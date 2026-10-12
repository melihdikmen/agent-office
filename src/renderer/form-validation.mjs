// Client-side checks for the password reset forms (forgot: email, reset: new password twice).
// Same rules as src/main/auth.js, which stays the final check: the server answers WEAK_PASSWORD / INVALID anyway.
// Pure: no DOM, returns { ok, code, ... } so the UI can pick its own message.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value) {
  const addr = String(value ?? '').trim().toLowerCase();
  if (!addr) return { ok: false, code: 'REQUIRED' };
  if (addr.length > EMAIL_MAX || !EMAIL_RE.test(addr)) return { ok: false, code: 'EMAIL_INVALID' };
  return { ok: true };
}

export function validatePassword(value) {
  const pw = String(value ?? '');
  if (!pw) return { ok: false, code: 'REQUIRED' };
  if (pw.trim().length < PASSWORD_MIN) return { ok: false, code: 'TOO_SHORT', min: PASSWORD_MIN };
  if (pw.length > PASSWORD_MAX) return { ok: false, code: 'TOO_LONG', max: PASSWORD_MAX };
  return { ok: true };
}

// Reset form: the new password must be valid and the confirmation must match it exactly.
export function validateResetForm({ password, confirm } = {}) {
  const errors = {};
  const pw = validatePassword(password);
  if (!pw.ok) errors.password = pw;
  else if (String(confirm ?? '') !== String(password)) errors.confirm = { ok: false, code: 'MISMATCH' };
  return { ok: Object.keys(errors).length === 0, errors };
}
