// Team chat: talk to the whole team (the lead takes it) or to people with @name.
// Agent answers and agent-to-agent messages appear here too.
import { tt } from '../i18n.js';
import { sendDraft } from './chat-send.mjs';
import { pendingList, lateIn } from './chat-pending.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (ts) => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export class ChatView {
  constructor(root, api, { toast, onUnread, onTerminal }) {
    this.root = root; this.api = api; this.toast = toast; this.onUnread = onUnread; this.onTerminal = onTerminal;
    this.leadId = null; this.optimistic = null; this.lateTimer = null;
    this.msgs = []; this.workers = []; this.key = ''; this.seen = 0; this.visible = false; this.draft = '';
    root.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    root.addEventListener('click', (e) => { const term = e.target.closest('[data-term]'); if (term) { this.onTerminal?.(term.dataset.term); return; } const c = e.target.closest('[data-mention]'); if (c) this.mention(c.dataset.mention); });
    root.addEventListener('input', (e) => { if (e.target.id === 'chIn') { this.draft = e.target.value; this.grow(e.target); } });
    root.addEventListener('keydown', (e) => { if (e.target.id === 'chIn' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); } });
  }

  name(id) { return id === 'user' ? tt('Sen', 'You') : this.workers.find((w) => w.id === id)?.name || '?'; }
  color(id) { return this.workers.find((w) => w.id === id)?.color || '#6b7194'; }
  grow(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; }

  set(msgs, workers, leadId) {
    this.msgs = msgs || []; this.workers = workers; this.leadId = leadId || null;
    const key = JSON.stringify([this.msgs.length, this.msgs.at(-1)?.id, workers.map((w) => [w.name, w.status])]);
    const fromAgents = this.msgs.filter((m) => m.to === 'user' && m.from !== 'user').length;
    if (this.visible) this.seen = fromAgents;
    this.onUnread(Math.max(0, fromAgents - this.seen));
    if (key === this.key) return;
    this.key = key; this.render();
  }

  show(on) {
    this.visible = on;
    if (on) { this.seen = this.msgs.filter((m) => m.to === 'user' && m.from !== 'user').length; this.onUnread(0); this.scroll(); this.root.querySelector('#chIn')?.focus(); }
  }

  scroll() { const l = this.root.querySelector('.ch-list'); if (l) l.scrollTop = l.scrollHeight; }

  bubble(m) {
    const mine = m.from === 'user';
    if (m.kind === 'dm') return `<div class="ch-dm"><i style="background:${this.color(m.from)}"></i><b>${esc(this.name(m.from))}</b> → <b>${esc(this.name(m.to))}</b>: ${esc(m.text)}<span class="muted"> · ${hm(m.ts)}</span></div>`;
    const to = mine ? (m.to === 'team' ? tt('takım', 'team') : m.to.split(',').map((i) => this.name(i)).join(', ')) : '';
    return `<div class="ch-m ${mine ? 'mine' : ''}"><div class="ch-who">${mine ? `${esc(this.name('user'))} <span class="muted">→ ${esc(to)}</span>` : `<i style="background:${this.color(m.from)}"></i>${esc(this.name(m.from))}`}<span class="muted"> · ${hm(m.ts)}</span></div><div class="ch-t">${esc(m.text).replace(/@([\p{L}\p{N}_-]+)/gu, '<span class="ch-at">@$1</span>')}</div></div>`;
  }

  // "thinking…" rows for whoever should answer the owner's last message
  pendHtml() {
    const kinds = { thinking: ['düşünüyor', 'thinking'], waking: ['uyanıyor', 'waking up'], asleep: ['uyuyor, uyandırılıyor', 'asleep, waking up'], approval: ['senden onay bekliyor', 'waiting for you'] };
    return pendingList({ msgs: this.msgs, workers: this.workers, leadId: this.leadId, optimistic: this.optimistic }).map((p) => {
      const body = p.kind === 'late'
        ? `${tt('cevap gecikiyor, terminaline bak', 'reply is late, check the terminal')} <button type="button" class="ch-term" data-term="${esc(p.id)}">${tt('terminal ›', 'terminal ›')}</button>`
        : `${tt(...kinds[p.kind])}<span class="ch-dots"></span>`;
      return `<div class="ch-m ch-pend ${p.kind}"><div class="ch-who"><i style="background:${p.color}"></i>${esc(p.name)}</div><div class="ch-t">${body}</div></div>`;
    }).join('');
  }

  updatePending() {
    const list = this.root.querySelector('.ch-list');
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.querySelectorAll('.ch-pend').forEach((n) => n.remove());
    const html = this.pendHtml();
    if (html) list.querySelector('.ch-empty')?.remove();
    list.insertAdjacentHTML('beforeend', html);
    if (atBottom) this.scroll();
    clearTimeout(this.lateTimer);
    const ms = lateIn(this.msgs, this.optimistic);
    if (ms != null) this.lateTimer = setTimeout(() => this.updatePending(), Math.min(ms, 2 ** 31 - 1));
  }

  render() {
    const keep = this.root.querySelector('#chIn');
    const draft = keep ? keep.value : this.draft;
    const atBottom = (() => { const l = this.root.querySelector('.ch-list'); return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 80; })();
    this.root.innerHTML = `<div class="ch-wrap"><div class="ch-list">${this.msgs.length ? this.msgs.map((m) => this.bubble(m)).join('') : `<div class="ch-empty"><b>${tt('Takım sohbeti', 'Team chat')}</b><p>${tt('Bir hedef yaz: lider alır, görevlere böler, ekibe dağıtır. Belirli birine yazmak için @ad kullan.', 'Write a goal: the lead splits it into tasks and hands them out. Use @name to talk to one person.')}</p></div>`}</div>
      <form class="ch-form"><div class="ch-chips">${this.workers.map((w) => `<button type="button" class="ch-chip" data-mention="${esc(w.name)}"><i style="background:${w.color}"></i>@${esc(w.name)}</button>`).join('')}</div>
      <div class="ch-row"><textarea id="chIn" rows="1" placeholder="${tt('Takıma yaz… (Enter gönderir, Shift+Enter satır ekler)', 'Message the team… (Enter sends, Shift+Enter adds a line)')}">${esc(draft)}</textarea><button class="btn primary" type="submit">${tt('Gönder', 'Send')}</button></div></form></div>`;
    const ta = this.root.querySelector('#chIn'); this.grow(ta);
    this.updatePending();
    if (atBottom) this.scroll();
    if (keep && document.activeElement === document.body && this.visible) ta.focus();
  }

  mention(name) {
    const ta = this.root.querySelector('#chIn');
    ta.value = `${ta.value}${ta.value && !/\s$/.test(ta.value) ? ' ' : ''}@${name} `; this.draft = ta.value; ta.focus();
  }

  async send() {
    // re-query the box every time: render() may replace the textarea mid-send
    const box = () => this.root.querySelector('#chIn');
    const ok = await sendDraft(Object.assign(this.flow ||= {}, {
      get: () => box()?.value ?? this.draft,
      set: (v) => { this.draft = v; const ta = box(); if (ta) { ta.value = v; this.grow(ta); } },
      send: async (text) => {
        this.optimistic = { ts: Date.now(), text }; this.updatePending();
        try { const r = await this.api.chatSend({ text }); if (r?.error) { this.optimistic = null; this.updatePending(); } return r; }
        catch (e) { this.optimistic = null; this.updatePending(); throw e; }
      },
      toast: (m, k) => this.toast(m, k),
    }));
    if (ok) { this.key = ''; setTimeout(() => this.scroll(), 120); }
  }
}
