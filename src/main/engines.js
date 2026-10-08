'use strict';
// Agent engines a worker can run on. Claude Code is the native one (its own session
// registry gives exact status, cost and transcript). Codex CLI and Gemini CLI are
// driven through their terminal: the office board is handed to them as an MCP
// server, status is read from terminal activity, and cost/transcript are unknown.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENGINES = {
  claude: { label: 'Claude Code', bin: 'claude', native: true, models: ['haiku', 'sonnet', 'opus', 'fable'], defaultModel: 'sonnet' },
  codex: { label: 'Codex CLI (OpenAI)', bin: 'codex', models: [], defaultModel: '', modelHint: 'boş = Codex varsayılanı (örn. gpt-5-codex)' },
  gemini: { label: 'Gemini CLI (Google)', bin: 'gemini', models: [], defaultModel: '', modelHint: 'boş = Gemini varsayılanı (örn. gemini-2.5-pro)' },
};

// Owner-facing permission modes → each CLI's own vocabulary.
const CODEX_MODES = {
  plan: { approval: 'on-request', sandbox: 'read-only' },
  acceptEdits: { approval: 'on-request', sandbox: 'workspace-write' },
  auto: { approval: 'on-failure', sandbox: 'workspace-write' },
  bypassPermissions: { approval: 'never', sandbox: 'danger-full-access' },
};
const GEMINI_MODES = { plan: 'default', acceptEdits: 'auto_edit', auto: 'auto_edit', bypassPermissions: 'yolo' };

const tomlStr = (s) => JSON.stringify(String(s));        // a JSON string is a valid TOML basic string

// "a b 'c d'" → ['a', 'b', 'c d']; lets the owner add flags without touching code.
function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function findBin(name, envPath) {
  const dirs = String(envPath || process.env.PATH || '').split(':').filter(Boolean);
  const extra = [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.npm-global/bin')];
  return [...dirs, ...extra].map((d) => path.join(d, name)).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// What to run for a non-Claude worker. ctx: { worker, cwd, mcpUrl, integrations, prompt, dataDir }
function launch(engine, ctx) {
  const w = ctx.worker;
  const extra = splitArgs(w.extraArgs);
  if (engine === 'codex') {
    const m = CODEX_MODES[w.permissionMode] || CODEX_MODES.auto;
    const args = ['-c', `mcp_servers.office.url=${tomlStr(ctx.mcpUrl)}`, '-c', `approval_policy=${tomlStr(m.approval)}`, '-c', `sandbox_mode=${tomlStr(m.sandbox)}`];
    if (w.model) args.push('-m', w.model);
    args.push(...extra, ctx.prompt);                   // the briefing is the first message
    return { args, env: {} };
  }
  if (engine === 'gemini') {
    // Gemini reads MCP servers from settings only; a per-worker system settings file keeps the project clean.
    const dir = path.join(ctx.dataDir, 'engines', w.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'gemini-settings.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { office: { httpUrl: ctx.mcpUrl, trust: true }, ...(ctx.integrations || {}) } }, null, 2));
    const args = ['--approval-mode', GEMINI_MODES[w.permissionMode] || 'auto_edit'];
    if (w.model) args.push('-m', w.model);
    args.push(...extra, '-i', ctx.prompt);
    return { args, env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: file } };
  }
  throw new Error(`Bilinmeyen motor: ${engine}`);
}

// ---- status from terminal activity (engines without a session registry) ----------
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)|\u001b[()][0-9A-B]|\r/g;
const stripAnsi = (s) => String(s).replace(ANSI, '');
const ASK = /(\(y\/n\)|\[y\/n\]|\by\/n\b|do you want to|allow this|approve|proceed\?|press enter to (confirm|continue)|yes, (and|allow)|waiting for (your )?(approval|confirmation)|onay)/i;

class Activity {
  constructor() { this.m = new Map(); }
  start(id, now = Date.now()) { this.m.set(id, { startedAt: now, lastOut: 0, firstOut: 0, tail: '', status: 'starting', since: now }); }
  data(id, chunk, now = Date.now()) {
    const a = this.m.get(id);
    if (!a) return;
    a.lastOut = now; a.firstOut ||= now;
    a.tail = (a.tail + stripAnsi(chunk)).slice(-1500);
  }
  stop(id) { this.m.delete(id); }
  // Busy while output keeps arriving; "waiting" when it went quiet on a question; idle otherwise.
  state(id, now = Date.now()) {
    const a = this.m.get(id);
    if (!a) return { status: 'offline', since: null, waitingFor: null };
    let status;
    const quiet = now - a.lastOut;
    if (!a.firstOut || now - a.startedAt < 4000) status = 'starting';
    else if (quiet < 2500) status = 'working';
    else if (ASK.test(a.tail.slice(-400))) status = 'waiting';
    else status = 'idle';
    if (status !== a.status) { a.status = status; a.since = now; }
    const line = a.tail.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' ').slice(0, 140);
    return { status, since: a.since, waitingFor: status === 'waiting' ? line : null };
  }
}

module.exports = { ENGINES, CODEX_MODES, GEMINI_MODES, splitArgs, findBin, launch, stripAnsi, Activity };
