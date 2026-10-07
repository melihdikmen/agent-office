'use strict';
// Detects AI agents running on this machine (Claude Code sessions, Cursor agents,
// Codex, Gemini CLI, Aider, Ollama, ...) from the process table. The Claude Desktop
// and Cursor apps themselves are left out: they are editors, not agents at work.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const crypto = require('crypto');

const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
// Claude Code writes one file per running process here: session id, cwd, name and
// its own status (busy / idle / waiting + what it waits for). Internal format, so
// everything below falls back to heuristics when a field is missing.
const CLAUDE_SESSIONS = path.join(os.homedir(), '.claude', 'sessions');

const MATCHERS = [
  {
    kind: 'claude-code', label: 'Claude Code',
    test: (c) => (/(^|\/)claude(\s|$)|\/claude\/versions\/[\w.-]+(\s|$)|ClaudeCode\.app\/Contents\/MacOS\/claude|@anthropic-ai\/claude-code\/cli\.js/.test(c))
      && !/--bg-pty-host|bg-pty-host|daemon run|--bg-spare|chrome-native-host|\bmcp\b/.test(c),
  },
  {
    kind: 'cursor-agent', label: 'Cursor Agent',
    test: (c) => /extension-host \(agent-exec\)/.test(c),
    name: (c) => (c.match(/\(agent-exec\)\s+(.+?)\s*\[/) || [])[1],
  },
  { kind: 'cursor-cli', label: 'Cursor CLI', test: (c) => /(^|\/)cursor-agent(\s|$)/.test(c) },
  { kind: 'codex', label: 'Codex CLI', test: (c) => /(^|\/)codex(\s|$)|@openai\/codex/.test(c) },
  { kind: 'gemini', label: 'Gemini CLI', test: (c) => /(^|\/)gemini(\s|$)|@google\/gemini-cli/.test(c) },
  { kind: 'aider', label: 'Aider', test: (c) => /(^|\/)aider(\s|$)/.test(c) },
  { kind: 'opencode', label: 'OpenCode', test: (c) => /(^|\/)opencode(\s|$)/.test(c) },
  { kind: 'goose', label: 'Goose', test: (c) => /(^|\/)goose(\s|$)/.test(c) },
  { kind: 'copilot', label: 'Copilot CLI', test: (c) => /(^|\/)copilot(\s|$)|@github\/copilot/.test(c) },
  { kind: 'amp', label: 'Amp', test: (c) => /(^|\/)amp(\s|$)|@sourcegraph\/amp/.test(c) },
  { kind: 'windsurf', label: 'Windsurf', test: (c) => /\/Windsurf\.app\/Contents\/MacOS\/(Electron|Windsurf)(\s|$)/.test(c) },
  { kind: 'ollama', label: 'Ollama', test: (c) => /(^|\/)ollama (serve|runner)/.test(c) },
  { kind: 'lmstudio', label: 'LM Studio', test: (c) => /\/LM Studio\.app\/Contents\/MacOS\/LM Studio(\s|$)/.test(c) },
];

// Short human label for a tool call, e.g. "Bash: npm test" or "Edit world/Hazards.ts".
function summarizeToolUse(name, input = {}) {
  const short = (s, n = 60) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const file = input.file_path || input.notebook_path || input.path;
  if (file) return `${name} ${short(String(file).split('/').slice(-2).join('/'))}`;
  if (input.command) return `${name}: ${short(input.command)}`;
  if (input.pattern) return `${name} "${short(input.pattern, 40)}"`;
  if (input.url) return `${name} ${short(input.url)}`;
  if (input.query) return `${name} "${short(input.query, 40)}"`;
  if (input.description) return `${name}: ${short(input.description)}`;
  return name;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 8000 }, (err, stdout) => resolve(err && !stdout ? '' : stdout));
  });
}

function parseEtime(s) {
  const m = s.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+m[3]) * 60 + (+m[4]);
}

function argValue(cmd, flag) {
  const m = cmd.match(new RegExp(`${flag}(?:=|\\s+)(\\S+)`));
  return m ? m[1] : null;
}

function projectDirFor(cwd) { return path.join(CLAUDE_PROJECTS, cwd.replace(/[^a-zA-Z0-9]/g, '-')); }

