// Review: what each worker changed on its own branch. Pick a worker, pick a file, read the
// diff, click a line to leave a comment (it is typed into that worker's terminal).
import { tt } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Unified diff → [{type:'hunk'|'add'|'del'|'ctx', text, n}] where n is the line number in the new file.
export function parseDiff(text) {
  const rows = []; let n = 0; let inHunk = false;
  for (const l of String(text || '').split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (h) { n = Number(h[1]); inHunk = true; rows.push({ type: 'hunk', text: l, n: 0 }); continue; }
    if (!inHunk) continue;
    if (l.startsWith('+')) rows.push({ type: 'add', text: l.slice(1), n: n++ });
    else if (l.startsWith('-')) rows.push({ type: 'del', text: l.slice(1), n: 0 });
    else if (l.startsWith('\\')) continue;
    else rows.push({ type: 'ctx', text: l.slice(1), n: n++ });
  }
  return rows;
}

export class ReviewView {
  constructor(root, api, { toast, refresh }) {
    this.root = root; this.api = api; this.toast = toast; this.refresh = refresh;
    this.list = []; this.sel = null; this.file = null; this.rows = []; this.compose = null; this.loading = false;
    root.addEventListener('click', (e) => this.click(e));
  }

  async load() {
    const r = await this.api.reviewList();
    this.list = Array.isArray(r) ? r : [];
    if (!this.list.some((x) => x.id === this.sel)) { this.sel = this.list[0]?.id || null; this.file = null; this.rows = []; }
    const cur = this.cur();
    if (cur && !this.file && cur.files[0]) await this.pick(cur.files[0].file, false);
    this.render();
  }

  cur() { return this.list.find((x) => x.id === this.sel) || null; }

  async pick(file, draw = true) {
    this.file = file; this.compose = null; this.rows = [];
    try { this.rows = parseDiff(await this.api.reviewDiff({ id: this.sel, file })); } catch (e) { this.toast(String(e.message || e), 'err'); }
    if (draw) this.render();
  }

  render() {
    const c = this.cur();
    if (!this.list.length) {
      this.root.innerHTML = `<div class="rvw-empty"><b>${tt('Karşılaştırılacak dal yok', 'No branch to review')}</b><p>${tt('Bir çalışanın ayarlarında "kendi git worktree\'sinde çalış" seçeneğini aç. Çalışan kendi dalında çalışır, değişiklikleri burada satır satır inceler, yorum bırakır ve birleştirirsin.', 'Turn on "work in its own git worktree" for a worker. It works on its own branch and you review the changes line by line here, comment and merge.')}</p></div>`;
      return;
    }
    const st = c.status;
    this.root.innerHTML = `<div class="rvw">
      <div class="rvw-side">${this.list.map((x) => `<button class="rvw-w ${x.id === this.sel ? 'on' : ''}" data-w="${x.id}"><i style="background:${x.color}"></i><span><b>${esc(x.name)}</b><small>${x.status.exists ? `${x.status.ahead} commit · ${x.files.length} ${tt('dosya', 'files')}${x.status.dirty.length ? ` · ${x.status.dirty.length} ${tt('bekleyen', 'pending')}` : ''}` : tt('worktree yok', 'no worktree')}</small></span></button>`).join('')}</div>
      <div class="rvw-main">
        <div class="rvw-top"><b>⎇ ${esc(st.branch || '')}</b><span class="muted">← ${esc(st.base || '')} ${st.stat ? `· ${esc(st.stat)}` : ''}</span><span class="spacer"></span>
          <button class="btn small" data-act="commit" ${st.dirty?.length ? '' : 'disabled'}>${tt('Commit\'le', 'Commit')}</button>
          <button class="btn small primary" data-act="merge" ${st.ahead && !st.dirty?.length ? '' : 'disabled'}>${tt('Birleştir', 'Merge')}</button>
          <button class="btn small" data-act="pr" ${st.ahead && !st.dirty?.length ? '' : 'disabled'}>${tt('PR aç', 'Open PR')}</button></div>
        <div class="rvw-body">
          <div class="rvw-files">${c.files.map((f) => `<button class="rvw-f ${f.file === this.file ? 'on' : ''}" data-file="${esc(f.file)}" title="${esc(f.file)}"><em class="k-${f.kind}">${f.kind}</em><span>${esc(f.file.split('/').pop())}<small>${esc(f.file.includes('/') ? f.file.slice(0, f.file.lastIndexOf('/')) : '')}</small></span><span class="pm">${f.binary ? 'bin' : `<b class="a">+${f.add}</b> <b class="d">-${f.del}</b>`}</span></button>`).join('') || `<div class="muted pad">${tt('Henüz commit yok.', 'No commits yet.')}</div>`}</div>
          <div class="rvw-diff">${this.diffHtml(c)}</div></div></div></div>`;
  }

