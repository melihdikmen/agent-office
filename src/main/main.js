'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('./store');
const { Terminals } = require('./pty');
const { Workers, MODELS, PERMISSION_MODES, ROLE_PRESETS } = require('./workers');
const { Board, STATUSES } = require('./board');
const { Memory } = require('./memory');
const { Watch } = require('./watch');
const { Integrations } = require('./integrations');
const { courier, OWNER_TAG } = require('./courier');
const { startMcp } = require('./mcp');
const scanner = require('./scanner');

app.setName('Agent Office');
if (process.env.AGENT_OFFICE_DATA) app.setPath('userData', process.env.AGENT_OFFICE_DATA);

let win;
let store;
let terminals;

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

function findClaude(envPath) {
  const candidates = [...envPath.split(':').map((d) => path.join(d, 'claude')), path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
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
  // When the app itself was started from inside a Claude Code session, the workers
  // must not inherit its session markers (they would run as "child sessions").
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID|CLAUDE_JOB|CLAUDE_EFFORT)/.test(k)) delete env[k];
  const claudeBin = findClaude(envPath);
  terminals = new Terminals(env);
  const memory = new Memory(store);
  const watch = new Watch();
  const log = (line) => send('ev:log', { ts: Date.now(), line });

  // Workers reach the board through MCP; the token in the URL says who is calling.
  const workersRef = {};
  const mcp = await startMcp({
    resolveCaller: (token) => workersRef.current?.byToken(token) || null,
    log,
    handlers: {
      team_list: (c) => c.ws.workers.map((w) => { const v = workersRef.current.view(c.ws, w); return { name: w.name, role: w.role, lead: c.ws.lead === w.id, status: v.status, doing: c.ws.tasks.filter((t) => t.assignee === w.id && t.status === 'doing').map((t) => t.id) }; }),
      board_list: (c, a) => board.list(c.ws, a.status).map((t) => ({ id: t.id, title: t.title, status: t.status, assignee: board.who(c.ws, t.assignee), parent: t.parent, details: t.details.slice(0, 400) })),
      task_create: (c, a) => { const t = board.create(c.ws, { ...a, createdBy: c.worker.id }); return `${t.id} oluşturuldu (${t.status}${t.assignee ? `, ${board.who(c.ws, t.assignee)}` : ''})`; },
      task_update: (c, a) => { const t = board.update(c.ws, a.id, a, c.worker.id); return `${t.id}: ${t.status}${t.assignee ? ` · ${board.who(c.ws, t.assignee)}` : ''}`; },
      task_done: (c, a) => { const t = board.done(c.ws, a.id, a, c.worker.id); return `${t.id} kapatıldı. Rapor kaydedildi.`; },
      message: (c, a) => board.message(c.ws, c.worker.id, a.to, a.text),
      memory_note: (c, a) => memory.note(c.ws, c.worker, a.text, a.tags),
      memory_search: (c, a) => { const r = memory.search(c.ws, a.query); return r.length ? r.join('\n') : 'eşleşen not yok'; },
    },
  });
  // helper sessions the app spawns itself (couriers) — never shown as guests
  const runtime = { children: new Set() };
  const integrations = new Integrations(store);
  const workers = new Workers(store, terminals, memory, { claudeBin, mcp, scanner, integrations });
  workersRef.current = workers;
  const board = new Board(store, workers);

  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1100, minHeight: 700,
    title: 'Agent Office',
    backgroundColor: '#15120f',
    titleBarStyle: 'hiddenInset',
    show: !process.env.AGENT_OFFICE_OFFSCREEN,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // ---- state pushed to the renderer -----------------------------------------
  const activeWs = () => store.active;
  function state() {
    const ws = activeWs();
    return {
      workspaces: store.workspaces.map((w) => ({ id: w.id, name: w.name, dir: w.dir, workers: w.workers.length })),
      active: ws ? {
        id: ws.id, name: ws.name, dir: ws.dir, lead: ws.lead, layout: ws.layout,
        workers: ws.workers.map((w) => workers.view(ws, w)),
        tasks: ws.tasks, reports: ws.reports.slice(0, 100),
      } : null,
      terminals: terminals.list(),
      guests,
      handsOff: !!store.data.handsOff,
      presets: { roles: ROLE_PRESETS, models: MODELS, permissionModes: PERMISSION_MODES, statuses: STATUSES },
      integrations: integrations.list(),
      claudeBin, home: os.homedir(), mcpPort: mcp.port,
    };
  }
  const push = () => send('ev:state', state());
  workers.on('change', push);
  board.on('change', push);
  board.on('report', ({ task }) => {
    send('ev:report', task);
    if (Notification.isSupported() && (!win || win.isDestroyed() || !win.isFocused())) {
      new Notification({ title: `${task.id} tamamlandı`, body: `${task.title} — ${task.report?.summary?.slice(0, 120) || ''}` }).show();
    }
  });
  board.on('message', (m) => send('ev:message', m));
  terminals.on('data', (p) => send('ev:pty-data', p));
  terminals.on('exit', (p) => { send('ev:pty-exit', p); push(); });
  terminals.on('change', push);
  watch.on('change', () => send('ev:watch', watch.list().slice(0, 50)));

  // Guests: Claude sessions running elsewhere on this machine (other terminals, background).
  let guests = [];
  let guestTick = 0;
  async function scanGuests() {
    const mine = terminals.list().map((t) => t.pid);
    const found = await scanner.scan({ excludePids: [...mine, ...runtime.children] }).catch(() => []);
    // Only sessions opened in this office's folder (or below it) are guests here.
    const dir = activeWs()?.dir;
    const inside = (cwd) => !!dir && !!cwd && (cwd === dir || cwd.startsWith(dir.endsWith('/') ? dir : `${dir}/`));
    const ours = (id) => store.workspaces.some((w) => w.workers.some((x) => x.sessionId === id || x.pastSessions?.includes(id)));
    // A worker's earlier incarnation that outlived the app: stop it, the live one has the conversation now.
    for (const a of found) {
      if (a.pid && a.sessionId && store.workspaces.some((w) => w.workers.some((x) => x.sessionId !== a.sessionId && x.pastSessions?.includes(a.sessionId)))) { try { process.kill(a.pid, 'SIGTERM'); } catch { /* gone */ } }
    }
    guests = found.filter((a) => a.kind === 'claude-code' && a.sessionId && inside(a.cwd) && !ours(a.sessionId))
      .map((a) => ({ id: `g:${a.sessionId}`, sessionId: a.sessionId, pid: a.pid, jobId: a.jobId, background: a.background, name: a.name || a.session?.title || a.sessionId.slice(0, 8), project: a.project, cwd: a.cwd,
        status: a.status === 'active' ? 'working' : a.status, waitingFor: a.waitingFor, activity: a.session?.activity || null, lastPrompt: a.session?.lastPrompt || null, recap: a.session?.recap?.text || null,
        model: a.model, ctx: a.session?.ctx || 0, seed: a.seed, uptime: a.uptime, headless: a.headless }));
  }
  const guest = (id) => guests.find((g) => g.id === id);

  // Status loop: Claude's own registry says busy / idle / waiting per worker.
  const waiting = new Set();
  const loop = async () => {
    if (guestTick++ % 2 === 0) await scanGuests();
    const ws = activeWs();
    if (ws) {
      watch.start(ws.dir);
      const views = ws.workers.map((w) => workers.view(ws, w));
      for (const v of views) {
        if (v.status === 'waiting' && !waiting.has(v.id) && Notification.isSupported() && (!win || win.isDestroyed() || !win.isFocused())) {
          new Notification({ title: `${v.name} seni bekliyor`, body: v.waitingFor || 'onay ya da yanıt gerekiyor' }).show();
        }
        if (v.status === 'waiting') waiting.add(v.id); else waiting.delete(v.id);
      }
      board.tick(ws, views);
      workers.flush(ws);
    }
    push();
    setTimeout(loop, win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() ? 2000 : 8000);
  };
  loop();

  // The crew that was at work when the app last closed sits back down (same conversations).
  const ws0 = activeWs();
  if (ws0) for (const w of ws0.workers) if (w.wasRunning) { workers.start(ws0, w.id, { cols: 100, rows: 30 }); w.wasRunning = false; }

  // ---- IPC ---------------------------------------------------------------------
  const H = (ch, fn) => ipcMain.handle(ch, async (_e, arg) => { try { return await fn(arg || {}); } catch (e) { return { error: e.message }; } });
  const need = () => { const ws = activeWs(); if (!ws) throw new Error('Önce bir ofis (proje) oluştur.'); return ws; };

  H('state', () => state());
  H('open-path', ({ path: p }) => p && shell.openPath(p));
  H('choose-dir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: path.join(os.homedir(), 'Projects') });
    return r.canceled ? null : r.filePaths[0] || null;
  });

  H('ws-create', ({ name, dir }) => { if (!dir) throw new Error('Proje klasörü gerekli'); const ws = store.createWorkspace({ name, dir }); store.data.activeWorkspace = ws.id; store.save(); push(); return ws.id; });
  H('ws-switch', ({ id }) => { if (store.workspace(id)) { store.data.activeWorkspace = id; store.save(); push(); } return true; });
  H('ws-update', ({ id, name, layout, lead }) => { const ws = store.workspace(id) || need(); if (name) ws.name = String(name).trim(); if (layout !== undefined) ws.layout = layout; if (lead) ws.lead = lead; store.save(); push(); return true; });
  H('ws-remove', ({ id }) => { const ws = store.workspace(id); if (ws) for (const w of ws.workers) workers.stop(ws, w.id); store.removeWorkspace(id); push(); return true; });

  H('worker-create', (def) => workers.create(need(), def).id);
  H('worker-update', ({ id, patch }) => !!workers.update(need(), id, patch));
  H('worker-remove', ({ id }) => { workers.remove(need(), id); return true; });
  H('worker-start', ({ id, cols, rows }) => workers.start(need(), id, { cols, rows }));
  H('worker-stop', ({ id }) => workers.stop(need(), id));
  H('worker-send', ({ id, text }) => workers.send(need(), id, text));
  H('worker-memory', ({ id }) => { const ws = need(); const w = ws.workers.find((x) => x.id === id); return w ? memory.read(ws, w) : ''; });

  // ---- IPC: guests (sessions the office does not run) -----------------------
  const stopGuest = (g) => new Promise((resolve) => {
    if (g.background && /^[0-9a-f]{6,16}$/.test(g.jobId || '')) execFile(claudeBin, ['stop', g.jobId], { env, timeout: 20000 }, () => resolve(true));
    else { try { process.kill(g.pid, 'SIGTERM'); } catch { /* gone */ } resolve(true); }
  });
  H('guest-adopt', async ({ id, role, duties, model }) => {
    const ws = need();
    const g = guest(id);
    if (!g) throw new Error('Misafir artık görünmüyor');
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Vazgeç', 'Dahil et'], defaultId: 1, cancelId: 0,
      message: `${g.name} bu ofise katılsın mı?`,
      detail: `Oturum bulunduğu yerde durdurulur ve aynı konuşmayla burada, kendi terminalinde devam eder${g.cwd && g.cwd !== ws.dir ? ` (klasörü: ${g.cwd})` : ''}. Pano araçlarını alır.`,
    });
    if (r.response !== 1) return null;
    await stopGuest(g);
    await new Promise((res) => setTimeout(res, 1500));
    const w = workers.adopt(ws, g, { role, duties, model });
    guests = guests.filter((x) => x.id !== id);
    workers.start(ws, w.id, { cols: 100, rows: 30 });
    push();
    return w.id;
  });
  H('guest-message', async ({ id, text }) => {
    const g = guest(id);
    if (!g) throw new Error('Misafir artık görünmüyor');
    return courier({ claudeBin, env, children: runtime.children }, [{ to: g.name, text: `${OWNER_TAG} ${String(text || '').trim()}` }]);
  });
  H('guest-terminal', ({ id }) => {
    const g = guest(id);
    if (!g) throw new Error('Misafir artık görünmüyor');
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const cmd = g.background && g.jobId ? `cd ${q(g.cwd || os.homedir())} && ${q(claudeBin)} attach ${g.jobId}` : `cd ${q(g.cwd || os.homedir())} && ${q(claudeBin)} --resume ${g.sessionId} --fork-session`;
    execFile('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmd)}\ntell application "Terminal" to activate`]);
    return true;
  });

  H('term-shell', ({ cols, rows }) => { const ws = activeWs(); return terminals.create({ kind: 'shell', cwd: ws?.dir || os.homedir(), cols, rows }); });
  H('term-write', ({ id, data }) => { terminals.write(id, data); return true; });
  H('term-paste', ({ id, text }) => { terminals.paste(id, text); return true; });
  H('term-resize', ({ id, cols, rows }) => { terminals.resize(id, cols, rows); return true; });
  H('term-kill', ({ id }) => terminals.kill(id));
  H('term-buffer', ({ id }) => terminals.buffer(id));

  H('task-create', (def) => board.create(need(), { ...def, createdBy: 'user' }).id);
  H('task-update', ({ id, patch }) => board.update(need(), id, patch, 'user').id);
  H('task-done', ({ id, report }) => board.done(need(), id, report || { summary: 'Sahip kapattı.' }, 'user').id);
  H('task-remove', ({ id }) => { board.remove(need(), id); return true; });
  H('hands-off', ({ on }) => { store.data.handsOff = !!on; store.save(); push(); return !!on; });

  H('integration-set', ({ id, on, secret, env }) => integrations.set(id, { on, secret, env }));
  H('memory-graph', () => memory.graph(need()));
  H('memory-search', ({ query }) => memory.search(need(), query));
  H('watch-list', () => watch.list().slice(0, 100));
  H('watch-status', () => watch.status());
  H('watch-diff', ({ file }) => watch.diff(file));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (store && terminals) {
    for (const ws of store.workspaces) for (const w of ws.workers) w.wasRunning = terminals.get(`w:${w.id}`)?.exited === null;
    terminals.killAll();
    store.flush();
  }
});