function findSessionFile(cmd, cwd, startedAt, exact = false) {
  const resume = argValue(cmd, '--resume') || argValue(cmd, '-r') || argValue(cmd, '--session-id');
  if (resume && resume.endsWith('.jsonl') && fs.existsSync(resume)) return resume;
  if (resume && /^[0-9a-f-]{36}$/.test(resume)) {
    if (cwd) { const f = path.join(projectDirFor(cwd), `${resume}.jsonl`); if (fs.existsSync(f)) return f; }
    try {
      for (const d of fs.readdirSync(CLAUDE_PROJECTS)) {
        const f = path.join(CLAUDE_PROJECTS, d, `${resume}.jsonl`);
        if (fs.existsSync(f)) return f;
      }
    } catch { /* ignore */ }
  }
  // A known session id with no transcript yet is a fresh session; don't guess another file.
  if (!cwd || exact) return null;
  try {
    const dir = projectDirFor(cwd);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.m >= startedAt - 5000)
      .sort((a, b) => b.m - a.m);
    return files[0]?.f || null;
  } catch { return null; }
}

function readSlice(file, fromEnd, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

// One process's entry in Claude Code's session registry (null when it isn't a session).
function registryEntry(pid) {
  try { return JSON.parse(fs.readFileSync(path.join(CLAUDE_SESSIONS, `${pid}.json`), 'utf8')); } catch { return null; }
}

// Transcript file of a known session id, looked up by its project folder first.
function sessionFile(sessionId, cwd) {
  if (!/^[0-9a-f-]{36}$/.test(sessionId || '')) return null;
  if (cwd) { const f = path.join(projectDirFor(cwd), `${sessionId}.jsonl`); if (fs.existsSync(f)) return f; }
  try {
    for (const d of fs.readdirSync(CLAUDE_PROJECTS)) {
      const f = path.join(CLAUDE_PROJECTS, d, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch { /* no projects dir */ }
  return null;
}

// Claude Code writes a running cost line into the transcript; the last one is the session total.
const costCache = new Map();
function costState(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const cached = costCache.get(file);
  if (cached && cached.mtime === stat.mtimeMs) return cached.data;
  // Transcripts can carry huge attachment lines; walk back in chunks until the line shows up.
  let data = null;
  for (let bytes = 512 * 1024; bytes <= 16 * 1024 * 1024 && bytes / 2 < stat.size + 512 * 1024; bytes *= 2) {
    const tail = readSlice(file, true, bytes);
    const i = tail.lastIndexOf('"type":"cost-state"');
    if (i < 0) { if (bytes >= stat.size) break; continue; }
    const start = tail.lastIndexOf('\n', i) + 1;
    const end = tail.indexOf('\n', i);
    try { data = JSON.parse(tail.slice(start, end < 0 ? undefined : end)); } catch { data = null; }
    break;
  }
  costCache.set(file, { mtime: stat.mtimeMs, data });
  return data;
}

function readRegistry() {
  const reg = new Map();
  let files = [];
  try { files = fs.readdirSync(CLAUDE_SESSIONS).filter((f) => /^\d+\.json$/.test(f)); } catch { return reg; }
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(CLAUDE_SESSIONS, f), 'utf8'));
      if (r && r.pid) reg.set(+r.pid, r);
    } catch { /* being rewritten */ }
  }
  return reg;
}

const HELPER_TOOLS = new Set(['Agent', 'Task']);

// What the session is doing right now, from the tail of its transcript:
// phase tool | thinking | replied, the running tool, and how many subagents it waits on.
function currentActivity(entries) {
  const conv = entries.filter((e) => (e.type === 'user' || e.type === 'assistant') && !e.isSidechain && !e.isMeta);
  const last = conv[conv.length - 1];
  if (!last) return null;
  const done = new Set();
  let turnStart = 0;
  conv.forEach((e, i) => {
    if (e.type !== 'user') return;
    const c = e.message?.content;
    const results = Array.isArray(c) ? c.filter((b) => b.type === 'tool_result') : [];
    results.forEach((b) => done.add(b.tool_use_id));
    if (!results.length) turnStart = i;       // a human prompt starts a new turn
  });
  const pending = [];
  for (const e of conv.slice(turnStart)) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) if (b.type === 'tool_use' && !done.has(b.id)) pending.push(b);
  }
  const helpers = pending.filter((b) => HELPER_TOOLS.has(b.name)).length;
  const tool = pending.filter((b) => !HELPER_TOOLS.has(b.name)).pop() || pending[pending.length - 1];
  if (tool) return { phase: 'tool', tool: tool.name, text: summarizeToolUse(tool.name, tool.input), helpers };
  if (last.type === 'assistant') {
    const hasText = (last.message?.content || []).some?.((b) => b.type === 'text' && b.text.trim());
    return { phase: hasText ? 'replied' : 'thinking', tool: null, text: '', helpers: 0 };
  }
  return { phase: 'thinking', tool: null, text: '', helpers: 0 };
}

