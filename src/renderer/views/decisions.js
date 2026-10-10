// Decisions: questions workers ask the owner (ask_owner). Open ones first with one-click
// options; answering types the reply into the worker's terminal.
import { tt } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? tt('şimdi', 'now') : s < 3600 ? `${Math.floor(s / 60)} ${tt('dk', 'min')}` : s < 86400 ? `${Math.floor(s / 3600)} ${tt('sa', 'h')}` : `${Math.floor(s / 86400)} ${tt('g', 'd')}`; };

export class DecisionsView {
  constructor(root, api, { toast, onCount }) {
    this.root = root; this.api = api; this.toast = toast; this.onCount = onCount;
    this.items = []; this.workers = new Map(); this.key = '';
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-free]')) this.answer(e.target.dataset.free, e.target.value); });
  }

  set(items, workers) {
    this.items = items || []; this.workers = new Map(workers.map((w) => [w.id, w]));
    const key = JSON.stringify([this.items.map((d) => [d.id, d.status]), [...this.workers.values()].map((w) => w.name)]);
    this.onCount(this.items.filter((d) => d.status === 'open').length);
    if (key === this.key) return;
    this.key = key; this.render();
  }

  render() {
    const open = this.items.filter((d) => d.status === 'open'), done = this.items.filter((d) => d.status !== 'open');
    const who = (d) => this.workers.get(d.by)?.name || '?';
    const card = (d) => `<div class="dc" data-id="${d.id}">
      <div class="dc-head"><b>${d.id}</b> · ${esc(who(d))}${d.task ? ` · ${esc(d.task)}` : ''}<span class="spacer"></span><span class="muted">${ago(d.ts)}</span></div>
      <div class="dc-q">${esc(d.question)}</div>${d.details ? `<div class="dc-d">${esc(d.details)}</div>` : ''}
      <div class="dc-opts">${d.options.map((o) => `<button class="btn small" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}
        <button class="btn small ghost" data-opt="${esc(tt('Karar senin: kendi yargınla ilerle.', 'Your call: use your own judgement.'))}">${tt('Sen karar ver', 'You decide')}</button></div>
      <div class="dc-free"><input data-free="${d.id}" placeholder="${tt('Başka bir cevap yaz, Enter ile gönder…', 'Write another answer, Enter to send…')}"></div></div>`;
    this.root.innerHTML = `<div class="dc-wrap">
      ${open.length ? open.map(card).join('') : `<div class="dc-empty">${tt('Bekleyen karar yok. Bir ajan seçenekli bir soru sorunca burada görünür ve bildirim gelir.', 'No pending decisions. When an agent asks you a question with options it shows up here, with a notification.')}</div>`}
      ${done.length ? `<h4 class="dc-h">${tt('Cevaplananlar', 'Answered')}</h4>${done.slice(0, 30).map((d) => `<div class="dc done"><div class="dc-head"><b>${d.id}</b> · ${esc(who(d))}<span class="spacer"></span><span class="muted">${ago(d.answeredTs || d.ts)}</span></div><div class="dc-q">${esc(d.question)}</div><div class="dc-a">→ ${esc(d.answer)}</div></div>`).join('')}` : ''}</div>`;
  }

  async answer(id, text) {
    if (!String(text || '').trim()) return;
    const r = await this.api.decisionAnswer({ id, answer: text });
    if (r?.error) this.toast(r.error, 'err');
  }

  click(e) {
    const opt = e.target.closest('[data-opt]');
    if (opt) this.answer(opt.closest('.dc').dataset.id, opt.dataset.opt);
  }

  open(id) { this.root.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'center' }); }
}
