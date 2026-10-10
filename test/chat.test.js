'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Chat } = require('../src/main/chat');

function rig() {
  const sent = [], started = [], run = new Set();
  const ws = { id: 'w1', lead: 'a1', workers: [{ id: 'a1', name: 'Ada' }, { id: 'k2', name: 'Kai' }] };
  const workers = {
    running: (id) => run.has(id), start: (w, id) => { started.push(id); run.add(id); return true; },
    send: (w, id, t) => { sent.push([id, t]); return true; },
    resolve: (w, n) => w.workers.find((x) => x.id === n || x.name.toLowerCase() === String(n).toLowerCase()) || null,
  };
  return { chat: new Chat({ save() {} }, workers), ws, sent, started };
}

test('a message without @ goes to the lead as a team message', () => {
  const { chat, ws, sent, started } = rig();
  assert.deepEqual(chat.ownerSend(ws, 'Giriş ekranı yapalım'), ['a1']);
  assert.deepEqual(started, ['a1']);
  assert.match(sent[0][1], /Sahip → takım.*Giriş ekranı/s);
  assert.equal(chat.list(ws)[0].to, 'team');
});

test('@names address people directly, in any case', () => {
  const { chat, ws, sent } = rig();
  assert.deepEqual(chat.ownerSend(ws, '@kai bunu bak, @Ada sen de'), ['k2', 'a1']);
  assert.equal(sent.length, 2);
  assert.throws(() => chat.ownerSend(ws, '  '), /boş/);
});

test('the answer of a worker that finished its turn is mirrored once', () => {
  const { chat, ws } = rig();
  chat.ownerSend(ws, '@Ada durum?');
  const t0 = Date.now();
  chat.tick(ws, [{ id: 'a1', status: 'working', lastAnswer: 'x' }], t0 + 9000);
  chat.tick(ws, [{ id: 'a1', status: 'idle', lastAnswer: 'Hazır.' }], t0 + 9000);
  chat.tick(ws, [{ id: 'a1', status: 'idle', lastAnswer: 'Hazır.' }], t0 + 20000);
  const replies = chat.list(ws).filter((m) => m.from === 'a1');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, 'Hazır.');
});

test('message to "sahip" and agent DMs are recorded', () => {
  const { chat, ws } = rig();
  chat.fromAgent(ws, 'k2', 'sahip', 'Bitti');
  chat.fromAgent(ws, 'k2', 'Ada', 'PR hazır');
  const l = chat.list(ws);
  assert.equal(l[0].to, 'user');
  assert.equal(l[1].kind, 'dm');
});
