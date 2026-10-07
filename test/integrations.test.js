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

test('dev and prod keys are stored separately and the selected env feeds the MCP config', () => {
  const i = mk();
  i.set('github', { env: 'dev', secret: 'ghp_dev' });
  i.set('github', { env: 'prod', secret: 'ghp_prod', on: true });
  const gh = () => i.mcpServers().github.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  assert.strictEqual(gh(), 'ghp_prod');
  i.set('github', { env: 'dev' });
  assert.strictEqual(gh(), 'ghp_dev');
  const row = i.list().find((x) => x.id === 'github');
  assert.deepStrictEqual(row.hasSecrets, { dev: true, prod: true });
  assert.strictEqual(row.env, 'dev');
});

test('switching to an env without a key is refused while on; off is allowed and skipped', () => {
  const i = mk();
  i.set('stripe', { env: 'prod', secret: 'sk_live', on: true });
  assert.throws(() => i.set('stripe', { env: 'dev' }), /dev ortamı/);
  i.set('stripe', { on: false });
  i.set('stripe', { env: 'dev' });
  assert.strictEqual(i.mcpServers().stripe, undefined);
  assert.throws(() => i.set('stripe', { env: 'staging' }), /dev veya prod/);
});

test('legacy single secret is treated as the prod key', () => {
  const i = mk();
  i.state.supabase = { on: true, secret: Buffer.from('sbp_old').toString('base64') };
  assert.ok(i.mcpServers().supabase.args.includes('sbp_old'));
  assert.deepStrictEqual(i.list().find((x) => x.id === 'supabase').hasSecrets, { dev: false, prod: true });
});

test('catalog still has Sentry, GitHub, Supabase and Stripe', () => {
  for (const id of ['sentry', 'github', 'supabase', 'stripe']) assert.ok(CATALOG.find((c) => c.id === id), id);
});
