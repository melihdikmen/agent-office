// Notification centre: the bell with an unread count and a list of what happened
// (project · agent · what), plus switches for which kinds to be told about.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { done: '✓', waiting: '?', finished: '●', assigned: '→' };

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'şimdi';
  if (s < 3600) return `${Math.floor(s / 60)} dk`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa`;
  return `${Math.floor(s / 86400)} g`;
}

export class NotifyView {
  constructor(bell, panel, api, { onOpen }) {
    this.bell = bell; this.panel = panel; this.api = api; this.onOpen = onOpen;
    this.data = { items: [], unread: 0, prefs: { enabled: true, onlyUnfocused: true, sound: true, kinds: {} }, kinds: {} };
    this.showPrefs = false;
    bell.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    panel.addEventListener('click', (e) => this.click(e));
    document.addEventListener('pointerdown', (e) => { if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !bell.contains(e.target)) this.toggle(false); });
    setInterval(() => { if (!panel.classList.contains('hidden')) this.render(); }, 30000);
  }

  set(data) {
    if (!data) return;
    const key = JSON.stringify([data.items.map((n) => [n.id, n.read]), data.unread, data.prefs]);
    if (key === this.key) return;
    this.key = key; this.data = data;
    this.bell.querySelector('.badge').textContent = data.unread > 99 ? '99+' : String(data.unread || '');
    this.bell.classList.toggle('has', data.unread > 0);
    this.bell.classList.toggle('off', !data.prefs.enabled);
    if (!this.panel.classList.contains('hidden')) this.render();
  }

  toggle(open = this.panel.classList.contains('hidden')) {
    this.panel.classList.toggle('hidden', !open);
    if (open) this.render();
  }

  render() {
    const { items, prefs, kinds } = this.data;
    const toggles = Object.entries(kinds).map(([k, d]) => `<label class="nt-opt"><input type="checkbox" data-kind="${k}" ${prefs.kinds[k] ? 'checked' : ''}> ${d.icon} ${esc(d.label)}</label>`).join('');
    const prefsHtml = this.showPrefs ? `<div class="nt-prefs">
        <label class="nt-opt"><input type="checkbox" data-pref="enabled" ${prefs.enabled ? 'checked' : ''}> Bildirimler açık</label>
        <label class="nt-opt"><input type="checkbox" data-pref="onlyUnfocused" ${prefs.onlyUnfocused ? 'checked' : ''}> Sistem bildirimi yalnızca uygulama arkadayken</label>
        <label class="nt-opt"><input type="checkbox" data-pref="sound" ${prefs.sound ? 'checked' : ''}> Ses</label>
        <div class="nt-sep"></div>${toggles}</div>` : '';
    this.panel.innerHTML = `<div class="nt-head"><b>Bildirimler</b><span class="spacer"></span>
        <button data-act="readall" title="Hepsini okundu yap">✓ okundu</button><button data-act="clear" title="Temizle">Temizle</button><button data-act="prefs" class="${this.showPrefs ? 'on' : ''}" title="Ayarlar">⚙</button></div>${prefsHtml}
      <div class="nt-list">${items.length ? items.map((n) => `<div class="nt-item ${n.read ? '' : 'unread'} ${n.warn ? 'warn' : ''}" data-id="${n.id}">
          <span class="nt-ic k-${n.kind}">${ICON[n.kind] || '•'}</span>
          <div class="nt-main"><div class="nt-title">${esc(n.title)} <span class="nt-ago">${ago(n.ts)}</span></div><div class="nt-sub">${esc(n.subtitle)}</div><div class="nt-body">${esc(n.body)}</div></div></div>`).join('') : '<div class="nt-empty">Henüz bildirim yok. Bir ajan görev bitirince ya da seni beklediğinde burada görünür.</div>'}</div>`;
  }

  async click(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'readall') return this.api.notifyRead({});
    if (act === 'clear') return this.api.notifyClear({});
    if (act === 'prefs') { this.showPrefs = !this.showPrefs; return this.render(); }
    const kind = e.target.closest('[data-kind]')?.dataset.kind, pref = e.target.closest('[data-pref]')?.dataset.pref;
    if (kind) return this.api.notifySet({ kinds: { [kind]: e.target.checked } });
    if (pref) return this.api.notifySet({ [pref]: e.target.checked });
    const item = e.target.closest('.nt-item');
    if (item) {
      const n = this.data.items.find((x) => x.id === item.dataset.id);
      if (n) { await this.api.notifyRead({ id: n.id }); this.toggle(false); this.onOpen({ ...n.ref, wsId: n.wsId }); }
    }
  }
}
