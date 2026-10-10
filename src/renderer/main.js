// Agent Office shell: the pixel office on the left, terminals / board / reports /
// memory / browser on the right. State arrives from the main process every few
// seconds; everything here renders it and sends the owner's actions back.
import { Office } from './office/office.js';
import { SHIRTS } from './office/sprites.js';
import { Panes } from './views/terminal.js';
import { NotifyView } from './views/notify.js';
import { initI18n, tt } from './i18n.js';
import { startTour } from './views/tour.js';
import { Voice } from './views/voice.js';
import { DecisionsView } from './views/decisions.js';
import { SkillsView } from './views/skills.js';
import { BoardView } from './views/board.js';
import { ReportsView } from './views/reports.js';
import { MemoryView } from './views/memory.js';
import { WatchView } from './views/watch.js';
import { BrowserView } from './views/browser.js';
import { HubView } from './views/hub.js';
import { ChatView } from './views/chat.js';
import { ReviewView } from './views/review.js';
import { EditorPane } from './views/editor.js';
import { DesignView } from './views/design.js';
import { THEMES, applyTheme, currentTheme } from './views/themes.js';
applyTheme();

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

let LANG = 'tr';
try { LANG = localStorage.getItem('ao.lang') === 'en' ? 'en' : 'tr'; } catch { /* storage blocked */ }
initI18n(LANG);

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
  onContext: (id, x, y) => agentMenu(id, x, y),
  onLayout: (layout) => { if (S.ws) api.wsUpdate({ id: S.ws.id, layout }); },
  onDesk: (desk) => deskDialog(desk),
});
const onMic = (id) => toggleVoice(id);
const onPopout = async (id, from) => { const r = await api.popoutOpen({ id }); if (r?.error) return toast(r.error, 'err'); await from.close(id, { kill: false }); };
const moveTerm = async (id, from) => { const to = from === panes ? panes2 : panes; await from.close(id, { kill: false }); to.meta = from.meta; await to.open(id); };
const panes = new Panes($('#panes'), api, { onFocus: () => {}, onClose: () => {}, onMove: moveTerm, onMic, onPopout });
const panes2 = new Panes($('#panes2'), api, { onFocus: () => {}, onClose: () => {}, onMove: moveTerm, onMic, onPopout });   // terminals shown in the office area
const leftTermOpen = () => !$('#leftTerm').classList.contains('hidden');
const openIn = async (id) => { const own = [panes, panes2].find((p) => p.has(id)); if (own) { if (own === panes) setRTab('terminal'); return own.focus(id); } return (leftTermOpen() ? panes2 : panes).open(id); };
const notify = new NotifyView($('#bellBtn'), $('#notifyPanel'), api, { onOpen: (ref) => openRef(ref) });
// Jump to what a notification is about: a task card, or the agent (terminal for one that waits).
async function openRef(ref) {
  if (!ref) return;
  if (ref.wsId && S.ws?.id !== ref.wsId) { await api.wsSwitch({ id: ref.wsId }); S.layoutFor = null; await new Promise((r) => setTimeout(r, 400)); }
  if (ref.type === 'decision') { setRTab('decisions'); setTimeout(() => decisionsView.open(ref.id), 50); }
  else if (ref.type === 'task') { setRTab('board'); board.open = ref.id; board.render(); }
  else if (ref.type === 'worker') { select(ref.id); openWorkerTerminal(ref.id); }
}
const board = new BoardView($('#rtab-board'), api, { onSelectWorker: select, onImport: () => importDialog() });
const reports = new ReportsView($('#rtab-reports'), { api, toast, onOpenTask: (id) => { setRTab('board'); board.open = id; board.render(); } });
const memory = new MemoryView($('#rtab-memory'), api);
const watch = new WatchView($('#ltab-code'), api);
const browser = new BrowserView($('#rtab-browser'), { api, toast, workers: () => S.ws?.workers || [] });
const decisionsView = new DecisionsView($('#rtab-decisions'), api, { toast, onCount: (n) => { $('#decisionCount').textContent = n ? String(n) : ''; $('#decisionCount').classList.toggle('hot', n > 0); } });
const skillsView = new SkillsView($('#rtab-skills'), api, { toast, openDialog: (...a) => openDialog(...a), closeDialog: () => dlg.close(), dlgBody: () => dlgBody });
const chatView = new ChatView($('#rtab-chat'), api, { toast, onUnread: (n) => { $('#chatCount').textContent = n ? String(n) : ''; } });
const review = new ReviewView($('#rtab-review'), api, { toast });
const editor = new EditorPane($('#rtab-editor'), api, { toast, workers: () => S.ws?.workers || [] });
const designView = new DesignView($('#rtab-design'), api, { toast, workers: () => S.ws?.workers || [] });
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

  renderTeamBar(workers);
  const cost = workers.reduce((n, w) => n + (w.cost || 0), 0);
  const waitingN = workers.filter((w) => w.status === 'waiting').length;
  $('#sbWorkers').innerHTML = `<i class="dot ${waitingN ? 'warn' : active ? 'on' : ''}"></i>${active}/${workers.length} çalışıyor${waitingN ? ` · ${waitingN} bekliyor` : ''}`;
  $('#sbCost').textContent = `$${cost.toFixed(2)} toplam`;
  const decN = $('#decisionCount').textContent;
  $('#sbDecisions').textContent = decN ? `⚑ ${decN} karar bekliyor` : '';
  $('#sbDecisions').classList.toggle('warn', !!decN);

  S.guests = (st.guests || []).map((g) => ({ ...g, guest: true, color: '#9d79d6' }));
  $('#guestCount').textContent = S.guests.length ? `· ${S.guests.length} misafir` : '';
  if (ws) {
    if (S.layoutFor !== ws.id) { office.setLayout(ws.layout); S.layoutFor = ws.id; }
    office.setWorkers(workers, S.guests);
    bubbles(workers);
  } else office.setWorkers([], S.guests);
  notify.set(st.notify);
  decisionsView.set(st.decisions, workers);
  skillsView.set(st.skills, workers, st.skillProposals || []);
  $('#skillCount').textContent = (st.skillProposals || []).length || '';
  firstRun(st);
  $('#tabInfo').classList.toggle('has', !!st.app?.update?.newer);
  $('#railDot').className = `rail-dot ${workers.some((w) => w.status === 'waiting') ? 'warn' : workers.some((w) => w.status === 'working') ? 'busy' : ''}`;
  panes.setKey(ws?.id); panes2.setKey(ws?.id ? `${ws.id}.L` : null);
  panes.setMeta(st.terminals, workers); panes2.setMeta(st.terminals, workers);
  board.set(ws?.tasks || [], workers);
  chatView.set(ws?.chat || [], workers);
  designView.set(ws?.designs || []);
  editor.setWorkspace(ws?.id || null);
  reports.set(ws?.reports || [], workers);
  memory.setWorkers(workers);
  if (JSON.stringify(st.integrations) !== JSON.stringify(S.integrations)) { S.integrations = st.integrations; hub.setItems(st.integrations || []); }
  const pick = $('#agentPick');
  const cur = pick.value;
  const shells = st.terminals.filter((t) => t.kind === 'shell' && t.exited == null && !panes.has(t.id) && !panes2.has(t.id));
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

