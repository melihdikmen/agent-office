'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkUrl } = require('../src/main/webtool');

test('http(s) pages and localhost are fine', () => {
  assert.equal(checkUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(checkUrl('http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(checkUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/');
});

test('other schemes and metadata / link-local addresses are refused', () => {
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.com', 'http://169.254.169.254/latest/meta-data', 'http://[fe80::1]/', 'http://metadata.google.internal/', 'not a url']) assert.throws(() => checkUrl(bad), undefined, bad);
});
