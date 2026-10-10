'use strict';
// Password reset core: POST /auth/forgot and POST /auth/reset.
// Storage and mail are injected, so this module has no HTTP, DB or SMTP of its own.
//   store.findUserByEmail(email) -> { id } | null
//   store.saveResetToken({ userId, hash, expiresAt })
//   store.consumeResetToken(hash, now) -> { userId, expiresAt } | null   (atomic: marks used)
//   store.invalidateResetTokens(userId)
//   store.setPassword(userId, password)
//   mailer.send({ to, link })
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const FORGOT_OK = Object.freeze({ ok: true });

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = (e) => String(e ?? '').trim().toLowerCase();

function createAuth({ store, mailer, baseUrl = 'http://localhost/reset', now = () => Date.now(), ttlMs = TTL_MS, log = () => {} }) {
  // Always the same answer, whether or not the email is registered.
  async function forgot(email) {
    const addr = normEmail(email);
    if (!addr) return FORGOT_OK;
    const user = await store.findUserByEmail(addr);
    if (!user) return FORGOT_OK;
    const token = crypto.randomBytes(32).toString('base64url');
    await store.invalidateResetTokens(user.id);
    await store.saveResetToken({ userId: user.id, hash: sha256(token), expiresAt: now() + ttlMs });
    try {
      await mailer.send({ to: addr, link: `${baseUrl}?token=${encodeURIComponent(token)}` });
    } catch (err) {
      log('auth.forgot mail failed', err && err.message);
    }
    return FORGOT_OK;
  }

  // Returns { status: 200, body: {ok:true} } or { status: 400, body: {code} }.
  async function reset(token, password) {
    if (typeof token !== 'string' || !token || typeof password !== 'string' || !password) {
      return { status: 400, body: { code: 'INVALID' } };
    }
    const hash = sha256(token);
    const rec = await store.consumeResetToken(hash, now());
    if (!rec) return { status: 400, body: { code: 'INVALID' } };
    if (rec.expiresAt <= now()) return { status: 400, body: { code: 'EXPIRED' } };
    await store.setPassword(rec.userId, password);
    await store.invalidateResetTokens(rec.userId);
    return { status: 200, body: { ok: true } };
  }

  return { forgot, reset };
}

module.exports = { createAuth, TTL_MS };
