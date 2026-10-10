'use strict';
// Designs: a worker saves a self-contained HTML mock-up with design_save; the owner looks at it in
// the Design tab, drops numbered notes on it and sends them back; the worker saves a new version.
const fs = require('fs');
const path = require('path');

const MAX_HTML = 600 * 1024;
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

class Designs {
  constructor(store) { this.store = store; }

  list(ws) { return (ws.designs ||= []); }
  dir(ws) { const d = path.join(this.store.workspaceDir(ws.id), 'designs'); fs.mkdirSync(d, { recursive: true }); return d; }
  fileOf(ws, d, v) { return path.join(this.dir(ws), `${d.id}-v${v}.html`); }

  // Same title (any case) = a new version of the same design.
  save(ws, worker, { title, html, summary = '' }) {
    const t = clip(title, 80), h = String(html || '');
    if (!t) throw new Error('Başlık gerekli.');
    if (!h.trim()) throw new Error('HTML boş.');
    if (Buffer.byteLength(h) > MAX_HTML) throw new Error('Tasarım çok büyük (600 KB üstü); sadeleştir.');
    let d = this.list(ws).find((x) => x.title.toLowerCase() === t.toLowerCase());
    if (!d) {
      ws.designSeq = (ws.designSeq || 0) + 1;
      d = { id: `D-${ws.designSeq}`, title: t, by: worker?.id || 'user', status: 'draft', versions: [], ts: Date.now() };
      this.list(ws).unshift(d);
    }
    const v = (d.versions.at(-1)?.v || 0) + 1;
    fs.writeFileSync(this.fileOf(ws, d, v), h);
    d.versions.push({ v, ts: Date.now(), by: worker?.id || 'user', summary: clip(summary, 400) });
    d.status = 'draft'; d.ts = Date.now();
    this.store.save();
    return { design: d, v, file: this.fileOf(ws, d, v) };
  }

  get(ws, id, v) {
    const d = this.list(ws).find((x) => x.id === id);
    if (!d) throw new Error('Tasarım bulunamadı.');
    const ver = v || d.versions.at(-1).v;
    if (!d.versions.some((x) => x.v === ver)) throw new Error('Sürüm bulunamadı.');
    return { design: d, v: ver, html: fs.readFileSync(this.fileOf(ws, d, ver), 'utf8'), file: this.fileOf(ws, d, ver) };
  }

  approve(ws, id, on = true) {
    const d = this.list(ws).find((x) => x.id === id);
    if (!d) throw new Error('Tasarım bulunamadı.');
    d.status = on ? 'approved' : 'draft';
    this.store.save();
    return d;
  }

  remove(ws, id) {
    const d = this.list(ws).find((x) => x.id === id);
    if (!d) return;
    for (const ver of d.versions) { try { fs.unlinkSync(this.fileOf(ws, d, ver.v)); } catch { /* already gone */ } }
    ws.designs = this.list(ws).filter((x) => x.id !== id);
    this.store.save();
  }
}

module.exports = { Designs };
