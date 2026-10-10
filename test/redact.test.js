'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { redact } = require('../src/main/redact');

test('known token shapes are masked', () => {
  assert.equal(redact('key sk-ant-api03-abcdefghijklmnop1234 ok'), 'key [gizli] ok');
  assert.equal(redact('ghp_' + 'a'.repeat(36)), '[gizli]');
  assert.equal(redact('AKIAABCDEFGHIJKLMNOP'), '[gizli]');
  assert.equal(redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'), 'Authorization: Bearer [gizli]');
  assert.match(redact('-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----'), /^\[gizli\]$/);
});

test('key = value pairs keep the name, hide the value', () => {
  assert.equal(redact('API_KEY=supersecret123456'), 'API_KEY=[gizli]');
  assert.equal(redact('"password": "hunter2hunter2"'), '"password": "[gizli]"');
});

test('ordinary text is untouched', () => {
  const t = 'Giriş akışı eklendi; token süresi 15 dk. Dosya: src/auth.js';
  assert.equal(redact(t), t);
});
