// Design tab: mock-ups the crew saves with design_save. Look at one, drop numbered notes on it,
// send them back to the worker (who saves a new version), approve it to start the build.
import { tt } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class DesignView {
  constructor(root, api, { toast, workers }) {
    this.root = root; this.api = api; this.toast = toast; this.workers = workers;
    this.items = []; this.sel = null; this.ver = null; this.html = ''; this.marks = []; this.ann = false; this.key = ''; this.req = false;
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('input', (e) => { const m = this.marks[Number(e.target.dataset.i)]; if (m && e.target.matches('textarea')) m.text = e.target.value; });
    root.addEventListener('change', async (e) => {
      if (e.target.id === 'dsFile' && e.target.files[0]) {
        const f = e.target.files[0]; const r = await this.api.designImport({ title: f.name.replace(/\.[^.]+$/, ''), html: await f.text() });
        if (r?.error) this.toast(r.error, 'err'); else { this.sel = r.id; this.ver = r.v; this.html = ''; this.loadHtml(); }
        return;
      } if (e.target.id === 'dsVer') { this.ver = Number(e.target.value); this.marks = []; this.loadHtml(); } });
    api.on('design', ({ id, v }) => { if (this.sel === id && !this.ann) { this.ver = v; this.loadHtml(); } this.toast(tt(`Yeni tasarım sürümü: ${id} v${v}`, `New design version: ${id} v${v}`)); });
  }

  set(items) {
    this.items = items || [];
    const key = JSON.stringify(this.items.map((d) => [d.id, d.status, d.versions.length, d.title]));
    if (!this.sel || !this.items.some((d) => d.id === this.sel)) { this.sel = this.items[0]?.id || null; this.ver = null; this.html = ''; }
    if (key === this.key) return;
    this.key = key; this.render(); if (this.sel && !this.html) this.loadHtml();
  }

  cur() { return this.items.find((d) => d.id === this.sel) || null; }
  who(id) { return id === 'user' ? tt('Sen', 'You') : this.workers().find((w) => w.id === id)?.name || '?'; }
  show() { if (this.sel && !this.html) this.loadHtml(); }

  async loadHtml() {
    const d = this.cur(); if (!d) return;
    const r = await this.api.designGet({ id: d.id, v: this.ver || undefined });
    if (r?.error) return this.toast(r.error, 'err');
    this.ver = r.v; this.html = r.html; this.render();
  }

  render() {
    const d = this.cur(), ws = this.workers();
    const list = this.items.map((x) => `<button class="ds-i ${x.id === this.sel ? 'on' : ''}" data-d="${esc(x.id)}"><b>${esc(x.title)}</b><small>${esc(x.id)} · v${x.versions.at(-1).v} · ${esc(this.who(x.by))}</small><em class="ds-st ${x.status}">${x.status === 'approved' ? tt('onaylı', 'approved') : tt('taslak', 'draft')}</em></button>`).join('');
    const reqBox = this.req ? `<div class="ds-req"><textarea id="dsReq" rows="3" placeholder="${tt('Ne tasarlansın? (örn. Mobil giriş ekranı: e-posta, şifre, sosyal giriş)', 'What should be designed? (e.g. mobile login: email, password, social login)')}"></textarea><div class="row"><select id="dsReqTo">${ws.map((w) => `<option value="${esc(w.id)}">${esc(w.name)} · ${esc(w.role)}</option>`).join('')}</select><button class="btn small primary" data-a="req-go">${tt('İste', 'Ask')}</button><button class="btn small" data-a="req-x">✕</button></div></div>` : '';
    const main = !d ? `<div class="ds-empty"><b>${tt('Henüz tasarım yok', 'No designs yet')}</b><p>${tt('Bir çalışandan koda geçmeden önce ekran taslağı iste. Tasarımı burada görür, üzerine numaralı notlar bırakır ve geri gönderirsin; beğenince onaylayıp geliştirmeyi başlatırsın.', 'Ask a worker for a screen mock-up before any code. See it here, drop numbered notes on it and send them back; approve it to start the build.')}</p><button class="btn primary" data-a="req">${tt('＋ Tasarım iste', '＋ Ask for a design')}</button></div>` : `
      <div class="ds-top"><b>${esc(d.title)}</b><span class="muted">${esc(d.id)}</span><select id="dsVer">${d.versions.map((x) => `<option value="${x.v}" ${x.v === this.ver ? 'selected' : ''}>v${x.v}${x.summary ? ` · ${esc(x.summary.slice(0, 40))}` : ''}</option>`).join('')}</select><span class="spacer"></span>
        <button class="btn small ${this.ann ? 'on' : ''}" data-a="ann">✎ ${tt('İşaretle', 'Annotate')}</button>
        <button class="btn small ${d.status === 'approved' ? 'on' : 'primary'}" data-a="approve">${d.status === 'approved' ? tt('✓ Onaylandı', '✓ Approved') : tt('Onayla ve başlat', 'Approve & start')}</button>
        <button class="btn small" data-a="del" title="${tt('Sil', 'Delete')}">🗑</button></div>
      <div class="ds-annbar ${this.ann ? '' : 'hidden'}"><span class="muted">${tt('Tasarımda bir noktaya tıkla, notunu yaz.', 'Click a point on the design and write your note.')}</span><span class="spacer"></span><select id="dsTo">${ws.map((w) => `<option value="${esc(w.id)}" ${w.id === d.by ? 'selected' : ''}>${esc(w.name)} · ${esc(w.role)}</option>`).join('')}</select><button class="btn small" data-a="clear">${tt('Temizle', 'Clear')}</button><button class="btn small primary" data-a="send">${tt('Geri bildirim gönder', 'Send feedback')}</button></div>
      <div class="ds-stage"><iframe id="dsFrame" sandbox="allow-same-origin" title="design"></iframe><div class="ds-ov ${this.ann ? '' : 'hidden'}"></div></div>`;
    this.root.innerHTML = `<div class="ds"><aside class="ds-side"><button class="btn small primary" data-a="req">${tt('＋ Tasarım iste', '＋ Ask for a design')}</button><button class="btn small" data-a="imp" title="${tt('Bir .html dosyasını tasarım olarak ekle', 'Add an .html file as a design')}">${tt('⇪ Dosyadan ekle', '⇪ Add from file')}</button><input id="dsFile" type="file" accept=".html,.htm" hidden>${reqBox}${list}</aside><section class="ds-main">${main}</section></div>`;
    const fr = this.root.querySelector('#dsFrame'); if (fr && this.html) fr.srcdoc = this.html;
    this.ov = this.root.querySelector('.ds-ov');
    if (this.ov) { this.ov.onclick = (e) => this.addMark(e); this.drawMarks(); }
  }

  addMark(e) {
    if (e.target.closest('.ds-mk')) return;
    const r = this.ov.getBoundingClientRect();
    this.marks.push({ x: e.clientX - r.left, y: e.clientY - r.top, text: '' });
    this.drawMarks(this.marks.length - 1);
  }

  drawMarks(focus = -1) {
    if (!this.ov) return;
    this.ov.innerHTML = this.marks.map((m, i) => `<div class="ds-mk" style="left:${m.x}px;top:${m.y}px"><b>${i + 1}</b><div class="ds-note"><textarea data-i="${i}" rows="2" placeholder="${tt('Bu nokta için ne istiyorsun?', 'What do you want here?')}">${esc(m.text)}</textarea><button class="x" data-del="${i}">✕</button></div></div>`).join('');
    if (focus >= 0) this.ov.querySelector(`textarea[data-i="${focus}"]`)?.focus();
  }

  async send() {
    const d = this.cur(); if (!d) return;
    if (!this.marks.length) return this.toast(tt('Önce tasarımda en az bir nokta işaretle.', 'Drop at least one point first.'), 'err');
    const to = this.root.querySelector('#dsTo').value;
    const stage = this.root.querySelector('.ds-stage'); const r = stage.getBoundingClientRect();
    const doc = this.root.querySelector('#dsFrame').contentDocument;
    const notes = this.marks.map((m, i) => {
      let target = '';
      try { const e = doc?.elementFromPoint(m.x, m.y); if (e) target = `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''} "${(e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 50)}"`; } catch { /* cross-origin */ }
      return { n: i + 1, px: Math.round(m.x / r.width * 100), py: Math.round(m.y / r.height * 100), text: m.text.trim() || tt('(not yok)', '(no note)'), target };
    });
    stage.classList.add('capturing');
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const png = await this.api.captureRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    stage.classList.remove('capturing');
    const res = await this.api.designFeedback({ id: d.id, v: this.ver, to, png: typeof png === 'string' ? png : null, notes, width: Math.round(r.width), height: Math.round(r.height) });
    if (res?.error) return this.toast(res.error, 'err');
    this.toast(tt('Geri bildirim iletildi; yeni sürüm gelince burada görünür', 'Feedback sent; the new version shows up here'));
    this.ann = false; this.marks = []; this.render();
  }

  async click(e) {
    const dl = e.target.closest('[data-del]'); if (dl) { this.marks.splice(Number(dl.dataset.del), 1); return this.drawMarks(); }
    const it = e.target.closest('[data-d]'); if (it) { this.sel = it.dataset.d; this.ver = null; this.html = ''; this.marks = []; this.ann = false; this.render(); return this.loadHtml(); }
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    const d = this.cur();
    if (a === 'req') { this.req = !this.req; this.render(); this.root.querySelector('#dsReq')?.focus(); }
    if (a === 'imp') this.root.querySelector('#dsFile').click();
    if (a === 'req-x') { this.req = false; this.render(); }
    if (a === 'req-go') {
      const r = await this.api.designRequest({ to: this.root.querySelector('#dsReqTo').value, text: this.root.querySelector('#dsReq').value });
      if (r?.error) return this.toast(r.error, 'err');
      this.req = false; this.render(); this.toast(tt(`${r.name}'dan tasarım istendi; hazır olunca burada görünür.`, `Asked ${r.name} for a design; it shows up here.`));
    }
    if (a === 'ann') { this.ann = !this.ann; if (!this.ann) this.marks = []; this.render(); }
    if (a === 'clear') { this.marks = []; this.drawMarks(); }
    if (a === 'send') this.send();
    if (a === 'approve' && d) { const r = await this.api.designApprove({ id: d.id, on: d.status !== 'approved' }); if (r?.error) this.toast(r.error, 'err'); else this.toast(r.status === 'approved' ? tt('Onaylandı; lidere geliştirmeyi başlatması söylendi', 'Approved; the lead was told to start building') : tt('Onay kaldırıldı', 'Approval removed')); }
    if (a === 'del' && d && confirm(tt(`"${d.title}" ve tüm sürümleri silinsin mi?`, `Delete "${d.title}" and all versions?`))) { await this.api.designDelete({ id: d.id }); this.sel = null; this.html = ''; }
  }
}
