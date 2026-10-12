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

const T = (sec) => new Date(Date.UTC(2026, 9, 12, 10, 0, sec)).toISOString();
const turn = (sec, text, role = 'assistant') => ({ role, text, ts: T(sec) });
const view = (id, turns) => ({ id, turns });
const from = (chat, ws, id) => chat.list(ws).filter((m) => m.from === id);

test('first sight of an agent takes no backlog; later answers are mirrored whatever triggered them', () => {
  const { chat, ws } = rig();
  chat.tick(ws, [view('a1', [turn(0, 'eski cevap')])]);
  assert.equal(chat.list(ws).length, 0);
  chat.tick(ws, [view('a1', [turn(0, 'eski cevap'), turn(30, '[Pano] T-1 geldi', 'user'), turn(40, 'Başlıyorum.'), turn(60, 'Bitti.')])]);
  assert.deepEqual(from(chat, ws, 'a1').map((m) => m.text), ['Başlıyorum.', 'Bitti.']);
  assert.ok(from(chat, ws, 'a1').every((m) => m.to === 'user'));
});

test('ticking twice or restarting does not duplicate or lose messages', () => {
  const { chat, ws } = rig();
  const t = [turn(0, 'bir')];
  chat.tick(ws, [view('a1', t)]);
  t.push(turn(30, 'iki'));
  chat.tick(ws, [view('a1', t)]);
  chat.tick(ws, [view('a1', t)]);
  const saved = JSON.parse(JSON.stringify(ws));            // app closes and reopens: new Chat, same workspace data
  const again = rig();
  Object.assign(again.ws, saved);
  t.push(turn(60, 'üç'));
  again.chat.tick(again.ws, [view('a1', t)]);
  assert.deepEqual(from(again.chat, again.ws, 'a1').map((m) => m.text), ['iki', 'üç']);
});

test('answers said while the app was closed are picked up after the cursor, even if it left the window', () => {
  const { chat, ws } = rig();
  chat.tick(ws, [view('a1', [turn(0, 'bir')])]);
  chat.tick(ws, [view('a1', [turn(100, 'yeni1'), turn(200, 'yeni2')])]);
  assert.deepEqual(from(chat, ws, 'a1').map((m) => m.text), ['yeni1', 'yeni2']);
});

test('a worker with no output yet still gets its first words mirrored', () => {
  const { chat, ws } = rig();
  chat.tick(ws, [view('a1', [])]);
  chat.tick(ws, [view('a1', [{ role: 'assistant', text: 'Merhaba', ts: new Date(Date.now() + 1000).toISOString() }])]);
  assert.equal(from(chat, ws, 'a1').length, 1);
});

test('long answers are kept up to 4000 chars, longer ones end with a pointer to the terminal', () => {
  const { chat, ws } = rig();
  chat.tick(ws, [view('a1', [turn(0, 'x')])]);
  chat.tick(ws, [view('a1', [turn(0, 'x'), turn(30, 'u'.repeat(3500))])]);
  chat.add(ws, { from: 'k2', to: 'user', text: 'v'.repeat(9000) });
  assert.equal(from(chat, ws, 'a1')[0].text.length, 3500);
  const long = from(chat, ws, 'k2')[0].text;
  assert.equal(long.length, 4000);
  assert.match(long, /devamı terminalde\)$/);
});

test('noise is skipped and parts within 2 seconds merge into one message', () => {
  const { chat, ws } = rig();
  chat.tick(ws, [view('a1', [turn(0, 'x')])]);
  chat.tick(ws, [view('a1', [turn(0, 'x'), turn(30, '...'), turn(31, 'Önce bakıyorum.'), turn(32, 'Sonra düzeltiyorum.'), turn(50, 'Ayrı mesaj.')])]);
  assert.deepEqual(from(chat, ws, 'a1').map((m) => m.text), ['Önce bakıyorum.\n\nSonra düzeltiyorum.', 'Ayrı mesaj.']);
});

test('what the owner types in the terminal shows up as a terminal message; app-injected lines do not', () => {
  const { chat, ws } = rig();
  chat.tick(ws, [view('a1', [turn(0, 'x')])]);
  chat.tick(ws, [view('a1', [turn(0, 'x'), turn(10, 'şunu yap', 'user'), turn(11, '[Mesaj · Kai] selam', 'user'), turn(12, '[Sohbet · Sahip] hey', 'user')])]);
  const l = chat.list(ws);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].from, l[0].to, l[0].kind, l[0].text], ['user', 'a1', 'term', 'şunu yap']);
});

test('message(to: sahip) and the same words in the terminal answer become one chat message', () => {
  const { chat, ws } = rig();
  chat.tick(ws, [view('k2', [turn(0, 'x')])]);
  chat.fromAgent(ws, 'k2', 'sahip', 'PR hazır, bakabilirsin.');
  chat.tick(ws, [view('k2', [turn(0, 'x'), turn(5, 'PR hazır, bakabilirsin.')])]);
  assert.equal(from(chat, ws, 'k2').length, 1);
});

test('chat history keeps up to 1000 messages', () => {
  const { chat, ws } = rig();
  for (let i = 0; i < 1100; i++) chat.add(ws, { from: 'user', to: 'team', text: `m${i}` });
  assert.equal(chat.list(ws).length, 1000);
  assert.equal(chat.list(ws)[0].text, 'm100');
});

test('message to "sahip" and agent DMs are recorded', () => {
  const { chat, ws } = rig();
  chat.fromAgent(ws, 'k2', 'sahip', 'Bitti');
  chat.fromAgent(ws, 'k2', 'Ada', 'PR hazır');
  const l = chat.list(ws);
  assert.equal(l[0].to, 'user');
  assert.equal(l[1].kind, 'dm');
});
