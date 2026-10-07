'use strict';
// Board, memory and worker logic without Electron: the pieces the crew relies on.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { Memory } = require('../src/main/memory');
const { Workers, briefing } = require('../src/main/workers');
const { Board } = require('../src/main/board');

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-'));
  const store = new Store(dir);
  const ws = store.createWorkspace({ name: 'Demo', dir });
  const memory = new Memory(store);
  const typed = [];
  const running = new Set();
  const terminals = {
    get: (id) => (running.has(id) ? { exited: null, pid: 1 } : null),
    kill: (id) => running.delete(id), create: (o) => { running.add(o.id); return o; },
    paste: (id, t) => typed.push([id, t]), write: () => {}, snapshot: (x) => x,
  };
  const scanner = { registryEntry: () => ({ status: 'idle' }), sessionFile: () => null, summarizeSession: () => null, costState: () => null };
  const workers = new Workers(store, terminals, memory, { claudeBin: 'claude', mcp: { urlFor: () => 'http://x', toolNames: [] }, scanner });
  const board = new Board(store, workers);
  return { store, ws, memory, workers, board, typed, running, dir };
}

test('owner goals go to the lead to split; assigned cards wake and reach their worker', () => {
  const { ws, workers, board, typed, running } = rig();
  const lead = workers.create(ws, { name: 'Ada', role: 'Lider', lead: true });
  const dev = workers.create(ws, { name: 'Nova', role: 'Frontend' });
  workers.start(ws, lead.id);
  const goal = board.create(ws, { title: 'Giriş ekranı', details: 'şifremi unuttum', createdBy: 'user' });
  assert.strictEqual(goal.status, 'backlog');
  assert.match(typed[0][1], /Sahipten yeni hedef T-1/);
  const sub = board.create(ws, { title: 'Form', assignee: 'nova', createdBy: lead.id, parent: goal.id });
  assert.strictEqual(sub.assignee, dev.id);
  assert.strictEqual(sub.parent, goal.id);
  assert.ok(running.has(`w:${dev.id}`), 'sleeping worker was started for the card');
  assert.match(typed[1][1], /Yeni görev T-2 \(Ada\): Form/);
});

test('a card closes only with evidence and the creator hears about it', () => {
  const { ws, workers, board, typed } = rig();
  const lead = workers.create(ws, { name: 'Ada', role: 'Lider', lead: true });
  const dev = workers.create(ws, { name: 'Nova', role: 'Frontend' });
  workers.start(ws, lead.id); workers.start(ws, dev.id);
  const t = board.create(ws, { title: 'Form', assignee: dev.id, createdBy: lead.id });
  assert.throws(() => board.done(ws, t.id, { summary: 'x', evidence: [] }, dev.id), /Kanıt/);
  board.done(ws, t.id, { summary: 'Form hazır', evidence: [{ label: 'typecheck', ok: true }, { label: 'test', ok: false, detail: '1 fail' }], files: ['a.ts'] }, dev.id);
  assert.strictEqual(ws.tasks[0].status, 'done');
  assert.strictEqual(ws.reports.length, 1);
  const last = typed[typed.length - 1];
  assert.strictEqual(last[0], `w:${lead.id}`);
  assert.match(last[1], /T-1 "Form" tamamlandı \(Nova\)/);
  assert.match(last[1], /1 doğrulama başarısız/);
  assert.strictEqual(board.done(ws, board.create(ws, { title: 'Owner', createdBy: 'user' }).id, { summary: 'ok' }, 'user').status, 'done');
});

test('hands-off feeds idle workers the next open card, but not goals waiting on the lead', () => {
  const { store, ws, workers, board } = rig();
  const lead = workers.create(ws, { name: 'Ada', role: 'Lider', lead: true });
  const dev = workers.create(ws, { name: 'Nova', role: 'Frontend' });
  workers.start(ws, lead.id); workers.start(ws, dev.id);
  const goal = board.create(ws, { title: 'Hedef', createdBy: 'user' });
  const open = board.create(ws, { title: 'Serbest iş', createdBy: lead.id });
  store.data.handsOff = true;
  board.tick(ws, [{ id: dev.id, name: 'Nova', status: 'idle' }, { id: lead.id, name: 'Ada', status: 'working' }]);
  assert.strictEqual(board.task(ws, open.id).assignee, dev.id);
  assert.strictEqual(board.task(ws, open.id).status, 'todo');
  assert.strictEqual(board.task(ws, goal.id).assignee, null);
});

