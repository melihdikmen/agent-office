// Reports: every closed task with its evidence, newest first.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (ts) => new Date(ts).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

export class ReportsView {
  constructor(root, { onOpenTask }) { this.root = root; this.onOpenTask = onOpenTask; this.reports = []; this.workers = []; this.open = new Set(); root.addEventListener('click', (e) => this.click(e)); }
  who(id) { return id === 'user' ? 'Sahip' : this.workers.find((w) => w.id === id)?.name || id; }

  set(reports, workers) { this.reports = reports; this.workers = workers; this.render(); }

  render() {
    const ok = this.reports.filter((r) => !r.evidence.some((e) => !e.ok)).length;
    this.root.innerHTML = `<div class="rp-head"><h3>Raporlar</h3><span class="muted">${this.reports.length} rapor · ${ok} kanıtı temiz</span></div>
      ${this.reports.length ? this.reports.map((r) => this.item(r)).join('') : '<p class="muted pad">Bir görev kanıtıyla kapanınca raporu burada görünür.</p>'}`;
  }

  item(r) {
    const failed = r.evidence.filter((e) => !e.ok).length;
    const open = this.open.has(r.id);
    return `<div class="rp ${failed ? 'warn' : 'ok'} ${open ? 'open' : ''}" data-id="${esc(r.id)}">
      <div class="rp-top"><span class="tid">${r.taskId}</span><b>${esc(r.title)}</b><span class="spacer"></span><span class="muted">${esc(this.who(r.by))} · ${when(r.ts)}</span><span class="badge">${failed ? `⚠ ${failed} başarısız` : `✓ ${r.evidence.length} doğrulama`}</span></div>
      <p class="rp-sum">${esc(r.summary)}</p>
      ${open ? `${r.evidence.length ? `<ul class="evidence">${r.evidence.map((e) => `<li class="${e.ok ? 'ok' : 'fail'}"><b>${e.ok ? '✓' : '✗'} ${esc(e.label)}</b>${e.detail ? `<span>${esc(e.detail)}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${r.files.length ? `<div class="files">${r.files.map((f) => `<code>${esc(f)}</code>`).join('')}</div>` : ''}
        <div class="rp-acts"><button class="btn small" data-task="${r.taskId}">Görevi aç</button></div>` : ''}</div>`;
  }

  click(e) {
    const t = e.target.closest('[data-task]');
    if (t) return this.onOpenTask?.(t.dataset.task);
    const item = e.target.closest('.rp');
    if (!item) return;
    this.open.has(item.dataset.id) ? this.open.delete(item.dataset.id) : this.open.add(item.dataset.id);
    this.render();
  }
}
