'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { compareVersions, normalize, check } = require('../src/main/updates');
const changelog = require('../src/main/changelog');

test('versions compare numerically, ignoring a v prefix', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0'), 0);
  assert.equal(compareVersions('0.4.1', '0.5.0'), -1);
});

test('feed: plain JSON and a GitHub release both normalize', () => {
  assert.deepEqual(normalize({ version: '0.6.0', url: 'https://x/dl', notes: 'n' }), { version: '0.6.0', url: 'https://x/dl', notes: 'n' });
  assert.equal(normalize({ tag_name: 'v0.6.0', html_url: 'https://gh/rel', body: 'b' }).url, 'https://gh/rel');
  assert.equal(normalize({}), null);
});

test('check reports newer only when the feed is ahead', async () => {
  const feed = (v) => async () => ({ ok: true, json: async () => ({ version: v, url: 'u' }) });
  assert.equal((await check('https://f', '0.5.0', feed('0.6.0'))).newer, true);
  assert.equal((await check('https://f', '0.5.0', feed('0.5.0'))).newer, false);
  await assert.rejects(() => check('', '0.5.0', feed('1')), /adresi/);
  await assert.rejects(() => check('https://f', '0.5.0', async () => ({ ok: false, status: 404 })), /404/);
});

test('changelog is newest first and matches package.json', () => {
  assert.equal(changelog[0].version, require('../package.json').version);
  for (let i = 1; i < changelog.length; i++) assert.equal(require('../src/main/updates').compareVersions(changelog[i - 1].version, changelog[i].version), 1);
});
