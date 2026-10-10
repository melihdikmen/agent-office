'use strict';
// Keep secrets out of what the office stores and shows: memory notes, reports, decisions.
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,        // JWT
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi,
];
const KEYED = /((?:api[_-]?key|secret|token|passw(?:or)?d|parola|şifre|sifre|credential)s?["']?\s*[:=]\s*["']?)([^\s"',;]{8,})/gi;

function redact(text) {
  let s = String(text ?? '');
  for (const re of PATTERNS) s = s.replace(re, (m, pre) => (pre && /bearer/i.test(pre) ? `${pre}[gizli]` : '[gizli]'));
  return s.replace(KEYED, (_m, pre) => `${pre}[gizli]`);
}

module.exports = { redact };
