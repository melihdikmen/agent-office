'use strict';
// The crew: named workers with a role, a model, a persistent memory file and their
// own terminal running Claude Code. Starting a worker spawns `claude` in a pty with
// the office briefing and the office MCP tools; talking to it means typing into
// that terminal.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { id } = require('./store');
const { ENGINES, findBin, launch, Activity, stripAnsi } = require('./engines');
const limits = require('./limits');
const worktree = require('./worktree');

const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'plan'];
// Everyday commands a worker may run without a prompt, whatever the permission mode.
const SAFE_TOOLS = ['Bash(npm *)', 'Bash(npx *)', 'Bash(pnpm *)', 'Bash(yarn *)', 'Bash(node *)', 'Bash(python3 *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git add *)', 'Bash(git commit *)',
  'Bash(ls *)', 'Bash(cat *)', 'Bash(pwd*)', 'Bash(mkdir *)', 'Bash(wc *)', 'Bash(head *)', 'Bash(tail *)', 'Bash(grep *)', 'Bash(find *)', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebFetch', 'WebSearch'];
const NAMES = ['Nova', 'Kai', 'Ada', 'Rio', 'Sol', 'Lux', 'Max', 'Mira', 'Deniz', 'Ege', 'Arda', 'Lara', 'Can', 'Eda', 'Ozan', 'Naz', 'Bora', 'Ela', 'Mert', 'Zey'];
const ROLE_PRESETS = [
  { role: 'Lider', lead: true, duties: 'Sahibin hedefini alır, alt görevlere böler, takıma dağıtır, ilerlemeyi takip eder ve sonunda özet raporu verir. Kendi payına düşen işi de yapar.' },
  { role: 'Frontend Geliştirici', duties: 'Arayüz, istemci tarafı mantık ve stiller; kendi kodunun testleri.' },
  { role: 'Backend Geliştirici', duties: 'API, veri modeli, servisler ve entegrasyonlar; kendi kodunun testleri.' },
  { role: 'QA', duties: 'Biten işi doğrular: build, test, diff; hata bulursa repro adımlarıyla görev açar.' },
  { role: 'Tasarımcı', duties: 'Kullanıcı akışları, yerleşim, metinler ve görsel tutarlılık; spec yazar, arayüz değişikliklerini gözden geçirir.' },
  { role: 'Araştırmacı', duties: 'Rakipleri, kütüphaneleri ve seçenekleri araştırır; kısa, kaynaklı özetler yazar.' },
  { role: 'Pazarlama', duties: 'Konumlandırma, hedef kitle, kampanya planı, metinler.' },
  { role: 'İçerik Yazarı', duties: 'Açılış sayfası, blog, e-posta ve sosyal medya metinleri.' },
  { role: 'SEO Uzmanı', duties: 'Anahtar kelime ve rakip araştırması, sayfa içi SEO, içerik yapısı.' },
  { role: 'DevOps', duties: 'Build, CI/CD, ortam ayarları, bağımlılık güncellemeleri, yayın.' },
];

function briefing(ws, worker, memoryFile, extra = []) {
  const mates = ws.workers.filter((w) => w.id !== worker.id);
  const lead = ws.workers.find((w) => w.id === ws.lead);
  const isLead = lead && lead.id === worker.id;
  const lines = [
    `# Agent Office — ${ws.name}`,
    `You are ${worker.name}, the ${worker.role} of this office. Project directory: ${ws.dir}.`,
    'You run in your own terminal; the owner (a human) watches the office, reads the board and the reports, and may type to you directly.',
    '',
    ...(worker.engine && worker.engine !== 'claude' ? ['The office board tools (board_list, task_create, task_update, task_done, message, memory_note, memory_search, team_list) come from the MCP server named "office". Use them for all board work; if you cannot see them, tell the owner instead of improvising.', ''] : []),
    ...(worker.worktree && worker.worktreePath ? [`You work in your own git worktree (${worker.worktreePath}) on branch ${worker.worktreeBranch}, branched from ${worker.worktreeBase}. Stay in it: commit your work there in small commits with clear messages, never switch branches and never touch the main project folder. The owner reviews the branch and merges it.`, ''] : []),
    '## Your role',
    worker.duties || worker.role,
    isLead ? 'You are the lead: when the owner gives a goal, split it into tasks with task_create (assign each to a teammate by name, keep one for yourself, set parent to the goal task), follow progress on the board, and when every part is done close the goal with task_done and a summary report.' : '',
    '',
    '## Team',
    ...(mates.length ? mates.map((m) => `- ${m.name} — ${m.role}${m.id === ws.lead ? ' (lead)' : ''}: ${m.duties || ''}`) : ['- (no teammates yet)']),
    'Teammates are separate Claude Code sessions. Reach one with the office `message` tool, by name.',
    '',
    '## Task board (office tools)',
    '- The board lives in the office MCP tools (mcp__office__board_list, task_create, task_update, task_done, message, memory_note, memory_search). Nothing else is the board: no TodoWrite, no local task lists, no scripts.',
    '- Work arrives as "[Pano] …" lines in your terminal or with board_list. Before starting a task call task_update(id, status: "doing").',
    '- Close a task only with task_done: a short summary, evidence (what you ran to verify — typecheck, build, tests, a manual check — with ok/fail and a detail line) and the files you changed. No evidence, no done.',
    '- If you cannot finish, task_update with status "review" or "todo" and a note saying why.',
    '- Never create a task that already exists on the board; update it instead.',
    '',
    '## Memory',
    `- Your memory file: ${memoryFile}. Read it when a task starts. It is yours alone; teammates have their own.`,
    '- When you truly need the owner to choose (two real options, a risky or hard-to-undo step), call ask_owner with 2-4 options and a one-line question; it does not block: carry on with independent work and the answer arrives in your terminal as "[Karar K-n] …". Do not ask about small, reversible things.',
    '- Team chat: messages from the owner arrive as "[Sohbet · …]". Your normal reply when you finish is mirrored into the chat; use message(to: "sahip") for anything you want the owner to see immediately.',
    '- Record decisions, preferences the owner stated, and things you learned with memory_note (short, concrete, with tags). Search the team memory with memory_search before asking a teammate something that was probably decided already.',
    '',
    '## Working rules',
    '- Write everything in Turkish unless the owner writes in another language.',
    '- Message a teammate only when they must act or need information; no acknowledgements or thanks.',
    '- Keep token use low: search before reading, read only what you need, keep command output short.',
    '- Do not touch files outside your part without telling the owner of that file (the board shows who does what).',
    '- When a "[Mesaj · name]" line arrives, it is from that teammate; "[Pano]" lines come from the board; anything else the owner typed.',
  ];
  return [...lines, ...extra].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

class Workers extends EventEmitter {
  constructor(store, terminals, memory, runtime) {
    super();
    this.store = store;
    this.terminals = terminals;
    this.memory = memory;
    this.rt = runtime;                 // { claudeBin, mcp, scanner }
    this.outbox = new Map();           // workerId → texts waiting for Claude to be ready
    this.activity = new Activity();    // status of non-Claude engines, read from terminal output
    this.tails = new Map();            // terminal id → last output (plain text), for limit detection
    terminals.on?.('data', ({ id: tid, data }) => { if (tid.startsWith('w:')) { this.activity.data(tid, data); this.tails.set(tid, ((this.tails.get(tid) || '') + stripAnsi(data)).slice(-2000)); } });
    terminals.on?.('exit', ({ id: tid }) => this.activity.stop(tid));
  }

  byToken(token) {
    for (const ws of this.store.workspaces) {
      const w = ws.workers.find((x) => x.token === token);
      if (w) return { ws, worker: w, name: w.name };
    }
    return null;
  }

  resolve(ws, nameOrId) {
    const n = String(nameOrId || '').trim().toLowerCase();
    return ws.workers.find((w) => w.id === nameOrId || w.name.toLowerCase() === n) || null;
  }

  pickName(ws) {
    const used = new Set(ws.workers.map((w) => w.name.toLowerCase()));
    return NAMES.find((n) => !used.has(n.toLowerCase())) || `Ajan${ws.workers.length + 1}`;
  }

  // Claude takes one of its model aliases; the other engines take any model name (or none = their default).
  modelFor(engine, model) {
    if (engine === 'claude') return MODELS.includes(model) ? model : 'sonnet';
    return String(model || '').trim();
  }

  create(ws, def = {}) {
    const worker = {
      id: id(), token: crypto.randomBytes(12).toString('hex'),
      name: String(def.name || '').trim() || this.pickName(ws),
      role: String(def.role || '').trim() || 'Geliştirici',
      duties: String(def.duties || '').trim(),
      engine: ENGINES[def.engine] ? def.engine : 'claude',
      model: this.modelFor(ENGINES[def.engine] ? def.engine : 'claude', def.model),
      skills: this.rt.skills ? this.rt.skills.known(def.skills) : [], worktree: !!def.worktree, budget: Math.max(0, Number(def.budget) || 0), extraArgs: String(def.extraArgs || '').trim(), command: String(def.command || '').trim(),
      permissionMode: PERMISSION_MODES.includes(def.permissionMode) ? def.permissionMode : 'auto',
      seed: crypto.randomBytes(4).readUInt32LE(0),
      deskId: def.deskId || null, sessionId: null, created: Date.now(), autostart: true,
    };
    ws.workers.push(worker);
    if (!ws.lead || def.lead) ws.lead = worker.id;
    this.memory.ensure(ws, worker);
    this.store.save();
    this.emit('change', ws.id);
    return worker;
  }

  // A session that was running elsewhere becomes a worker: same conversation,
  // same folder, now in an office terminal with the board tools.
  adopt(ws, guest, def = {}) {
    const worker = this.create(ws, { name: guest.name || undefined, role: def.role || 'Misafir', duties: def.duties || '', model: def.model || (String(guest.model || '').includes('haiku') ? 'haiku' : String(guest.model || '').includes('opus') ? 'opus' : 'sonnet') });
    worker.sessionId = guest.sessionId;
    worker.cwd = guest.cwd && guest.cwd !== ws.dir ? guest.cwd : null;
    worker.adopted = true;
    this.store.save();
    return worker;
  }

  update(ws, wid, patch) {
    const w = ws.workers.find((x) => x.id === wid);
    if (!w) return null;
    for (const k of ['name', 'role', 'duties', 'deskId']) if (patch[k] !== undefined) w[k] = patch[k];
    if (ENGINES[patch.engine] && patch.engine !== w.engine) { w.engine = patch.engine; if (patch.model === undefined) w.model = this.modelFor(w.engine, ''); }
    if (patch.model !== undefined) w.model = this.modelFor(w.engine || 'claude', patch.model);
    if (patch.reroll) w.seed = crypto.randomBytes(4).readUInt32LE(0);          // a new look for this worker
    if (patch.worktree !== undefined) w.worktree = !!patch.worktree;
    if (patch.skills !== undefined) w.skills = this.rt.skills ? this.rt.skills.known(patch.skills) : [];
    if (patch.budget !== undefined) { w.budget = Math.max(0, Number(patch.budget) || 0); w.budgetWarned = false; w.budgetFrom = null; }
    for (const k of ['extraArgs', 'command']) if (patch[k] !== undefined) w[k] = String(patch[k] || '').trim();
    if (PERMISSION_MODES.includes(patch.permissionMode)) w.permissionMode = patch.permissionMode;
    if (patch.lead) ws.lead = w.id;
    this.store.save();
    this.emit('change', ws.id);
    return w;
  }

  remove(ws, wid) {
    this.stop(ws, wid);
    const gone = ws.workers.find((x) => x.id === wid);
    if (gone?.worktreePath) { try { worktree.remove(ws, gone); } catch { /* branch stays */ } }
    ws.workers = ws.workers.filter((x) => x.id !== wid);
    if (ws.lead === wid) ws.lead = ws.workers[0]?.id || null;
    for (const t of ws.tasks) if (t.assignee === wid) t.assignee = null;
    this.store.save();
    this.emit('change', ws.id);
  }

  termId(wid) { return `w:${wid}`; }
  otherEngine(wid) { for (const ws of this.store.workspaces) { const w = ws.workers.find((x) => x.id === wid); if (w) return !!w.engine && w.engine !== 'claude'; } return false; }
  running(wid) { const t = this.terminals.get(this.termId(wid)); return !!t && t.exited === null; }

  start(ws, wid, { cols, rows } = {}) {
    const w = ws.workers.find((x) => x.id === wid);
    let cwd = w?.cwd || ws.dir;
    if (!w || !cwd) return null;
    if (this.running(wid)) return this.terminals.snapshot(this.terminals.get(this.termId(wid)));
    const cap = Number(this.store.data.maxRunning) || 12;       // guard against a runaway fan-out filling the machine
    if (ws.workers.filter((x) => this.running(x.id)).length >= cap) return { error: `En fazla ${cap} çalışan aynı anda açık olabilir; birini durdur.` };
    if (w.worktree) {            // isolated checkout on the worker's own branch
      try { cwd = worktree.ensure(ws, w, this.rt.dataDir); } catch (e) { return { error: e.message }; }
    }
    const memoryFile = this.memory.ensure(ws, w);
    if (w.engine && w.engine !== 'claude') return this.startOther(ws, w, cwd, memoryFile, { cols, rows });
    const sessionId = w.sessionId && this.rt.scanner.sessionFile(w.sessionId, cwd) ? w.sessionId : null;
    // --add-dir: the memory folder lives in app data, outside the project; without
    // this every memory read would stop for a permission prompt.
    const args = ['--name', w.name, '--model', w.model, '--permission-mode', w.permissionMode, '--add-dir', path.dirname(memoryFile),
      '--mcp-config', JSON.stringify({ mcpServers: { office: { type: 'http', url: this.rt.mcp.urlFor(w.token) }, ...(this.rt.integrations?.mcpServers() || {}) } }),
      '--allowedTools', ...this.rt.mcp.toolNames, ...SAFE_TOOLS,
      // Claude Code's own task list and worktree tools would shadow the office board.
      '--disallowedTools', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskStop', 'EnterWorktree', 'ExitWorktree',
      '--append-system-prompt', briefing(ws, w, memoryFile)];
    const skillsDir = this.rt.skills?.pluginFor(w);          // playbooks handed to this worker, loaded for this session only
    if (skillsDir) args.push('--plugin-dir', skillsDir);
    if (sessionId) args.push('--resume', sessionId);
    else { w.sessionId = crypto.randomUUID(); args.push('--session-id', w.sessionId); }
    this.store.save();
    const snap = this.terminals.create({ id: this.termId(wid), kind: 'worker', workerId: wid, title: w.name, cwd, cmd: this.rt.claudeBin, args, cols, rows });
    // A resumed conversation keeps its old system prompt, so a joined session gets the briefing as a message.
    if (sessionId && w.adopted && !w.briefed) { this.send(ws, wid, `[Ofis] ${ws.name} ofisine katıldın. Bundan sonra şu brifinge göre çalış:\n\n${briefing(ws, w, memoryFile)}`); w.briefed = true; this.store.save(); }
    w.lastStart = Date.now();
    this.emit('change', ws.id);
    return snap;
  }

  // ---- usage limits: park a worker whose agent hit its limit, resume it after the reset ----
  // views: this workspace's worker views from the status loop. Returns the workers parked now.
  limitTick(ws, views, now = Date.now()) {
    const parked = [], due = [];
    for (const v of views) {
      const w = ws.workers.find((x) => x.id === v.id);
      if (!w) continue;
      if (w.parked) { if (now >= w.parked.until) due.push(w); continue; }
      if (!v.running || v.status === 'working' || v.status === 'starting') continue;
      const tid = this.termId(w.id);
      const hit = limits.detect(this.tails.get(tid) || '', now);
      if (!hit) continue;
      this.tails.set(tid, '');
      w.parked = { until: hit.resetAt, reason: hit.reason, since: now, guessed: hit.guessed };
      this.store.save();
      this.emit('limit', { ws, worker: w, parked: w.parked });
      parked.push(w);
    }
    for (const w of due) this.unpark(ws, w.id, { resume: true });
    if (parked.length || due.length) this.emit('change', ws.id);
    return parked;
  }

  // ---- spend guard: a worker with a budget is warned at 80% and stopped at 100% ----
  // Spend counts from the first reading after each start, so the owner can raise the budget and restart.
  budgetTick(ws, views) {
    for (const v of views) {
      const w = ws.workers.find((x) => x.id === v.id);
      if (!w || !(w.budget > 0)) continue;
      if (!v.running) { if (w.budgetFrom != null || w.budgetWarned) { w.budgetFrom = null; w.budgetWarned = false; } continue; }
      if (!(v.cost > 0)) continue;
      if (w.budgetFrom == null) { w.budgetFrom = v.cost; this.store.save(); continue; }
      const spent = Math.max(0, v.cost - w.budgetFrom);
      if (spent >= w.budget) {
        this.stop(ws, w.id);
        w.budgetFrom = null; w.budgetWarned = false;
        this.store.save();
        this.emit('budget', { ws, worker: w, spent, budget: w.budget, stopped: true });
      } else if (spent >= w.budget * 0.8 && !w.budgetWarned) {
        w.budgetWarned = true; this.store.save();
        this.emit('budget', { ws, worker: w, spent, budget: w.budget, stopped: false });
      }
    }
  }

  // resume: also type the "carry on" message (after the reset, or when the owner says so).
  unpark(ws, wid, { resume = false } = {}) {
    const w = ws.workers.find((x) => x.id === wid);
    if (!w?.parked) return false;
    w.parked = null;
    this.store.save();
    if (resume) {
      if (!this.running(wid)) this.start(ws, wid, { cols: 100, rows: 30 });
      this.send(ws, wid, '[Ofis] Kullanım limitin sıfırlanmış olmalı. Kaldığın yerden devam et; takıldığın bir iş varsa durumunu bir cümleyle yaz.');
      this.emit('limit-resume', { ws, worker: w });
    }
    this.emit('change', ws.id);
    return true;
  }

  // Codex / Gemini: no session registry, so a fresh conversation each start (the memory file carries over).
  startOther(ws, w, cwd, memoryFile, { cols, rows }) {
    const eng = ENGINES[w.engine];
    const bin = w.command || findBin(eng.bin, this.rt.envPath);
    if (!bin) return { error: `${eng.label} bulunamadı. Kurulu değil ya da PATH'te yok; çalışanın detayında "komut" alanına tam yolu yazabilirsin.` };
    const mcpUrl = this.rt.mcp.urlFor(w.token);
    const servers = {};
    for (const [name, c] of Object.entries(this.rt.integrations?.mcpServers() || {})) if (c.url) servers[name] = { httpUrl: c.url, ...(c.headers ? { headers: c.headers } : {}) };
    let l;
    try { l = launch(w.engine, { worker: w, cwd, mcpUrl, integrations: servers, prompt: briefing(ws, w, memoryFile, this.rt.skills?.briefing(w) || []), dataDir: this.rt.dataDir }); } catch (e) { return { error: e.message }; }
    const tid = this.termId(w.id);
    this.activity.start(tid);
    const snap = this.terminals.create({ id: tid, kind: 'worker', workerId: w.id, title: w.name, cwd, cmd: bin, args: l.args, env: l.env, cols, rows });
    w.lastStart = Date.now();
    this.store.save();
    this.emit('change', ws.id);
    return snap;
  }

  stop(ws, wid) {
    const ok = this.terminals.kill(this.termId(wid));
    this.emit('change', ws.id);
    return ok;
  }

  // Claude is ready once it has registered its session (prompt is up).
  ready(wid) {
    const t = this.terminals.get(this.termId(wid));
    if (!t || t.exited !== null) return false;
    if (this.otherEngine(wid)) return this.activity.state(this.termId(wid)).status !== 'starting';
    return !!this.rt.scanner.registryEntry(t.pid);
  }

  // Type a prompt into the worker's terminal and submit it. Text sent while Claude
  // is still starting waits in the outbox and goes in on the next status tick.
  send(ws, wid, text) {
    if (!this.running(wid)) return false;
    const t = String(text || '').trim();
    if (!t) return false;
    if (!this.ready(wid)) { const q = this.outbox.get(wid) || []; q.push(t); this.outbox.set(wid, q); return true; }
    this.type(wid, t);
    return true;
  }

  type(wid, text) {
    const id = this.termId(wid);
    this.terminals.paste(id, text);
    setTimeout(() => this.terminals.write(id, '\r'), 150);
  }

  flush(ws) {
    for (const [wid, q] of this.outbox) {
      if (!q.length) { this.outbox.delete(wid); continue; }
      if (!this.running(wid)) { this.outbox.delete(wid); continue; }
      if (!this.ready(wid)) continue;
      const w = ws.workers.find((x) => x.id === wid);
      if (!w) { this.outbox.delete(wid); continue; }
      // one prompt per tick, so each lands in its own turn
      this.type(wid, q.shift());
    }
  }

  // Live state of a worker, read from Claude Code's own session registry and transcript.
  view(ws, w) {
    const term = this.terminals.get(this.termId(w.id));
    const running = !!term && term.exited === null;
    if (running && w.engine && w.engine !== 'claude') {
      const a = this.activity.state(this.termId(w.id));
      return { ...w, parkedUntil: w.parked?.until || null, token: undefined, running, status: a.status === 'offline' ? 'starting' : a.status, waitingFor: a.waitingFor, statusSince: a.since, activity: null, lastAnswer: null, lastActivity: null, ctx: 0,
        branch: null, recent: [], sends: [], cost: 0, tokens: 0, lead: ws.lead === w.id, terminalId: this.termId(w.id), decisionOpen: (ws.decisions || []).filter((d) => d.by === w.id && d.status === 'open').length };
    }
    const reg = running ? this.rt.scanner.registryEntry(term.pid) : null;
    if (reg?.sessionId && reg.sessionId !== w.sessionId) {
      // --resume gives the conversation a new session id; remember the old one so a leftover
      // process of it is not mistaken for an outside session (a "guest") later.
      if (w.sessionId) w.pastSessions = [...(w.pastSessions || []).filter((x) => x !== w.sessionId), w.sessionId].slice(-20);
      w.sessionId = reg.sessionId; this.store.save();
    }
    const file = w.sessionId && (!w.engine || w.engine === 'claude') ? this.rt.scanner.sessionFile(w.sessionId, (w.worktree && w.worktreePath) || w.cwd || ws.dir) : null;
    const s = file ? this.rt.scanner.summarizeSession(file) : null;
    const cost = file ? this.rt.scanner.costState(file) : null;
    let status = 'offline';
    if (running) status = reg?.status === 'waiting' ? 'waiting' : reg?.status === 'busy' ? 'working' : reg?.status === 'idle' ? 'idle' : 'starting';
    const lastAnswer = [...(s?.recent || [])].reverse().find((r) => r.role === 'assistant')?.text || null;
    return {
      ...w, parkedUntil: w.parked?.until || null, token: undefined, running, status, waitingFor: reg?.waitingFor || null, statusSince: reg?.statusUpdatedAt || null,
      activity: s?.activity || null, lastAnswer, lastActivity: s?.lastActivity || null, ctx: s?.ctx || 0,
      branch: s?.branch || null, recent: s?.recent || [], sends: s?.sends || [],
      cost: cost?.totalCostUSD || 0, tokens: cost ? Object.values(cost.modelUsage || {}).reduce((a, m) => a + (m.inputTokens || 0) + (m.outputTokens || 0) + (m.cacheReadInputTokens || 0) + (m.cacheCreationInputTokens || 0), 0) : 0,
      lead: ws.lead === w.id, terminalId: this.termId(w.id), decisionOpen: (ws.decisions || []).filter((d) => d.by === w.id && d.status === 'open').length,
    };
  }
}

module.exports = { Workers, briefing, MODELS, PERMISSION_MODES, ROLE_PRESETS, NAMES, SAFE_TOOLS };
