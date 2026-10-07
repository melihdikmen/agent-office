// Integration hub: turn services on once; every worker started afterwards gets
// them as MCP tools. Keys never show again after they are saved.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class HubView {
  constructor(root, api, { toast }) {
    this.root = root; this.api = api; this.toast = toast; this.items = [];
    root.addEventListener('submit', (e) => this.submit(e));
    root.addEventListener('change', (e) => { if (e.target.matches('[data-on]')) this.set(e.target.dataset.on, { on: e.target.checked }); });
  }

  set items(v) { this._items = v; } get items() { return this._items; }

  setItems(items) { this.items = items; this.render(); }

  render() {
    this.root.innerHTML = `<div class="hub-head"><h3>Entegrasyon merkezi</h3><span class="muted">Bir kez bağla; bundan sonra başlayan her çalışan bu araçları kullanır. Anahtarlar sistem anahtar zincirinde şifreli durur.</span></div>
      <div class="hub-grid">${this.items.map((it) => `<form class="hub-card ${it.on ? 'on' : ''}" data-id="${it.id}">
        <div class="hub-top"><b>${esc(it.name)}</b><label class="switch"><input type="checkbox" data-on="${it.id}" ${it.on ? 'checked' : ''}><i></i></label></div>
        <p class="muted">${esc(it.desc)}</p>
        ${it.secret ? `<div class="row"><input name="secret" type="password" placeholder="${esc(it.secret)}${it.hasSecret ? ' · kayıtlı' : ''}" autocomplete="off"><button class="btn small">${it.hasSecret ? 'Değiştir' : 'Kaydet'}</button></div>` : `<p class="muted small">${esc(it.note || 'Anahtar gerekmez.')}</p>`}
        ${it.on ? '<span class="hub-state">● bağlı · yeni başlayan çalışanlara verilir</span>' : ''}</form>`).join('')}</div>
      <p class="muted pad">Dev/prod ayrımı: farklı ortamlar için ayrı ofisler kur; her ofisin çalışanları ortak merkezden ama kendi klasöründe çalışır. Değişiklikler, çalışanı yeniden başlatınca geçerli olur.</p>`;
  }

  async set(id, patch) {
    const r = await this.api.integrationSet({ id, ...patch });
    if (r?.error) { this.toast(r.error, 'err'); this.render(); return; }
    this.items = r; this.render();
  }

  async submit(e) {
    e.preventDefault();
    const id = e.target.dataset.id;
    const secret = String(new FormData(e.target).get('secret') || '').trim();
    if (!secret) return;
    await this.set(id, { secret, on: true });
    this.toast('Anahtar kaydedildi ve entegrasyon açıldı.');
  }
}
