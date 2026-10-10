'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Board } = require('../src/main/board');

function rig() {
  const sent = [], started = [];
  const workers = { resolve: (ws, n) => ws.workers.find((w) => w.id === n || w.name === n) || null, running: () => false, start: (ws, id) => started.push(id), send: (ws, id, text) => sent.push([id, text]) };
  const board = new Board({ save() {}, data: {} }, workers);
  const ws = { id: 'w1', lead: 'l1', workers: [{ id: 'a1', name: 'Ada' }, { id: 'l1', name: 'Nova' }], tasks: [], reports: [], nextTask: 1 };
  const t = board.create(ws, { title: 'Giriş', assignee: 'a1', createdBy: 'user' });
  board.done(ws, t.id, { summary: 'Tamam', evidence: [{ label: 'test', ok: true }], files: ['a.js'] }, 'a1');
  sent.length = 0; started.length = 0;                 // ignore the assignment traffic from setup
  return { board, ws, sent, started, rep: ws.reports[0], task: ws.tasks[0] };
}

test('a worker\'s report starts pending with no comments', () => {
  const { rep } = rig();
  assert.equal(rep.review.status, 'pending');
  assert.deepEqual(rep.comments, []);
});

test('comment goes to the report author with its anchor', () => {
  const { board, ws, sent, rep } = rig();
  board.reviewReport(ws, rep.id, { action: 'comment', text: 'Testi ayrıntılandır', anchor: { type: 'evidence', ref: 0, label: 'test' } });
  assert.equal(rep.comments.length, 1);
  assert.match(sent[0][1], /\[Rapor T-\d+ · yorum · kanıt: test\] Testi ayrıntılandır/);
  assert.equal(sent[0][0], 'a1');
  assert.throws(() => board.reviewReport(ws, rep.id, { action: 'comment', text: ' ' }), /boş/);
});

test('changes reopen the task and tell the worker to close it again', () => {
  const { board, ws, sent, started, rep, task } = rig();
  board.reviewReport(ws, rep.id, { action: 'changes', text: 'Hata durumunu da kapsa' });
  assert.equal(rep.review.status, 'changes');
  assert.equal(task.status, 'doing');
  assert.deepEqual(started, ['a1']);
  assert.match(sent[0][1], /değişiklik istedi: Hata durumunu da kapsa\nDüzeltip T-\d+ için task_done/);
  assert.throws(() => board.reviewReport(ws, rep.id, { action: 'changes', text: '' }), /Ne değişmeli/);
});

test('approve marks the report and notifies the author', () => {
  const { board, ws, sent, rep } = rig();
  board.reviewReport(ws, rep.id, { action: 'approve', text: 'Güzel' });
  assert.equal(rep.review.status, 'approved');
  assert.match(sent[0][1], /onayladı ✓ — Güzel/);
});
