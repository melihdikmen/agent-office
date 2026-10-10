// Skills: playbooks workers can be given. Toggle a skill per worker; write your own.
// Claude workers load them as a plugin for that session; Codex / Gemini get the text in their briefing.
import { tt } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class SkillsView {
  constructor(root, api, { toast, openDialog, closeDialog, dlgBody }) {
    Object.assign(this, { root, api, toast, openDialog, closeDialog, dlgBody });
    this.skills = []; this.workers = []; this.props = []; this.key = '';
    root.addEventListener('click', (e) => this.click(e));
  }

  set(skills, workers, props = []) {
    this.skills = skills || []; this.workers = workers; this.props = props;
    const key = JSON.stringify([props.map((p) => p.id), this.skills.map((s) => [s.id, s.name, s.description]), workers.map((w) => [w.id, w.name, w.skills, w.running])]);
    if (key === this.key) return;
    this.key = key; this.render();
  }

  card(s) {
    const chips = this.workers.map((w) => {
      const on = (w.skills || []).includes(s.id);
      return `<button class="sk-chip ${on ? 'on' : ''}" data-toggle="${esc(w.id)}" title="${on ? tt('Çıkar', 'Remove') : tt('Ver', 'Give')}${w.running ? ` — ${tt('çalışan bir sonraki başlatmada alır', 'applied on the next start')}` : ''}">${on ? '✓ ' : ''}${esc(w.name)}</button>`;
    }).join('');
    return `<div class="sk" data-id="${esc(s.id)}"><div class="sk-top"><b>${esc(s.name)}</b><span class="spacer"></span>${s.builtin ? `<span class="muted">${tt('hazır', 'built-in')}</span>` : `<button class="link" data-act="edit">${tt('düzenle', 'edit')}</button><button class="link" data-act="del">${tt('sil', 'delete')}</button>`}<button class="link" data-act="view">${tt('göz at', 'view')}</button></div>
      <div class="sk-desc">${esc(s.description)}</div><div class="sk-who">${chips || `<span class="muted">${tt('Henüz çalışan yok.', 'No workers yet.')}</span>`}</div></div>`;
  }

  render() {
    const builtin = this.skills.filter((s) => s.builtin), mine = this.skills.filter((s) => !s.builtin);
    const prop = (p) => `<div class="sk prop" data-pid="${esc(p.id)}"><div class="sk-top"><b>${esc(p.name)}</b><span class="muted">${tt('öneren', 'by')} ${esc(p.byName)}</span><span class="spacer"></span><button class="link" data-act="pview">${tt('gör', 'view')}</button><button class="btn small primary" data-act="paccept">${tt('Kabul et', 'Accept')}</button><button class="btn small" data-act="pdismiss">${tt('Reddet', 'Dismiss')}</button></div><div class="sk-desc">${esc(p.description)}</div></div>`;
    this.root.innerHTML = `<div class="sk-wrap">${this.props.length ? `<h4 class="dc-h">${tt('Önerilen beceriler', 'Suggested skills')} · ${this.props.length}</h4>${this.props.map(prop).join('')}` : ''}<div class="sk-head"><h3>${tt('Beceriler', 'Skills')}</h3><span class="muted">${tt('Çalışana bir beceri ver: ilgili iş gelince o yöntemi izler.', 'Give a worker a skill: it follows that method when the work matches.')}</span><span class="spacer"></span><button class="btn" data-act="suggest" title="${tt('Bir çalışandan hafızasına bakıp beceri önermesini iste', 'Ask a worker to suggest skills from its memory')}">${tt('✦ Ekipten öner', '✦ Ask the team')}</button><button class="btn small primary" data-act="new">＋ ${tt('Yeni beceri', 'New skill')}</button></div>
      ${mine.length ? `<h4 class="dc-h">${tt('Benim becerilerim', 'My skills')}</h4>${mine.map((s) => this.card(s)).join('')}` : ''}
      <h4 class="dc-h">${tt('Hazır beceriler', 'Built-in skills')}</h4>${builtin.map((s) => this.card(s)).join('')}
      <p class="muted sk-note">${tt('Claude çalışanları becerileri yalnızca o oturum için yükler, projene dosya yazılmaz. Codex ve Gemini çalışanlarına metin olarak brifinge eklenir.', 'Claude workers load skills for that session only; nothing is written into your project. Codex and Gemini workers get the text in their briefing.')}</p></div>`;
  }

  async form(s = null) {
    this.openDialog(`<form><h3>${s ? tt('Beceriyi düzenle', 'Edit skill') : tt('Yeni beceri', 'New skill')}</h3>
      <label>${tt('Ad', 'Name')} <input name="name" value="${esc(s?.name || '')}" placeholder="${tt('örn. Kod stili', 'e.g. Code style')}" required></label>
      <label>${tt('Ne zaman kullanılsın? (tek cümle, İngilizce önerilir)', 'When should it be used? (one sentence)')} <input name="description" value="${esc(s?.description || '')}" placeholder="Use when …" required></label>
      <label>${tt('Yöntem (Markdown)', 'Playbook (Markdown)')} <textarea name="body" rows="10" required>${esc(s?.body || '')}</textarea></label>
      <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>${tt('Vazgeç', 'Cancel')}</button><button value="save" class="btn primary">${tt('Kaydet', 'Save')}</button></div></form>`,
    async (fd) => { const r = await this.api.skillSave({ id: s?.id, name: fd.get('name'), description: fd.get('description'), body: fd.get('body') }); if (r?.error) { this.toast(r.error, 'err'); return false; } });
  }

  async click(e) {
    const card = e.target.closest('.sk');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new') return this.form();
    if (act === 'suggest') { const r = await this.api.skillSuggestAsk({}); return this.toast(r?.error || tt(`${r.name}'dan öneri istendi; hazır olunca burada görünür.`, `Asked ${r.name} for suggestions; they show up here.`), r?.error ? 'err' : undefined); }
    const pcard = e.target.closest('[data-pid]');
    if (pcard) {
      const p = this.props.find((x) => x.id === pcard.dataset.pid); if (!p) return;
      if (act === 'paccept') { const r = await this.api.skillProposalAccept({ id: p.id }); return this.toast(r?.error || tt('Beceri eklendi', 'Skill added'), r?.error ? 'err' : undefined); }
      if (act === 'pdismiss') return this.api.skillProposalDismiss({ id: p.id });
      if (act === 'pview') return this.openDialog(`<form><h3>${esc(p.name)}</h3><p class="muted">${esc(p.description)}</p><pre class="memo">${esc(p.body)}</pre><div class="dlg-actions"><span class="spacer"></span><button value="cancel" class="btn">${tt('Kapat', 'Close')}</button></div></form>`, () => {});
    }
    const s = card && this.skills.find((x) => x.id === card.dataset.id);
    const tg = e.target.closest('[data-toggle]');
    if (tg && s) {
      const w = this.workers.find((x) => x.id === tg.dataset.toggle), has = (w.skills || []).includes(s.id);
      const r = await this.api.workerUpdate({ id: w.id, patch: { skills: has ? w.skills.filter((x) => x !== s.id) : [...(w.skills || []), s.id] } });
      if (r?.error) this.toast(r.error, 'err');
      return;
    }
    if (!s) return;
    if (act === 'view') { const body = s.body ?? await this.api.skillGet({ id: s.id }); this.openDialog(`<form><h3>${esc(s.name)}</h3><p class="muted">${esc(s.description)}</p><pre class="memo">${esc(body)}</pre><div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>${tt('Kapat', 'Close')}</button></div></form>`); }
    if (act === 'edit') this.form(s);
    if (act === 'del' && confirm(tt(`"${s.name}" silinsin mi? Çalışanlardan da kalkar.`, `Delete "${s.name}"? It is removed from workers too.`))) await this.api.skillDelete({ id: s.id });
  }
}
