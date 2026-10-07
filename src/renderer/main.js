// Agent Office shell: the pixel office on the left, terminals / board / reports /
// memory / browser on the right. State arrives from the main process every few
// seconds; everything here renders it and sends the owner's actions back.
import { Office } from './office/office.js';
import { SHIRTS } from './office/sprites.js';
import { Panes } from './views/terminal.js';
import { BoardView } from './views/board.js';
import { ReportsView } from './views/reports.js';
import { MemoryView } from './views/memory.js';
import { WatchView } from './views/watch.js';
import { BrowserView } from './views/browser.js';
import { HubView } from './views/hub.js';

const api = window.office;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_TR = { working: 'çalışıyor', idle: 'boşta', waiting: 'seni bekliyor', offline: 'uyuyor', starting: 'başlıyor' };
const TOOL_ICON = { Bash: '⌨', Edit: '✎', Write: '✎', Read: '🔍', Grep: '🔍', Glob: '🔍', WebFetch: '🌐', WebSearch: '🌐', Agent: '🤖' };
const TEAMS = {
  software: { label: 'Yazılım ekibi', roles: ['Lider', 'Frontend Geliştirici', 'Backend Geliştirici', 'QA'] },
  marketing: { label: 'Pazarlama ekibi', roles: ['Lider', 'Pazarlama', 'İçerik Yazarı', 'SEO Uzmanı'] },
  research: { label: 'Araştırma ekibi', roles: ['Lider', 'Araştırmacı', 'Araştırmacı'] },
  product: { label: 'Ürün ekibi', roles: ['Lider', 'Tasarımcı', 'Frontend Geliştirici', 'Backend Geliştirici', 'QA'] },
};

const S = { st: null, ws: null, selected: null, ltab: 'office', rtab: 'terminal', edit: false, prevAct: new Map(), lastSeen: new Map() };
const workerColor = (w) => SHIRTS[(w.seed >>> 0) % SHIRTS.length];

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

// ---- views -------------------------------------------------------------------
const office = new Office($('#office'), {
  onSelect: (id) => select(id),
  onOpen: (id) => openWorkerTerminal(id),
  onLayout: (layout) => { if (S.ws) api.wsUpdate({ id: S.ws.id, layout }); },
  onDesk: (desk) => deskDialog(desk),
});
const panes = new Panes($('#panes'), api, { onFocus: () => {}, onClose: () => {} });
const board = new BoardView($('#rtab-board'), api, { onSelectWorker: select });
const reports = new ReportsView($('#rtab-reports'), { onOpenTask: (id) => { setRTab('board'); board.open = id; board.render(); } });
const memory = new MemoryView($('#rtab-memory'), api);
const watch = new WatchView($('#ltab-code'), api);
const browser = new BrowserView($('#rtab-browser'));
const hub = new HubView($('#rtab-hub'), api, { toast });

