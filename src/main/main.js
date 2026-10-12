'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Notification, session, systemPreferences, Tray, Menu, nativeImage, safeStorage } = require('electron');
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
const { Notifier } = require('./notify');
const { ENGINES, findBin } = require('./engines');
const worktree = require('./worktree');
const { Stt } = require('./stt');
const { Chat } = require('./chat');
const langMod = require('./lang');
const files = require('./files');
const { Designs } = require('./designs');
const { Decisions } = require('./decisions');
const { Skills } = require('./skills');
const speaker = require('./speak');
const doctor = require('./doctor');
const backup = require('./backup');
const github = require('./github');
const { WebTool } = require('./webtool');
const trackers = require('./trackers');
const { AppTray } = require('./tray');
const updates = require('./updates');
const changelog = require('./changelog');
const scanner = require('./scanner');

app.setName('Agent Office');
// Crash journal: anything that escapes is written down (and the app keeps running).
function journal(kind, err) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `${new Date().toISOString()} ${kind}: ${err?.stack || err}\n`); } catch { /* nothing more to do */ }
}
process.on('uncaughtException', (e) => journal('uncaughtException', e));
process.on('unhandledRejection', (e) => journal('unhandledRejection', e));
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

function send(channel, payload) {                       // every window: the main one and any popped-out terminals
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

async function createWindow() {
  store = new Store(app.getPath('userData'));
  langMod.setLang(store.data.lang);
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
  const decisionsRef = {};
  const designs = new Designs(store);
  const webtoolRef = { current: new WebTool({ BrowserWindow }, path.join(app.getPath('userData'), 'screenshots'), (l) => log(l)) };
  const mcp = await startMcp({
    resolveCaller: (token) => workersRef.current?.byToken(token) || null,
    log,
    handlers: {
      team_list: (c) => c.ws.workers.map((w) => { const v = workersRef.current.view(c.ws, w); return { name: w.name, role: w.role, lead: c.ws.lead === w.id, status: v.status, doing: c.ws.tasks.filter((t) => t.assignee === w.id && t.status === 'doing').map((t) => t.id) }; }),
      board_list: (c, a) => board.list(c.ws, a.status).map((t) => ({ id: t.id, title: t.title, status: t.status, assignee: board.who(c.ws, t.assignee), parent: t.parent, details: t.details.slice(0, 400) })),
      task_create: (c, a) => { const t = board.create(c.ws, { ...a, createdBy: c.worker.id }); return `${t.id} oluşturuldu (${t.status}${t.assignee ? `, ${board.who(c.ws, t.assignee)}` : ''})`; },
      task_update: (c, a) => { const t = board.update(c.ws, a.id, a, c.worker.id); return `${t.id}: ${t.status}${t.assignee ? ` · ${board.who(c.ws, t.assignee)}` : ''}`; },
      task_done: (c, a) => { const t = board.done(c.ws, a.id, a, c.worker.id); return `${t.id} kapatıldı. Rapor kaydedildi.`; },
      design_save: (c, a) => { const r = designs.save(c.ws, c.worker, a); push(); send('ev:design', { id: r.design.id, v: r.v }); return `${r.design.id} v${r.v} kaydedildi; sahip Tasarım sekmesinde görecek. Dosya: ${r.file}`; },
      skill_propose: (c, a) => { const p = skills.propose(c.worker, a); push(); return `Öneri sahibe iletildi (${p.name}). Onaylanırsa beceri merkezine eklenir.`; },
      ask_owner: (c, a) => { const d = decisionsRef.current.ask(c.ws, c.worker.id, a); return `${d.id} sahibe iletildi. Cevap terminaline "[Karar ${d.id}] …" olarak gelecek; o zamana kadar bu karara bağlı olmayan işe devam et.`; },
      web_read: (c, a) => webtoolRef.current.read(a.url),
      web_screenshot: async (c, a) => `Ekran görüntüsü: ${await webtoolRef.current.shot(a.url, a)}`,
      message: (c, a) => board.message(c.ws, c.worker.id, a.to, a.text),
      memory_note: (c, a) => memory.note(c.ws, c.worker, a.text, a.tags),
      memory_search: (c, a) => { const r = memory.search(c.ws, a.query); return r.length ? r.join('\n') : 'eşleşen not yok'; },
    },
  });
  // helper sessions the app spawns itself (couriers) — never shown as guests
  const runtime = { children: new Set() };
  const integrations = new Integrations(store);
  const skills = new Skills(store, app.getPath('userData'));
  const workers = new Workers(store, terminals, memory, { claudeBin, mcp, scanner, integrations, envPath, dataDir: app.getPath('userData'), skills });
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
        tasks: ws.tasks, reports: ws.reports.slice(0, 100), designs: (ws.designs || []).slice(0, 60), chat: (ws.chat || []).slice(-150),
      } : null,
      terminals: terminals.list(),
      guests,
      handsOff: !!store.data.handsOff,
      notify: notifier.view(),
      decisions: ws ? (ws.decisions || []).slice(0, 100) : [],
      skillProposals: skills.proposals(),
      skills: skills.all().map((s) => ({ id: s.id, name: s.name, description: s.description, builtin: s.builtin, body: s.builtin ? undefined : s.body })),
      app: { version: app.getVersion(), lastSeen: store.data.lastSeenVersion || null, tourDone: !!store.data.tourDone, lang: store.data.lang || 'tr', changelog: changelog.slice(0, 12), updateFeed: store.data.updateFeed || '', update: store.data.updateResult || null },
      presets: { engines: Object.fromEntries(Object.entries(ENGINES).map(([k, e]) => [k, { label: e.label, models: e.models, hint: e.modelHint || '', installed: k === 'claude' || !!findBin(e.bin, envPath) }])), roles: ROLE_PRESETS, models: MODELS, permissionModes: PERMISSION_MODES, statuses: STATUSES },
      integrations: integrations.list(),
      claudeBin, home: os.homedir(), mcpPort: mcp.port,
    };
  }
  const push = () => send('ev:state', state());
  workers.on('change', push);
  board.on('change', push);
  const notifier = new Notifier({
    store, send, win: () => win,
    speak: (n) => { const t = speaker.phrase(n); if (t) speaker.speak(t, store.data.lang || 'tr'); },
    onOpen: (ref) => {
      if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      if (ref.wsId && store.data.activeWorkspace !== ref.wsId && store.workspace(ref.wsId)) { store.data.activeWorkspace = ref.wsId; store.save(); push(); }
      send('ev:notify-open', ref);
    },
  });
  board.on('report', ({ wsId, task }) => {
    send('ev:report', task);
    const ws = store.workspace(wsId);
    if (ws) notifier.taskDone(ws, task, board.who(ws, task.report?.by));
  });
  board.on('assigned', ({ wsId, task, by, assignee }) => { const ws = store.workspace(wsId); if (ws) notifier.taskAssigned(ws, task, by, assignee); });
  const decisions = new Decisions(store, workers, notifier);
  decisionsRef.current = decisions;
  const chat = new Chat(store, workers);
  chat.on('change', push);
  workers.on('limit', ({ ws, worker, parked }) => notifier.limitHit(ws, worker, parked));
  workers.on('budget', ({ ws, worker, spent, budget, stopped }) => notifier.budgetHit(ws, worker, { spent, budget, stopped }));
  workers.on('limit-resume', ({ ws, worker }) => notifier.limitResumed(ws, worker));
  decisions.on('change', push);
  board.on('message', (m) => { send('ev:message', m); const ws = store.workspace(m.wsId); if (ws) chat.fromAgent(ws, m.from, m.to === 'user' ? 'sahip' : m.to, m.text); });
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
  const showWin = () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } };
  let tray = null;
  try {
    tray = new AppTray({ Tray, Menu, nativeImage }, {
      show: showWin,
      decisions: () => { showWin(); send('ev:notify-open', { type: 'decision' }); },
      toggleAutopilot: () => { store.data.handsOff = !store.data.handsOff; store.save(); push(); },
      worker: (id) => { showWin(); send('ev:notify-open', { type: 'worker', id, wsId: store.data.activeWorkspace }); },
      quit: () => app.quit(),
    });
  } catch { tray = null; }
  const loop = async () => {
    if (guestTick++ % 2 === 0) await scanGuests();
    const ws = activeWs();
    if (ws) {
      watch.start(ws.dir);
      const views = ws.workers.map((w) => workers.view(ws, w));
      board.tick(ws, views);
      workers.flush(ws);
    }
    if (tray) { const w0 = activeWs(); tray.update(w0 ? w0.workers.map((w) => workers.view(w0, w)) : [], w0 ? (w0.decisions || []).filter((d) => d.status === 'open').length : 0, !!store.data.handsOff); }
    for (const o of store.workspaces) { const vs = o.workers.map((w) => workers.view(o, w)); notifier.tick(o, vs); workers.limitTick(o, vs); workers.budgetTick(o, vs); chat.tick(o, vs); try { decisionsRef.current?.tick(o); } catch { /* answer failed; retried next tick */ } }   // every project, not only the open one
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
  H('worker-remove', ({ id }) => { if (!workers.remove(need(), id)) throw new Error('Çalışan bulunamadı (zaten silinmiş olabilir).'); return true; });
  H('worker-start', ({ id, cols, rows }) => workers.start(need(), id, { cols, rows }));
  H('worker-stop', ({ id }) => workers.stop(need(), id));
  H('chat-send', ({ text }) => { try { return { to: chat.ownerSend(need(), text) }; } catch (e) { return { error: e.message }; } });
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
      type: 'question', buttons: [langMod.tt('Vazgeç', 'Cancel'), langMod.tt('Dahil et', 'Add it')], defaultId: 1, cancelId: 0,
      message: langMod.tt(`${g.name} bu ofise katılsın mı?`, `Should ${g.name} join this office?`),
      detail: langMod.tt(`Oturum bulunduğu yerde durdurulur ve aynı konuşmayla burada, kendi terminalinde devam eder${g.cwd && g.cwd !== ws.dir ? ` (klasörü: ${g.cwd})` : ''}. Pano araçlarını alır.`, `The session is stopped where it is and continues here, in its own terminal, with the same conversation${g.cwd && g.cwd !== ws.dir ? ` (folder: ${g.cwd})` : ''}. It gets the board tools.`),
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
  H('report-review', ({ id, action, text, anchor }) => { const r = board.reviewReport(need(), id, { action, text, anchor }); push(); return r.review.status; });
  H('task-done', ({ id, report }) => board.done(need(), id, report || { summary: 'Sahip kapattı.' }, 'user').id);
  H('task-remove', ({ id }) => { board.remove(need(), id); return true; });
  const stt = new Stt({ dataDir: app.getPath('userData'), envPath, store });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'clipboard-sanitized-write'));
  H('worker-unpark', ({ id, resume }) => { workers.unpark(need(), id, { resume: !!resume }); push(); return true; });
  H('doctor', async () => doctor.check({ claudeBin, envPath, dataDir: app.getPath('userData'), stt, micStatus: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted' }));
  H('backup-export', async () => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `AgentOffice-${langMod.tt('yedek', 'backup')}-${backup.stamp()}.zip`), filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    backup.exportZip(store, app.getPath('userData'), r.filePath);
    shell.showItemInFolder(r.filePath);
    return { file: r.filePath };
  });
  const dailyBackup = () => { try { backup.daily(store, app.getPath('userData')); } catch { /* backups are best effort */ } };
  dailyBackup(); setInterval(dailyBackup, 6 * 3600 * 1000);
  H('pr-open', async ({ id, title, body }) => {
    const { ws, w } = wtOf(id);
    const st = worktree.status(ws, w);
    if (!st.exists || !st.ahead) throw new Error('Açılacak commit yok.');
    if (st.dirty.length) throw new Error('Worktree\'de commitlenmemiş değişiklik var; önce commit et.');
    const last = ws.reports.find((r) => r.by === w.id);
    const t = title || (last ? `${last.taskId}: ${last.title}` : `${w.name}: ${st.branch}`);
    const b = body || [last ? last.summary : '', '', '### Commitler', ...st.commits.map((c) => `- ${c}`), '', `_Agent Office · ${w.name}_`].join('\n');
    return { url: await github.openPr(envPath, ws, w, { title: t, body: b }) };
  });
  // Linear / Jira credentials live encrypted with the system keychain (safeStorage), never in plain text.
  const seal = (v) => (safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(String(v)).toString('base64') } : (() => { throw new Error('Sistem anahtar zinciri kullanılamıyor.'); })());
  const unseal = (o) => (o?.enc ? safeStorage.decryptString(Buffer.from(o.enc, 'base64')) : '');
  H('tracker-status', () => { const t = store.data.trackers || {}; return { linear: !!t.linear?.secret, jira: t.jira?.secret ? { site: t.jira.site, email: t.jira.email } : null }; });
  H('tracker-save', ({ kind, site, email, secret }) => {
    if (!String(secret || '').trim()) throw new Error('Anahtar boş olamaz.');
    store.data.trackers ||= {};
    store.data.trackers[kind] = kind === 'jira' ? { site: String(site || '').trim(), email: String(email || '').trim(), secret: seal(secret.trim()) } : { secret: seal(secret.trim()) };
    store.save(); return true;
  });
  H('tracker-forget', ({ kind }) => { if (store.data.trackers) delete store.data.trackers[kind]; store.save(); return true; });
  H('tracker-issues', async ({ kind, jql }) => {
    const t = (store.data.trackers || {})[kind];
    if (!t?.secret) throw new Error('Önce hesabı bağla.');
    return { items: kind === 'linear' ? await trackers.linearIssues(unseal(t.secret)) : await trackers.jiraIssues({ site: t.site, email: t.email, token: unseal(t.secret) }, jql) };
  });
  H('issues-list', async () => ({ items: await github.issues(envPath, need()) }));
  H('tasks-import', ({ items }) => {
    const ws = need(); let n = 0;
    for (const it of (items || []).slice(0, 100)) { if (String(it.title || '').trim()) { board.create(ws, { title: String(it.title).slice(0, 200), details: String(it.details || '').slice(0, 4000), createdBy: 'user' }); n++; } }
    push(); return { count: n };
  });
  H('parse-list', ({ text }) => ({ items: github.parseList(text) }));
  const popouts = new Map();                                // terminal id → window
  H('popout-open', ({ id }) => {
    if (!terminals.get(id)) throw new Error('Terminal yok.');
    const ex = popouts.get(id);
    if (ex && !ex.isDestroyed()) { ex.show(); ex.focus(); return true; }
    const pw = new BrowserWindow({ width: 920, height: 620, minWidth: 360, minHeight: 240, backgroundColor: '#15120f', title: terminals.get(id).title || 'Terminal', show: !process.env.AGENT_OFFICE_OFFSCREEN,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    pw.loadFile(path.join(__dirname, '..', 'renderer', 'popout.html'), { query: { id } });
    popouts.set(id, pw);
    pw.on('closed', () => popouts.delete(id));
    return true;
  });
  H('skill-proposal-accept', ({ id }) => { const r = skills.acceptProposal(id); push(); return r; });
  H('skill-proposal-dismiss', ({ id }) => { skills.dismissProposal(id); push(); return true; });
  H('skill-suggest-ask', ({ id }) => {
    const ws = need(); const w = ws.workers.find((x) => x.id === (id || ws.lead)) || ws.workers[0];
    if (!w) throw new Error('Ofiste çalışan yok.');
    if (!workers.running(w.id)) workers.start(ws, w.id);
    workers.send(ws, w.id, '[Sahip] Hafızana (memory_search) ve yakın zamanda yaptığın işlere bak: tekrar eden, genelleştirilebilir çalışma biçimleri var mı? Varsa her biri için skill_propose çağır (en fazla 3, somut ve kısa). Yoksa "öneri yok" de.');
    return { name: w.name };
  });
  H('skill-get', ({ id }) => skills.find(id)?.body || '');
  H('skill-save', (p) => { const id = skills.save(p); push(); return id; });
  H('skill-delete', ({ id }) => { skills.remove(id); push(); return true; });
  H('decision-answer', ({ id, answer }) => { const d = decisions.answer(need(), id, answer); push(); return d.id; });
  H('stt-status', () => stt.status());
  H('stt-setup', async () => { await stt.setup((text, pct) => send('ev:stt-progress', { text, pct })); return { ok: true }; });
  H('stt-transcribe', async ({ wav, lang }) => ({ text: await stt.transcribe(Buffer.from(wav), { lang: lang === 'en' ? 'en' : 'tr' }) }));
  H('mic-access', async () => (process.platform === 'darwin' && !process.env.AO_MIC_SKIP ? systemPreferences.askForMediaAccess('microphone') : true));
  const wtOf = (id) => { const ws = need(); const w = ws.workers.find((x) => x.id === id); if (!w) throw new Error('Çalışan yok'); return { ws, w }; };
  H('annot-send', ({ id, png, url, width, height, notes }) => {
    const { ws, w } = wtOf(id);
    const dir = path.join(app.getPath('userData'), 'annotations');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(String(png), 'base64'));
    for (const old of fs.readdirSync(dir).sort().slice(0, -40)) { try { fs.unlinkSync(path.join(dir, old)); } catch { /* best effort */ } }
    const lines = (notes || []).slice(0, 20).map((n) => `${n.n}) (${n.x},${n.y})${n.target ? ` ${n.target}` : ''} — ${String(n.text).slice(0, 400)}`);
    const text = `[İşaretli ekran · Sahip] Sayfa: ${url} (${width}×${height})\nGörüntü (numaralı kırmızı noktalar): ${file}\n${lines.join('\n')}\n(Görüntüyü Read ile aç, notları sırayla uygula; bitince kısaca haber ver.)`;
    if (!workers.running(w.id)) workers.start(ws, w.id);
    workers.send(ws, w.id, text);
    return { file };
  });
  const rootOf = (root) => {
    const ws = need();
    if (!root || root === 'project') return { ws, dir: ws.dir, w: null };
    const w = ws.workers.find((x) => x.id === root);
    if (!w?.worktreePath || !fs.existsSync(w.worktreePath)) throw new Error('Bu çalışanın worktree klasörü yok.');
    return { ws, dir: w.worktreePath, w };
  };
  H('fs-roots', () => { const ws = need(); return [{ id: 'project', label: ws.name, dir: ws.dir }, ...ws.workers.filter((w) => w.worktree && w.worktreePath && fs.existsSync(w.worktreePath)).map((w) => ({ id: w.id, label: `${w.name} · dal`, dir: w.worktreePath }))]; });
  H('fs-list', ({ root, path: p }) => files.list(rootOf(root).dir, p || ''));
  H('fs-read', ({ root, path: p }) => files.read(rootOf(root).dir, p));
  H('fs-write', ({ root, path: p, text }) => files.write(rootOf(root).dir, p, text));
  H('fs-create', ({ root, path: p, dir }) => files.create(rootOf(root).dir, p, !!dir));
  H('fs-rename', ({ root, from, to }) => files.rename(rootOf(root).dir, from, to));
  H('fs-trash', async ({ root, path: p }) => { await shell.trashItem(files.inside(rootOf(root).dir, p)); return true; });
  H('fs-reveal', ({ root, path: p }) => { shell.showItemInFolder(files.inside(rootOf(root).dir, p || '.')); return true; });
  H('fs-abs', ({ root, path: p }) => files.inside(rootOf(root).dir, p || '.'));
  H('fs-mtime', ({ root, path: p }) => files.mtime(rootOf(root).dir, p));
  H('fs-walk', ({ root }) => files.walk(rootOf(root).dir));
  H('editor-send', ({ worker, file, from, to, code, comment }) => {
    const { ws } = rootOf('project');
    const w = ws.workers.find((x) => x.id === worker);
    if (!w) throw new Error('Çalışan yok.');
    const where = from ? `${file}:${from}${to && to !== from ? `-${to}` : ''}` : file;
    const snippet = code ? `\n\`\`\`\n${String(code).slice(0, 3000)}\n\`\`\`` : '';
    if (!workers.running(w.id)) workers.start(ws, w.id);
    workers.send(ws, w.id, `[Kod · Sahip] ${where}${snippet}\n${String(comment || '').slice(0, 1500) || '(bu koda bak)'}`);
    return true;
  });
  H('design-get', ({ id, v }) => { const r = designs.get(need(), id, v); return { html: r.html, v: r.v, file: r.file }; });
  H('design-approve', ({ id, on, note }) => {
    const ws = need(); const d = designs.approve(ws, id, on !== false);
    if (d.status === 'approved') { const w = ws.workers.find((x) => x.id === ws.lead) || ws.workers.find((x) => x.id === d.by); if (w) { if (!workers.running(w.id)) workers.start(ws, w.id); workers.send(ws, w.id, `[Tasarım · Sahip] ${d.id} "${d.title}" v${d.versions.at(-1).v} onaylandı${note ? `: ${String(note).slice(0, 300)}` : ''}. Geliştirmeye başla: görevlere böl ve ekibe dağıt.`); } }
    push(); return d;
  });
  H('design-import', ({ title, html }) => { const r = designs.save(need(), null, { title, html, summary: 'içe aktarıldı' }); push(); return { id: r.design.id, v: r.v }; });
  H('design-delete', ({ id }) => { designs.remove(need(), id); push(); return true; });
  H('design-request', ({ to, text }) => {
    const ws = need(); const w = ws.workers.find((x) => x.id === to) || ws.workers.find((x) => x.id === ws.lead) || ws.workers[0];
    if (!w) throw new Error('Ofiste çalışan yok.');
    const t = String(text || '').trim().slice(0, 1500); if (!t) throw new Error('Ne tasarlanacağını yaz.');
    if (!workers.running(w.id)) workers.start(ws, w.id);
    workers.send(ws, w.id, `[Tasarım isteği · Sahip] ${t}\n(Kod yazma; yalnızca tasarım taslağı hazırla: kendi içinde tam bir HTML'i design_save ile kaydet.)`);
    return { name: w.name };
  });
  H('design-feedback', ({ id, v, to, png, notes, width, height }) => {
    const ws = need(); const { design, file } = designs.get(ws, id, v);
    const w = ws.workers.find((x) => x.id === to) || ws.workers.find((x) => x.id === design.by);
    if (!w) throw new Error('Çalışan yok.');
    const dir = path.join(app.getPath('userData'), 'annotations'); fs.mkdirSync(dir, { recursive: true });
    const shot = path.join(dir, `${Date.now()}.png`); if (png) fs.writeFileSync(shot, Buffer.from(String(png), 'base64'));
    const lines = (notes || []).slice(0, 20).map((n) => `${n.n}) (%${n.px},%${n.py})${n.target ? ` ${n.target}` : ''} — ${String(n.text).slice(0, 400)}`);
    if (!workers.running(w.id)) workers.start(ws, w.id);
    workers.send(ws, w.id, `[Tasarım · Sahip] ${design.id} "${design.title}" v${v} için geri bildirim (${width}×${height})\n${png ? `Görüntü (numaralı kırmızı noktalar): ${shot}\n` : ''}Tasarım dosyası: ${file}\n${lines.join('\n')}\n(Notları uygula ve design_save ile AYNI başlıkla yeni sürüm kaydet.)`);
    return true;
  });
  H('capture-rect', async ({ x, y, w, h }) => { const img = await win.webContents.capturePage({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }); return img.toPNG().toString('base64'); });
  H('review-list', () => {
    const ws = activeWs(); if (!ws) return [];
    return ws.workers.filter((w) => w.worktree && w.worktreePath).map((w) => {
      const st = worktree.status(ws, w);
      return { id: w.id, name: w.name, role: w.role, color: w.color, status: st, files: st.exists ? worktree.files(ws, w) : [], comments: (w.reviewNotes || []).slice(-60) };
    });
  });
  H('review-diff', ({ id, file }) => { const { ws, w } = wtOf(id); return worktree.diff(ws, w, file); });
  H('review-comment', ({ id, file, line, text }) => {
    const { ws, w } = wtOf(id);
    const t = String(text || '').trim().slice(0, 1500);
    if (!t) throw new Error('Yorum boş olamaz.');
    (w.reviewNotes ||= []).push({ file, line: Number(line) || 0, text: t, ts: Date.now() });
    if (w.reviewNotes.length > 200) w.reviewNotes.splice(0, w.reviewNotes.length - 200);
    store.save();
    if (!workers.running(w.id)) workers.start(ws, w.id);
    workers.send(ws, w.id, `[İnceleme · Sahip] ${file}${line ? `:${line}` : ''} — ${t}\n(Düzeltip commit'le; bittiğinde kısaca haber ver.)`);
    push();
    return true;
  });
  H('worktree-status', ({ id }) => { const { ws, w } = wtOf(id); return worktree.status(ws, w); });
  H('worktree-commit', ({ id, message }) => { const { w } = wtOf(id); const r = worktree.commit(w, message); push(); return r; });
  H('worktree-merge', ({ id }) => { const { ws, w } = wtOf(id); const r = worktree.merge(ws, w); push(); return r; });
  H('worktree-remove', ({ id, deleteBranch }) => { const { ws, w } = wtOf(id); workers.stop(ws, id); worktree.remove(ws, w, { deleteBranch: !!deleteBranch }); w.worktree = false; store.save(); push(); return true; });
  H('app-ack', ({ tour, lang }) => { store.data.lastSeenVersion = app.getVersion(); if (tour) store.data.tourDone = true; if (lang) { store.data.lang = lang === 'en' ? 'en' : 'tr'; langMod.setLang(store.data.lang); } store.save(); push(); return true; });
  H('open-url', ({ url }) => { if (/^https?:\/\//i.test(url || '')) shell.openExternal(url); return true; });
  const runUpdateCheck = async (feed, quiet) => {
    try {
      const r = await updates.check(feed, app.getVersion());
      store.data.updateResult = { ...r, checkedAt: Date.now() };
      if (r.newer && !quiet) send('ev:update', r);
      if (r.newer && quiet && store.data.updateNotified !== r.version) { store.data.updateNotified = r.version; send('ev:update', r); }
      store.save(); push();
      return store.data.updateResult;
    } catch (e) { if (!quiet) return { error: e.message }; return null; }
  };
  H('update-check', async ({ feed }) => { if (feed !== undefined) { store.data.updateFeed = String(feed).trim(); store.save(); } return runUpdateCheck(store.data.updateFeed, false); });
  setInterval(() => { if (store.data.updateFeed) runUpdateCheck(store.data.updateFeed, true); }, 6 * 3600 * 1000);
  setTimeout(() => { if (store.data.updateFeed) runUpdateCheck(store.data.updateFeed, true); }, 15000);
  H('notify-set', (p) => { const r = notifier.setPrefs(p); push(); return r; });
  H('notify-read', ({ id }) => { notifier.read(id); push(); return true; });
  H('notify-clear', () => { notifier.clear(); push(); return true; });
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
