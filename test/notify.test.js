'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { prefsOf, shouldPopup, describeDone, describeWaiting, describeFinished, Notifier } = require('../src/main/notify');

const ws = { id: 'w1', name: 'Ürün HQ', tasks: [{ id: 'T-2', assignee: 'a1', status: 'doing', title: 'Form doğrulama' }] };

test('prefs: defaults and overrides', () => {
  const p = prefsOf({ kinds: { assigned: true }, sound: false });
  assert.equal(p.enabled, true);
  assert.equal(p.sound, false);
  assert.equal(p.kinds.assigned, true);
  assert.equal(p.kinds.done, true);
});

test('popup only when enabled, kind on, and (if asked) the app is in the background', () => {
  const p = prefsOf({});
  assert.equal(shouldPopup(p, 'done', false), true);
  assert.equal(shouldPopup(p, 'done', true), false);
  assert.equal(shouldPopup(prefsOf({ onlyUnfocused: false }), 'done', true), true);
  assert.equal(shouldPopup(p, 'assigned', false), false);
  assert.equal(shouldPopup(prefsOf({ enabled: false }), 'done', false), false);
});

test('done text names the project, the agent, the task and the evidence', () => {
  const task = { id: 'T-2', title: 'Form doğrulama', report: { summary: 'zod eklendi', evidence: [{ label: 'test', ok: true }, { label: 'build', ok: false }], files: ['a.js', 'b.js'] } };
  const d = describeDone(ws, task, 'Ada');
  assert.equal(d.title, 'Ürün HQ · Ada');
  assert.match(d.subtitle, /T-2/);
  assert.match(d.body, /zod eklendi/);
  assert.match(d.body, /1\/2 doğrulama başarısız/);
  assert.match(d.body, /2 dosya/);
  assert.equal(d.warn, true);
});

test('waiting and finished texts', () => {
  const w = describeWaiting(ws, { id: 'a1', name: 'Ada', waitingFor: 'izin: rm -rf out' }, ws.tasks[0]);
  assert.equal(w.kind, 'waiting');
  assert.match(w.body, /rm -rf out/);
  assert.match(w.body, /T-2/);
  const f = describeFinished(ws, { id: 'a1', name: 'Ada' }, ws.tasks[0], 190);
  assert.match(f.body, /3 dk/);
});

test('tick: notifies on waiting and on stopping a long stretch of work, not on short blips', () => {
  const sent = [];
  const store = { data: {}, save() {} };
  const n = new Notifier({ store, send: (c, p) => sent.push(p), win: () => null, onOpen() {} });
  const view = (status) => [{ id: 'a1', name: 'Ada', status, waitingFor: 'onay' }];
  n.tick(ws, view('idle'));
  n.tick(ws, view('working'));
  n.tick(ws, view('waiting'));
  assert.deepEqual(sent.map((x) => x.kind), ['waiting']);
  n.seen.set('a1', { status: 'working', since: Date.now() - 60000 });
  n.tick(ws, view('idle'));
  assert.deepEqual(sent.map((x) => x.kind), ['waiting', 'finished']);
  n.seen.set('a1', { status: 'working', since: Date.now() - 2000 });
  n.tick(ws, view('idle'));
  assert.equal(sent.length, 2);
  assert.equal(store.data.notifications.length, 2);
});
