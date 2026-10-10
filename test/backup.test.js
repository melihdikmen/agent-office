'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scrub, daily } = require('../src/main/backup');

const data = { integrations: { github: { enabled: true, secrets: { prod: 'ENC' }, secret: 'ENC2' } }, workspaces: [{ workers: [{ id: 'a', token: 'TOK', name: 'Ada' }] }] };

test('scrub removes secrets and worker tokens but keeps the rest', () => {
  const c = scrub(data);
  assert.equal(c.integrations.github.enabled, true);
  assert.equal(c.integrations.github.secrets, undefined);
  assert.equal(c.integrations.github.secret, undefined);
  assert.equal(c.workspaces[0].workers[0].token, undefined);
  assert.equal(c.workspaces[0].workers[0].name, 'Ada');
  assert.equal(data.workspaces[0].workers[0].token, 'TOK');            // the original is untouched
});

test('daily backup: one per day, keeps the last 7', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-bk-'));
  const store = { data };
  const day = (n) => new Date(Date.UTC(2026, 9, 1 + n, 12));
  assert.ok(daily(store, dir, day(0)));
  assert.equal(daily(store, dir, day(0)), null);
  for (let i = 1; i < 10; i++) daily(store, dir, day(i));
  const files = fs.readdirSync(path.join(dir, 'backups')).sort();
  assert.equal(files.length, 7);
  assert.equal(files[0], 'office-20261004.json');
});
