'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { splitArgs, launch, Activity, stripAnsi } = require('../src/main/engines');

test('splitArgs keeps quoted groups together', () => {
  assert.deepEqual(splitArgs('--foo "a b" -x \'c d\''), ['--foo', 'a b', '-x', 'c d']);
  assert.deepEqual(splitArgs(''), []);
});

test('codex: board is an MCP url override, permissions map to config, briefing goes last', () => {
  const { args } = launch('codex', { worker: { id: 'w1', permissionMode: 'plan', model: 'gpt-5', extraArgs: '--search' }, mcpUrl: 'http://127.0.0.1:9/mcp/tok', prompt: 'BRIEF' });
  assert.ok(args.includes('mcp_servers.office.url="http://127.0.0.1:9/mcp/tok"'));
  assert.ok(args.includes('sandbox_mode="read-only"'));
  assert.deepEqual(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2), ['-m', 'gpt-5']);
  assert.equal(args.at(-1), 'BRIEF');
  assert.ok(args.includes('--search'));
});

test('gemini: MCP settings go to a per-worker file named by env, prompt via -i', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-eng-'));
  const l = launch('gemini', { worker: { id: 'w2', permissionMode: 'bypassPermissions', model: '' }, mcpUrl: 'http://127.0.0.1:9/mcp/tok', integrations: { sentry: { httpUrl: 'https://x' } }, prompt: 'BRIEF', dataDir: dir });
  const cfg = JSON.parse(fs.readFileSync(l.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, 'utf8'));
  assert.equal(cfg.mcpServers.office.httpUrl, 'http://127.0.0.1:9/mcp/tok');
  assert.ok(cfg.mcpServers.sentry);
  assert.deepEqual(l.args.slice(0, 2), ['--approval-mode', 'yolo']);
  assert.deepEqual(l.args.slice(-2), ['-i', 'BRIEF']);
  assert.ok(!l.args.includes('-m'));
});

test('activity: starting → working while output flows → idle when quiet → waiting on a question', () => {
  const a = new Activity();
  a.start('w:1', 0);
  assert.equal(a.state('w:1', 1000).status, 'starting');
  a.data('w:1', 'thinking…', 5000);
  assert.equal(a.state('w:1', 6000).status, 'working');
  assert.equal(a.state('w:1', 9000).status, 'idle');
  a.data('w:1', '\u001b[1mAllow this command? (y/n)\u001b[0m', 10000);
  const s = a.state('w:1', 14000);
  assert.equal(s.status, 'waiting');
  assert.match(s.waitingFor, /Allow this command/);
  a.stop('w:1');
  assert.equal(a.state('w:1', 15000).status, 'offline');
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red');
});