test('prompts typed before Claude is ready wait in the outbox', () => {
  const { ws, workers, typed } = rig();
  const w = workers.create(ws, { name: 'Kai', role: 'Backend' });
  workers.rt.scanner.registryEntry = () => null;        // not registered yet
  workers.start(ws, w.id);
  assert.strictEqual(workers.send(ws, w.id, 'merhaba'), true);
  assert.strictEqual(typed.length, 0);
  workers.flush(ws);
  assert.strictEqual(typed.length, 0);
  workers.rt.scanner.registryEntry = () => ({ status: 'idle' });
  workers.flush(ws);
  assert.deepStrictEqual(typed[0], [`w:${w.id}`, 'merhaba']);
});

test('memory notes are per worker, searchable and linked by tags', () => {
  const { ws, workers, memory } = rig();
  const a = workers.create(ws, { name: 'Ada', role: 'Lider' });
  const b = workers.create(ws, { name: 'Kai', role: 'Backend' });
  memory.note(ws, a, 'Token 15 dakika geçerli', ['Auth', 'token']);
  memory.note(ws, b, 'E-posta kuyruğu Redis', ['email', 'auth']);
  assert.match(memory.read(ws, a), /- \d{4}-\d{2}-\d{2} \d{2}:\d{2} — Token 15 dakika geçerli \[\[auth\]\] \[\[token\]\]/);
  assert.strictEqual(memory.search(ws, 'auth').length, 2);
  assert.strictEqual(memory.search(ws, 'redis kuyruğu').length, 1);
  const g = memory.graph(ws);
  assert.deepStrictEqual(g.nodes.filter((n) => n.kind === 'tag').map((n) => n.label).sort(), ['auth', 'email', 'token']);
  assert.strictEqual(g.nodes.find((n) => n.id === 'tag:auth').count, 2);
  assert.strictEqual(g.links.length, 4);
});

test('briefing names the team, the board tools and the memory file', () => {
  const { ws, workers } = rig();
  const lead = workers.create(ws, { name: 'Ada', role: 'Lider', lead: true });
  const dev = workers.create(ws, { name: 'Nova', role: 'Frontend', duties: 'UI yazar' });
  const text = briefing(ws, dev, '/m/nova.md');
  assert.match(text, /You are Nova, the Frontend/);
  assert.match(text, /- Ada — Lider \(lead\)/);
  assert.match(text, /\/m\/nova\.md/);
  assert.match(text, /mcp__office__board_list/);
  assert.doesNotMatch(text, /You are the lead/);
  assert.match(briefing(ws, lead, '/m/ada.md'), /You are the lead/);
});

test('workers are named automatically and only one is lead', () => {
  const { ws, workers } = rig();
  const a = workers.create(ws, {});
  const b = workers.create(ws, { lead: true });
  assert.notStrictEqual(a.name, b.name);
  assert.strictEqual(ws.lead, b.id);
  workers.remove(ws, b.id);
  assert.strictEqual(ws.lead, a.id);
});

test('board drag-and-drop calls: moving between columns changes status, drop on done closes with a report', () => {
  const { ws, board } = rig();
  const t = board.create(ws, { title: 'Sürükle', createdBy: 'user' });
  assert.strictEqual(t.status, 'backlog');
  for (const st of ['todo', 'doing', 'review', 'backlog']) {
    board.update(ws, t.id, { status: st }, 'user');
    assert.strictEqual(board.task(ws, t.id).status, st);
  }
  board.done(ws, t.id, { summary: 'Sahip panodan kapattı.' }, 'user');
  assert.strictEqual(board.task(ws, t.id).status, 'done');
  assert.strictEqual(ws.reports[0].taskId, t.id);
  board.update(ws, t.id, { status: 'doing' }, 'user');       // reopen by dragging out of done
  assert.strictEqual(board.task(ws, t.id).status, 'doing');
});