// ---- state -------------------------------------------------------------------
function apply(st) {
  S.st = st;
  S.ws = st.active;
  const ws = S.ws;
  const workers = (ws?.workers || []).map((w) => ({ ...w, color: workerColor(w) }));
  $('#noWs').classList.toggle('hidden', !!ws);
  $('#wsName').textContent = ws ? ws.name.toUpperCase() : 'OFİS YOK';
  const active = workers.filter((w) => w.status === 'working' || w.status === 'waiting').length;
  $('#wsActive').textContent = `${active}/${workers.length} active`;
  $('#wsDot').className = `dot ${workers.some((w) => w.status === 'waiting') ? 'warn' : active ? 'on' : ''}`;
  $('#activeCount').textContent = workers.length ? `${active}/${workers.length}` : '';
  $('#taskCount').textContent = (ws?.tasks || []).filter((t) => t.status !== 'done').length || '';
  $('#reportCount').textContent = (ws?.reports || []).length || '';
  const ap = $('#autopilot');
  ap.classList.toggle('on', st.handsOff);
  $('span', ap).textContent = st.handsOff ? 'HANDS-OFF' : 'UYUYOR';

  S.guests = (st.guests || []).map((g) => ({ ...g, guest: true, color: '#9d79d6' }));
  $('#guestCount').textContent = S.guests.length ? `· ${S.guests.length} misafir` : '';
  if (ws) {
    if (S.layoutFor !== ws.id) { office.setLayout(ws.layout); S.layoutFor = ws.id; }
    office.setWorkers(workers, S.guests);
    bubbles(workers);
  } else office.setWorkers([], S.guests);
  panes.setMeta(st.terminals, workers);
  board.set(ws?.tasks || [], workers);
  reports.set(ws?.reports || [], workers);
  memory.setWorkers(workers);
  if (JSON.stringify(st.integrations) !== JSON.stringify(S.integrations)) { S.integrations = st.integrations; hub.setItems(st.integrations || []); }
  const pick = $('#agentPick');
  const cur = pick.value;
  const shells = st.terminals.filter((t) => t.kind === 'shell' && t.exited == null && !panes.has(t.id));
  pick.innerHTML = '<option value="">⚇ agent</option>' + workers.map((w) => `<option value="${w.id}">${esc(w.name)} · ${esc(w.role)}${w.running ? '' : ' (uyuyor)'}</option>`).join('')
    + shells.map((t) => `<option value="term:${t.id}">⌨ ${esc(t.title)} (açık)</option>`).join('');
  pick.value = cur;
  if (S.selected && !workers.some((w) => w.id === S.selected) && !S.guests.some((g) => g.id === S.selected)) S.selected = null;
  renderWorkerCard();
}

// Short speech bubbles when a worker starts a new tool or someone writes to it.
function bubbles(workers) {
  for (const w of workers) {
    const act = w.activity;
    const text = w.status === 'working' && act?.phase === 'tool' ? `${TOOL_ICON[act.tool] || '⚙'} ${act.text.replace(/^[A-Za-z]+:? /, '').slice(0, 34)}` : w.status === 'working' ? '…' : null;
    const prev = S.prevAct.get(w.id);
    if (text && text !== prev && text !== '…') office.say(w.id, text, 5);
    S.prevAct.set(w.id, text);
  }
}

const sel = () => (S.ws?.workers || []).find((w) => w.id === S.selected) || null;
const selGuest = () => (S.guests || []).find((g) => g.id === S.selected) || null;

function select(id) {
  S.selected = id;
  office.select(id);
  renderWorkerCard();
}

function renderGuestCard(g) {
  const card = $('#workerCard'), comp = $('#composer');
  card.classList.remove('hidden'); comp.classList.remove('hidden');
  const act = g.activity;
  const now = g.status === 'waiting' ? `⚠ ${esc(g.waitingFor || 'onay bekliyor')}` : g.status === 'working' ? (act?.phase === 'tool' ? `⌨ ${esc(act.text)}` : '✳ düşünüyor…') : '';
  const html = `<div class="wc-head"><b>✦ ${esc(g.name)}</b><span class="muted">· misafir${g.project ? ` · ${esc(g.project)}` : ''}${g.background ? ' · arka plan' : ''}</span><span class="pill ${g.status}">${STATUS_TR[g.status] || g.status}</span><span class="spacer"></span>
      <button class="link" data-gc="terminal">terminal ›</button><button class="x" data-gc="close">✕</button></div>
    ${now ? `<div class="wc-now">${now}</div>` : ''}
    <div class="wc-body">${g.lastPrompt ? `<span class="muted">son istek:</span> ${esc(g.lastPrompt)}` : '<span class="muted">bu oturum başka bir yerde çalışıyor</span>'}${g.recap ? `<br><span class="muted">özet:</span> ${esc(g.recap)}` : ''}</div>
    <div class="wc-meta"><span title="${esc(g.cwd || '')}">📍 ${esc(g.cwd || '')}</span>${g.model ? `<span>${esc(g.model)}</span>` : ''}${g.ctx ? `<span>ctx ${Math.round(g.ctx / 1000)}k</span>` : ''}</div>
    <div class="wc-acts"><button class="btn small primary" data-gc="adopt" ${S.ws ? '' : 'disabled'}>⚑ Bu ofise dahil et</button><span class="muted">mesaj kutusundan yazarsan kurye ile iletilir</span></div>`;
  if (card.innerHTML !== html) card.innerHTML = html;
  $('#composerText').placeholder = `${g.name} oturumuna mesaj…`;
}

