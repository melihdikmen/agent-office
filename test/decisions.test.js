'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Decisions } = require('../src/main/decisions');

function rig() {
  const sent = [], started = [], asked = [];
  const workers = { running: () => false, start: (ws, id) => started.push(id), send: (ws, id, text) => { sent.push([id, text]); return true; } };
  const notifier = { decisionAsked: (ws, d, name) => asked.push([d.id, name]) };
  const ws = { id: 'w1', workers: [{ id: 'a1', name: 'Ada' }] };
  return { d: new Decisions({ save() {} }, workers, notifier), ws, sent, started, asked };
}

test('ask stores an open decision, numbers it and tells the owner', () => {
  const { d, ws, asked } = rig();
  const k = d.ask(ws, 'a1', { question: 'Hangi veritabanı?', options: ['SQLite', 'Postgres', ''], details: 'ölçek küçük' });
  assert.equal(k.id, 'K-1');
  assert.deepEqual(k.options, ['SQLite', 'Postgres']);
  assert.equal(d.ask(ws, 'a1', { question: 'ikinci' }).id, 'K-2');
  assert.deepEqual(asked[0], ['K-1', 'Ada']);
  assert.equal(d.open(ws).length, 2);
  assert.throws(() => d.ask(ws, 'a1', { question: '  ' }), /boş/);
});

test('answer types the reply into the worker terminal (starting it if asleep) and closes the decision', () => {
  const { d, ws, sent, started } = rig();
  d.ask(ws, 'a1', { question: 'Hangi veritabanı?', options: ['SQLite', 'Postgres'] });
  const k = d.answer(ws, 'K-1', 'SQLite');
  assert.equal(k.status, 'answered');
  assert.deepEqual(started, ['a1']);
  assert.match(sent[0][1], /\[Karar K-1\] Sahip cevapladı: SQLite/);
  assert.equal(d.open(ws).length, 0);
  assert.throws(() => d.answer(ws, 'K-1', 'x'), /zaten/);
  assert.throws(() => d.answer(ws, 'K-9', 'x'), /yok/);
});
