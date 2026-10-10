// Built-in browser: a webview with an address bar, for checking what the crew ships.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class BrowserView {
  constructor(root, { api, workers, toast } = {}) {
    this.root = root; this.api = api; this.workers = workers || (() => []); this.toast = toast || (() => {}); this.marks = []; this.ann = false;
    this.url = 'http://localhost:3000';
    root.innerHTML = `<div class="br-bar"><button class="btn small" data-nav="back">‹</button><button class="btn small" data-nav="fwd">›</button><button class="btn small" data-nav="reload">↻</button>
      <form id="brForm"><input id="brUrl" value="${esc(this.url)}" spellcheck="false"></form><button class="btn small" data-nav="ext" title="Sistem tarayıcısında aç">↗</button><button class="btn small" data-nav="ann" title="Ekranda nokta işaretle, nota yaz ve bir çalışana gönder">✎ İşaretle</button></div>
      <div class="br-annbar hidden"><span class="muted">Sayfada bir noktaya tıkla, notunu yaz.</span><span class="spacer"></span><select id="brTo"></select><button class="btn small" data-nav="clear">Temizle</button><button class="btn small primary" data-nav="send">Çalışana gönder</button><button class="btn small" data-nav="annoff">✕</button></div>
      <div class="br-stage"><webview id="brView"></webview><div class="br-ov hidden"></div></div>`;
    this.view = root.querySelector('#brView');
    this.input = root.querySelector('#brUrl');
    this.ov = root.querySelector('.br-ov'); this.annbar = root.querySelector('.br-annbar');
    this.ov.addEventListener('click', (e) => this.addMark(e));
    this.ov.addEventListener('input', (e) => { const m = this.marks[Number(e.target.dataset.i)]; if (m) m.text = e.target.value; });
    this.ov.addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { e.stopPropagation(); this.marks.splice(Number(d.dataset.del), 1); this.draw(); } }, true);
    root.querySelector('#brForm').onsubmit = (e) => { e.preventDefault(); this.go(this.input.value); };
    this.annbar.onclick = (e) => { const n = e.target.closest('[data-nav]')?.dataset.nav; if (n === 'annoff') this.toggle(false); if (n === 'clear') { this.marks = []; this.draw(); } if (n === 'send') this.send(); };
    root.querySelector('.br-bar').onclick = (e) => {
      const nav = e.target.closest('[data-nav]')?.dataset.nav;
      if (!nav) return;
      if (nav === 'ann') return this.toggle(true);
      try {
        if (nav === 'back' && this.view.canGoBack()) this.view.goBack();
        if (nav === 'fwd' && this.view.canGoForward()) this.view.goForward();
        if (nav === 'reload') this.view.reload();
        if (nav === 'ext') window.open(this.view.getURL() || this.url);
      } catch { /* webview not ready */ }
    };
    const nav = (e) => { if (!e.url || e.url === 'about:blank') return; this.url = e.url; this.input.value = e.url; };
    this.view.addEventListener('did-navigate', nav);
    this.view.addEventListener('did-navigate-in-page', nav);
    this.started = false;
  }

  go(u) {
    let url = String(u || '').trim();
    if (!url) return;
    if (url === 'about:blank') return;
    if (!/^[a-z]+:\/\//i.test(url)) url = /^(localhost|\d+\.\d+\.\d+\.\d+)/.test(url) ? `http://${url}` : `https://${url}`;
    this.url = url; this.input.value = url;
    this.view.src = url;
    this.started = true;
  }

  toggle(on) {
    this.ann = on; this.ov.classList.toggle('hidden', !on); this.annbar.classList.toggle('hidden', !on);
    const ws = this.workers();
    this.root.querySelector('#brTo').innerHTML = ws.map((w) => `<option value="${esc(w.id)}">${esc(w.name)} · ${esc(w.role)}</option>`).join('') || '<option value="">çalışan yok</option>';
    if (!on) this.marks = [];
    this.draw();
  }

  addMark(e) {
    if (e.target.closest('.br-mk')) return;
    const r = this.ov.getBoundingClientRect();
    this.marks.push({ x: e.clientX - r.left, y: e.clientY - r.top, text: '' });
    this.draw(this.marks.length - 1);
  }

  draw(focus = -1) {
    this.ov.innerHTML = this.marks.map((m, i) => `<div class="br-mk" style="left:${m.x}px;top:${m.y}px"><b>${i + 1}</b><div class="br-note"><textarea data-i="${i}" rows="2" placeholder="Bu nokta için ne istiyorsun?">${esc(m.text)}</textarea><button class="x" data-del="${i}" title="Sil">✕</button></div></div>`).join('');
    if (focus >= 0) this.ov.querySelector(`textarea[data-i="${focus}"]`)?.focus();
  }

  // Screenshot of the page with the numbered markers drawn on it, plus what sits under each marker.
  async send() {
    const to = this.root.querySelector('#brTo').value;
    if (!to) return this.toast('Önce bir çalışan seç.', 'err');
    if (!this.marks.length) return this.toast('Önce sayfada en az bir nokta işaretle.', 'err');
    try {
      const rect = this.ov.getBoundingClientRect();
      const img = await this.view.capturePage();
      const url = img.toDataURL();
      const el = new Image(); await new Promise((res, rej) => { el.onload = res; el.onerror = rej; el.src = url; });
      const k = el.width / rect.width;
      const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height;
      const c = cv.getContext('2d'); c.drawImage(el, 0, 0);
      const notes = [];
      for (const [i, m] of this.marks.entries()) {
        const x = m.x * k, y = m.y * k, r = 13 * k;
        c.fillStyle = '#ff5d73'; c.strokeStyle = '#fff'; c.lineWidth = 2 * k;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
        c.fillStyle = '#fff'; c.font = `bold ${13 * k}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), x, y + k);
        let target = '';
        try {
          target = await this.view.executeJavaScript(`(() => { const e = document.elementFromPoint(${Math.round(m.x)}, ${Math.round(m.y)}); if (!e) return ''; const id = e.id ? '#' + e.id : ''; const cl = typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''; return e.tagName.toLowerCase() + id + cl + ' "' + (e.innerText || e.value || e.alt || '').trim().replace(/\s+/g, ' ').slice(0, 60) + '"'; })()`);
        } catch { /* page blocked script access */ }
        notes.push({ n: i + 1, x: Math.round(m.x), y: Math.round(m.y), text: m.text.trim() || '(not yok)', target });
      }
      const r = await this.api.annotSend({ id: to, png: cv.toDataURL('image/png').split(',')[1], url: this.url, width: Math.round(rect.width), height: Math.round(rect.height), notes });
      if (r?.error) return this.toast(r.error, 'err');
      this.toast('İşaretli ekran çalışana iletildi');
      this.toggle(false);
    } catch (e) { this.toast(`Gönderilemedi: ${e.message || e}`, 'err'); }
  }

  show() { if (!this.started) this.go(this.url); }
  // a hidden webview must not keep the keyboard
  blur() { try { if (this.started) this.view.blur(); } catch { /* not ready */ } if (document.activeElement === this.view) document.activeElement.blur(); }
}
