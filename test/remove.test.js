'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Workers } = require('../src/main/workers');
const { Store } = require('../src/main/store');
const { Memory } = require('../src/main/memory');

function setup({ git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-rm-'));
  if (git) {
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('init', '-q'); g('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'init');
  }
  const store = new Store(dir);
  const ws = store.createWorkspace({ name: 'Demo', dir });
  const killed = [];
  let live = new Set();
  const terminals = { get: (id) => (live.has(id) ? { exited: null, pid: 1 } : null), kill: (id) => { killed.push(id); return live.delete(id); }, create: () => {}, snapshot: (x) => x, write() {}, paste() {} };
  const workers = new Workers(store, terminals, new Memory(store), { claudeBin: 'claude', mcp: { urlFor: () => 'u', toolNames: [] }, scanner: { registryEntry: () => null } });
  return { dir, store, ws, workers, killed, live };
}

test('removing a never-started worker works and clears its tasks', () => {
  const { ws, workers } = setup();
  const a = workers.create(ws, { name: 'A', role: 'Lider' });
  const b = workers.create(ws, { name: 'B', role: 'QA' });
  ws.tasks.push({ id: 'T-1', assignee: b.id, status: 'todo' });
  workers.remove(ws, b.id);
  assert.deepStrictEqual(ws.workers.map((w) => w.id), [a.id]);
  assert.strictEqual(ws.tasks[0].assignee, null);
});

test('removing a running worker kills its terminal first', () => {
  const { ws, workers, killed, live } = setup();
  const a = workers.create(ws, { name: 'A', role: 'QA' });
  live.add(workers.termId(a.id));
  workers.remove(ws, a.id);
  assert.deepStrictEqual(killed, [workers.termId(a.id)]);
  assert.strictEqual(ws.workers.length, 0);
});

test('removing the lead hands lead to the next worker; removing the last leaves lead null', () => {
  const { ws, workers } = setup();
  const a = workers.create(ws, { name: 'A', role: 'Lider', lead: true });
  const b = workers.create(ws, { name: 'B', role: 'QA' });
  assert.strictEqual(ws.lead, a.id);
  workers.remove(ws, a.id);
  assert.strictEqual(ws.lead, b.id);
  workers.remove(ws, b.id);
  assert.strictEqual(ws.lead, null);
  const c = workers.create(ws, { name: 'C', role: 'QA' });
  assert.strictEqual(ws.lead, c.id, 'a new hire becomes lead again');
});

test('removing a worker whose worktree is gone or broken still removes the worker', () => {
  const { ws, workers } = setup();
  const a = workers.create(ws, { name: 'A', role: 'QA', worktree: true });
  a.worktreePath = '/nonexistent/path/xyz';
  workers.remove(ws, a.id);
  assert.strictEqual(ws.workers.length, 0);
});

test('removing a worker with a real worktree deletes the checkout', () => {
  const { dir, ws, workers } = setup({ git: true });
  const a = workers.create(ws, { name: 'A', role: 'QA', worktree: true });
  const wt = path.join(dir, '.wt-a');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'wt-a', wt], { cwd: dir, stdio: 'ignore' });
  a.worktreePath = wt; a.worktreeBranch = 'wt-a';
  workers.remove(ws, a.id);
  assert.strictEqual(ws.workers.length, 0);
  assert.strictEqual(fs.existsSync(wt), false);
});

test('removing an unknown worker is a no-op that reports it', () => {
  const { ws, workers } = setup();
  assert.strictEqual(workers.remove(ws, 'nope'), false);
});

test('a failing step is reported, not swallowed into a half-removed worker', () => {
  const { ws, workers } = setup();
  const a = workers.create(ws, { name: 'A', role: 'QA' });
  workers.terminals.kill = () => { throw new Error('pty yok'); };
  workers.remove(ws, a.id);
  assert.strictEqual(ws.workers.length, 0, 'worker is gone even if the terminal kill failed');
});