  diffHtml(c) {
    if (!this.file) return `<div class="muted pad">${tt('Soldan bir dosya seç.', 'Pick a file on the left.')}</div>`;
    const notes = (c.comments || []).filter((n) => n.file === this.file);
    return `<div class="rvw-fname">${esc(this.file)}</div>` + this.rows.map((r, i) => {
      if (r.type === 'hunk') return `<div class="dl hunk">${esc(r.text)}</div>`;
      const here = r.type !== 'del' ? notes.filter((n) => n.line === r.n) : [];
      const box = this.compose === i ? `<div class="dl-compose"><textarea id="rvwText" rows="2" placeholder="${tt('Bu satır için yorum… (çalışanın terminaline yazılır)', 'Comment on this line… (typed into the worker\'s terminal)')}"></textarea><div><button class="btn small primary" data-act="send" data-i="${i}">${tt('Gönder', 'Send')}</button> <button class="btn small" data-act="cancel">${tt('Vazgeç', 'Cancel')}</button></div></div>` : '';
      return `<div class="dl ${r.type}" ${r.type !== 'del' ? `data-i="${i}"` : ''}><span class="ln">${r.type === 'del' ? '' : r.n}</span><span class="pl">${r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span><code>${esc(r.text) || ' '}</code></div>${here.map((n) => `<div class="dl-note">💬 ${esc(n.text)}</div>`).join('')}${box}`;
    }).join('');
  }

  async click(e) {
    const w = e.target.closest('[data-w]');
    if (w) { this.sel = w.dataset.w; this.file = null; this.rows = []; const c = this.cur(); if (c?.files[0]) await this.pick(c.files[0].file, false); return this.render(); }
    const f = e.target.closest('[data-file]');
    if (f) return this.pick(f.dataset.file);
    const act = e.target.closest('[data-act]')?.dataset.act;
    const c = this.cur();
    if (act === 'cancel') { this.compose = null; return this.render(); }
    if (act === 'send') {
      const i = Number(e.target.dataset.i), text = this.root.querySelector('#rvwText')?.value || '';
      const r = await this.api.reviewComment({ id: this.sel, file: this.file, line: this.rows[i]?.n || 0, text }).catch((x) => ({ error: x.message }));
      if (r?.error) return this.toast(r.error, 'err');
      this.compose = null; this.toast(tt('Yorum çalışana iletildi', 'Comment sent to the worker')); return this.load();
    }
    if (act && c) {
      let r;
      if (act === 'commit') r = await this.api.worktreeCommit({ id: c.id, message: `office: ${c.name} çalışması` });
      if (act === 'merge') r = await this.api.worktreeMerge({ id: c.id });
      if (act === 'pr') { r = await this.api.prOpen({ id: c.id }); if (r?.url) this.api.openUrl({ url: r.url }); }
      if (r?.error) this.toast(r.error, 'err');
      else if (act === 'merge') this.toast(r.merged ? `${r.commits} commit ${tt('birleştirildi', 'merged')}` : r.reason);
      return this.load();
    }
    const line = e.target.closest('.dl[data-i]');
    if (line && !e.target.closest('.dl-compose')) { this.compose = Number(line.dataset.i); this.render(); this.root.querySelector('#rvwText')?.focus(); }
  }
}
