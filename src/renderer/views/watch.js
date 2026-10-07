// Live watch ("Kod" tab): files the crew touched, newest first, with the diff.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? `${s} sn` : s < 3600 ? `${Math.round(s / 60)} dk` : `${Math.round(s / 3600)} sa`; };

export class WatchView {
  constructor(root, api) {
    this.root = root; this.api = api; this.changes = []; this.status = []; this.open = null; this.diff = null;
    root.innerHTML = `<div class="wt-list"><div class="wt-head"><h3>Canlı izle</h3><button class="btn small" id="wtRefresh">↻</button></div><div id="wtItems"></div></div><div class="wt-diff" id="wtDiff"><p class="muted pad">Bir dosya seç; değişikliği burada görünür.</p></div>`;
    root.querySelector('#wtRefresh').onclick = () => this.refresh();
    root.querySelector('#wtItems').onclick = (e) => { const f = e.target.closest('[data-file]')?.dataset.file; if (f) this.show(f); };
    api.on('watch', (list) => { this.changes = list; this.renderList(); if (this.open && list.some((c) => c.file === this.open)) this.show(this.open, true); });
  }

  async refresh() {
    const [list, status] = await Promise.all([this.api.watchList(), this.api.watchStatus()]);
    this.changes = Array.isArray(list) ? list : []; this.status = Array.isArray(status) ? status : [];
    this.renderList();
  }

  renderList() {
    const seen = new Set();
    const rows = [];
    for (const c of this.changes) { if (seen.has(c.file)) continue; seen.add(c.file); rows.push({ file: c.file, sub: `${ago(c.ts)} önce`, live: true }); }
    for (const s of this.status) { if (seen.has(s.file)) continue; seen.add(s.file); rows.push({ file: s.file, sub: s.code === '??' ? 'yeni' : s.code === 'M' ? 'değişti' : s.code }); }
    this.root.querySelector('#wtItems').innerHTML = rows.length ? rows.slice(0, 80).map((r) => `<button class="wt-item ${r.file === this.open ? 'sel' : ''} ${r.live ? 'live' : ''}" data-file="${esc(r.file)}"><b>${esc(r.file.split('/').pop())}</b><span class="muted">${esc(r.file.split('/').slice(0, -1).join('/'))}</span><span class="when">${r.sub}</span></button>`).join('')
      : '<p class="muted pad">Henüz değişen dosya yok.</p>';
  }

  async show(file, silent = false) {
    this.open = file;
    if (!silent) this.renderList();
    const r = await this.api.watchDiff({ file });
    const box = this.root.querySelector('#wtDiff');
    if (!r || r.error) { box.innerHTML = `<p class="muted pad">${esc(r?.error || 'okunamadı')}</p>`; return; }
    const lines = (r.diff || '').split('\n');
    box.innerHTML = `<div class="wt-diff-head"><b>${esc(file)}</b><span class="muted">${r.untracked ? 'yeni dosya' : 'git diff'}</span></div><pre class="diff">${lines.map((l) => {
      const k = l.startsWith('+++') || l.startsWith('---') ? 'meta' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
      return `<span class="${k}">${esc(l)}</span>`;
    }).join('\n') || '<span class="muted">(fark yok)</span>'}</pre>`;
  }
}