function renderWorkerCard() {
  const w = sel();
  const g = selGuest();
  const card = $('#workerCard'), comp = $('#composer');
  if (g) return renderGuestCard(g);
  if (!w) { card.classList.add('hidden'); comp.classList.add('hidden'); return; }
  card.classList.remove('hidden'); comp.classList.remove('hidden');
  const act = w.activity;
  const now = w.status === 'waiting' ? `⚠ ${esc(w.waitingFor || 'onay bekliyor')} — <a class="link" data-wc="terminal">terminalde yanıtla ›</a>` : w.status === 'working' ? (act?.phase === 'tool' ? `⌨ ${esc(act.text)}` : '✳ düşünüyor…') : '';
  const html = `<div class="wc-head"><b>${esc(w.name)}</b><span class="muted">· ${esc(w.role)}${w.lead ? ' · lider' : ''}</span><span class="pill ${w.status}">${STATUS_TR[w.status]}</span><span class="spacer"></span>
      <button class="link" data-wc="terminal">terminal ›</button><button class="link" data-wc="detail">detay ›</button><button class="x" data-wc="close">✕</button></div>
    ${now ? `<div class="wc-now">${now}</div>` : ''}
    <div class="wc-body">${w.lastAnswer ? esc(w.lastAnswer) : `<span class="muted">${w.running ? 'henüz cevap yok' : 'uyuyor — komut yazınca uyanır'}</span>`}</div>
    <div class="wc-meta"><span>$${(w.cost || 0).toFixed(2)}</span><span>${Math.round((w.tokens || 0) / 1000)}k tok</span><span>${esc(w.model)}</span>${w.branch ? `<span>⎇ ${esc(w.branch)}</span>` : ''}${w.ctx ? `<span>ctx ${Math.round(w.ctx / 1000)}k</span>` : ''}</div>`;
  if (card.innerHTML !== html) card.innerHTML = html;
  $('#composerText').placeholder = `${w.name}'${/[aeıioöuü]$/i.test(w.name) ? 'ya' : 'a'} komut yaz…`;
}

$('#workerCard').addEventListener('click', async (e) => {
  const gact = e.target.closest('[data-gc]')?.dataset.gc;
  const g = selGuest();
  if (gact && g) {
    if (gact === 'close') select(null);
    if (gact === 'terminal') { const r = await api.guestTerminal({ id: g.id }); if (r?.error) toast(r.error, 'err'); }
    if (gact === 'adopt') adoptDialog(g);
    return;
  }
  const act = e.target.closest('[data-wc]')?.dataset.wc;
  const w = sel();
  if (!act || !w) return;
  if (act === 'close') select(null);
  if (act === 'terminal') openWorkerTerminal(w.id);
  if (act === 'detail') workerDialog(w);
});

// ---- composer / commands -----------------------------------------------------
async function sendTo(id, text) {
  const w = (S.ws?.workers || []).find((x) => x.id === id);
  if (!w) return;
  if (!w.running) {
    await startWorker(id);
    toast(`${w.name} uyanıyor, komut birazdan iletilecek…`);
    await new Promise((r) => setTimeout(r, 6000));
  }
  const ok = await api.workerSend({ id, text });
  if (ok === true) office.say(id, '✉ ' + text.slice(0, 30), 4);
  else toast(`${w.name} komutu alamadı`, 'err');
}
const composer = $('#composer'), composerText = $('#composerText');
composer.onsubmit = async (e) => {
  e.preventDefault();
  const text = composerText.value.trim();
  if (!text || !S.selected) return;
  composerText.value = ''; composerText.style.height = '';
  const g = selGuest();
  if (g) { toast(`${g.name} oturumuna iletiliyor…`); const r = await api.guestMessage({ id: g.id, text }); if (r?.ok) { toast('İletildi'); office.say(g.id, '✉ ' + text.slice(0, 30), 4); } else toast(r?.error || `İletilemedi: ${(r?.failed || []).join(', ')}`, 'err'); return; }
  await sendTo(S.selected, text);
};
composerText.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); } };
composerText.oninput = () => { composerText.style.height = ''; composerText.style.height = `${Math.min(120, composerText.scrollHeight)}px`; };