// Messages this session sent to other sessions (SendMessage), newest last.
function sentMessages(entries) {
  const out = [];
  for (const e of entries) {
    if (e.type !== 'assistant' || e.isSidechain || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== 'tool_use' || b.name !== 'SendMessage' || !b.input?.to) continue;
      const text = String(b.input.summary || b.input.message || '').replace(/\s+/g, ' ').trim();
      out.push({ id: b.id, to: String(b.input.to), text: text.slice(0, 200), ts: Date.parse(e.timestamp) || 0 });
    }
  }
  return out.slice(-8);
}

const summaryCache = new Map(); // file -> { mtime, data }

function summarizeSession(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const cached = summaryCache.get(file);
  if (cached && cached.mtime === stat.mtimeMs) return cached.data;
  const parse = (chunk) => chunk.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const head = parse(readSlice(file, false, 96 * 1024));
  const tail = parse(readSlice(file, true, 256 * 1024));
  const isHuman = (e) => e.type === 'user' && !e.isMeta && textOf(e.message?.content).trim() && !/^<(command|local-command|system-reminder)/.test(textOf(e.message?.content).trim());
  let title = null;
  let lastPrompt = null;
  let recap = null;
  let permissionMode = null;
  for (const e of [...head, ...tail]) {
    if (e.type === 'custom-title' || e.type === 'ai-title' || e.type === 'agent-name' || (e.type === 'summary' && e.summary)) {
      title = e.customTitle || e.aiTitle || e.agentName || e.summary || e.title || title;
    } else if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
    else if (e.type === 'system' && e.subtype === 'away_summary' && e.content) recap = { text: String(e.content).replace(/\s*\(disable recaps[^)]*\)\s*$/, ''), ts: e.timestamp };
    else if (e.type === 'permission-mode' && e.permissionMode) permissionMode = e.permissionMode;
  }
  const lastAssistant = [...tail].reverse().find((e) => e.type === 'assistant' && !e.isSidechain && e.message?.model);
  const usage = lastAssistant?.message?.usage;
  const branch = [...tail].reverse().find((e) => e.gitBranch)?.gitBranch;
  const firstUser = head.find(isHuman);
  const recent = [];
  for (const e of tail) {
    if (isHuman(e)) recent.push({ role: 'user', text: textOf(e.message.content).slice(0, 600), ts: e.timestamp });
    else if (e.type === 'assistant') {
      const t = textOf(e.message?.content);
      const tool = (e.message?.content || []).find?.((b) => b.type === 'tool_use');
      if (t.trim()) recent.push({ role: 'assistant', text: t.slice(0, 600), ts: e.timestamp });
      else if (tool) recent.push({ role: 'tool', text: tool.name, ts: e.timestamp });
    }
  }
  const last = tail[tail.length - 1];
  const data = {
    sessionId: path.basename(file, '.jsonl'),
    file,
    title: title || (firstUser ? textOf(firstUser.message.content).slice(0, 80) : null),
    cwd: [...tail].reverse().find((e) => e.cwd)?.cwd || null,
    recent: recent.slice(-8),
    lastActivity: stat.mtimeMs,
    lastRole: last?.type,
    lastPrompt: lastPrompt ? lastPrompt.slice(0, 400) : [...recent].reverse().find((r) => r.role === 'user')?.text || null,
    recap,
    permissionMode,
    model: lastAssistant?.message?.model || null,
    ctx: usage ? (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) : 0,
    branch: branch && branch !== 'HEAD' ? branch : null,
    activity: currentActivity(tail),
    sends: sentMessages(tail),
  };
  summaryCache.set(file, { mtime: stat.mtimeMs, data });
  return data;
}

