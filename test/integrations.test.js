'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

// integrations.js pulls in Electron's safeStorage; stub it with reversible base64.
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') {
    return { safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() } };
  }
  return origLoad.call(this, req, ...rest);
};
const { Integrations, CATALOG } = require('../src/main/integrations');

const mk = () => new Integrations({ data: {}, save() {} });

test('catalog has PostHog with bearer-auth http MCP', () => {
  const c = CATALOG.find((x) => x.id === 'posthog');
  assert.ok(c);
  assert.deepStrictEqual(c.config('phx_abc'), { type: 'http', url: 'https://mcp.posthog.com/mcp', headers: { Authorization: 'Bearer phx_abc' } });
});

test('PostHog needs a key before it can be enabled, then shows up in mcpServers', () => {
  const i = mk();
  assert.throws(() => i.set('posthog', { on: true }), /PostHog/);
  i.set('posthog', { on: true, secret: 'phx_abc' });
  assert.strictEqual(i.mcpServers().posthog.headers.Authorization, 'Bearer phx_abc');
});

test('catalog ids are unique', () => {
  const ids = CATALOG.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('package.json builds for mac, win (nsis) and linux (AppImage)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.strictEqual(pkg.build.win.target, 'nsis');
  assert.strictEqual(pkg.build.linux.target, 'AppImage');
  for (const s of ['dist:mac', 'dist:win', 'dist:linux']) assert.ok(pkg.scripts[s], s);
});
