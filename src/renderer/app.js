'use strict';
/* global OfficeCanvas */
(() => {
  const api = window.office;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const time = (ts) => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const dur = (s) => (s > 86400 ? `${Math.floor(s / 86400)}g ${Math.floor((s % 86400) / 3600)}s` : s > 3600 ? `${Math.floor(s / 3600)}s ${Math.floor((s % 3600) / 60)}dk` : `${Math.floor(s / 60)}dk`);
  const STATUS_TR = { idle: 'boşta', queued: 'sırada', working: 'çalışıyor', error: 'hata', stopped: 'durdu' };
  const TASK_TR = { todo: 'Yapılacak', doing: 'Yapılıyor', review: 'İncelemede', done: 'Bitti', blocked: 'Engelli' };
  const SIZE_TR = { s: 'Küçük', m: 'Orta', l: 'Büyük' };
  const MODELS = [['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-fable-5-1', 'Fable 5.1'], ['claude-haiku-4-5-20251001', 'Haiku 4.5']];
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const modelName = (id) => (MODELS.find(([v]) => v === id) || [0, id || 'varsayılan'])[1];
  const KIND_ICON = { 'claude-code': '✳', 'claude-desktop': '✳', cursor: '⌘', 'cursor-agent': '⌘', 'cursor-cli': '⌘', codex: '◎', gemini: '✦', ollama: '🦙', aider: 'A', opencode: '◇', goose: '🪿', copilot: '◉', amp: '⚡', windsurf: '〰', lmstudio: '▣' };
  const KIND_COLOR = { 'claude-code': '#d97757', 'claude-desktop': '#c15f3c', cursor: '#d9d9de', 'cursor-agent': '#9aa0aa', codex: '#10a37f', gemini: '#4c8bf5', ollama: '#f2f2f2' };

  const S = { settings: null, team: [], agents: new Map(), messages: [], tasks: [], cost: 0, paused: false, selected: null, filter: 'all', radar: [], tab: 'agent', logs: [], openAsk: null, radarFocus: null, radarFilter: 'all' };

  const office = new OfficeCanvas($('#office'), {
    onSelect: (id) => selectAgent(id),
    onSelectExternal: (id) => { S.radarFocus = id; setTab('radar'); renderRadar(); },
  });

  const who = (id) => (id === 'user' ? { name: 'Sen', title: 'Owner', color: '#ffd166' } : S.team.find((a) => a.id === id) || { name: id, title: '', color: '#888' });

  function toast(text) {
    const el = h(`<div class="toast">${esc(text)}</div>`);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 4500);
  }

  // ---- state ---------------------------------------------------------------
  async function load(st) {
    st = st || await api.state();
    S.settings = st.settings;
    S.team = st.settings.team.filter((a) => a.enabled);
    S.agents = new Map(st.agents.map((a) => [a.id, a]));
    S.messages = st.messages;
    S.tasks = st.tasks;
    S.cost = st.cost || 0;
    S.paused = st.paused;
    S.claudeBin = st.claudeBin;
    if (S.selected && !S.team.some((a) => a.id === S.selected)) S.selected = null;
    office.setTeam(S.team, st.agents);
    renderTop();
    renderRecipients();
    renderFeed();
    renderAgentTab();
    renderBoard();
  }

  function renderTop() {
    const dir = S.settings.projectDir;
    $('#projectName').textContent = dir ? dir.split('/').pop() : 'Proje seç';
    $('#projectBtn').title = dir || 'Proje klasörü seç';
    $('#emptyState').classList.toggle('hidden', !!dir);
    $('#modelSel').value = S.settings.model || '';
    $('#permSel').value = S.settings.permissionMode || 'acceptEdits';
    $('#costBadge').textContent = `$${S.cost.toFixed(2)}`;
    $('#pauseBtn').textContent = S.paused ? '▶ Devam et' : '⏸ Duraklat';
    $('#pauseBtn').classList.toggle('on', S.paused);
  }

  function renderRecipients() {
    const sel = $('#toSel');
    const cur = sel.value;
    sel.innerHTML = `<option value="all">📢 Tüm ekip</option>` + S.team.map((a) => `<option value="${a.id}">${esc(a.name)} · ${esc(a.title)}</option>`).join('');
    sel.value = cur && [...sel.options].some((o) => o.value === cur) ? cur : (S.team.some((a) => a.id === 'pm') ? 'pm' : 'all');
  }

  // ---- feed ----------------------------------------------------------------
  function msgVisible(m) {
    if (S.filter === 'me') return m.to.includes('user');
    if (S.filter === 'sel') return S.selected && (m.from === S.selected || m.to.includes(S.selected));
    return true;
  }

  function msgEl(m) {
    const f = who(m.from);
    const to = m.to.map((t) => esc(who(t).name)).join(', ');
    const el = h(`<div class="msg ${m.to.includes('user') && m.from !== 'user' ? 'to-me' : ''} ${m.held ? 'held' : ''} ${m.kind === 'system' ? 'system' : ''}" data-id="${m.id}">
      <span class="dot" style="background:${f.color}"></span>
      <div>
        <div class="meta"><b>${esc(f.name)}</b> → ${to} · ${time(m.ts)}
          ${m.kind === 'task' ? '<span class="tag">görev</span>' : ''}
          ${m.held ? '<span class="tag warn">döngü koruması: bekletildi</span><button class="btn small release">Serbest bırak</button>' : ''}
        </div>
        <div class="body">${esc(m.text)}</div>
      </div></div>`);
    el.querySelector('.body').onclick = (e) => e.currentTarget.classList.toggle('open');
    const rel = el.querySelector('.release');
    if (rel) rel.onclick = () => api.release(m.id);
    return el;
  }

  function renderFeed() {
    const list = $('#feedList');
    list.innerHTML = '';
    const msgs = S.messages.filter(msgVisible).slice(-200);
    if (!msgs.length) list.append(h(`<div class="muted" style="padding:14px 0">${S.settings.projectDir ? 'Henüz mesaj yok. Aşağıdan PM\'e bir hedef yazarak başla — ör. “Login ekranına şifremi unuttum akışı ekleyelim.”' : 'Önce bir proje klasörü seç.'}</div>`));
    for (const m of msgs) list.append(msgEl(m));
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  function onMessage(m) {
    const i = S.messages.findIndex((x) => x.id === m.id);
    const isNew = i < 0;
    if (isNew) S.messages.push(m); else S.messages[i] = m;
    if (isNew) office.onMessage(m);
    if (B.open && B.drawer && B.drawer !== 'new') renderDrawer();
    else if (!m.held) office.onMessage(m); // released
    const list = $('#feedList');
    const existing = list.querySelector(`[data-id="${m.id}"]`);
    if (existing) existing.replaceWith(msgEl(m));
    else if (msgVisible(m)) {
      const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      if (list.firstElementChild?.classList.contains('muted')) list.innerHTML = '';
      list.append(msgEl(m));
      if (stick) list.scrollTop = list.scrollHeight;
    }
    if (m.held && isNew) toast(`Döngü koruması: ${who(m.from).name} → ${m.to.map((t) => who(t).name).join(', ')} mesajı bekletildi.`);
  }

  // ---- agent tab -----------------------------------------------------------
  function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    ['agent', 'radar'].forEach((t) => $(`#tab-${t}`).classList.toggle('hidden', t !== tab));
    if (tab === 'radar') scan();
  }

  async function selectAgent(id) {
    S.selected = id;
    office.setSelected(id);
    setTab('agent');
    S.logs = id ? await api.logs(id) : [];
    renderAgentTab();
    if (S.filter === 'sel') renderFeed();
  }

  function agentRow(a) {
    const s = S.agents.get(a.id) || { status: 'idle' };
    const sub = s.status === 'working' ? `⌨ ${s.activity || 'çalışıyor'}` : s.status === 'queued' ? `${s.inbox} mesaj bekliyor` : s.lastError ? `⚠ ${s.lastError}`
      : s.turns ? `${s.turns} tur · $${(s.cost || 0).toFixed(2)}` : 'hazır';
    return `<div class="agent-row">
      <div class="avatar" style="background:${a.color}">${esc(a.name[0])}</div>
      <div style="min-width:0"><div><b>${esc(a.name)}</b> <span class="muted">· ${esc(a.title)}</span></div><div class="sub">${esc(sub)}</div></div>
      <span class="pill ${s.status}">${STATUS_TR[s.status] || s.status}</span></div>`;
  }

  function renderAgentTab() {
    const box = $('#tab-agent');
    box.innerHTML = '';
    if (!S.selected) {
      const grid = h('<div class="team-grid"></div>');
      for (const a of S.team) {
        const c = h(`<div class="card click">${agentRow(a)}</div>`);
        c.onclick = () => selectAgent(a.id);
        grid.append(c);
      }
      box.append(grid);
      box.append(h(`<p class="muted" style="line-height:1.5;margin-top:14px">Ofisteki bir kişiye tıklayarak detayını, canlı logunu ve ona özel mesaj kutusunu aç.<br>Rolleri açıp kapatmak, isim/model/talimat değiştirmek için ⚙ Ayarlar.</p>`));
      return;
    }
    const a = S.team.find((x) => x.id === S.selected);
    const s = S.agents.get(a.id) || {};
    const el = h(`<div>
      <button class="back">← Ekip</button>
      <div class="detail-head"><div class="avatar" style="background:${a.color}">${esc(a.name[0])}</div>
        <div style="flex:1"><h3>${esc(a.name)}</h3><div class="muted">${esc(a.title)}</div></div>
        <span class="pill ${s.status}">${STATUS_TR[s.status] || 'boşta'}</span></div>
      <div class="activity">${s.status === 'working' ? '⌨ ' + esc(s.activity || '') : ''}</div>
      ${s.lastError ? `<div class="err">⚠ ${esc(s.lastError)}</div>` : ''}
      <div class="stats">
        <div class="stat"><b>${s.turns || 0}</b><span>tur</span></div>
        <div class="stat"><b>${s.inbox || 0}</b><span>gelen kutusu</span></div>
        <div class="stat"><b>$${(s.cost || 0).toFixed(2)}</b><span>maliyet</span></div>
        <div class="stat" title="${esc(s.sessionId || '')}"><b>${s.sessionId ? s.sessionId.slice(0, 6) : '—'}</b><span>oturum</span></div>
        <div class="stat" title="Son turdaki model${s.size ? ' · iş boyutu: ' + SIZE_TR[s.size] : ''}"><b>${s.model || s.turns ? esc(modelName(s.model)) : '—'}</b><span>model</span></div>
        <div class="stat" title="Her araç çağrısında yeniden gönderilen bağlam"><b>${s.ctx ? Math.round(s.ctx / 1000) + 'k' : '—'}</b><span>bağlam</span></div>
      </div>
      <div class="row-actions">
        <button class="btn small" data-a="stop">⏹ Durdur</button>
        <button class="btn small" data-a="clear">Kuyruğu temizle</button>
        <button class="btn small" data-a="reset" title="Ajanın hafızasını sıfırlar, yeni oturum açar">↺ Oturumu sıfırla</button>
        ${s.sessionId ? '<button class="btn small" data-a="term" title="Bu ajanın oturumunun bir kopyasını Terminal\'de aç">Terminal</button>' : ''}
      </div>
      <div class="log" id="agentLog"></div>
      <form class="mini-composer"><textarea placeholder="${esc(a.name)}'a doğrudan yaz…"></textarea><button class="btn primary">Gönder</button></form>
    </div>`);
    el.querySelector('.back').onclick = () => selectAgent(null);
    el.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = async () => {
        const act = b.dataset.a;
        if (act === 'stop') api.stopAgent(a.id);
        if (act === 'clear') api.clearInbox(a.id);
        if (act === 'reset' && confirm(`${a.name} için oturum sıfırlansın mı? Ajan önceki konuşmaları unutur.`)) api.resetSession(a.id);
        if (act === 'term') api.extTerminal({ cwd: S.settings.projectDir, sessionId: s.sessionId });
      };
    });
    const form = el.querySelector('form');
    const ta = form.querySelector('textarea');
    const submit = async (e) => { e?.preventDefault(); if (!ta.value.trim()) return; await api.send({ to: a.id, text: ta.value }); ta.value = ''; };
    form.onsubmit = submit;
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); };
    box.append(el);
    const log = el.querySelector('#agentLog');
    if (!S.logs.length) log.append(h('<div class="e system">Henüz log yok. Bu ajana mesaj geldiğinde burada canlı akış görünür.</div>'));
    S.logs.forEach((e) => log.append(logEl(e)));
    log.scrollTop = log.scrollHeight;
  }

  function logEl(e) {
    const icon = { in: '📥 ', text: '', tool: '🔧 ', 'tool-error': '✖ ', error: '⚠ ', system: '' }[e.kind] || '';
    return h(`<div class="e ${e.kind}">${icon}${esc(e.text)}</div>`);
  }

  function patchAgentDetail(snap) {
    if (S.tab !== 'agent') return;
    if (!S.selected) { renderAgentTab(); return; }
    if (snap.id !== S.selected) return;
    const box = $('#tab-agent');
    const act = box.querySelector('.activity');
    const pill = box.querySelector('.detail-head .pill');
    if (!act || !pill) return renderAgentTab();
    act.textContent = snap.status === 'working' ? '⌨ ' + (snap.activity || '') : '';
    pill.className = `pill ${snap.status}`;
    pill.textContent = STATUS_TR[snap.status] || snap.status;
    const stats = box.querySelectorAll('.stat b');
    stats[0].textContent = snap.turns || 0;
    stats[1].textContent = snap.inbox || 0;
    stats[2].textContent = `$${(snap.cost || 0).toFixed(2)}`;
    stats[3].textContent = snap.sessionId ? snap.sessionId.slice(0, 6) : '—';
    const err = box.querySelector('.err');
    if (snap.lastError && !err) renderAgentTab();
    else if (!snap.lastError && err) err.remove();
  }

  // ---- task board (full-screen dashboard) ------------------------------------
  const COLS = ['todo', 'doing', 'review', 'blocked', 'done'];
  const COL_COLOR = { todo: '#8d99ae', doing: '#5eead4', review: '#a78bfa', blocked: '#ff6b6b', done: '#6ee7a1' };
  const SIZE_SHORT = { s: 'K', m: 'O', l: 'B' };
  const DONE_LIMIT = 12;
  const B = { open: false, q: '', size: '', who: '', drawer: null, allDone: false };

  const ago = (ts) => {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return m < 1 ? 'şimdi' : m < 60 ? `${m} dk` : m < 1440 ? `${Math.round(m / 60)} sa` : `${Math.round(m / 1440)} g`;
  };
  const span = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`;
  };

  function updateTaskCount() {
    $('#taskCount').textContent = S.tasks.filter((t) => t.status !== 'done').length || '';
  }

  function openBoard(open = !B.open) {
    B.open = open;
    $('#board').classList.toggle('hidden', !open);
    $('#boardBtn').classList.toggle('on', open);
    if (open) renderBoard();
    else closeDrawer();
  }

  function visibleTasks() {
    const q = B.q.trim().toLowerCase();
    return S.tasks.filter((t) => (!B.who || (B.who === '-' ? !t.assignee : t.assignee === B.who))
      && (!B.size || (B.size === '-' ? !t.size : t.size === B.size))
      && (!q || `${t.id} ${t.title} ${t.details || ''}`.toLowerCase().includes(q)));
  }

  function renderBoard() {
    updateTaskCount();
    if (!B.open) return;
    $('#bdProject').textContent = S.settings.projectDir ? `· ${S.settings.projectDir.split('/').pop()}` : '';
    renderKpis();
    renderBoardTeam();
    renderCols();
    if (B.drawer && B.drawer !== 'new') renderDrawer();
  }

  function renderKpis() {
    const all = S.tasks;
    const n = (st) => all.filter((t) => t.status === st).length;
    const done = all.filter((t) => t.status === 'done');
    const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
    const avg = done.length ? done.reduce((a, t) => a + (t.updated - t.created), 0) / done.length : 0;
    const turns = [...S.agents.values()].reduce((a, s) => a + (s.turns || 0), 0);
    const working = [...S.agents.values()].filter((s) => s.status === 'working').length;
    const kpi = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
    $('#bdKpis').innerHTML = [
      kpi('Açık görev', all.length - done.length, `${n('todo')} yapılacak · ${n('doing')} yapılıyor · ${n('review')} incelemede`),
      kpi('Engelli', n('blocked'), n('blocked') ? 'müdahale gerekebilir' : 'engel yok', n('blocked') ? 'bad' : ''),
      `<div class="kpi"><span>İlerleme</span><b>%${pct}</b><small>${done.length}/${all.length} görev bitti</small><i class="bar"><i style="width:${pct}%"></i></i></div>`,
      kpi('Ort. bitirme süresi', done.length ? span(avg) : '—', 'açılıştan bitişe'),
      kpi('Ekip', `${working}/${S.team.length}`, `çalışıyor · ${turns} tur bu oturumda`),
      kpi('Maliyet', `$${S.cost.toFixed(2)}`, 'bu projede toplam'),
    ].join('');
  }

  function renderBoardTeam() {
    if (!B.open) return;
    const box = $('#bdTeam');
    box.innerHTML = '';
    for (const a of S.team) {
      const s = S.agents.get(a.id) || {};
      const mine = S.tasks.filter((t) => t.assignee === a.id && t.status !== 'done');
      const segs = COLS.filter((c) => c !== 'done').map((c) => ({ c, n: mine.filter((t) => t.status === c).length })).filter((x) => x.n);
      const el = h(`<button class="bd-agent ${B.who === a.id ? 'on' : ''}" title="Sadece ${esc(a.name)} görevlerini göster">
        <div class="avatar sm" style="background:${a.color}">${esc(a.name[0])}</div>
        <div class="bd-agent-body">
          <div class="bd-agent-top"><b>${esc(a.name)}</b><span class="pill ${s.status || ''}">${STATUS_TR[s.status] || 'boşta'}</span></div>
          <div class="bd-agent-act">${s.status === 'working' ? `⌨ ${esc(s.activity || 'çalışıyor')}` : s.status === 'queued' ? `${s.inbox} mesaj bekliyor` : esc(a.title)}</div>
          <div class="bd-load">${segs.map(({ c, n }) => `<i style="flex:${n};background:${COL_COLOR[c]}" title="${n} ${TASK_TR[c]}"></i>`).join('') || '<i class="none"></i>'}</div>
          <div class="bd-agent-meta">${mine.length} açık görev${s.model ? ` · ${esc(modelName(s.model))}` : ''}</div>
        </div></button>`);
      el.onclick = () => { B.who = B.who === a.id ? '' : a.id; renderBoard(); };
      box.append(el);
    }
    const un = S.tasks.filter((t) => !t.assignee && t.status !== 'done').length;
    if (un || B.who === '-') {
      const el = h(`<button class="bd-agent slim ${B.who === '-' ? 'on' : ''}"><b>${un}</b><span class="muted">atanmamış</span></button>`);
      el.onclick = () => { B.who = B.who === '-' ? '' : '-'; renderBoard(); };
      box.append(el);
    }
  }

  function cardEl(t) {
    const a = who(t.assignee);
    const s = t.assignee && S.agents.get(t.assignee);
    const live = t.status === 'doing' && s?.status === 'working';
    const last = t.notes[t.notes.length - 1];
    const el = h(`<div class="bd-card ${t.status} ${B.drawer === t.id ? 'sel' : ''}" draggable="true" style="--c:${t.assignee ? a.color : '#555'}">
      <div class="bd-card-top"><span class="tid">${esc(t.id)}</span>${t.size ? `<span class="sz ${t.size}" title="${SIZE_TR[t.size]} iş">${SIZE_SHORT[t.size]}</span>` : ''}
        ${live ? '<span class="live" title="Atanan ajan şu an çalışıyor"></span>' : ''}<span class="age" title="${new Date(t.updated).toLocaleString('tr-TR')}">${t.status === 'done' ? '✓ ' + span(t.updated - t.created) : ago(t.updated)}</span></div>
      <div class="bd-card-title">${esc(t.title)}</div>
      ${last ? `<div class="bd-card-note">💬 ${esc(who(last.by).name)}: ${esc(last.text)}</div>` : t.details && t.details !== t.title ? `<div class="bd-card-note">${esc(t.details)}</div>` : ''}
      <div class="bd-card-foot">${t.assignee ? `<span class="avatar xs" style="background:${a.color}">${esc(a.name[0])}</span>${esc(a.name)}` : '<span class="muted">atanmamış</span>'}
        <span class="muted">← ${esc(who(t.createdBy).name)}</span>${t.notes.length > 1 ? `<span class="muted nc">💬 ${t.notes.length}</span>` : ''}</div></div>`);
    el.onclick = () => openDrawer(t.id);
    el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('drag'); };
    el.ondragend = () => el.classList.remove('drag');
    return el;
  }

  function renderCols() {
    const box = $('#bdCols');
    box.innerHTML = '';
    const tasks = visibleTasks();
    for (const st of COLS) {
      let items = tasks.filter((t) => t.status === st).sort((a, b) => b.updated - a.updated);
      const total = items.length;
      if (st === 'done' && !B.allDone) items = items.slice(0, DONE_LIMIT);
      const col = h(`<div class="bd-col" data-st="${st}">
        <div class="bd-col-head"><i style="background:${COL_COLOR[st]}"></i>${TASK_TR[st]}<span class="count">${total || ''}</span></div>
        <div class="bd-col-body"></div></div>`);
      const body = col.querySelector('.bd-col-body');
      items.forEach((t) => body.append(cardEl(t)));
      if (!total) body.append(h(`<div class="bd-empty">${st === 'blocked' ? 'Engel yok' : 'Görev yok'}</div>`));
      if (total > items.length || (st === 'done' && B.allDone && total > DONE_LIMIT)) {
        const more = h(`<button class="btn small bd-more">${B.allDone ? 'Daha az göster' : `+${total - items.length} görev daha`}</button>`);
        more.onclick = () => { B.allDone = !B.allDone; renderCols(); };
        body.append(more);
      }
      col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
      col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
      col.ondrop = (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const t = S.tasks.find((x) => x.id === e.dataTransfer.getData('text/plain'));
        if (!t || t.status === st) return;
        t.status = st;
        t.updated = Date.now();
        renderBoard();
        api.taskUpdate({ id: t.id, patch: { status: st } });
      };
      box.append(col);
    }
  }

  // ---- task drawer: details, notes, related messages, editing
  function openDrawer(id) { B.drawer = id; renderDrawer(); renderCols(); }
  function closeDrawer() { B.drawer = null; $('#bdDrawer').classList.add('hidden'); if (B.open) renderCols(); }

  const assigneeOpts = (cur) => `<option value="">— atanmamış —</option>` + S.team.map((a) => `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${esc(a.name)} (${esc(a.title)})</option>`).join('');
  const sizeOpts = (cur) => `<option value="">— boyut yok —</option>` + Object.entries(SIZE_TR).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');

  function renderDrawer() {
    const d = $('#bdDrawer');
    d.classList.remove('hidden');
    if (B.drawer === 'new') {
      d.innerHTML = '';
      const form = h(`<form class="bd-form">
        <div class="bd-dh"><h3>Yeni görev</h3><button type="button" class="btn icon x">✕</button></div>
        <label>Başlık<input name="title" required></label>
        <label>Detay / kabul kriterleri<textarea name="details" rows="7"></textarea></label>
        <div class="bd-grid"><label>Atanan<select name="assignee">${assigneeOpts(B.who && B.who !== '-' ? B.who : '')}</select></label>
          <label>Boyut → model<select name="size">${sizeOpts('m')}</select></label></div>
        <p class="muted">Bir ajana atarsan görev ona hemen iletilir.</p>
        <button class="btn primary">Görevi oluştur</button></form>`);
      form.querySelector('.x').onclick = closeDrawer;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const t = await api.taskCreate({ title: fd.get('title').trim(), details: fd.get('details').trim(), assignee: fd.get('assignee'), size: fd.get('size') || null });
        if (t) openDrawer(t.id); else closeDrawer();
      };
      d.append(form);
      form.title.focus();
      return;
    }
    const t = S.tasks.find((x) => x.id === B.drawer);
    if (!t) { closeDrawer(); return; }
    const re = new RegExp(`\\b${t.id}\\b`);
    const related = S.messages.filter((m) => m.taskId === t.id || re.test(m.text)).slice(-15);
    const el = h(`<div>
      <div class="bd-dh"><span class="tid">${esc(t.id)}</span><span class="pill" style="color:${COL_COLOR[t.status]}">${TASK_TR[t.status]}</span><div class="spacer"></div><button class="btn icon x">✕</button></div>
      <h3 class="bd-dtitle">${esc(t.title)}</h3>
      <div class="bd-grid">
        <label>Durum<select class="st">${COLS.map((c) => `<option value="${c}" ${c === t.status ? 'selected' : ''}>${TASK_TR[c]}</option>`).join('')}</select></label>
        <label>Atanan<select class="as">${assigneeOpts(t.assignee)}</select></label>
        <label>Boyut → model<select class="fsz">${sizeOpts(t.size)}</select></label>
        <label>Açan<span class="ro">${esc(who(t.createdBy).name)} · ${new Date(t.created).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</span></label>
      </div>
      ${t.details && t.details !== t.title ? `<h4>Detay</h4><div class="bd-details">${esc(t.details)}</div>` : ''}
      <h4>Notlar <span class="count">${t.notes.length || ''}</span></h4>
      ${t.notes.length ? `<div class="bd-tl">${t.notes.map((n) => `<div><b style="color:${who(n.by).color}">${esc(who(n.by).name)}</b> <span class="muted">${time(n.ts)}</span><p>${esc(n.text)}</p></div>`).join('')}</div>` : '<p class="muted">Henüz not yok.</p>'}
      <h4>İlgili mesajlar <span class="count">${related.length || ''}</span></h4>
      ${related.length ? `<div class="bd-tl">${related.map((m) => `<div><b style="color:${who(m.from).color}">${esc(who(m.from).name)}</b> <span class="muted">→ ${m.to.map((x) => esc(who(x).name)).join(', ')} · ${time(m.ts)}</span><p>${esc(m.text)}</p></div>`).join('')}</div>` : '<p class="muted">Bu göreve değinen mesaj yok.</p>'}
      <div class="bd-dfoot"><button class="btn small danger del">Görevi sil</button></div></div>`);
    el.querySelector('.x').onclick = closeDrawer;
    el.querySelector('.st').onchange = (e) => api.taskUpdate({ id: t.id, patch: { status: e.target.value } });
    el.querySelector('.as').onchange = (e) => api.taskUpdate({ id: t.id, patch: { assignee: e.target.value } });
    el.querySelector('.fsz').onchange = (e) => api.taskUpdate({ id: t.id, patch: { size: e.target.value } });
    el.querySelector('.del').onclick = () => { if (confirm(`${t.id} silinsin mi?`)) { api.taskDelete(t.id); closeDrawer(); } };
    const scroll = d.scrollTop;
    d.innerHTML = '';
    d.append(el);
    d.scrollTop = scroll;
  }

  $('#boardBtn').onclick = () => openBoard();
  $('#bdClose').onclick = () => openBoard(false);
  $('#bdNew').onclick = () => { B.drawer = 'new'; renderDrawer(); };
  $('#bdSearch').oninput = (e) => { B.q = e.target.value; renderCols(); };
  $('#bdSize').onchange = (e) => { B.size = e.target.value; renderCols(); };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !B.open || document.querySelector('dialog[open]')) return;
    if (B.drawer) closeDrawer(); else openBoard(false);
  });
  // Relative times on cards ("5 dk") go stale; refresh them once a minute.
  setInterval(() => { if (B.open && !document.hidden) renderCols(); }, 60000);

  // ---- radar ---------------------------------------------------------------
  let scanning = false;
  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      S.radar = await api.scan();
      office.setExternals(S.radar);
      const waiting = S.radar.filter((x) => x.status === 'waiting').length;
      $('#radarCount').textContent = waiting ? `⚠ ${waiting}` : S.radar.length || '';
      $('#radarCount').classList.toggle('warn', !!waiting);
      if (S.tab === 'radar' && !S.openAsk) renderRadar();
    } finally { scanning = false; }
  }

  const RADAR_TR = { waiting: '⚠ seni bekliyor', active: 'çalışıyor', idle: 'boşta' };
  const home = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');

  // One line saying what the session is doing right now.
  function radarNow(x) {
    const s = x.session;
    const since = x.statusSince ? ` · ${ago(x.statusSince)}` : '';
    if (x.status === 'waiting') return `<div class="now warn">⚠ Senden onay/yanıt bekliyor${x.waitingFor ? `: ${esc(x.waitingFor)}` : ''}${since}</div>`;
    const act = s?.activity;
    if (x.status === 'active') {
      if (act?.phase === 'tool') return `<div class="now on">⌨ ${esc(act.text)}</div>`;
      return `<div class="now on">✳ düşünüyor…</div>`;
    }
    if (!s) return '';
    const last = `son işlem ${ago(s.lastActivity)} önce`;
    return act?.phase === 'replied' ? `<div class="now">✓ Cevabını verdi, yeni mesaj bekliyor · ${last}</div>` : `<div class="now">${last}</div>`;
  }

  function renderRadar() {
    const box = $('#tab-radar');
    const keepScroll = box.scrollTop;
    box.innerHTML = '';
    const count = (st) => S.radar.filter((x) => x.status === st).length;
    const chips = h(`<div class="radar-sum">
      ${[['all', `Tümü ${S.radar.length}`], ['waiting', `⚠ Bekleyen ${count('waiting')}`], ['active', `Çalışan ${count('active')}`], ['idle', `Boşta ${count('idle')}`]]
        .map(([k, l]) => `<button data-f="${k}" class="${S.radarFilter === k ? 'on' : ''} ${k === 'waiting' && count('waiting') ? 'warn' : ''}">${l}</button>`).join('')}</div>`);
    chips.onclick = (e) => { const f = e.target.dataset.f; if (f) { S.radarFilter = f; renderRadar(); } };
    box.append(chips);
    const list = S.radar.filter((x) => S.radarFilter === 'all' || x.status === S.radarFilter);
    if (!S.radar.length) box.append(h('<p class="muted">Şu an çalışan başka ajan yok.</p>'));
    else if (!list.length) box.append(h('<p class="muted">Bu durumda ajan yok.</p>'));
    for (const x of list) {
      const s = x.session;
      const el = h(`<div class="card radar-item ${x.status} ${S.radarFocus === x.id ? 'flash' : ''}" data-id="${esc(x.id)}">
        <div class="top"><div class="bot" style="background:${KIND_COLOR[x.kind] || '#8e9aaf'}">${KIND_ICON[x.kind] || '🤖'}</div>
          <div style="min-width:0"><b>${esc(x.name || x.label)}</b>${x.background ? ' <span class="tag">arka plan</span>' : ''}${x.project ? ` <span class="muted">· ${esc(x.project)}</span>` : ''}
            <div class="sub">${esc(x.label)}${x.model ? ' · ' + esc(modelName(x.model)) : ''} · ${dur(x.uptime)} · CPU %${x.cpu.toFixed(0)} · ${Math.round(x.rss / 1024)} MB${x.headless ? ' · headless' : ''}</div></div>
          <span class="pill ${x.status}">${RADAR_TR[x.status] || x.status}</span></div>
        ${radarNow(x)}
        ${s?.lastPrompt ? `<div class="ask-line" title="${esc(s.lastPrompt)}">👤 ${esc(s.lastPrompt)}</div>` : s?.title ? `<div class="ask-line">🗂 ${esc(s.title)}</div>` : ''}
        ${s?.recap?.text ? `<div class="recap">📝 ${esc(s.recap.text)}</div>` : ''}
        <div class="meta">${x.cwd ? `<span title="${esc(x.cwd)}">📍 ${esc(home(x.cwd))}</span>` : ''}${s?.branch ? `<span>🌿 ${esc(s.branch)}</span>` : ''}${s?.ctx ? `<span title="Son çağrıdaki bağlam">🧠 ${Math.round(s.ctx / 1000)}k</span>` : ''}${s?.permissionMode ? `<span title="İzin modu">🔐 ${esc(s.permissionMode)}</span>` : ''}</div>
        ${s?.recent?.length ? `<details ${S.radarFocus === x.id ? 'open' : ''}><summary class="sub" style="margin-top:6px;cursor:pointer">Son konuşma (${time(s.lastActivity)})</summary><div class="recent">${s.recent.map((r) => `<div class="${r.role}">${r.role === 'user' ? '👤 ' : r.role === 'tool' ? '🔧 ' : '✳ '}${esc(r.text.slice(0, 300))}</div>`).join('')}</div></details>` : ''}
        <div class="acts">
          ${x.background && x.jobId ? `<button class="btn small ${x.status === 'waiting' ? 'primary' : ''}" data-a="attach" title="claude attach ${esc(x.jobId)}">Terminal'de bağlan</button>` : ''}
          ${s ? '<button class="btn small" data-a="ask">💬 Sor</button><button class="btn small" data-a="term">Terminal\'de fork aç</button>' : ''}
          ${x.cwd ? '<button class="btn small" data-a="open">Klasörü aç</button>' : ''}
          <button class="btn small danger" data-a="kill">Durdur</button>
        </div></div>`);
      el.querySelectorAll('[data-a]').forEach((b) => {
        b.onclick = async () => {
          const act = b.dataset.a;
          if (act === 'open') api.openPath(x.cwd);
          if (act === 'attach') api.extAttach({ cwd: x.cwd, jobId: x.jobId });
          if (act === 'term') api.extTerminal({ cwd: x.cwd, sessionId: s.sessionId });
          if (act === 'kill') { const r = await api.extKill({ pid: x.pid, label: x.name || x.label }); if (r === true) { toast(`${x.name || x.label} durduruldu`); setTimeout(scan, 800); } else if (typeof r === 'string') toast(r); }
          if (act === 'ask') openAsk(el, x);
        };
      });
      box.append(el);
    }
    box.scrollTop = keepScroll;
    if (S.radarFocus) { box.querySelector('.flash')?.scrollIntoView({ block: 'nearest' }); S.radarFocus = null; }
  }

  function openAsk(el, x) {
    if (el.querySelector('.ask')) return;
    S.openAsk = x.id;
    const f = h(`<form class="ask"><textarea rows="2" placeholder="Örn: Şu an ne üzerinde çalışıyorsun, nerede kaldın?"></textarea>
      <div style="display:flex;gap:6px"><button class="btn primary small">Sor</button><button type="button" class="btn small close">Kapat</button></div></form>`);
    f.querySelector('.close').onclick = () => { f.remove(); S.openAsk = null; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const q = f.querySelector('textarea').value.trim();
      if (!q) return;
      const ans = h('<div class="answer muted">Oturumun kopyası düşünüyor…</div>');
      f.append(ans);
      const r = await api.extAsk({ cwd: x.cwd, sessionId: x.session.sessionId, question: q });
      ans.classList.remove('muted');
      ans.textContent = r.error ? `⚠ ${r.error}` : `${r.text}\n\n($${(r.cost || 0).toFixed(3)})`;
    };
    el.append(f);
    f.querySelector('textarea').focus();
  }

  // ---- settings ------------------------------------------------------------
  function openSettings() {
    const f = $('#settingsForm');
    const s = S.settings;
    f.language.value = s.language; f.maxConcurrent.value = s.maxConcurrent; f.maxHops.value = s.maxHops; f.claudePath.value = s.claudePath || '';
    f.allowedTools.value = (s.allowedTools || []).join('\n');
    f.contextLimit.value = s.contextLimit ?? 60000;
    f.lean.value = s.lean === false ? '0' : '1';
    const am = $('#autoModels');
    am.innerHTML = '';
    for (const [k, label] of Object.entries(SIZE_TR)) {
      const cur = (s.autoModels || {})[k] || {};
      am.append(h(`<label data-size="${k}">${label} iş
        <span style="display:flex;gap:6px"><select class="am">${MODELS.map(([v, l]) => `<option value="${v}" ${v === cur.model ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="ae">${EFFORTS.map((v) => `<option value="${v}" ${v === cur.effort ? 'selected' : ''}>${v}</option>`).join('')}</select></span></label>`));
    }
    $('#claudeBinInfo').textContent = `Kullanılan claude: ${S.claudeBin}`;
    const ed = $('#teamEditor');
    ed.innerHTML = '';
    const models = [['', 'Otomatik'], ...MODELS];
    for (const a of s.team) {
      const row = h(`<div class="team-edit" data-id="${a.id}">
        <input type="checkbox" class="en" ${a.enabled ? 'checked' : ''} title="Ofiste olsun">
        <input type="color" class="co" value="${a.color}">
        <input class="nm" value="${esc(a.name)}">
        <span class="muted">${esc(a.title)}</span>
        <select class="md">${models.map(([v, l]) => `<option value="${v}" ${v === (a.model || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <textarea class="ex" placeholder="Bu role ek talimat (ör. 'Testleri jest ile yaz')">${esc(a.extra || '')}</textarea></div>`);
      ed.append(row);
    }
    $('#settingsDlg').showModal();
  }

  $('#settingsForm').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    const f = e.target;
    const team = S.settings.team.map((a) => {
      const row = $(`.team-edit[data-id="${a.id}"]`);
      return { ...a, enabled: row.querySelector('.en').checked, color: row.querySelector('.co').value, name: row.querySelector('.nm').value.trim() || a.name, model: row.querySelector('.md').value, extra: row.querySelector('.ex').value.trim() };
    });
    if (team.filter((a) => a.enabled).length > 7) { toast('Ofiste en fazla 7 masa var.'); return; }
    const st = await api.updateSettings({
      language: f.language.value.trim() || 'Turkish',
      maxConcurrent: Math.max(1, +f.maxConcurrent.value || 3),
      maxHops: Math.max(1, +f.maxHops.value || 12),
      claudePath: f.claudePath.value.trim(),
      allowedTools: f.allowedTools.value.split('\n').map((l) => l.trim()).filter(Boolean),
      contextLimit: Math.max(0, +f.contextLimit.value || 0),
      lean: f.lean.value === '1',
      autoModels: Object.fromEntries([...document.querySelectorAll('#autoModels [data-size]')].map((l) => [l.dataset.size, { model: l.querySelector('.am').value, effort: l.querySelector('.ae').value }])),
      team,
    });
    load(st);
  });

  // ---- wiring --------------------------------------------------------------
  async function chooseProject() {
    const st = await api.chooseProject();
    if (st) { S.selected = null; office.setSelected(null); load(st); }
  }
  $('#projectBtn').onclick = chooseProject;
  $('#emptyProjectBtn').onclick = chooseProject;
  $('#modelSel').onchange = (e) => api.updateSettings({ model: e.target.value }).then((st) => { S.settings = st.settings; });
  $('#permSel').onchange = (e) => {
    if (e.target.value === 'bypassPermissions' && !confirm('Tüm izinler modunda ajanlar sana sormadan her komutu çalıştırabilir. Emin misin?')) { e.target.value = S.settings.permissionMode; return; }
    api.updateSettings({ permissionMode: e.target.value }).then((st) => { S.settings = st.settings; });
  };
  $('#pauseBtn').onclick = () => api.pause(!S.paused);
  $('#stopAllBtn').onclick = () => { if (confirm('Çalışan tüm ajanlar durdurulsun ve ofis duraklatılsın mı?')) api.stopAll(); };
  $('#settingsBtn').onclick = openSettings;
  document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => { if (b.dataset.tab === 'agent' && S.tab === 'agent') selectAgent(null); else setTab(b.dataset.tab); }; });
  $('#feedFilter').onclick = (e) => {
    const f = e.target.dataset.f; if (!f) return;
    S.filter = f;
    document.querySelectorAll('#feedFilter button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
    renderFeed();
  };

  const input = $('#msgInput');
  const sendMain = async (e) => {
    e?.preventDefault();
    if (!S.settings.projectDir) { toast('Önce bir proje klasörü seç.'); return; }
    const text = input.value.trim();
    if (!text) return;
    await api.send({ to: $('#toSel').value, text });
    input.value = '';
    input.style.height = '';
  };
  $('#composer').onsubmit = sendMain;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) sendMain(e); };
  input.oninput = () => { input.style.height = ''; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };

  api.on('agent', (snap) => { S.agents.set(snap.id, snap); office.updateAgent(snap); patchAgentDetail(snap); if (B.open) { renderBoardTeam(); renderKpis(); } });
  api.on('message', onMessage);
  api.on('log', ({ id, entry }) => {
    if (id !== S.selected) return;
    S.logs.push(entry);
    const log = $('#agentLog');
    if (!log) return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    if (log.firstElementChild?.classList.contains('system') && S.logs.length === 1) log.innerHTML = '';
    log.append(logEl(entry));
    if (stick) log.scrollTop = log.scrollHeight;
  });
  api.on('log-reset', (id) => { if (id === S.selected) { S.logs = []; renderAgentTab(); } });
  api.on('tasks', (tasks) => { S.tasks = tasks; renderBoard(); });
  api.on('cost', (c) => { S.cost = c; renderTop(); if (B.open) renderKpis(); });
  api.on('paused', (p) => { S.paused = p; renderTop(); });
  api.on('system', (t) => toast(t));
  api.on('reset', () => load());

  load().then(scan);
  setInterval(() => { if (!document.hidden) scan(); }, 5000);
})();
