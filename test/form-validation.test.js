'use strict';
const test = require('node:test');
const assert = require('node:assert');

// The validator is an ES module (bundled by esbuild for the renderer), so it is loaded with import().
const loadValidation = () => import('../src/renderer/form-validation.mjs');

test('email: accepts a normal address and trims/lowercases it', async () => {
  const { validateEmail } = await loadValidation();
  assert.deepStrictEqual(validateEmail('  Ada@Example.com '), { ok: true });
});

test('email: rejects empty, malformed and over-long addresses', async () => {
  const { validateEmail, EMAIL_MAX } = await loadValidation();
  assert.strictEqual(validateEmail('').code, 'REQUIRED');
  assert.strictEqual(validateEmail(undefined).code, 'REQUIRED');
  assert.strictEqual(validateEmail('ada@example').code, 'EMAIL_INVALID');
  assert.strictEqual(validateEmail('ada @example.com').code, 'EMAIL_INVALID');
  const long = 'a'.repeat(EMAIL_MAX) + '@x.co';
  assert.strictEqual(validateEmail(long).code, 'EMAIL_INVALID');
});

test('password: enforces the 8..128 length rules like the server', async () => {
  const { validatePassword, PASSWORD_MIN, PASSWORD_MAX } = await loadValidation();
  assert.strictEqual(validatePassword('').code, 'REQUIRED');
  assert.deepStrictEqual(validatePassword('1234567'), { ok: false, code: 'TOO_SHORT', min: PASSWORD_MIN });
  // The server trims before counting, so 7 real characters padded with spaces are still too short.
  assert.strictEqual(validatePassword('1234567 ').code, 'TOO_SHORT');
  assert.deepStrictEqual(validatePassword('12345678'), { ok: true });
  assert.deepStrictEqual(validatePassword('x'.repeat(PASSWORD_MAX + 1)), { ok: false, code: 'TOO_LONG', max: PASSWORD_MAX });
  assert.deepStrictEqual(validatePassword('x'.repeat(PASSWORD_MAX)), { ok: true });
});

test('reset form: needs a valid password and a matching confirmation', async () => {
  const { validateResetForm } = await loadValidation();
  assert.deepStrictEqual(validateResetForm({ password: 'correct horse', confirm: 'correct horse' }), { ok: true, errors: {} });

  const mismatch = validateResetForm({ password: 'correct horse', confirm: 'correct hors' });
  assert.strictEqual(mismatch.ok, false);
  assert.strictEqual(mismatch.errors.confirm.code, 'MISMATCH');
  assert.strictEqual(mismatch.errors.password, undefined);

  const weak = validateResetForm({ password: 'short', confirm: 'short' });
  assert.strictEqual(weak.ok, false);
  assert.strictEqual(weak.errors.password.code, 'TOO_SHORT');
  assert.strictEqual(weak.errors.confirm, undefined);
});