async function scan({ excludePids = [] } = {}) {
  const out = await run('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,etime=,command=']);
  const exclude = new Set(excludePids.map(Number));
  const procs = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, pcpu, rss, etime, cmd] = m;
    procs.push({ pid: +pid, ppid: +ppid, cpu: +pcpu, rss: +rss, uptime: parseEtime(etime), cmd });
  }
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const isExcluded = (p) => {
    for (let cur = p, i = 0; cur && i < 12; cur = byPid.get(cur.ppid), i++) if (exclude.has(cur.pid)) return true;
    return p.pid === process.pid;
  };

  const registry = readRegistry();
  const claude = MATCHERS[0];
  const found = [];
  for (const p of procs) {
    if (isExcluded(p)) continue;
    const reg = registry.get(p.pid);
    if (reg) {
      // Pre-warmed spare processes have no work yet; claimed ones are real background agents.
      if (reg.spare) continue;
      found.push({ ...p, kind: 'claude-code', label: 'Claude Code', name: reg.name || null, reg });
      continue;
    }
    const mt = MATCHERS.find((x) => x.test(p.cmd));
    if (!mt) continue;
    // A matched process whose parent is the same kind is a sub-process of the same agent.
    const parent = byPid.get(p.ppid);
    if (parent && mt.test(parent.cmd) && mt.kind !== 'cursor-agent') continue;
    if (mt === claude && parent && registry.has(parent.pid)) continue;
    found.push({ ...p, kind: mt.kind, label: mt.label, name: mt.name?.(p.cmd) || null });
  }

  const cliPids = found.filter((f) => !f.reg?.cwd && !['windsurf', 'lmstudio', 'cursor-agent'].includes(f.kind)).map((f) => f.pid);
  if (cliPids.length) {
    const lsof = await run('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', cliPids.join(',')]);
    let cur = null;
    for (const l of lsof.split('\n')) {
      if (l[0] === 'p') cur = found.find((f) => f.pid === +l.slice(1));
      else if (l[0] === 'n' && cur) cur.cwd = l.slice(1);
    }
  }

  const now = Date.now();
  for (const f of found) {
    const reg = f.reg;
    delete f.reg;
    if (reg?.cwd) f.cwd = reg.cwd;
    f.model = argValue(f.cmd, '--model');
    f.headless = /\s(-p|--print)(\s|$)/.test(f.cmd);
    f.background = !!reg && /^(bg|background)$/.test(reg.kind || '');
    f.jobId = reg ? reg.jobId || (f.background ? String(reg.sessionId || '').slice(0, 8) : null) : null;
    if (f.kind === 'claude-code') {
      const cmd = reg?.sessionId ? `--resume ${reg.sessionId}` : f.cmd;
      const file = findSessionFile(cmd, f.cwd, now - f.uptime * 1000, !!reg?.sessionId);
      const s = file && summarizeSession(file);
      if (s) { f.session = s; f.cwd = f.cwd || s.cwd; f.model = f.model || s.model; }
    }
    const recentWrite = f.session && now - f.session.lastActivity < 20000;
    // Prefer Claude Code's own status; fall back to transcript writes and CPU.
    if (reg?.status === 'waiting') { f.status = 'waiting'; f.waitingFor = reg.waitingFor || null; }
    else if (reg?.status === 'busy') f.status = 'active';
    else if (reg?.status === 'idle') f.status = 'idle';
    else f.status = recentWrite || f.cpu > 8 ? 'active' : 'idle';
    f.statusSince = reg?.statusUpdatedAt || null;
    f.project = f.cwd ? path.basename(f.cwd) : null;
    f.sessionId = reg?.sessionId || f.session?.sessionId || null;
    // Stable across restarts of the same session, so its character keeps its seat and looks.
    f.id = f.sessionId ? `s:${f.sessionId}` : `${f.kind}:${f.pid}`;
    f.seed = crypto.createHash('md5').update(f.sessionId || `${f.kind}:${f.name || ''}`).digest().readUInt32LE(0);
    delete f.cmd; // don't ship full argv (may contain tokens) to the renderer
  }
  const rank = { waiting: 0, active: 1, idle: 2 };
  return found.sort((a, b) => rank[a.status] - rank[b.status] || a.kind.localeCompare(b.kind) || b.uptime - a.uptime);
}

module.exports = { scan, parseEtime, currentActivity, sentMessages, summarizeToolUse, registryEntry, sessionFile, summarizeSession, costState, MATCHERS };
