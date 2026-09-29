'use strict';
// Detects AI agents running on this machine (Claude Code sessions, Claude Desktop,
// Cursor, Codex, Gemini CLI, Aider, Ollama, ...) from the process table.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

const MATCHERS = [
  {
    kind: 'claude-code', label: 'Claude Code',
    test: (c) => (/(^|\/)claude(\s|$)|\/claude\/versions\/[\w.-]+(\s|$)|ClaudeCode\.app\/Contents\/MacOS\/claude|@anthropic-ai\/claude-code\/cli\.js/.test(c))
      && !/--bg-pty-host|bg-pty-host|daemon run|--bg-spare|chrome-native-host|\bmcp\b/.test(c),
  },
  { kind: 'claude-desktop', label: 'Claude Desktop', test: (c) => /\/Claude\.app\/Contents\/MacOS\/Claude(\s|$)/.test(c) },
  {
    kind: 'cursor-agent', label: 'Cursor Agent',
    test: (c) => /extension-host \(agent-exec\)/.test(c),
    name: (c) => (c.match(/\(agent-exec\)\s+(.+?)\s*\[/) || [])[1],
  },
  { kind: 'cursor', label: 'Cursor', test: (c) => /\/Cursor\.app\/Contents\/MacOS\/Cursor(\s|$)/.test(c) },
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

function findSessionFile(cmd, cwd, startedAt) {
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
  if (!cwd) return null;
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
  for (const e of [...head, ...tail]) if ((e.type === 'summary' && e.summary) || e.type === 'custom-title') title = e.summary || e.customTitle || e.title || title;
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

  const found = [];
  for (const p of procs) {
    const mt = MATCHERS.find((x) => x.test(p.cmd));
    if (!mt || isExcluded(p)) continue;
    // A matched process whose parent is the same kind is a sub-process of the same agent.
    const parent = byPid.get(p.ppid);
    if (parent && mt.test(parent.cmd) && mt.kind !== 'cursor-agent') continue;
    found.push({ ...p, kind: mt.kind, label: mt.label, name: mt.name?.(p.cmd) || null });
  }

  const cliPids = found.filter((f) => !['claude-desktop', 'cursor', 'windsurf', 'lmstudio', 'cursor-agent'].includes(f.kind)).map((f) => f.pid);
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
    f.model = argValue(f.cmd, '--model');
    f.headless = /\s(-p|--print)(\s|$)/.test(f.cmd);
    if (f.kind === 'claude-code') {
      const file = findSessionFile(f.cmd, f.cwd, now - f.uptime * 1000);
      const s = file && summarizeSession(file);
      if (s) { f.session = s; f.cwd = f.cwd || s.cwd; }
    }
    const recentWrite = f.session && now - f.session.lastActivity < 20000;
    f.status = recentWrite || f.cpu > 8 ? 'active' : 'idle';
    f.project = f.cwd ? path.basename(f.cwd) : f.name || null;
    f.id = `${f.kind}:${f.pid}`;
    delete f.cmd; // don't ship full argv (may contain tokens) to the renderer
  }
  return found.sort((a, b) => a.kind.localeCompare(b.kind) || b.uptime - a.uptime);
}

module.exports = { scan, parseEtime, MATCHERS };
