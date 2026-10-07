'use strict';
// Relays a text into a Claude Code session the office does not control (one
// running in another terminal or in the background): a short headless session
// delivers it with SendMessage, the documented way to post into a session.
const { spawn } = require('child_process');
const os = require('os');

const OWNER_TAG = '[Sahip · Agent Office]';

function prompt(items) {
  return [
    'You are a message courier. For each item below, call the SendMessage tool once, with `to` set to the item\'s session name and the message text copied EXACTLY as written between the tags (no edits, no additions, no translation).',
    'Then answer with one line per item and nothing else: "<session name>: sent" or "<session name>: failed — <reason>".',
    '',
    ...items.map((it) => `<item to="${it.to}">\n${it.text}\n</item>`),
  ].join('\n');
}

function courier({ claudeBin, env, children }, items, { timeout = 120000 } = {}) {
  if (!items.length) return Promise.resolve({ ok: true, failed: [] });
  const args = ['-p', '--model', 'haiku', '--name', 'agent-office', '--permission-mode', 'acceptEdits', '--no-session-persistence',
    '--output-format', 'json', '--disable-slash-commands', '--strict-mcp-config'];
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let p;
    try { p = spawn(claudeBin, args, { cwd: os.homedir(), env }); } catch (e) { return resolve({ ok: false, failed: items.map((i) => i.to), error: e.message }); }
    children?.add(p.pid);
    const timer = setTimeout(() => p.kill('SIGTERM'), timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { err += e.message; });
    p.on('close', () => {
      clearTimeout(timer);
      children?.delete(p.pid);
      let text = '';
      let cost = 0;
      try { const j = JSON.parse(out); text = String(j.result || ''); cost = j.total_cost_usd || 0; } catch { return resolve({ ok: false, failed: items.map((i) => i.to), error: String(err || out).replace(/\x1b\[[0-9;]*m/g, '').slice(-300) || 'kurye çalışmadı' }); }
      const failed = items.filter((it) => { const line = text.split('\n').find((l) => l.includes(it.to)); return !line || /fail/i.test(line); }).map((it) => it.to);
      resolve({ ok: !failed.length, failed, cost, text });
    });
    p.stdin.end(prompt(items));
  });
}

module.exports = { courier, OWNER_TAG };