async function startWorker(id) {
  const r = await api.workerStart({ id, cols: 100, rows: 30 });
  if (r?.error) { toast(r.error, 'err'); return null; }
  if (r?.id) panes.meta.set(r.id, r);
  return r;
}
async function openWorkerTerminal(id) {
  const w = (S.ws?.workers || []).find((x) => x.id === id);
  if (!w) return;
  if (!w.running) { const r = await startWorker(id); if (!r) return; }
  setRTab('terminal');
  select(id);
  await panes.open(`w:${id}`);
}
$('#agentPick').onchange = (e) => { const v = e.target.value; e.target.value = ''; if (!v) return; if (v.startsWith('term:')) { setRTab('terminal'); panes.open(v.slice(5)); } else openWorkerTerminal(v); };
$('#addShell').onclick = async () => { const snap = await api.termShell({ cols: 100, rows: 30 }); if (snap?.id) { panes.meta.set(snap.id, snap); panes.open(snap.id); } };
$('#termSize').onclick = (e) => { const s = e.target.dataset.size; if (!s) return; $$('#termSize button').forEach((b) => b.classList.toggle('on', b.dataset.size === s)); panes.setSize(s); };
$('#autopilot').onclick = () => api.handsOff({ on: !S.st?.handsOff });
$('#zoomIn').onclick = () => office.zoom(1);
$('#zoomIn').ondblclick = () => office.fit(true);
$('#zoomOut').onclick = () => office.zoom(-1);

// ---- tabs ----------------------------------------------------------------------
function setLTab(t) {
  S.ltab = t;
  $$('[data-ltab]').forEach((b) => b.classList.toggle('on', b.dataset.ltab === t));
  $('#ltab-office').classList.toggle('hidden', t !== 'office');
  $('#ltab-code').classList.toggle('hidden', t !== 'code');
  if (t === 'code') watch.refresh();
}
function setRTab(t) {
  S.rtab = t;
  $$('[data-rtab]').forEach((b) => b.classList.toggle('on', b.dataset.rtab === t));
  for (const k of ['terminal', 'board', 'reports', 'memory', 'browser', 'hub']) $(`#rtab-${k}`).classList.toggle('hidden', k !== t);
  if (t === 'terminal') { panes.fitAll(); if (panes.focused) panes.focus(panes.focused); }
  if (t === 'memory') { memory.resize(); memory.refresh(); }
  if (t === 'browser') browser.show(); else browser.blur();
}
$('.left-tabs').onclick = (e) => { const t = e.target.closest('[data-ltab]')?.dataset.ltab; if (t) setLTab(t); };
$('.right-tabs').onclick = (e) => { const t = e.target.closest('[data-rtab]')?.dataset.rtab; if (t) setRTab(t); };

// ---- edit mode -----------------------------------------------------------------
$('#editBtn').onclick = () => {
  S.edit = !S.edit;
  office.setEdit(S.edit);
  $('#editBtn').classList.toggle('on', S.edit);
  const bar = $('#editBar');
  bar.classList.toggle('hidden', !S.edit);
  if (S.edit) {
    bar.innerHTML = `<span class="muted">Ekle:</span>${[['desk', 'Masa'], ['plant', 'Bitki'], ['shelf', 'Kitaplık'], ['sofa', 'Kanepe'], ['board', 'Tahta'], ['coffee', 'Kahve'], ['cooler', 'Sebil'], ['rack', 'Sunucu'], ['table', 'Masa (toplantı)'], ['rug', 'Halı']].map(([k, l]) => `<button data-add="${k}">${l}</button>`).join('')}<span class="spacer"></span><button data-floor>Zemin ↻</button>`;
    bar.onclick = (e) => {
      const add = e.target.closest('[data-add]')?.dataset.add;
      if (add) office.addItem(add);
      if (e.target.closest('[data-floor]')) { const r = office.layout.rooms[(S.floorIdx = ((S.floorIdx || 0) + 1) % office.layout.rooms.length)]; office.cycleFloor(r.id); toast(`${r.name}: zemin değişti`); }
    };
  }
};

