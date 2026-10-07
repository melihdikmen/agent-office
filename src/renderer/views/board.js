// Task board: kanban columns, drag between them, a drawer with details, notes and
// the closing report. The owner adds goals here; the lead splits them.
const COLS = [['backlog', 'Backlog'], ['todo', 'Yapılacak'], ['doing', 'Yapılıyor'], ['review', 'İncelemede'], ['done', 'Bitti']];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (ts) => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 1 ? 'şimdi' : m < 60 ? `${m} dk` : m < 1440 ? `${Math.round(m / 60)} sa` : `${Math.round(m / 1440)} g`; };
const time = (ts) => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export class BoardView {
  constructor(root, api, { onSelectWorker }) {
    this.root = root; this.api = api; this.onSelectWorker = onSelectWorker;
    this.tasks = []; this.workers = []; this.open = null; this.q = '';
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('submit', (e) => this.submit(e));
    root.addEventListener('input', (e) => { if (e.target.id === 'bdq') { this.q = e.target.value; this.renderCols(); } });
  }

  set(tasks, workers) { this.tasks = tasks; this.workers = workers; this.render(); }
  who(id) { return id === 'user' || !id ? 'Sahip' : id === 'office' ? 'Ofis' : this.workers.find((w) => w.id === id)?.name || id; }
  color(id) { return this.workers.find((w) => w.id === id)?.color || '#6b625b'; }

  render() {
    if (!this.root.querySelector('.bd-cols')) {
      this.root.innerHTML = `<div class="bd-head"><h3>Görevler</h3><input id="bdq" type="search" placeholder="ara…" value="${esc(this.q)}"><button class="btn primary" data-new>＋ Görev</button></div>
        <div class="bd-cols"></div><aside class="bd-drawer hidden"></aside>`;
    }
    this.renderCols();
    // state arrives every few seconds; don't wipe a note or a new task the owner is typing
    const a = document.activeElement;
    const typing = a && this.root.querySelector('.bd-drawer')?.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    if (!typing) this.renderDrawer();
  }

  card(t) {
    const a = t.assignee ? this.workers.find((w) => w.id === t.assignee) : null;
    const failed = t.report?.evidence?.filter((e) => !e.ok).length || 0;
    return `<div class="card ${t.status} ${this.open === t.id ? 'sel' : ''}" draggable="true" data-task="${t.id}" style="--c:${a ? a.color : '#4a4039'}">
      <div class="card-top"><span class="tid">${t.id}</span>${t.parent ? `<span class="muted">↳ ${t.parent}</span>` : ''}<span class="age">${t.status === 'done' && t.report ? (failed ? `⚠ ${failed}` : '✓') : ago(t.updated)}</span></div>
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-foot">${a ? `<i style="background:${a.color}"></i>${esc(a.name)}` : '<span class="muted">atanmamış</span>'}${t.notes.length ? `<span class="muted nc">💬 ${t.notes.length}</span>` : ''}</div></div>`;
  }

  renderCols() {
    const box = this.root.querySelector('.bd-cols');
    const q = this.q.trim().toLowerCase();
    const list = this.tasks.filter((t) => !q || `${t.id} ${t.title} ${t.details}`.toLowerCase().includes(q));
    box.innerHTML = COLS.map(([st, label]) => {
      const items = list.filter((t) => t.status === st).sort((a, b) => b.updated - a.updated);
      return `<div class="bd-col" data-st="${st}"><div class="bd-col-head">${label}<span class="count">${items.length || ''}</span></div><div class="bd-col-body">${items.map((t) => this.card(t)).join('') || '<div class="bd-empty">—</div>'}</div></div>`;
    }).join('');
    for (const col of box.querySelectorAll('.bd-col')) {
      col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
      col.ondragleave = () => col.classList.remove('over');
      col.ondrop = async (e) => {
        e.preventDefault(); col.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain');
        const st = col.dataset.st;
        if (st === 'done') await this.api.taskDone({ id, report: { summary: 'Sahip panodan kapattı.' } });
        else await this.api.taskUpdate({ id, patch: { status: st } });
      };
    }
    for (const c of box.querySelectorAll('.card')) c.ondragstart = (e) => e.dataTransfer.setData('text/plain', c.dataset.task);
  }

  renderDrawer() {
    const d = this.root.querySelector('.bd-drawer');
    if (!this.open) { d.classList.add('hidden'); return; }
    d.classList.remove('hidden');
    if (this.open === 'new') {
      const opts = this.workers.map((w) => `<option value="${w.id}">${esc(w.name)} · ${esc(w.role)}</option>`).join('');
      d.innerHTML = `<form data-form="new"><div class="dh"><h3>Yeni görev</h3><button type="button" class="x" data-close>✕</button></div>
        <label>Başlık<input name="title" required autofocus placeholder="Örn: Giriş ekranına şifremi unuttum akışı"></label>
        <label>Ayrıntı / kabul kriterleri<textarea name="details" rows="6"></textarea></label>
        <label>Kime<select name="assignee"><option value="">Lider bölsün (önerilen)</option>${opts}</select></label>
        <p class="muted">Atanmazsa lider alt görevlere böler ve dağıtır. Bir çalışana atarsan görev doğrudan onun terminaline düşer.</p>
        <button class="btn primary">Panoya ekle</button></form>`;
      d.querySelector('input').focus();
      return;
    }
    const t = this.tasks.find((x) => x.id === this.open);
    if (!t) { this.open = null; d.classList.add('hidden'); return; }
    const opts = `<option value="">— atanmamış —</option>` + this.workers.map((w) => `<option value="${w.id}" ${w.id === t.assignee ? 'selected' : ''}>${esc(w.name)} · ${esc(w.role)}</option>`).join('');
    const subs = this.tasks.filter((x) => x.parent === t.id);
    d.innerHTML = `<div class="dh"><span class="tid">${t.id}</span><span class="pill ${t.status}">${COLS.find((c) => c[0] === t.status)?.[1]}</span><span class="spacer"></span><button class="x" data-close>✕</button></div>
      <h3 class="dtitle">${esc(t.title)}</h3>
      <div class="grid2"><label>Durum<select data-field="status">${COLS.map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Atanan<select data-field="assignee">${opts}</select></label></div>
      <div class="meta"><span>${esc(this.who(t.createdBy))} açtı · ${time(t.created)}</span>${t.parent ? `<span>üst görev <a data-open="${t.parent}">${t.parent}</a></span>` : ''}</div>
      ${t.details ? `<h4>Ayrıntı</h4><div class="details">${esc(t.details)}</div>` : ''}
      ${subs.length ? `<h4>Alt görevler</h4><div class="subs">${subs.map((s) => `<a data-open="${s.id}" class="sub ${s.status}"><span class="tid">${s.id}</span> ${esc(s.title)} <span class="pill ${s.status}">${COLS.find((c) => c[0] === s.status)?.[1]}</span></a>`).join('')}</div>` : ''}
      ${t.report ? `<h4>Rapor <span class="muted">${esc(this.who(t.report.by))} · ${time(t.report.ts)}</span></h4><div class="report"><p>${esc(t.report.summary)}</p>
        ${t.report.evidence.length ? `<ul class="evidence">${t.report.evidence.map((e) => `<li class="${e.ok ? 'ok' : 'fail'}"><b>${e.ok ? '✓' : '✗'} ${esc(e.label)}</b>${e.detail ? `<span>${esc(e.detail)}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${t.report.files.length ? `<div class="files">${t.report.files.map((f) => `<code>${esc(f)}</code>`).join('')}</div>` : ''}</div>` : ''}
      <h4>Notlar</h4><div class="notes">${t.notes.map((n) => `<div><b>${esc(this.who(n.by))}</b> <span class="muted">${time(n.ts)}</span><p>${esc(n.text)}</p></div>`).join('') || '<p class="muted">Not yok.</p>'}</div>
      <form data-form="note"><textarea name="note" rows="2" placeholder="Not ekle (çalışana da iletilir)"></textarea><button class="btn small">Ekle</button></form>
      <div class="dfoot"><button class="btn small danger" data-remove="${t.id}">Görevi sil</button></div>`;
    for (const sel of d.querySelectorAll('[data-field]')) sel.onchange = async (e) => {
      const field = e.target.dataset.field;
      if (field === 'status' && e.target.value === 'done') await this.api.taskDone({ id: t.id, report: { summary: 'Sahip kapattı.' } });
      else await this.api.taskUpdate({ id: t.id, patch: { [field]: e.target.value } });
    };
  }

  async click(e) {
    const el = e.target.closest('[data-new],[data-close],[data-task],[data-open],[data-remove]');
    if (!el) return;
    if (el.dataset.new !== undefined) { this.open = 'new'; this.render(); return; }
    if (el.dataset.close !== undefined) { this.open = null; this.render(); return; }
    if (el.dataset.open) { this.open = el.dataset.open; this.render(); return; }
    if (el.dataset.task) { this.open = el.dataset.task; this.render(); return; }
    if (el.dataset.remove) { if (confirm(`${el.dataset.remove} silinsin mi?`)) { await this.api.taskRemove({ id: el.dataset.remove }); this.open = null; } }
  }

  async submit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (e.target.dataset.form === 'new') {
      const r = await this.api.taskCreate({ title: fd.get('title'), details: fd.get('details'), assignee: fd.get('assignee') || null });
      if (r?.error) alert(r.error); else this.open = r;
    } else if (e.target.dataset.form === 'note') {
      const note = String(fd.get('note')).trim();
      if (!note || !this.open) return;
      const t = this.tasks.find((x) => x.id === this.open);
      await this.api.taskUpdate({ id: this.open, patch: { note } });
      if (t?.assignee) await this.api.workerSend({ id: t.assignee, text: `[Pano] ${t.id} için sahipten not: ${note}` });
    }
  }
}
