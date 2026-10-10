'use strict';
// Web tools for agents: read a page the way a browser renders it (JavaScript included) or
// take a screenshot. One hidden, sandboxed window with its own cookie jar, used one request
// at a time. Only http(s); cloud-metadata and link-local addresses are refused.
const fs = require('fs');
const path = require('path');
const net = require('net');

function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error('Geçersiz adres.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Yalnızca http ve https adresleri açılır.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^169\.254\./.test(host) || /^fe80:/i.test(host) || host === 'metadata.google.internal' || host === '0.0.0.0') throw new Error('Bu adrese erişim engelli (link-local / metadata).');
  if (net.isIP(host) === 0 && /^\d+$/.test(host)) throw new Error('Geçersiz adres.');
  return u.toString();
}

class WebTool {
  // electron: { BrowserWindow }; dir: where screenshots are written
  constructor(electron, dir, log = () => {}) { this.E = electron; this.dir = dir; this.log = log; this.win = null; this.queue = Promise.resolve(); }

  async window() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new this.E.BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:agent-web', backgroundThrottling: false } });
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return this.win;
  }

  // serialise: the window navigates, so two calls at once would trample each other
  run(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }

  async load(url) {
    const w = await this.window();
    const target = checkUrl(url);
    this.log(`web: ${target}`);
    await Promise.race([w.loadURL(target), new Promise((_, rej) => setTimeout(() => rej(new Error('Sayfa 25 sn içinde açılmadı.')), 25000))]).catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; });
    await new Promise((r) => setTimeout(r, 900));                    // let client-side rendering settle
    return w;
  }

  read(url) {
    return this.run(async () => {
      const w = await this.load(url);
      const data = await w.webContents.executeJavaScript(`(() => ({ title: document.title, url: location.href, text: (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim(), links: [...document.querySelectorAll('a[href]')].slice(0, 40).map((a) => [(a.innerText || '').trim().slice(0, 60), a.href]).filter((l) => l[0]) }))()`);
      const links = data.links.length ? `\n\n## Bağlantılar\n${data.links.map(([t, h]) => `- ${t}: ${h}`).join('\n')}` : '';
      return `# ${data.title || '(başlıksız)'}\n${data.url}\n\n${data.text.slice(0, 12000)}${data.text.length > 12000 ? '\n…(kısaltıldı)' : ''}${links}`;
    });
  }

  shot(url, { width = 1280, height = 800 } = {}) {
    return this.run(async () => {
      const w = await this.load(url);
      w.setContentSize(Math.max(320, Math.min(2000, width)), Math.max(240, Math.min(3000, height)));
      await new Promise((r) => setTimeout(r, 300));
      const img = await w.webContents.capturePage();
      fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, `web-${Date.now()}.png`);
      fs.writeFileSync(file, img.toPNG());
      for (const f of fs.readdirSync(this.dir).sort().slice(0, -20)) fs.rmSync(path.join(this.dir, f), { force: true });
      return file;
    });
  }
}

module.exports = { WebTool, checkUrl };
