'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createAuth, TTL_MS } = require('../src/main/auth');

function memStore(users) {
  const tokens = new Map();
  const passwords = {};
  return {
    tokens, passwords,
    async findUserByEmail(email) { return users.find((u) => u.email === email) || null; },
    async saveResetToken(t) { tokens.set(t.hash, { ...t, used: false }); },
    async consumeResetToken(hash, now) {
      const t = tokens.get(hash);
      if (!t || t.used) return null;
      t.used = true;
      return { userId: t.userId, expiresAt: t.expiresAt };
    },
    async invalidateResetTokens(userId) {
      for (const t of tokens.values()) if (t.userId === userId) t.used = true;
    },
    async setPassword(userId, pw) { passwords[userId] = pw; },
  };
}

function setup(t0 = 1_000_000) {
  let now = t0;
  const sent = [];
  const store = memStore([{ id: 'u1', email: 'a@b.co' }]);
  const auth = createAuth({ store, mailer: { send: async (m) => sent.push(m) }, now: () => now });
  const tokenFromMail = () => new URL(sent.at(-1).link).searchParams.get('token');
  return { auth, store, sent, tokenFromMail, advance: (ms) => { now += ms; }, now: () => now, t0 };
}

test('forgot returns the same body for registered and unknown emails', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.auth.forgot('a@b.co'), { ok: true });
  assert.deepStrictEqual(await s.auth.forgot('nobody@x.io'), { ok: true });
  assert.deepStrictEqual(await s.auth.forgot(''), { ok: true });
  assert.equal(s.sent.length, 1, 'mail only for registered address');
});

test('forgot stores only the hash of the token and mails the plain token', async () => {
  const s = setup();
  await s.auth.forgot('  A@B.co ');
  const token = s.tokenFromMail();
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  assert.ok(s.store.tokens.has(hash));
  assert.ok(!s.store.tokens.has(token));
  assert.equal([...s.store.tokens.values()][0].expiresAt, s.t0 + TTL_MS);
});

test('reset with a valid token sets the password and works once', async () => {
  const s = setup();
  await s.auth.forgot('a@b.co');
  const token = s.tokenFromMail();
  assert.deepStrictEqual(await s.auth.reset(token, 'yeniSifre1'), { status: 200, body: { ok: true } });
  assert.equal(s.store.passwords.u1, 'yeniSifre1');
  assert.deepStrictEqual(await s.auth.reset(token, 'baska'), { status: 400, body: { code: 'INVALID' } });
});

test('reset with an unknown or used token is INVALID even with a weak password (no rule leak)', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.auth.reset('bogus-token', 'x'), { status: 400, body: { code: 'INVALID' } });
  await s.auth.forgot('a@b.co');
  const token = s.tokenFromMail();
  await s.auth.reset(token, 'yeniSifre1');
  assert.deepStrictEqual(await s.auth.reset(token, 'x'), { status: 400, body: { code: 'INVALID' } });
});

test('reset with a valid token and a weak password is WEAK_PASSWORD and keeps the link usable', async () => {
  const s = setup();
  await s.auth.forgot('a@b.co');
  const token = s.tokenFromMail();
  const weak = { status: 400, body: { code: 'WEAK_PASSWORD', min: 8, max: 128 } };
  assert.deepStrictEqual(await s.auth.reset(token, 'kisa'), weak);
  assert.deepStrictEqual(await s.auth.reset(token, 'a'.repeat(129)), weak);
  assert.equal(s.store.passwords.u1, undefined);
  assert.deepStrictEqual(await s.auth.reset(token, 'yeniSifre1'), { status: 200, body: { ok: true } });
});

test('reset after 15 minutes returns EXPIRED', async () => {
  const s = setup();
  await s.auth.forgot('a@b.co');
  const token = s.tokenFromMail();
  s.advance(TTL_MS);
  assert.deepStrictEqual(await s.auth.reset(token, 'yeniSifre1'), { status: 400, body: { code: 'EXPIRED' } });
  assert.equal(s.store.passwords.u1, undefined);
});

test('unknown or malformed token returns INVALID', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.auth.reset('uydurma', 'yeniSifre1'), { status: 400, body: { code: 'INVALID' } });
  assert.deepStrictEqual(await s.auth.reset(undefined, 'x'), { status: 400, body: { code: 'INVALID' } });
  assert.deepStrictEqual(await s.auth.reset('abc', ''), { status: 400, body: { code: 'INVALID' } });
});

test('a newer forgot request invalidates the older token', async () => {
  const s = setup();
  await s.auth.forgot('a@b.co');
  const first = s.tokenFromMail();
  await s.auth.forgot('a@b.co');
  assert.deepStrictEqual(await s.auth.reset(first, 'yeniSifre1'), { status: 400, body: { code: 'INVALID' } });
});
