// Built-in browser: a webview with an address bar, for checking what the crew ships.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class BrowserView {
  constructor(root, { api, workers, toast } = {}) {
    this.root = root; this.api = api; this.workers = workers || (() => []); this.toast = toast || (() => {}); this.marks = []; this.ann = false;
    this.url = 'http://localhost:3000';
    this.zoom = 1; this.bm = this.loadBm();
    root.innerHTML = `<div class="br-bar">
        <button class="btn small" data-nav="back" title="Önceki sayfa">‹</button><button class="btn small" data-nav="fwd" title="Sonraki sayfa">›</button><button class="btn small" data-nav="reload" title="Yenile">↻</button><button class="btn small" data-nav="hard" title="Önbelleği atla, sert yenile">↻!</button><button class="btn small" data-nav="stop" title="Yüklemeyi durdur">⏹</button><button class="btn small" data-nav="home" title="Ana sayfa (localhost:3000)">⌂</button>
        <form id="brForm"><input id="brUrl" value="${esc(this.url)}" spellcheck="false"></form>
        <button class="btn small" data-nav="star" id="brStar" title="Yer imi ekle / kaldır">☆</button><select id="brBm" title="Yer imleri"></select>
      </div>
      <div class="br-bar br-bar2">
        <button class="btn small" data-nav="zout" title="Uzaklaş">−</button><button class="btn small" data-nav="zreset" id="brZ" title="Yakınlaştırmayı sıfırla">100%</button><button class="btn small" data-nav="zin" title="Yakınlaş">+</button>
        <select id="brDev" title="Cihaz boyutu"><option value="0">Masaüstü</option><option value="1024">Tablet 1024</option><option value="820">Tablet 820</option><option value="430">Mobil 430</option><option value="390">Mobil 390</option><option value="360">Mobil 360</option></select>
        <button class="btn small" data-nav="find" title="Sayfada ara">⌕</button><button class="btn small" data-nav="shot" title="Ekran görüntüsünü panoya kopyala">📷</button><button class="btn small" data-nav="copy" title="Adresi kopyala">⧉</button><button class="btn small" data-nav="dev" title="Geliştirici araçları">🛠</button><button class="btn small" data-nav="ext" title="Sistem tarayıcısında aç">↗</button>
        <span class="spacer"></span><button class="btn small" data-nav="ann" title="Ekranda nokta işaretle, nota yaz ve bir çalışana gönder">✎ İşaretle</button>
      </div>
      <div class="br-find hidden"><input id="brFind" placeholder="Sayfada ara…" spellcheck="false"><button class="btn small" data-nav="fprev">↑</button><button class="btn small" data-nav="fnext">↓</button><button class="btn small" data-nav="fx">✕</button><span class="muted" id="brFc"></span></div>
      <div class="br-annbar hidden"><span class="muted">Sayfada bir noktaya tıkla, notunu yaz.</span><span class="spacer"></span><select id="brTo"></select><button class="btn small" data-nav="clear">Temizle</button><button class="btn small primary" data-nav="send">Çalışana gönder</button><button class="btn small" data-nav="annoff">✕</button></div>
      <div class="br-stage"><div class="br-frame"><webview id="brView"></webview><div class="br-ov hidden"></div></div></div>`;
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
      if (this.extra(nav)) return;
      try {
        if (nav === 'back' && this.view.canGoBack()) this.view.goBack();
        if (nav === 'fwd' && this.view.canGoForward()) this.view.goForward();
        if (nav === 'reload') this.view.reload();
        if (nav === 'ext') window.open(this.view.getURL() || this.url);
      } catch { /* webview not ready */ }
    };
    const nav = (e) => { if (!e.url || e.url === 'about:blank') return; this.url = e.url; this.input.value = e.url; this.drawBm?.(); };
    this.view.addEventListener('did-navigate', nav);
    this.view.addEventListener('did-navigate-in-page', nav);
    this.started = false;
    this.drawBm();
    root.querySelector('#brBm').onchange = (e) => { if (e.target.value) this.go(e.target.value); e.target.value = ''; };
    root.querySelector('#brDev').onchange = (e) => { const w = Number(e.target.value); this.root.querySelector('.br-frame').style.width = w ? `${w}px` : ''; this.root.querySelector('.br-frame').classList.toggle('device', !!w); if (this.ann) this.draw(); };
    const f = root.querySelector('#brFind');
    f.oninput = () => { try { f.value ? this.view.findInPage(f.value) : this.view.stopFindInPage('clearSelection'); } catch { /* not ready */ } };
    f.onkeydown = (e) => { if (e.key === 'Enter') { try { this.view.findInPage(f.value, { forward: !e.shiftKey, findNext: true }); } catch { /* not ready */ } } if (e.key === 'Escape') this.extra('fx'); };
    this.view.addEventListener('found-in-page', (e) => { const r = e.result; root.querySelector('#brFc').textContent = r?.matches != null ? `${r.activeMatchOrdinal || 0}/${r.matches}` : ''; });
    this.view.addEventListener('dom-ready', () => { try { this.view.setZoomFactor(this.zoom); } catch { /* ignore */ } });
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

  loadBm() { try { return JSON.parse(localStorage.getItem('ao.bookmarks') || '[]'); } catch { return []; } }
  saveBm() { try { localStorage.setItem('ao.bookmarks', JSON.stringify(this.bm)); } catch { /* storage blocked */ } this.drawBm(); }
  drawBm() {
    const sel = this.root.querySelector('#brBm');
    sel.innerHTML = `<option value="">Yer imleri (${this.bm.length})</option>${this.bm.map((u) => `<option value="${esc(u)}">${esc(u.replace(/^https?:\/\//, '').slice(0, 48))}</option>`).join('')}`;
    this.root.querySelector('#brStar').textContent = this.bm.includes(this.url) ? '★' : '☆';
  }

  setZoom(z) { this.zoom = Math.max(0.3, Math.min(3, Math.round(z * 10) / 10)); try { this.view.setZoomFactor(this.zoom); } catch { /* not ready */ } this.root.querySelector('#brZ').textContent = `${Math.round(this.zoom * 100)}%`; }

  async shot() {
    const img = await this.view.capturePage();
    const b64 = img.toDataURL().split(',')[1], bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([arr], { type: 'image/png' }) })]);
    this.toast('Ekran görüntüsü panoya kopyalandı');
  }

  // Buttons beyond plain navigation; true when handled.
  extra(nav) {
    const v = this.view;
    try {
      if (nav === 'hard') { v.reloadIgnoringCache(); return true; }
      if (nav === 'stop') { v.stop(); return true; }
      if (nav === 'home') { this.go('http://localhost:3000'); return true; }
      if (nav === 'zin') { this.setZoom(this.zoom + 0.1); return true; }
      if (nav === 'zout') { this.setZoom(this.zoom - 0.1); return true; }
      if (nav === 'zreset') { this.setZoom(1); return true; }
      if (nav === 'dev') { v.openDevTools(); return true; }
      if (nav === 'copy') { navigator.clipboard.writeText(this.url).then(() => this.toast('Adres kopyalandı')).catch(() => {}); return true; }
      if (nav === 'star') { this.bm = this.bm.includes(this.url) ? this.bm.filter((u) => u !== this.url) : [this.url, ...this.bm].slice(0, 30); this.saveBm(); return true; }
      if (nav === 'shot') { this.shot().catch((e) => this.toast(`Alınamadı: ${e.message || e}`, 'err')); return true; }
      if (nav === 'find') { const f = this.root.querySelector('.br-find'); f.classList.toggle('hidden'); if (!f.classList.contains('hidden')) this.root.querySelector('#brFind').focus(); else v.stopFindInPage('clearSelection'); return true; }
      if (nav === 'fx') { this.root.querySelector('.br-find').classList.add('hidden'); v.stopFindInPage('clearSelection'); return true; }
      if (nav === 'fnext' || nav === 'fprev') { const q = this.root.querySelector('#brFind').value; if (q) v.findInPage(q, { forward: nav === 'fnext', findNext: true }); return true; }
    } catch { /* webview not ready */ }
    return false;
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
