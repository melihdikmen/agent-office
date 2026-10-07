'use strict';
// Integration hub: a catalogue of MCP servers (GitHub, Sentry, Supabase, …) the
// owner turns on once; every worker gets them in its --mcp-config. Secrets are
// encrypted with the OS keychain (Electron safeStorage) before they touch disk.
const { safeStorage } = require('electron');

const CATALOG = [
  { id: 'github', name: 'GitHub', desc: 'Repo, issue, PR ve dosya işlemleri', secret: 'GitHub personal access token', config: (s) => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: s } }) },
  { id: 'sentry', name: 'Sentry', desc: 'Hatalar, olaylar, kök neden', secret: null, config: () => ({ type: 'http', url: 'https://mcp.sentry.dev/mcp' }), note: 'İlk kullanımda tarayıcıdan OAuth onayı ister.' },
  { id: 'supabase', name: 'Supabase', desc: 'Veritabanı, auth, storage', secret: 'Supabase access token', config: (s) => ({ command: 'npx', args: ['-y', '@supabase/mcp-server-supabase@latest', '--access-token', s] }) },
  { id: 'linear', name: 'Linear', desc: 'Issue ve proje takibi', secret: null, config: () => ({ type: 'http', url: 'https://mcp.linear.app/mcp' }), note: 'OAuth ile bağlanır.' },
  { id: 'notion', name: 'Notion', desc: 'Sayfalar ve veritabanları', secret: null, config: () => ({ type: 'http', url: 'https://mcp.notion.com/mcp' }), note: 'OAuth ile bağlanır.' },
  { id: 'vercel', name: 'Vercel', desc: 'Deploy, log, proje ayarları', secret: null, config: () => ({ type: 'http', url: 'https://mcp.vercel.com' }), note: 'OAuth ile bağlanır.' },
  { id: 'posthog', name: 'PostHog', desc: 'Analitik, feature flag, deney, hata takibi', secret: 'PostHog personal API key', config: (s) => ({ type: 'http', url: 'https://mcp.posthog.com/mcp', headers: { Authorization: `Bearer ${s}` } }) },
  { id: 'stripe', name: 'Stripe', desc: 'Müşteri, ödeme, abonelik', secret: 'Stripe secret key', config: (s) => ({ command: 'npx', args: ['-y', '@stripe/mcp', '--tools=all', `--api-key=${s}`] }) },
  { id: 'postgres', name: 'PostgreSQL', desc: 'Salt okunur SQL sorguları', secret: 'Bağlantı URL\'si (postgres://…)', config: (s) => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', s] }) },
  { id: 'playwright', name: 'Playwright', desc: 'Tarayıcıyı sürerek test', secret: null, config: () => ({ command: 'npx', args: ['-y', '@playwright/mcp@latest'] }) },
  { id: 'context7', name: 'Context7', desc: 'Güncel kütüphane dokümanları', secret: null, config: () => ({ type: 'http', url: 'https://mcp.context7.com/mcp' }) },
];

const ENVS = ['dev', 'prod'];

class Integrations {
  constructor(store) { this.store = store; }

  get state() { return this.store.data.integrations || (this.store.data.integrations = {}); }

  // Per integration: { on, env, secrets: { dev, prod } } (encrypted). Older saves kept one
  // `secret`; it becomes the prod key so nothing changes for existing setups.
  entry(id) {
    const cur = this.state[id] || (this.state[id] = {});
    if (cur.secret) { cur.secrets = { ...(cur.secrets || {}), prod: cur.secrets?.prod || cur.secret }; delete cur.secret; }
    if (!cur.secrets) cur.secrets = {};
    if (!ENVS.includes(cur.env)) cur.env = 'prod';
    return cur;
  }

  list() {
    return CATALOG.map((c) => {
      const e = this.entry(c.id);
      return { id: c.id, name: c.name, desc: c.desc, secret: c.secret, note: c.note || null, on: !!e.on, env: e.env,
        hasSecret: !!e.secrets[e.env], hasSecrets: { dev: !!e.secrets.dev, prod: !!e.secrets.prod } };
    });
  }

  // `env` switches the active environment; `secret` is stored for `env` (or the active one).
  set(id, { on, secret, env }) {
    const c = CATALOG.find((x) => x.id === id);
    if (!c) throw new Error('bilinmeyen entegrasyon');
    if (env !== undefined && !ENVS.includes(env)) throw new Error('ortam dev veya prod olmalı');
    const cur = this.entry(id);
    if (env !== undefined) cur.env = env;
    if (secret !== undefined && secret !== '') {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Bu sistemde şifreli saklama yok; anahtar kaydedilmedi.');
      cur.secrets[cur.env] = safeStorage.encryptString(String(secret)).toString('base64');
    }
    if (secret === '') delete cur.secrets[cur.env];
    if (on !== undefined) cur.on = !!on;
    if (cur.on && c.secret && !cur.secrets[cur.env]) throw new Error(`${c.name} için ${cur.env} ortamı ${c.secret} gerekli.`);
    this.store.save();
    return this.list();
  }

  secret(id, env) {
    const e = this.entry(id);
    const s = e.secrets[env || e.env];
    if (!s) return null;
    try { return safeStorage.decryptString(Buffer.from(s, 'base64')); } catch { return null; }
  }

  // mcpServers entries for every enabled integration, using each one's selected environment.
  mcpServers() {
    const out = {};
    for (const c of CATALOG) {
      if (!this.state[c.id]?.on) continue;
      const s = c.secret ? this.secret(c.id) : null;
      if (c.secret && !s) continue;
      out[c.id] = c.config(s);
    }
    return out;
  }
}

module.exports = { Integrations, CATALOG, ENVS };
