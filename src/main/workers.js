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

function briefing(ws, worker, memoryFile) {
  const mates = ws.workers.filter((w) => w.id !== worker.id);
  const lead = ws.workers.find((w) => w.id === ws.lead);
  const isLead = lead && lead.id === worker.id;
  const lines = [
    `# Agent Office — ${ws.name}`,
    `You are ${worker.name}, the ${worker.role} of this office. Project directory: ${ws.dir}.`,
    'You run in your own terminal; the owner (a human) watches the office, reads the board and the reports, and may type to you directly.',
    '',
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
    '- Record decisions, preferences the owner stated, and things you learned with memory_note (short, concrete, with tags). Search the team memory with memory_search before asking a teammate something that was probably decided already.',
    '',
    '## Working rules',
    '- Write everything in Turkish unless the owner writes in another language.',
    '- Message a teammate only when they must act or need information; no acknowledgements or thanks.',
    '- Keep token use low: search before reading, read only what you need, keep command output short.',
    '- Do not touch files outside your part without telling the owner of that file (the board shows who does what).',
    '- When a "[Mesaj · name]" line arrives, it is from that teammate; "[Pano]" lines come from the board; anything else the owner typed.',
  ];
  return lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

class Workers extends EventEmitter {
  constructor(store, terminals, memory, runtime) {
    super();
    this.store = store;
    this.terminals = terminals;
    this.memory = memory;
    this.rt = runtime;                 // { claudeBin, mcp, scanner }
    this.outbox = new Map();           // workerId → texts waiting for Claude to be ready
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

  create(ws, def = {}) {
    const worker = {
      id: id(), token: crypto.randomBytes(12).toString('hex'),
      name: String(def.name || '').trim() || this.pickName(ws),
      role: String(def.role || '').trim() || 'Geliştirici',
      duties: String(def.duties || '').trim(),
      model: MODELS.includes(def.model) ? def.model : 'sonnet',
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
    if (MODELS.includes(patch.model)) w.model = patch.model;
    if (PERMISSION_MODES.includes(patch.permissionMode)) w.permissionMode = patch.permissionMode;
    if (patch.lead) ws.lead = w.id;
    this.store.save();
    this.emit('change', ws.id);
    return w;
  }

  remove(ws, wid) {
    this.stop(ws, wid);
    ws.workers = ws.workers.filter((x) => x.id !== wid);
    if (ws.lead === wid) ws.lead = ws.workers[0]?.id || null;
    for (const t of ws.tasks) if (t.assignee === wid) t.assignee = null;
    this.store.save();
    this.emit('change', ws.id);
  }

  termId(wid) { return `w:${wid}`; }
  running(wid) { const t = this.terminals.get(this.termId(wid)); return !!t && t.exited === null; }

  start(ws, wid, { cols, rows } = {}) {
    const w = ws.workers.find((x) => x.id === wid);
    const cwd = w?.cwd || ws.dir;
    if (!w || !cwd) return null;
    if (this.running(wid)) return this.terminals.snapshot(this.terminals.get(this.termId(wid)));
    const memoryFile = this.memory.ensure(ws, w);
    const sessionId = w.sessionId && this.rt.scanner.sessionFile(w.sessionId, cwd) ? w.sessionId : null;
    // --add-dir: the memory folder lives in app data, outside the project; without
    // this every memory read would stop for a permission prompt.
    const args = ['--name', w.name, '--model', w.model, '--permission-mode', w.permissionMode, '--add-dir', path.dirname(memoryFile),
      '--mcp-config', JSON.stringify({ mcpServers: { office: { type: 'http', url: this.rt.mcp.urlFor(w.token) }, ...(this.rt.integrations?.mcpServers() || {}) } }),
      '--allowedTools', ...this.rt.mcp.toolNames, ...SAFE_TOOLS,
      // Claude Code's own task list and worktree tools would shadow the office board.
      '--disallowedTools', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskStop', 'EnterWorktree', 'ExitWorktree',
      '--append-system-prompt', briefing(ws, w, memoryFile)];
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

  stop(ws, wid) {
    const ok = this.terminals.kill(this.termId(wid));
    this.emit('change', ws.id);
    return ok;
  }

  // Claude is ready once it has registered its session (prompt is up).
  ready(wid) {
    const t = this.terminals.get(this.termId(wid));
    return !!t && t.exited === null && !!this.rt.scanner.registryEntry(t.pid);
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
    const reg = running ? this.rt.scanner.registryEntry(term.pid) : null;
    if (reg?.sessionId && reg.sessionId !== w.sessionId) { w.sessionId = reg.sessionId; this.store.save(); }
    const file = w.sessionId ? this.rt.scanner.sessionFile(w.sessionId, w.cwd || ws.dir) : null;
    const s = file ? this.rt.scanner.summarizeSession(file) : null;
    const cost = file ? this.rt.scanner.costState(file) : null;
    let status = 'offline';
    if (running) status = reg?.status === 'waiting' ? 'waiting' : reg?.status === 'busy' ? 'working' : reg?.status === 'idle' ? 'idle' : 'starting';
    const lastAnswer = [...(s?.recent || [])].reverse().find((r) => r.role === 'assistant')?.text || null;
    return {
      ...w, token: undefined, running, status, waitingFor: reg?.waitingFor || null, statusSince: reg?.statusUpdatedAt || null,
      activity: s?.activity || null, lastAnswer, lastActivity: s?.lastActivity || null, ctx: s?.ctx || 0,
      branch: s?.branch || null, recent: s?.recent || [], sends: s?.sends || [],
      cost: cost?.totalCostUSD || 0, tokens: cost ? Object.values(cost.modelUsage || {}).reduce((a, m) => a + (m.inputTokens || 0) + (m.outputTokens || 0) + (m.cacheReadInputTokens || 0) + (m.cacheCreationInputTokens || 0), 0) : 0,
      lead: ws.lead === w.id, terminalId: this.termId(w.id),
    };
  }
}

module.exports = { Workers, briefing, MODELS, PERMISSION_MODES, ROLE_PRESETS, NAMES, SAFE_TOOLS };
