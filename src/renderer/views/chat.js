// Team chat: talk to the whole team (the lead takes it) or to people with @name.
// Agent answers and agent-to-agent messages appear here too.
import { tt } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (ts) => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export class ChatView {
  constructor(root, api, { toast, onUnread }) {
    this.root = root; this.api = api; this.toast = toast; this.onUnread = onUnread;
    this.msgs = []; this.workers = []; this.key = ''; this.seen = 0; this.visible = false; this.draft = '';
    root.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    root.addEventListener('click', (e) => { const c = e.target.closest('[data-mention]'); if (c) this.mention(c.dataset.mention); });
    root.addEventListener('input', (e) => { if (e.target.id === 'chIn') { this.draft = e.target.value; this.grow(e.target); } });
    root.addEventListener('keydown', (e) => { if (e.target.id === 'chIn' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); } });
  }

  name(id) { return id === 'user' ? tt('Sen', 'You') : this.workers.find((w) => w.id === id)?.name || '?'; }
  color(id) { return this.workers.find((w) => w.id === id)?.color || '#6b7194'; }
  grow(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; }

  set(msgs, workers) {
    this.msgs = msgs || []; this.workers = workers;
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

  render() {
    const keep = this.root.querySelector('#chIn');
    const draft = keep ? keep.value : this.draft;
    const atBottom = (() => { const l = this.root.querySelector('.ch-list'); return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 80; })();
    this.root.innerHTML = `<div class="ch-wrap"><div class="ch-list">${this.msgs.length ? this.msgs.map((m) => this.bubble(m)).join('') : `<div class="ch-empty"><b>${tt('Takım sohbeti', 'Team chat')}</b><p>${tt('Bir hedef yaz: lider alır, görevlere böler, ekibe dağıtır. Belirli birine yazmak için @ad kullan.', 'Write a goal: the lead splits it into tasks and hands them out. Use @name to talk to one person.')}</p></div>`}</div>
      <form class="ch-form"><div class="ch-chips">${this.workers.map((w) => `<button type="button" class="ch-chip" data-mention="${esc(w.name)}"><i style="background:${w.color}"></i>@${esc(w.name)}</button>`).join('')}</div>
      <div class="ch-row"><textarea id="chIn" rows="1" placeholder="${tt('Takıma yaz… (Enter gönderir, Shift+Enter satır ekler)', 'Message the team… (Enter sends, Shift+Enter adds a line)')}">${esc(draft)}</textarea><button class="btn primary" type="submit">${tt('Gönder', 'Send')}</button></div></form></div>`;
    const ta = this.root.querySelector('#chIn'); this.grow(ta);
    if (atBottom) this.scroll();
    if (keep && document.activeElement === document.body && this.visible) ta.focus();
  }

  mention(name) {
    const ta = this.root.querySelector('#chIn');
    ta.value = `${ta.value}${ta.value && !/\s$/.test(ta.value) ? ' ' : ''}@${name} `; this.draft = ta.value; ta.focus();
  }

  async send() {
    const ta = this.root.querySelector('#chIn');
    const text = ta.value.trim();
    if (!text) return;
    const r = await this.api.chatSend({ text });
    if (r?.error) return this.toast(r.error, 'err');
    ta.value = ''; this.draft = ''; this.grow(ta); this.key = ''; setTimeout(() => this.scroll(), 120);
  }
}