// ---- dialogs -------------------------------------------------------------------
const dlg = $('#dlg'), dlgBody = $('#dlgBody');
function openDialog(html, onSubmit) {
  dlgBody.innerHTML = html;
  const form = $('form', dlgBody);
  if (form) form.onsubmit = async (e) => { e.preventDefault(); if (e.submitter?.value === 'cancel') return dlg.close(); const fd = new FormData(form); const ok = await onSubmit?.(fd, form); if (ok !== false) dlg.close(); };
  $$('[data-cancel]', dlgBody).forEach((b) => { b.onclick = () => dlg.close(); });
  dlg.showModal();
}
const roleOptions = (cur) => (S.st?.presets.roles || []).map((r) => `<option value="${esc(r.role)}" data-duties="${esc(r.duties)}" ${r.role === cur ? 'selected' : ''}>${esc(r.role)}</option>`).join('') + `<option value="__custom" ${cur && !(S.st?.presets.roles || []).some((r) => r.role === cur) ? 'selected' : ''}>Özel…</option>`;
const modelOptions = (cur = 'sonnet') => (S.st?.presets.models || []).map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m}</option>`).join('');
const permOptions = (cur = 'auto') => [['acceptEdits', 'Dosya düzenler, komutlarda sorar'], ['auto', 'Otomatik (auto)'], ['bypassPermissions', 'Hiç sormaz (riskli)'], ['plan', 'Salt okuma (plan)']].map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
// (auto is the default: the classifier approves routine commands, so a crew keeps moving)

function workerDialog(w = null) {
  openDialog(`<form><h3>${w ? `${esc(w.name)} · detay` : 'Yeni çalışan'}</h3>
    <div class="grid2"><label>Ad <input name="name" value="${esc(w?.name || '')}" placeholder="boşsa otomatik"></label>
      <label>Rol <select name="rolePreset">${roleOptions(w?.role)}</select></label></div>
    <label class="custom-role ${w && !(S.st?.presets.roles || []).some((r) => r.role === w.role) ? '' : 'hidden'}">Rol adı <input name="role" value="${esc(w?.role || '')}"></label>
    <label>Görev tanımı <textarea name="duties" rows="3">${esc(w?.duties || '')}</textarea></label>
    <div class="grid2"><label>Model <select name="model">${modelOptions(w?.model)}</select></label><label>İzinler <select name="permissionMode">${permOptions(w?.permissionMode)}</select></label></div>
    <label class="row"><input type="checkbox" name="lead" ${w?.lead ? 'checked' : ''}> Lider (hedefleri böler ve dağıtır)</label>
    ${w ? '' : '<label class="row"><input type="checkbox" name="start" checked> Hemen başlat</label>'}
    ${w ? `<div class="meta"><span>durum: ${STATUS_TR[w.status]}</span><span>$${(w.cost || 0).toFixed(2)}</span><span>${Math.round((w.tokens || 0) / 1000)}k tok</span></div>
      <div class="row acts"><button type="button" class="btn small" data-w="memory">Hafızasını gör</button>${w.running ? '<button type="button" class="btn small" data-w="stop">Durdur</button>' : '<button type="button" class="btn small" data-w="start">Başlat</button>'}<span class="spacer"></span><button type="button" class="btn small danger" data-w="remove">İşten çıkar</button></div>` : ''}
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Vazgeç</button><button value="save" class="btn primary">${w ? 'Kaydet' : 'İşe al'}</button></div></form>`,
  async (fd, form) => {
    const preset = fd.get('rolePreset');
    const role = preset === '__custom' ? String(fd.get('role')).trim() : preset;
    const presetDuties = $('option:checked', form.rolePreset)?.dataset.duties || '';
    const def = { name: fd.get('name'), role, duties: String(fd.get('duties')).trim() || presetDuties, model: fd.get('model'), permissionMode: fd.get('permissionMode'), lead: !!fd.get('lead') };
    if (w) { await api.workerUpdate({ id: w.id, patch: def }); return; }
    const id = await api.workerCreate(def);
    if (id?.error) { toast(id.error, 'err'); return false; }
    if (fd.get('start')) await startWorker(id);
    toast(`${def.name || 'Yeni çalışan'} işe alındı`);
  });
  const form = $('form', dlgBody);
  form.rolePreset.onchange = () => { const custom = form.rolePreset.value === '__custom'; $('.custom-role', form).classList.toggle('hidden', !custom); if (!custom) form.duties.value = $('option:checked', form.rolePreset).dataset.duties || ''; };
  dlgBody.onclick = async (e) => {
    const act = e.target.closest('[data-w]')?.dataset.w;
    if (!act || !w) return;
    if (act === 'start') { await startWorker(w.id); dlg.close(); }
    if (act === 'stop') { await api.workerStop({ id: w.id }); dlg.close(); }
    if (act === 'remove') { if (confirm(`${w.name} işten çıkarılsın mı? Terminali kapanır, hafıza dosyası kalır.`)) { await api.workerRemove({ id: w.id }); select(null); dlg.close(); } }
    if (act === 'memory') { const text = await api.workerMemory({ id: w.id }); openDialog(`<form><h3>${esc(w.name)} · hafıza</h3><pre class="memo">${esc(text || '(boş)')}</pre><div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Kapat</button></div></form>`); }
  };
}
$('#addWorker').onclick = () => (S.ws ? workerDialog() : wsDialog());

function adoptDialog(g) {
  if (!S.ws) return wsDialog();
  openDialog(`<form><h3>✦ ${esc(g.name)} · ofise dahil et</h3>
    <p class="muted">Oturum bulunduğu yerde durdurulur ve aynı konuşmayla burada, kendi terminalinde devam eder. Pano araçlarını alır.${g.cwd && g.cwd !== S.ws.dir ? ` Kendi klasöründe çalışmaya devam eder: <code>${esc(g.cwd)}</code>` : ''}</p>
    <div class="grid2"><label>Rol <select name="rolePreset">${roleOptions('')}</select></label><label>Model <select name="model">${modelOptions(String(g.model || '').includes('haiku') ? 'haiku' : String(g.model || '').includes('opus') ? 'opus' : 'sonnet')}</select></label></div>
    <label class="custom-role hidden">Rol adı <input name="role"></label>
    <label>Görev tanımı <textarea name="duties" rows="2"></textarea></label>
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Vazgeç</button><button value="save" class="btn primary">Dahil et</button></div></form>`,
  async (fd, form) => {
    const preset = fd.get('rolePreset');
    const role = preset === '__custom' ? String(fd.get('role')).trim() : preset;
    const duties = String(fd.get('duties')).trim() || $('option:checked', form.rolePreset)?.dataset.duties || '';
    const r = await api.guestAdopt({ id: g.id, role, duties, model: fd.get('model') });
    if (r?.error) { toast(r.error, 'err'); return false; }
    if (r) { toast(`${g.name} ofise katıldı`); select(r); setRTab('terminal'); setTimeout(() => panes.open(`w:${r}`), 1500); }
  });
  const form = $('form', dlgBody);
  form.rolePreset.onchange = () => { const custom = form.rolePreset.value === '__custom'; $('.custom-role', form).classList.toggle('hidden', !custom); if (!custom) form.duties.value = $('option:checked', form.rolePreset).dataset.duties || ''; };
  form.rolePreset.onchange();
}

function teamDialog() {
  openDialog(`<form><h3>Takım kur</h3><p class="muted">Şablondaki roller tek seferde işe alınır; ilk rol lider olur.</p>
    <label>Şablon <select name="tpl">${Object.entries(TEAMS).map(([k, v]) => `<option value="${k}">${v.label} — ${v.roles.join(', ')}</option>`).join('')}</select></label>
    <div class="grid2"><label>Model <select name="model">${modelOptions()}</select></label><label>İzinler <select name="permissionMode">${permOptions()}</select></label></div>
    <label class="row"><input type="checkbox" name="start" checked> Hepsini hemen başlat</label>
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Vazgeç</button><button value="save" class="btn primary">Takımı kur</button></div></form>`,
  async (fd) => {
    const tpl = TEAMS[fd.get('tpl')];
    const presets = S.st?.presets.roles || [];
    const ids = [];
    for (const [i, role] of tpl.roles.entries()) {
      const p = presets.find((r) => r.role === role);
      const id = await api.workerCreate({ role, duties: p?.duties || '', model: fd.get('model'), permissionMode: fd.get('permissionMode'), lead: i === 0 });
      if (id && !id.error) ids.push(id);
    }
    if (fd.get('start')) for (const id of ids) await startWorker(id);
    toast(`${tpl.label} kuruldu: ${ids.length} çalışan`);
  });
}
$('#addTeam').onclick = () => (S.ws ? teamDialog() : wsDialog());

function wsDialog() {
  openDialog(`<form><h3>Yeni ofis</h3>
    <label>Ad <input name="name" placeholder="Örn: Ürün HQ"></label>
    <label>Proje klasörü <span class="row"><input name="dir" readonly required placeholder="Çalışanların çalışacağı klasör"><button type="button" class="btn small" data-pick>Seç…</button></span></label>
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Vazgeç</button><button value="save" class="btn primary">Ofisi kur</button></div></form>`,
  async (fd) => { const r = await api.wsCreate({ name: fd.get('name'), dir: fd.get('dir') }); if (r?.error) { toast(r.error, 'err'); return false; } S.layoutFor = null; });
  $('[data-pick]', dlgBody).onclick = async () => { const d = await api.chooseDir(); if (d) { $('input[name=dir]', dlgBody).value = d; if (!$('input[name=name]', dlgBody).value) $('input[name=name]', dlgBody).value = d.split('/').pop(); } };
}
$('#noWsBtn').onclick = wsDialog;

function manageDialog() {
  const ws = S.ws; if (!ws) return wsDialog();
  const rows = ws.workers.map((w) => `<tr><td><input type="radio" name="lead" value="${w.id}" ${ws.lead === w.id ? 'checked' : ''} title="Lider"></td><td><b>${esc(w.name)}</b></td><td>${esc(w.role)}</td><td>${esc(w.model)}</td><td><span class="pill ${w.status}">${STATUS_TR[w.status]}</span></td>
    <td class="acts"><button type="button" class="link" data-m="edit" data-id="${w.id}">düzenle</button>${w.running ? `<button type="button" class="link" data-m="stop" data-id="${w.id}">durdur</button>` : `<button type="button" class="link" data-m="start" data-id="${w.id}">başlat</button>`}</td></tr>`).join('');
  openDialog(`<form><h3>Yönet · ${esc(ws.name)}</h3>
    <div class="grid2"><label>Ofis adı <input name="name" value="${esc(ws.name)}"></label><label>Proje klasörü <input value="${esc(ws.dir)}" readonly></label></div>
    <h4>Çalışanlar <span class="muted">(ilk sütun: lider)</span></h4>
    <table class="tbl"><tbody>${rows || '<tr><td colspan="6" class="muted">Henüz çalışan yok.</td></tr>'}</tbody></table>
    <div class="row acts"><button type="button" class="btn small" data-m="start-all">Hepsini başlat</button><button type="button" class="btn small" data-m="stop-all">Hepsini durdur</button><span class="spacer"></span><button type="button" class="btn small danger" data-m="remove-ws">Ofisi sil</button></div>
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Kapat</button><button value="save" class="btn primary">Kaydet</button></div></form>`,
  async (fd) => { await api.wsUpdate({ id: ws.id, name: fd.get('name'), lead: fd.get('lead') || undefined }); });
  dlgBody.onclick = async (e) => {
    const el = e.target.closest('[data-m]'); if (!el) return;
    const m = el.dataset.m, id = el.dataset.id;
    if (m === 'edit') { const w = ws.workers.find((x) => x.id === id); dlg.close(); workerDialog(w); }
    if (m === 'start') { await startWorker(id); dlg.close(); }
    if (m === 'stop') { await api.workerStop({ id }); dlg.close(); }
    if (m === 'start-all') { for (const w of ws.workers) if (!w.running) await startWorker(w.id); dlg.close(); }
    if (m === 'stop-all') { for (const w of ws.workers) if (w.running) await api.workerStop({ id: w.id }); dlg.close(); }
    if (m === 'remove-ws') { if (confirm(`"${ws.name}" ofisi silinsin mi? Çalışanlar durdurulur; proje klasörüne dokunulmaz.`)) { await api.wsRemove({ id: ws.id }); S.layoutFor = null; dlg.close(); } }
  };
}
$('#manageBtn').onclick = manageDialog;

function deskDialog(desk) {
  const ws = S.ws; if (!ws) return;
  openDialog(`<form><h3>Masa</h3><label>Bu masada kim oturuyor? <select name="worker"><option value="">— boş —</option>${ws.workers.map((w) => `<option value="${w.id}" ${desk.worker === w.id ? 'selected' : ''}>${esc(w.name)} · ${esc(w.role)}</option>`).join('')}</select></label>
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Vazgeç</button><button value="save" class="btn primary">Kaydet</button></div></form>`,
  async (fd) => { office.assignDesk(desk.id, fd.get('worker') || null); });
}

function wsMenu() {
  const list = S.st?.workspaces || [];
  openDialog(`<form><h3>Ofisler</h3><div class="ws-list">${list.map((w) => `<button type="button" class="ws-item ${w.id === S.ws?.id ? 'on' : ''}" data-ws="${w.id}"><b>${esc(w.name)}</b><span class="muted">${esc(w.dir)} · ${w.workers} çalışan</span></button>`).join('') || '<p class="muted">Henüz ofis yok.</p>'}</div>
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Kapat</button><button type="button" class="btn primary" data-new-ws>＋ Yeni ofis</button></div></form>`);
  dlgBody.onclick = async (e) => {
    const id = e.target.closest('[data-ws]')?.dataset.ws;
    if (id) { await api.wsSwitch({ id }); S.layoutFor = null; select(null); dlg.close(); }
    if (e.target.closest('[data-new-ws]')) { dlg.close(); wsDialog(); }
  };
}
$('#wsMenuBtn').onclick = wsMenu;
$('#wsName').onclick = wsMenu;

// ---- resizer -------------------------------------------------------------------
$('#resizer').addEventListener('pointerdown', (e) => {
  const start = e.clientX, w0 = $('#left').getBoundingClientRect().width;
  const move = (ev) => { document.documentElement.style.setProperty('--left', `${Math.max(380, Math.min(window.innerWidth - 420, w0 + ev.clientX - start))}px`); office.fit(); panes.fitAll(); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
});

// ---- wiring --------------------------------------------------------------------
api.on('state', apply);
api.on('message', (m) => { office.say(m.to, `✉ ${m.text.slice(0, 30)}`, 5); });
api.on('report', (t) => { toast(`${t.id} tamamlandı: ${t.title}`); if (S.rtab === 'reports') reports.render(); });
api.on('log', () => {});
document.addEventListener('keydown', (e) => {
  if (dlg.open) return;
  if (e.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { if (S.edit) $('#editBtn').click(); else select(null); }
});
api.state().then((st) => { apply(st); if (!st.active) $('#noWs').classList.remove('hidden'); });

window.__office = { S, office, panes, board, select, openWorkerTerminal, setRTab, setLTab, workerDialog, teamDialog, manageDialog, toast };