function renderTeamBar(workers) {
  const bar = $('#teamBar');
  const html = workers.map((w) => {
    const act = w.activity;
    const now = w.status === 'waiting' ? (w.waitingFor || 'onay bekliyor') : w.status === 'working' ? (act?.phase === 'tool' ? act.text : 'düşünüyor…') : w.running ? 'boşta' : 'uyuyor';
    return `<button class="chip-w ${w.status} ${S.selected === w.id ? 'sel' : ''}" data-w="${w.id}" title="${esc(w.role)}"><i class="dot ${w.status === 'working' ? 'on' : w.status === 'waiting' ? 'warn' : ''}" style="--c:${w.color}"></i><b>${esc(w.name)}</b><span>${esc(now)}</span></button>`;
  }).join('');
  if (bar.innerHTML !== html) bar.innerHTML = html;
}
$('#teamBar').addEventListener('click', (e) => { const id = e.target.closest('[data-w]')?.dataset.w; if (id) select(id); });

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
// Right-click menu on an agent avatar.
function agentMenu(id, x, y) {
  $('.ctx-menu')?.remove();
  const g = (S.guests || []).find((q) => q.id === id);
  const w = (S.ws?.workers || []).find((q) => q.id === id);
  if (!g && !w) return;
  select(id);
  const items = g
    ? [['▮ Terminalde aç', async () => { const r = await api.guestTerminal({ id }); if (r?.error) toast(r.error, 'err'); }], ['✦ Bu ofise dahil et', () => adoptDialog(g)]]
    : [['😀 Tepki ver: 👍 👏 🎉 ☕', () => office.say(id, '👍 👏 🎉', 4)], ['▮ Terminalini aç', () => openWorkerTerminal(id)], ['ⓘ Detay / ayarlar', () => workerDialog(w)], ...(w.parkedUntil ? [['▶ Limit beklemesini bitir, şimdi devam ettir', () => api.workerUnpark({ id, resume: true })], ['✕ Beklemeyi iptal et (devam ettirme)', () => api.workerUnpark({ id })]] : []), ...(w.running ? [['■ Durdur', () => api.workerStop({ id })]] : [['▶ Başlat', () => startWorker(id)]])];
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  m.innerHTML = `<div class="ctx-title">${esc((g || w).name)}</div>` + items.map(([t], i) => `<button data-i="${i}">${t}</button>`).join('');
  m.style.left = `${Math.min(x, innerWidth - 190)}px`; m.style.top = `${Math.min(y, innerHeight - 40 - items.length * 30)}px`;
  m.onclick = (e) => { const i = e.target.closest('[data-i]')?.dataset.i; if (i == null) return; m.remove(); items[i][1](); };
  m.oncontextmenu = (e) => e.preventDefault();
  document.body.append(m);
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } };
  setTimeout(() => addEventListener('pointerdown', off, true), 0);
}
async function openWorkerTerminal(id) {
  const w = (S.ws?.workers || []).find((x) => x.id === id);
  if (!w) return;
  if (!w.running) { const r = await startWorker(id); if (!r) return; }
  if (!leftTermOpen()) setRTab('terminal');
  select(id);
  await openIn(`w:${id}`);
}
$('#agentPick').onchange = (e) => { const v = e.target.value; e.target.value = ''; if (!v) return; if (v.startsWith('term:')) { if (!leftTermOpen()) setRTab('terminal'); openIn(v.slice(5)); } else openWorkerTerminal(v); };
$('#addShell').onclick = async () => { const snap = await api.termShell({ cols: 100, rows: 30 }); if (snap?.id) { panes.meta.set(snap.id, snap); panes2.meta.set(snap.id, snap); (leftTermOpen() ? panes2 : panes).open(snap.id); } };
$('#termSize').onclick = (e) => { const s = e.target.dataset.size; if (!s) return; $$('#termSize button').forEach((b) => b.classList.toggle('on', b.dataset.size === s)); panes.setSize(s); panes2.setSize(s); };
$('#autopilot').addEventListener('click', () => api.handsOff({ on: !S.st?.handsOff }));
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
  $('#viewTitle').textContent = $(`[data-rtab="${t}"] .nl`)?.textContent || t;
  for (const k of ['chat', 'terminal', 'board', 'design', 'editor', 'review', 'reports', 'memory', 'browser', 'skills', 'decisions', 'hub']) $(`#rtab-${k}`).classList.toggle('hidden', k !== t);
  chatView.show(t === 'chat');
  editor.show(t === 'editor');
  if (t === 'design') designView.show();
  if (t === 'review') review.load();
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
    bar.innerHTML = `<span class="muted">Ekle:</span>${[['desk', 'Masa'], ['plant', 'Bitki'], ['shelf', 'Kitaplık'], ['sofa', 'Kanepe'], ['board', 'Tahta'], ['coffee', 'Kahve'], ['cooler', 'Sebil'], ['rack', 'Sunucu'], ['table', 'Masa (toplantı)'], ['rug', 'Halı']].map(([k, l]) => `<button data-add="${k}">${l}</button>`).join('')}<span class="spacer"></span><button data-floor>Zemin ↻</button> <button class="btn small" data-theme title="Tüm odalara hazır bir görünüm uygula (varsayılan, sıcak, serin, koyu, pastel)">🎨 Tema</button>`;
    bar.onclick = (e) => {
      const add = e.target.closest('[data-add]')?.dataset.add;
      if (add) office.addItem(add);
      if (e.target.closest('[data-theme]')) { const names = ['varsayilan', 'sicak', 'serin', 'koyu', 'pastel']; S.themeIdx = ((S.themeIdx ?? -1) + 1) % names.length; office.applyTheme(names[S.themeIdx]); toast(`${tt('Tema', 'Theme')}: ${names[S.themeIdx]}`); }
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
const engineOptions = (cur = 'claude') => Object.entries(S.st?.presets.engines || { claude: { label: 'Claude Code', installed: true } }).map(([k, e]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(e.label)}${e.installed ? '' : ' (kurulu değil)'}</option>`).join('');
// Claude picks a model alias from a list; Codex and Gemini take any model name (empty = the CLI default).
const modelField = (engine, cur) => {
  const e = S.st?.presets.engines?.[engine];
  if (engine === 'claude' || !e) return `<select name="model">${modelOptions(cur)}</select>`;
  return `<input name="model" value="${esc(cur && !(S.st?.presets.models || []).includes(cur) ? cur : '')}" placeholder="${esc(e.hint)}">`;
};
const modelOptions = (cur = 'sonnet') => (S.st?.presets.models || []).map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m}</option>`).join('');
const permOptions = (cur = 'auto') => [['acceptEdits', 'Dosya düzenler, komutlarda sorar'], ['auto', 'Otomatik (auto)'], ['bypassPermissions', 'Hiç sormaz (riskli)'], ['plan', 'Salt okuma (plan)']].map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
// (auto is the default: the classifier approves routine commands, so a crew keeps moving)

function workerDialog(w = null) {
  openDialog(`<form><h3>${w ? `${esc(w.name)} · detay` : 'Yeni çalışan'}</h3>
    <div class="grid2"><label>Ad <input name="name" value="${esc(w?.name || '')}" placeholder="boşsa otomatik"></label>
      <label>Rol <select name="rolePreset">${roleOptions(w?.role)}</select></label></div>
    <label class="custom-role ${w && !(S.st?.presets.roles || []).some((r) => r.role === w.role) ? '' : 'hidden'}">Rol adı <input name="role" value="${esc(w?.role || '')}"></label>
    <label>Görev tanımı <textarea name="duties" rows="3">${esc(w?.duties || '')}</textarea></label>
    <div class="grid2"><label>Motor <select name="engine">${engineOptions(w?.engine)}</select></label><label>İzinler <select name="permissionMode">${permOptions(w?.permissionMode)}</select></label></div>
    <label>Model <span class="model-slot">${modelField(w?.engine || 'claude', w?.model)}</span></label>
    <label>Bütçe (USD, her başlatmada; boş = sınırsız) <input name="budget" type="number" min="0" step="0.5" value="${w?.budget || ''}" placeholder="örn. 5"></label>
    <label class="row"><input type="checkbox" name="worktree" ${w?.worktree ? 'checked' : ''}> Kendi git worktree'sinde çalış (izole dal, diğer ajanlarla çakışmaz)</label>
    ${w?.worktree ? '<div class="wt-box" id="wtBox"><span class="muted">worktree durumu okunuyor…</span></div>' : ''}
    <details class="adv" ${w?.extraArgs || w?.command ? 'open' : ''}><summary>Gelişmiş (Codex / Gemini)</summary>
      <label>Komut yolu <input name="command" value="${esc(w?.command || '')}" placeholder="boşsa PATH'te aranır"></label>
      <label>Ek argümanlar <input name="extraArgs" value="${esc(w?.extraArgs || '')}" placeholder="örn. --search"></label></details>
    <label class="row"><input type="checkbox" name="lead" ${w?.lead ? 'checked' : ''}> Lider (hedefleri böler ve dağıtır)</label>
    ${w ? '' : '<label class="row"><input type="checkbox" name="start" checked> Hemen başlat</label>'}
    ${w ? `<div class="meta"><span>durum: ${STATUS_TR[w.status]}</span><span>$${(w.cost || 0).toFixed(2)}</span><span>${Math.round((w.tokens || 0) / 1000)}k tok</span></div>
      <div class="row acts"><button type="button" class="btn small" data-w="memory">Hafızasını gör</button><button type="button" class="btn small" data-w="look" title="Karakterin görünümünü yeniden rastgele seç">🎲 Görünümü değiştir</button>${w.running ? '<button type="button" class="btn small" data-w="stop">Durdur</button>' : '<button type="button" class="btn small" data-w="start">Başlat</button>'}<span class="spacer"></span><button type="button" class="btn small danger" data-w="remove">İşten çıkar</button></div>` : ''}
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Vazgeç</button><button value="save" class="btn primary">${w ? 'Kaydet' : 'İşe al'}</button></div></form>`,
  async (fd, form) => {
    const preset = fd.get('rolePreset');
    const role = preset === '__custom' ? String(fd.get('role')).trim() : preset;
    const presetDuties = $('option:checked', form.rolePreset)?.dataset.duties || '';
    const def = { name: fd.get('name'), role, duties: String(fd.get('duties')).trim() || presetDuties, model: fd.get('model'), engine: fd.get('engine'), command: fd.get('command'), extraArgs: fd.get('extraArgs'), worktree: !!fd.get('worktree'), budget: fd.get('budget'), permissionMode: fd.get('permissionMode'), lead: !!fd.get('lead') };
    if (w) { await api.workerUpdate({ id: w.id, patch: def }); return; }
    const id = await api.workerCreate(def);
    if (id?.error) { toast(id.error, 'err'); return false; }
    if (fd.get('start')) await startWorker(id);
    toast(`${def.name || 'Yeni çalışan'} işe alındı`);
  });
  const form = $('form', dlgBody);
  if (w?.worktree) loadWorktree(w);
  form.engine.onchange = () => { $('.model-slot', form).innerHTML = modelField(form.engine.value, ''); };
  form.rolePreset.onchange = () => { const custom = form.rolePreset.value === '__custom'; $('.custom-role', form).classList.toggle('hidden', !custom); if (!custom) form.duties.value = $('option:checked', form.rolePreset).dataset.duties || ''; };
  dlgBody.onclick = async (e) => {
    const act = e.target.closest('[data-w]')?.dataset.w;
    if (!act || !w) return;
    if (act === 'start') { await startWorker(w.id); dlg.close(); }
    if (act === 'stop') { await api.workerStop({ id: w.id }); dlg.close(); }
    if (act === 'look') { await api.workerUpdate({ id: w.id, patch: { reroll: true } }); toast(tt('Yeni görünüm', 'New look')); }
    if (act === 'pr') { r = await api.prOpen({ id: w.id }); if (r?.url) { toast(`PR açıldı: ${r.url}`); api.openUrl({ url: r.url }); } }
    if (act === 'remove') { if (confirm(`${w.name} işten çıkarılsın mı? Terminali kapanır, hafıza dosyası kalır.`)) { await api.workerRemove({ id: w.id }); select(null); dlg.close(); } }
    if (act === 'memory') { const text = await api.workerMemory({ id: w.id }); openDialog(`<form><h3>${esc(w.name)} · hafıza</h3><pre class="memo">${esc(text || '(boş)')}</pre><div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>Kapat</button></div></form>`); }
  };
}
// Review panel for a worker's worktree: what changed on its branch, commit it, merge it into the base.
async function loadWorktree(w) {
  const box = $('#wtBox');
  if (!box) return;
  const st = await api.worktreeStatus({ id: w.id });
  if (st?.error) { box.innerHTML = `<span class="muted">${esc(st.error)}</span>`; return; }
  if (!st.exists) { box.innerHTML = '<span class="muted">Worktree, çalışan ilk başladığında açılır.</span>'; return; }
  box.innerHTML = `<div class="wt-head"><b>⎇ ${esc(st.branch)}</b> <span class="muted">← ${esc(st.base)} · ${st.ahead} commit önde${st.behind ? `, ${st.behind} geride` : ''}</span></div>
    ${st.stat ? `<div class="muted">${esc(st.stat)}</div>` : ''}
    ${st.dirty.length ? `<div class="wt-warn">${st.dirty.length} commitlenmemiş değişiklik</div>` : ''}
    ${st.commits.length ? `<ul class="wt-commits">${st.commits.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<div class="muted">Henüz commit yok.</div>'}
    <div class="row acts"><button type="button" class="btn small" data-wt="commit" ${st.dirty.length ? '' : 'disabled'}>Commit'le</button>
      <button type="button" class="btn small primary" data-wt="merge" ${st.ahead && !st.dirty.length ? '' : 'disabled'}>${esc(st.base)} dalına birleştir</button>
      <button type="button" class="btn small" data-wt="pr" ${st.ahead && !st.dirty.length ? '' : 'disabled'} title="Dalı GitHub'a gönderip pull request açar (gh gerekir)">PR aç</button>
      <button type="button" class="btn small" data-wt="remove">Worktree'yi sil</button></div>`;
  box.onclick = async (e) => {
    const act = e.target.closest('[data-wt]')?.dataset.wt;
    if (!act) return;
    let r;
    if (act === 'commit') r = await api.worktreeCommit({ id: w.id, message: `office: ${w.name} çalışması` });
    if (act === 'merge') r = await api.worktreeMerge({ id: w.id });
    if (act === 'remove') { if (!confirm(`${w.name} için worktree silinsin mi? Dal ve commitler kalır (birleştirilmemişse sonra kurtarılabilir).`)) return; r = await api.worktreeRemove({ id: w.id }); }
    if (r?.error) toast(r.error, 'err');
    else { if (act === 'merge') toast(r.merged ? `${r.commits} commit birleştirildi` : r.reason); if (act === 'remove') { dlg.close(); return; } loadWorktree(w); }
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

// ---- swap the 3D office area for the terminals ------------------------------------
function swapTerminals(toOffice) {
  $('#leftTerm').classList.toggle('hidden', !toOffice);
  $('#officeWrap').classList.toggle('hidden', toOffice);
  $('#swapBtn').classList.toggle('on', toOffice);
  $('#swapBtn').textContent = toOffice ? '◫ 3B Ofis' : '▮ Terminal';
  if (toOffice) setLTab('office'); else setTimeout(() => office.fit(true), 0);
  try { localStorage.setItem('ao.termInOffice', toOffice ? '1' : ''); } catch { /* storage unavailable */ }
  panes2.fitAll(); panes.fitAll();
}
$('#swapBtn').onclick = () => swapTerminals(!leftTermOpen());
try { if (localStorage.getItem('ao.termInOffice')) swapTerminals(true); } catch { /* storage unavailable */ }

// ---- import tasks: GitHub / Linear / Jira issues or a pasted list ----------------------------
async function importDialog() {
  if (!S.ws) return wsDialog();
  const SRC = [['gh', 'GitHub'], ['linear', 'Linear'], ['jira', 'Jira'], ['list', tt('Liste yapıştır', 'Paste a list')]];
  openDialog(`<form><h3>⬇ ${tt('Görevleri içe aktar', 'Import tasks')}</h3>
    <div class="seg" id="impTabs">${SRC.map(([k, l], i) => `<button type="button" data-t="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>
    <div id="impBody"><div class="muted">${tt('Yükleniyor…', 'Loading…')}</div></div>
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>${tt('Vazgeç', 'Cancel')}</button><button type="button" class="btn primary" id="impGo">${tt('İçe aktar', 'Import')}</button></div></form>`);
  let mode = 'gh', items = [];
  const body = $('#impBody');
  const list = (rows) => { items = rows; body.innerHTML = rows.length ? `<div class="imp-list">${rows.map((i, n) => `<label class="row"><input type="checkbox" data-i="${n}" checked> <b>${esc(i.key)}</b> ${esc(i.title)} ${i.status ? `<span class="chip">${esc(i.status)}</span>` : ''}</label>`).join('')}</div>` : `<div class="muted">${tt('Aktarılacak açık iş yok.', 'No open items.')}</div>`; };
  const fail = (m) => { body.innerHTML = `<div class="wt-warn">${esc(m)}</div>`; };
  async function show(t) {
    mode = t; items = [];
    $$('#impTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    body.innerHTML = `<div class="muted">${tt('Yükleniyor…', 'Loading…')}</div>`;
    if (t === 'list') { body.innerHTML = `<label>${tt('Her satır bir görev (madde işaretleri ve numaralar atılır)', 'One task per line (bullets and numbers are stripped)')}<textarea name="list" rows="8" placeholder="- [ ] Giriş ekranı&#10;- Şifre sıfırlama"></textarea></label>`; return; }
    if (t === 'gh') { const r = await api.issuesList(); return r?.error ? fail(r.error) : list(r.items.map((i) => ({ key: `#${i.number}`, title: i.title, status: i.labels[0] || '', details: `${i.body}\n\n${i.url}` }))); }
    const st = await api.trackerStatus();
    const has = t === 'linear' ? st.linear : !!st.jira;
    if (!has) {
      body.innerHTML = `<p class="muted">${t === 'linear' ? tt('Linear → Settings → API → Personal API keys.', 'Linear → Settings → API → Personal API keys.') : tt('id.atlassian.com → Security → API tokens.', 'id.atlassian.com → Security → API tokens.')} ${tt('Anahtar sistem anahtar zincirinde şifreli saklanır.', 'The key is stored encrypted in the system keychain.')}</p>
        ${t === 'jira' ? `<div class="grid2"><label>${tt('Site', 'Site')} <input name="site" placeholder="sirket.atlassian.net"></label><label>E-posta <input name="email" type="email"></label></div>` : ''}
        <label>${t === 'linear' ? 'API key' : 'API token'} <input name="secret" type="password" autocomplete="off"></label><button type="button" class="btn small primary" id="impConnect">${tt('Bağlan', 'Connect')}</button>`;
      $('#impConnect').onclick = async () => {
        const r = await api.trackerSave({ kind: t, site: $('input[name=site]')?.value, email: $('input[name=email]')?.value, secret: $('input[name=secret]').value });
        if (r?.error) return toast(r.error, 'err');
        show(t);
      };
      return;
    }
    const r = await api.trackerIssues({ kind: t });
    if (r?.error) { fail(r.error); body.insertAdjacentHTML('beforeend', `<button type="button" class="btn small" id="impForget">${tt('Hesabı unut', 'Forget account')}</button>`); $('#impForget').onclick = async () => { await api.trackerForget({ kind: t }); show(t); }; return; }
    list(r.items.map((i) => ({ key: i.key, title: i.title, status: i.status, details: `${i.body}\n\n${i.url}` })));
  }
  $('#impTabs').onclick = (e) => { const t = e.target.dataset.t; if (t) show(t); };
  $('#impGo').onclick = async () => {
    let picked;
    if (mode === 'list') picked = (await api.parseList({ text: $('textarea[name=list]').value })).items.map((title) => ({ title }));
    else picked = $$('#impBody [data-i]:checked').map((c) => { const i = items[c.dataset.i]; return { title: `${i.key} ${i.title}`, details: i.details }; });
    if (!picked.length) return toast(tt('Seçili bir şey yok.', 'Nothing selected.'), 'err');
    const res = await api.tasksImport({ items: picked });
    dlg.close(); toast(tt(`${res.count} görev eklendi`, `${res.count} tasks added`));
  };
  show('gh');
}

// ---- voice input: speak, the text is typed into the terminal (Enter stays with you) -----------
const voiceHud = document.createElement('div');
voiceHud.className = 'voice-hud hidden';
document.body.append(voiceHud);
const owner = (id) => [panes, panes2].find((p) => p.has(id));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const voice = new Voice({
  transcribe: async (wav) => { const r = await api.sttTranscribe({ wav, lang: LANG }); if (r?.error) throw new Error(r.error); return r.text; },
  onState(state, info = {}) {
    const t = voice.target;
    if (state === 'recording') {
      owner(t)?.setRecording(t, true);
      voiceHud.classList.remove('hidden');
      voiceHud.innerHTML = `<i class="v-dot"></i><span>${info.heard ? tt('Dinliyorum…', 'Listening…') : tt('Konuş…', 'Speak…')} ${clock(info.secs || 0)}</span><b class="v-bar"><u style="width:${Math.round((info.level || 0) * 100)}%"></u></b><small>${tt('Bitirmek için 🎤 · iptal: Esc', 'Click 🎤 to finish · Esc cancels')}</small>`;
      return;
    }
    owner(t)?.setRecording(t, false);
    if (state === 'processing') { voiceHud.classList.remove('hidden'); voiceHud.innerHTML = `<i class="v-dot busy"></i><span>${tt('Yazıya çevriliyor…', 'Transcribing…')}</span>`; return; }
    voiceHud.classList.add('hidden');
    if (state === 'done') { api.termPaste({ id: info.target, text: info.text }); owner(info.target)?.focus(info.target); }
    if (state === 'empty') toast(tt('Ses algılanamadı.', 'No speech detected.'));
    if (state === 'error') toast(info.message, 'err');
  },
});
const focusedTerm = () => { const p = [panes, panes2].find((x) => x.focused && x.has(x.focused) && x.root.offsetParent); return p?.focused || null; };
async function toggleVoice(id = focusedTerm()) {
  if (voice.state === 'recording') return voice.stop();
  if (voice.state !== 'idle') return;
  if (!id) return toast(tt('Önce bir terminal aç ya da seç.', 'Open or select a terminal first.'));
  const st = await api.sttStatus();
  if (!st.ready) return sttSetupDialog(st);
  if (!(await api.micAccess())) return toast(tt('Mikrofon izni yok: Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon', 'No microphone access: System Settings → Privacy & Security → Microphone'), 'err');
  voice.start(id);
}
function sttSetupDialog(st) {
  openDialog(`<form><h3>🎤 ${tt('Sesli komut kurulumu', 'Voice input setup')}</h3>
    <p class="muted">${tt('Konuşman bu Mac\'te, internet olmadan yazıya çevrilir (whisper.cpp). Bir kez kurulur:', 'Your speech is transcribed on this Mac, offline (whisper.cpp). One-time setup:')}</p>
    <ul class="stt-list"><li>${st.bin ? '✓' : '○'} whisper-cpp ${st.bin ? '' : tt('(Homebrew ile kurulur)', '(installed with Homebrew)')}</li><li>${st.model ? '✓' : '○'} ${tt('Dil modeli', 'Language model')} ${esc(st.modelName)} ${st.model ? '' : tt('(~180 MB indirilir)', '(~180 MB download)')}</li></ul>
    ${!st.bin && !st.brew ? `<p class="wt-warn">${tt('Homebrew bulunamadı; önce brew.sh adresinden kur.', 'Homebrew not found; install it from brew.sh first.')}</p>` : ''}
    <div id="sttProgress" class="muted"></div><div class="stt-bar hidden"><u></u></div>
    <div class="dlg-actions"><button value="cancel" class="btn" formnovalidate>${tt('Vazgeç', 'Cancel')}</button><button type="button" class="btn primary" data-s="install" ${!st.bin && !st.brew ? 'disabled' : ''}>${tt('Kur', 'Install')}</button></div></form>`);
  const off = api.on('stt-progress', ({ text, pct }) => { $('#sttProgress').textContent = text; const bar = $('.stt-bar'); bar.classList.toggle('hidden', pct == null); if (pct != null) $('u', bar).style.width = `${Math.round(pct * 100)}%`; });
  dlg.addEventListener('close', off, { once: true });
  dlgBody.onclick = async (e) => {
    if (!e.target.closest('[data-s=install]')) return;
    e.target.disabled = true;
    const r = await api.sttSetup({});
    if (r?.error) { $('#sttProgress').textContent = r.error; e.target.disabled = false; return; }
    dlg.close(); toast(tt('Sesli komut hazır: 🎤 düğmesine bas ve konuş.', 'Voice input is ready: click 🎤 and speak.'));
  };
}
$('#micBtn').onclick = () => toggleVoice();
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); e.stopPropagation(); toggleVoice(); }
  else if (e.key === 'Escape' && voice.state === 'recording') { e.preventDefault(); e.stopPropagation(); voice.cancel(); }
}, true);

