// Reports: every closed task with its evidence, newest first. The owner reviews them here:
// comment on the summary / a check / a file, approve, or ask for changes (the task reopens).
import { tt } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (ts) => new Date(ts).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
const REVIEW = { pending: ['○', 'Onay bekliyor', 'Awaiting review'], approved: ['✓', 'Onaylandı', 'Approved'], changes: ['↺', 'Değişiklik istendi', 'Changes requested'] };

export class ReportsView {
  constructor(root, { onOpenTask, api, toast }) {
    this.root = root; this.onOpenTask = onOpenTask; this.api = api; this.toast = toast;
    this.reports = []; this.workers = []; this.open = new Set(); this.drafts = new Map(); this.anchors = new Map(); this.key = '';
    root.addEventListener('click', (e) => this.click(e));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.full) { this.full = null; this.render(); } });
    root.addEventListener('input', (e) => { const box = e.target.closest('.rv-box'); if (box && e.target.matches('textarea')) this.drafts.set(box.dataset.report, e.target.value); });
  }
  who(id) { return id === 'user' ? tt('Sahip', 'Owner') : this.workers.find((w) => w.id === id)?.name || id; }

  set(reports, workers) {
    this.reports = reports; this.workers = workers;
    const key = JSON.stringify([reports.map((r) => [r.id, r.review?.status, r.comments?.length]), workers.map((w) => w.name)]);
    if (key === this.key) return;              // the status loop pushes state every few seconds; do not wipe a half-written comment
    this.key = key; this.render();
  }

  render() {
    const ok = this.reports.filter((r) => !r.evidence.some((e) => !e.ok)).length;
    const pending = this.reports.filter((r) => (r.review?.status || 'pending') === 'pending' && r.by !== 'user').length;
    this.root.innerHTML = `<div class="rp-head"><h3>${tt('Raporlar', 'Reports')}</h3><span class="muted">${this.reports.length} ${tt('rapor', 'reports')} · ${ok} ${tt('kanıtı temiz', 'clean evidence')}${pending ? ` · ${pending} ${tt('onay bekliyor', 'awaiting review')}` : ''}</span></div>
      ${this.reports.length ? this.reports.map((r) => this.item(r)).join('') : `<p class="muted pad">${tt('Bir görev kanıtıyla kapanınca raporu burada görünür.', 'When a task closes with evidence, its report shows up here.')}</p>`}`;
  }

  anchorLabel(a) { return !a ? '' : a.type === 'evidence' ? `${tt('kanıt', 'check')}: ${a.label || a.ref}` : a.type === 'file' ? `${tt('dosya', 'file')}: ${a.ref}` : tt('özet', 'summary'); }

  item(r) {
    const failed = r.evidence.filter((e) => !e.ok).length;
    const full = this.full === r.id;
    const open = this.open.has(r.id) || full;
    const rv = REVIEW[r.review?.status || 'pending'];
    const cm = (type, ref) => `<button class="cm" data-anchor="${type}:${esc(ref)}" title="${tt('Buna yorum yaz', 'Comment on this')}">💬</button>`;
    const anchor = this.anchors.get(r.id);
    return `<div class="rp ${failed ? 'warn' : 'ok'} ${open ? 'open' : ''} ${full ? 'full' : ''}" data-id="${esc(r.id)}">
      <div class="rp-top"><span class="tid">${r.taskId}</span><b>${esc(r.title)}</b><span class="spacer"></span><button class="cm full-btn" data-full="${esc(r.id)}" title="${tt('Tam ekran oku (Esc ile kapat)', 'Read full screen (Esc to close)')}">${full ? '✕' : '⛶'}</button><span class="muted">${esc(this.who(r.by))} · ${when(r.ts)}</span><span class="rv rv-${r.review?.status || 'pending'}" title="${tt(rv[1], rv[2])}">${rv[0]}</span><span class="badge">${failed ? `⚠ ${failed} ${tt('başarısız', 'failed')}` : `✓ ${r.evidence.length} ${tt('doğrulama', 'checks')}`}</span></div>
      <p class="rp-sum">${esc(r.summary)}</p>
      ${open ? `<div class="rp-body">${cm('summary', '')}${r.evidence.length ? `<ul class="evidence">${r.evidence.map((e, i) => `<li class="${e.ok ? 'ok' : 'fail'}"><b>${e.ok ? '✓' : '✗'} ${esc(e.label)}</b>${e.detail ? `<span>${esc(e.detail)}</span>` : ''}${cm('evidence', `${i}|${e.label}`)}</li>`).join('')}</ul>` : ''}
        ${r.files.length ? `<div class="files">${r.files.map((f) => `<code data-anchor="file:${esc(f)}" title="${tt('Yorum yaz', 'Comment')}">${esc(f)}</code>`).join('')}</div>` : ''}
        ${(r.comments || []).length ? `<div class="rv-thread">${r.comments.map((c) => `<div class="rv-c"><b>${esc(this.who(c.by))}</b>${c.anchor ? ` <span class="muted">· ${esc(this.anchorLabel(c.anchor))}</span>` : ''} <span class="muted">${when(c.ts)}</span><div>${esc(c.text)}</div></div>`).join('')}</div>` : ''}
        <div class="rv-box" data-report="${esc(r.id)}">
          <div class="rv-anchor muted">${anchor ? `💬 ${esc(this.anchorLabel(anchor))} <a data-rv="clear">✕</a>` : ''}</div>
          <textarea rows="2" placeholder="${tt('Yorum ya da değişiklik isteği yaz… (çalışanın terminaline iletilir)', 'Write a comment or change request… (sent to the worker\'s terminal)')}">${esc(this.drafts.get(r.id) || '')}</textarea>
          <div class="rp-acts"><button class="btn small" data-rv="comment">${tt('Yorum gönder', 'Send comment')}</button><button class="btn small" data-rv="approve">✓ ${tt('Onayla', 'Approve')}</button><button class="btn small" data-rv="changes">↺ ${tt('Değişiklik iste', 'Request changes')}</button><span class="spacer"></span><button class="btn small" data-task="${r.taskId}">${tt('Görevi aç', 'Open task')}</button></div></div></div>` : ''}</div>`;
  }

  async review(box, action) {
    const id = box.dataset.report, ta = box.querySelector('textarea');
    const r = await this.api.reportReview({ id, action, text: ta.value, anchor: this.anchors.get(id) || null });
    if (r?.error) return this.toast(r.error, 'err');
    this.drafts.delete(id); this.anchors.delete(id);
    this.key = ''; // the pushed state re-renders with the new comment
    this.toast(action === 'approve' ? tt('Onaylandı', 'Approved') : action === 'changes' ? tt('Değişiklik isteği iletildi, görev yeniden açıldı', 'Change request sent, the task is open again') : tt('Yorum iletildi', 'Comment sent'));
  }

  click(e) {
    const fb = e.target.closest('[data-full]');
    if (fb) { this.full = this.full === fb.dataset.full ? null : fb.dataset.full; return this.render(); }
    if (this.full && !e.target.closest('.rp-body, .rp-top, .rp-sum')) { this.full = null; return this.render(); }
    const t = e.target.closest('[data-task]');
    if (t) return this.onOpenTask?.(t.dataset.task);
    const rv = e.target.closest('[data-rv]');
    if (rv) {
      const box = rv.closest('.rv-box');
      if (rv.dataset.rv === 'clear') { this.anchors.delete(box.dataset.report); return this.render(); }
      return this.review(box, rv.dataset.rv);
    }
    const an = e.target.closest('[data-anchor]');
    if (an) {
      const item = an.closest('.rp'), [type, ...rest] = an.dataset.anchor.split(':'), ref = rest.join(':');
      const a = type === 'evidence' ? { type, ref: Number(ref.split('|')[0]), label: ref.split('|').slice(1).join('|') } : type === 'file' ? { type, ref } : { type: 'summary', ref: '' };
      this.anchors.set(item.dataset.id, a);
      this.render();
      this.root.querySelector(`.rp[data-id="${item.dataset.id}"] textarea`)?.focus();
      return;
    }
    if (e.target.closest('.rp-body')) return;
    const item = e.target.closest('.rp');
    if (!item) return;
    this.open.has(item.dataset.id) ? this.open.delete(item.dataset.id) : this.open.add(item.dataset.id);
    this.render();
  }
}
