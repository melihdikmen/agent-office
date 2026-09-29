'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('./store');
const { AgentManager } = require('./agents');
const scanner = require('./scanner');

app.setName('Agent Office');
if (process.env.AGENT_OFFICE_DATA) app.setPath('userData', process.env.AGENT_OFFICE_DATA);

let win;
let store;
let manager;

// Apps launched from Finder get a minimal PATH; borrow the login shell's.
function loginShellPath() {
  return new Promise((resolve) => {
    const sh = process.env.SHELL || '/bin/zsh';
    execFile(sh, ['-ilc', 'printf "__P__%s__P__" "$PATH"'], { timeout: 5000 }, (_e, out) => {
      const m = String(out || '').match(/__P__(.*)__P__/);
      resolve(m ? m[1] : process.env.PATH);
    });
  });
}

function findClaude(envPath, configured) {
  const candidates = [configured, ...envPath.split(':').map((d) => path.join(d, 'claude')), path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  return candidates.find((c) => c && fs.existsSync(c)) || 'claude';
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function createWindow() {
  store = new Store(app.getPath('userData'));
  const envPath = await loginShellPath();
  const env = { ...process.env, PATH: envPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const runtime = { claudeBin: findClaude(envPath, store.settings.claudePath), env };
  manager = new AgentManager(store, runtime);

  for (const ev of ['agent', 'message', 'log', 'tasks', 'cost', 'paused', 'system', 'reset', 'log-reset']) {
    manager.on(ev, (payload) => send(`ev:${ev}`, payload));
  }
  manager.on('notify', (msg) => {
    const from = manager.agent(msg.from);
    if (Notification.isSupported() && (!win || !win.isFocused())) {
      new Notification({ title: `${from?.name || msg.from} → sana`, body: msg.text.slice(0, 200) }).show();
    }
  });

  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 700,
    title: 'Agent Office',
    backgroundColor: '#14161c',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // Dev aid: AGENT_OFFICE_KICKOFF="text" sends a brief to the PM once the window is up.
  if (process.env.AGENT_OFFICE_KICKOFF) {
    win.webContents.once('did-finish-load', () => setTimeout(() => manager.sendFromUser('pm', process.env.AGENT_OFFICE_KICKOFF), 1500));
  }

  // Dev aid: AGENT_OFFICE_SNAPSHOT=/path.png [AGENT_OFFICE_SNAPSHOT_AFTER=ms] saves a screenshot periodically.
  if (process.env.AGENT_OFFICE_SNAPSHOT) {
    const every = +process.env.AGENT_OFFICE_SNAPSHOT_AFTER || 4000;
    let n = 0;
    setInterval(async () => {
      if (win.isDestroyed()) return;
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.AGENT_OFFICE_SNAPSHOT.replace('%d', String(++n)), img.toPNG());
    }, every);
  }

  // ---- IPC -----------------------------------------------------------------
  ipcMain.handle('state', () => ({ ...manager.state(), claudeBin: runtime.claudeBin }));
  ipcMain.handle('logs', (_e, id) => manager.logs(id));
  ipcMain.handle('send', (_e, { to, text }) => manager.sendFromUser(to, text));
  ipcMain.handle('release', (_e, id) => manager.release(id));
  ipcMain.handle('pause', (_e, p) => manager.setPaused(p));
  ipcMain.handle('stop-all', () => manager.stopAll());
  ipcMain.handle('stop-agent', (_e, id) => manager.stopAgent(id));
  ipcMain.handle('clear-inbox', (_e, id) => manager.clearInbox(id));
  ipcMain.handle('reset-session', (_e, id) => manager.resetSession(id));
  ipcMain.handle('task-create', (_e, t) => manager.createTask({ ...t, createdBy: 'user' }));
  ipcMain.handle('task-update', (_e, { id, patch }) => manager.updateTask(id, patch, 'user'));
  ipcMain.handle('task-delete', (_e, id) => manager.deleteTask(id));

  ipcMain.handle('choose-project', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: store.settings.projectDir || path.join(os.homedir(), 'Projects') });
    if (r.canceled || !r.filePaths[0]) return null;
    manager.switchProject();
    store.updateSettings({ projectDir: r.filePaths[0] });
    manager.paused = false;
    return { ...manager.state(), claudeBin: runtime.claudeBin };
  });

  ipcMain.handle('update-settings', (_e, patch) => {
    const s = store.updateSettings(patch);
    if (patch.claudePath !== undefined) runtime.claudeBin = findClaude(envPath, s.claudePath);
    if (patch.team) {
      for (const id of [...manager.rt.keys()]) if (!manager.agent(id)) manager.stopAgent(id);
    }
    return { ...manager.state(), claudeBin: runtime.claudeBin };
  });

  ipcMain.handle('open-path', (_e, p) => p && shell.openPath(p));

  // ---- radar: agents running elsewhere on this machine ---------------------
  ipcMain.handle('scan', () => scanner.scan({ excludePids: manager.pids() }));

  ipcMain.handle('ext-kill', async (_e, { pid, label }) => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Vazgeç', 'Durdur'], defaultId: 0, cancelId: 0,
      message: `${label} (PID ${pid}) durdurulsun mu?`,
      detail: 'Sürece SIGTERM gönderilir. Kaydedilmemiş iş kaybolabilir.',
    });
    if (r.response !== 1) return false;
    try { process.kill(pid, 'SIGTERM'); return true; } catch (e) { return e.message; }
  });

  ipcMain.handle('ext-terminal', (_e, { cwd, sessionId }) => {
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const cmd = `cd ${q(cwd || os.homedir())} && ${q(runtime.claudeBin)}${sessionId ? ` --resume ${sessionId} --fork-session` : ''}`;
    const script = `tell application "Terminal" to do script ${JSON.stringify(cmd)}\ntell application "Terminal" to activate`;
    execFile('osascript', ['-e', script]);
    return true;
  });

  // Ask a running Claude Code session a question through a throwaway fork,
  // so the original session is not disturbed.
  ipcMain.handle('ext-ask', (_e, { cwd, sessionId, question }) => new Promise((resolve) => {
    if (!/^[0-9a-f-]{36}$/.test(sessionId || '')) return resolve({ error: 'geçersiz oturum' });
    const args = ['-p', '--resume', sessionId, '--fork-session', '--no-session-persistence', '--output-format', 'json', '--permission-mode', 'plan'];
    const p = spawn(runtime.claudeBin, args, { cwd: cwd || os.homedir(), env });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ error: e.message }));
    p.on('close', () => {
      try { const j = JSON.parse(out); resolve({ text: j.result, cost: j.total_cost_usd }); } catch { resolve({ error: (err || out).slice(-500) || 'çıktı yok' }); }
    });
    p.stdin.end(question);
  }));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (manager) for (const id of manager.rt.keys()) manager.stopAgent(id);
  if (store) store.flush();
});