// ---- about / what's new / updates / language / tour -----------------------------------
let firstRunDone = false;
function firstRun(st) {
  if (firstRunDone || !st.app) return;
  firstRunDone = true;
  if (st.app.lang !== LANG) { try { localStorage.setItem('ao.lang', st.app.lang); } catch { /* storage blocked */ } if (st.app.lang !== LANG) { location.reload(); return; } }
  if (!st.app.tourDone && !st.app.lastSeen) setTimeout(() => startTour((done) => api.appAck({ tour: true })), 1200);
  else if (st.app.lastSeen !== st.app.version) setTimeout(() => { aboutDialog(); api.appAck({}); }, 800);
}
function aboutDialog() {
  const a = S.st?.app;
  if (!a) return;
  const u = a.update;
  const log = a.changelog.map((c) => `<h5>v${esc(c.version)} · ${esc(c.date)}</h5><ul>${(LANG === 'en' && c.en ? c.en : c.items).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('');
  openDialog(`<form><h3>Agent Office</h3>
    <div class="about-ver"><b>v${esc(a.version)}</b><span class="spacer"></span>
      <label class="row">${tt('Dil', 'Language')} <select name="uilang"><option value="tr" ${LANG === 'tr' ? 'selected' : ''}>Türkçe</option><option value="en" ${LANG === 'en' ? 'selected' : ''}>English</option></select></label></div>
    <b>${tt('Tema', 'Theme')}</b><div class="theme-row">${Object.entries(THEMES).map(([k, t]) => `<button type="button" class="theme-chip ${currentTheme() === k ? 'on' : ''}" data-theme-pick="${k}"><i style="background:${t.vars.bg || '#10131f'};border-color:${t.vars.accent || '#8d9bff'}"></i>${t.name}</button>`).join('')}</div>
    <div class="upd ${u?.newer ? 'new' : ''}"><div>${u ? (u.newer ? `<b>${tt('Yeni sürüm', 'New version')} v${esc(u.version)}</b>${u.notes ? ` — ${esc(u.notes.slice(0, 160))}` : ''}` : tt('Güncelsin.', 'You are up to date.')) : tt('Güncelleme adresi girilmemiş.', 'No update address set.')}</div>
      <div class="row"><input name="feed" value="${esc(a.updateFeed)}" placeholder="${tt('Güncelleme adresi (JSON ya da GitHub releases/latest)', 'Update feed (JSON or GitHub releases/latest)')}">
      <button type="button" class="btn small" data-a="check">${tt('Denetle', 'Check')}</button>${u?.newer && u.url ? `<button type="button" class="btn small primary" data-a="download">${tt('İndir', 'Download')}</button>` : ''}</div></div>
    <div class="row"><button type="button" class="btn small" data-a="doctor">🩺 ${tt('Sistem kontrolü', 'System check')}</button><button type="button" class="btn small" data-a="backup">💾 ${tt('Yedek al', 'Back up')}</button><span class="muted">${tt('Her gün otomatik yedek de alınır (son 7).', 'A daily backup is kept automatically (last 7).')}</span></div>
    <div id="doctorOut" class="doc-out"></div>
    <b>${tt('Yenilikler', 'What\'s new')}</b><div class="about-log">${log}</div>
    <div class="dlg-actions"><button type="button" class="btn" data-a="tour">${tt('Turu başlat', 'Start the tour')}</button><span class="spacer"></span><button value="cancel" class="btn" formnovalidate>${tt('Kapat', 'Close')}</button></div></form>`);
  const form = $('form', dlgBody);
  form.uilang.onchange = async () => { await api.appAck({ lang: form.uilang.value }); try { localStorage.setItem('ao.lang', form.uilang.value); } catch { /* storage blocked */ } location.reload(); };
  dlgBody.onclick = async (e) => {
    const tp = e.target.closest('[data-theme-pick]')?.dataset.themePick;
    if (tp) { applyTheme(tp); dlgBody.querySelectorAll('[data-theme-pick]').forEach((b) => b.classList.toggle('on', b.dataset.themePick === tp)); return; }
    const act = e.target.closest('[data-a]')?.dataset.a;
    if (act === 'check') { const r = await api.updateCheck({ feed: form.feed.value }); if (r?.error) toast(r.error, 'err'); else { dlg.close(); setTimeout(aboutDialog, 100); } }
    if (act === 'download') api.openUrl({ url: u.url });
    if (act === 'doctor') {
      const out = $('#doctorOut'); out.textContent = tt('Kontrol ediliyor…', 'Checking…');
      const items = await api.doctor();
      out.innerHTML = items.map((i) => `<div class="doc-i ${i.ok ? 'ok' : 'no'}"><b>${i.ok ? '✓' : '○'} ${esc(i.label)}</b> <span class="muted">${esc(i.detail)}</span>${!i.ok && i.fix ? ` <code>${esc(i.fix)}</code>` : ''}</div>`).join('');
    }
    if (act === 'backup') { const r = await api.backupExport(); if (r?.error) toast(r.error, 'err'); else if (r?.file) toast(tt('Yedek hazır: ', 'Backup saved: ') + r.file); }
    if (act === 'tour') { dlg.close(); setTimeout(() => startTour(() => api.appAck({ tour: true })), 250); }
  };
}
$('#tabInfo').onclick = aboutDialog;
api.on('update', (r) => toast(tt(`Yeni sürüm v${r.version} var — ⓘ düğmesinden indir`, `New version v${r.version} available — download it from the ⓘ button`)));

document.addEventListener('keydown', (e) => {                      // ⌘⇧↵: focused terminal fills the whole window
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key !== 'Enter') return;
  const p = Panes.full?.owner || [panes, panes2].find((x) => x.focused && x.has(x.focused) && x.root.offsetParent);
  if (p?.focused) { e.preventDefault(); e.stopPropagation(); p.toggleFull(Panes.full?.id || p.focused); }
}, true);

// ---- show / hide the office column ---------------------------------------------
function setOfficeHidden(hide) {
  document.querySelector('.app').classList.toggle('no-left', hide);
  try { localStorage.setItem('ao.officeHidden', hide ? '1' : ''); } catch { /* storage unavailable */ }
  if (!hide) setTimeout(() => office.fit(), 0);
  panes.fitAll(); panes2.fitAll();
}
const toggleOffice = () => setOfficeHidden(!document.querySelector('.app').classList.contains('no-left'));
$('#tabCollapse').onclick = toggleOffice;
$('#officeRail').onclick = toggleOffice;
$('#tabAddWorker').onclick = () => (S.ws ? workerDialog() : wsDialog());
$('#tabSwap').onclick = () => swapTerminals(!leftTermOpen());
$('#tabNewShell').onclick = () => $('#addShell').click();
$('#tabSplit').onclick = () => { const p = [panes, panes2].find((x) => x.focused && x.has(x.focused)) || (leftTermOpen() ? panes2 : panes); if (p.focused) p.splitFrom(p.focused, 'row'); else $('#addShell').click(); };
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleOffice(); } });
try { if (localStorage.getItem('ao.officeHidden')) setOfficeHidden(true); } catch { /* storage unavailable */ }

// ---- resizer -------------------------------------------------------------------
$('#resizer').addEventListener('pointerdown', (e) => {
  const start = e.clientX, w0 = $('#left').getBoundingClientRect().width;
  const move = (ev) => { document.documentElement.style.setProperty('--left', `${Math.max(380, Math.min(window.innerWidth - 420, w0 + ev.clientX - start))}px`); office.fit(); panes.fitAll(); panes2.fitAll(); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
});

// ---- wiring --------------------------------------------------------------------
api.on('state', apply);
api.on('message', (m) => { office.say(m.to, `✉ ${m.text.slice(0, 30)}`, 5); });
api.on('report', () => { if (S.rtab === 'reports') reports.render(); });
api.on('notify', (n) => toast(`${n.title} — ${n.subtitle}\n${n.body.split('\n')[0]}`, n.warn ? 'err' : ''));
api.on('notify-open', (ref) => openRef(ref));
api.on('log', () => {});
document.addEventListener('keydown', (e) => {
  if (dlg.open) return;
  if (e.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { if (S.edit) $('#editBtn').click(); else select(null); }
});
api.state().then((st) => { apply(st); if (!st.active) $('#noWs').classList.remove('hidden'); });

window.__applyTheme = applyTheme;
window.__office = { S, office, panes, panes2, board, select, openWorkerTerminal, setRTab, setLTab, review, editor, designView, browser, workerDialog, teamDialog, manageDialog, toast };

// ---- command palette (⌘K) ------------------------------------------------------
const palette = (() => {
  const el = document.createElement('div');
  el.className = 'palette hidden';
  el.innerHTML = '<div class="pal-box"><input id="palInput" placeholder="Ne yapmak istiyorsun? Çalışan, görünüm ya da işlem yaz…" autocomplete="off"><div id="palList" class="pal-list"></div></div>';
  document.body.appendChild(el);
  const input = el.querySelector('#palInput'), list = el.querySelector('#palList');
  let items = [], idx = 0;
  const all = () => {
    const ws = S.ws?.workers || [];
    return [
      ...[['office', 'Ofis'], ['code', 'Kod']].map(([k, n]) => ({ g: 'Görünüm', n: `${n} görünümü`, run: () => setLTab(k) })),
      ...[['chat', 'Sohbet'], ['terminal', 'Terminal'], ['board', 'Görevler'], ['design', 'Tasarım'], ['editor', 'Editör'], ['review', 'İnceleme'], ['reports', 'Raporlar'], ['memory', 'Hafıza'], ['browser', 'Tarayıcı'], ['skills', 'Beceriler'], ['decisions', 'Kararlar'], ['hub', 'Hub']].map(([k, n]) => ({ g: 'Görünüm', n: `${n} görünümü`, run: () => setRTab(k) })),
      ...ws.flatMap((w) => [{ g: 'Çalışan', n: `${w.name} · ${w.role} — seç`, run: () => { setLTab('office'); select(w.id); } }, { g: 'Çalışan', n: `${w.name} — terminalini aç`, run: () => openWorkerTerminal(w.id) }]),
      ...Object.entries(THEMES).map(([k, t]) => ({ g: 'Tema', n: `${t.name} temasına geç`, run: () => applyTheme(k) })),
      { g: 'İşlem', n: 'Çalışan ekle', run: () => (S.ws ? workerDialog() : wsDialog()) },
      { g: 'İşlem', n: 'Takım ekle', run: () => (S.ws ? teamDialog() : wsDialog()) },
      { g: 'İşlem', n: 'Yeni shell terminali', run: () => $('#addShell').click() },
      { g: 'İşlem', n: 'Hands-off aç / kapat', run: () => $('#autopilot').click() },
      { g: 'İşlem', n: 'Ofisi gizle / göster', run: () => toggleOffice() },
      { g: 'İşlem', n: 'Hakkında, yenilikler, sistem kontrolü', run: () => $('#tabInfo').click() },
    ];
  };
  const norm = (t) => t.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const draw = () => {
    const q = norm(input.value.trim());
    items = all().filter((i) => !q || q.split(/\s+/).every((p) => norm(`${i.g} ${i.n}`).includes(p))).slice(0, 12);
    idx = Math.min(idx, Math.max(0, items.length - 1));
    list.innerHTML = items.map((i, n) => `<div class="pal-row ${n === idx ? 'on' : ''}" data-i="${n}"><span class="pal-g">${esc(i.g)}</span>${esc(i.n)}</div>`).join('') || '<div class="pal-empty">Eşleşme yok</div>';
  };
  const close = () => el.classList.add('hidden');
  const open = () => { el.classList.remove('hidden'); input.value = ''; idx = 0; draw(); input.focus(); };
  const run = (n) => { const it = items[n]; if (!it) return; close(); it.run(); };
  input.oninput = () => { idx = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && !e.isComposing) run(idx);
  };
  list.onclick = (e) => { const n = e.target.closest('[data-i]')?.dataset.i; if (n != null) run(+n); };
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); el.classList.contains('hidden') ? open() : close(); } }, true);
  return { open, close };
})();
$('#sbHint').onclick = () => palette.open();
