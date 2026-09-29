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
  const KIND_ICON = { 'claude-code': '✳', 'claude-desktop': '✳', cursor: '⌘', 'cursor-agent': '⌘', 'cursor-cli': '⌘', codex: '◎', gemini: '✦', ollama: '🦙', aider: 'A', opencode: '◇', goose: '🪿', copilot: '◉', amp: '⚡', windsurf: '〰', lmstudio: '▣' };
  const KIND_COLOR = { 'claude-code': '#d97757', 'claude-desktop': '#c15f3c', cursor: '#d9d9de', 'cursor-agent': '#9aa0aa', codex: '#10a37f', gemini: '#4c8bf5', ollama: '#f2f2f2' };

  const S = { settings: null, team: [], agents: new Map(), messages: [], tasks: [], cost: 0, paused: false, selected: null, filter: 'all', radar: [], tab: 'agent', logs: [], openAsk: null, radarFocus: null };

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
    renderTasks();
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
    ['agent', 'tasks', 'radar'].forEach((t) => $(`#tab-${t}`).classList.toggle('hidden', t !== tab));
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

  // ---- tasks ---------------------------------------------------------------
  function renderTasks() {
    const box = $('#tab-tasks');
    const open = S.tasks.filter((t) => t.status !== 'done').length;
    $('#taskCount').textContent = open || '';
    box.innerHTML = '';
    const opts = `<option value="">— atanmamış —</option>` + S.team.map((a) => `<option value="${a.id}">${esc(a.name)} (${esc(a.title)})</option>`).join('');
    const form = h(`<form class="task-new card">
      <div class="r"><input name="title" placeholder="Yeni görev başlığı" required><select name="assignee">${opts}</select><button class="btn primary">Ekle</button></div>
      <textarea name="details" rows="2" placeholder="Detay / kabul kriterleri (opsiyonel)"></textarea></form>`);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await api.taskCreate({ title: fd.get('title'), details: fd.get('details'), assignee: fd.get('assignee') });
      form.reset();
    };
    box.append(form);
    if (!S.tasks.length) box.append(h('<p class="muted">Pano boş. Ajanlar &lt;task&gt; etiketiyle görev açtıkça burada görünür; sen de ekleyebilirsin.</p>'));
    for (const st of ['blocked', 'doing', 'review', 'todo', 'done']) {
      const items = S.tasks.filter((t) => t.status === st).sort((a, b) => b.updated - a.updated);
      if (!items.length) continue;
      box.append(h(`<div class="col-title"><span>${TASK_TR[st]}</span><span>${items.length}</span></div>`));
      for (const t of items) {
        const a = who(t.assignee);
        const el = h(`<div class="task" style="border-left-color:${t.assignee ? a.color : '#555'}">
          <div class="t">${esc(t.id)} · ${esc(t.title)}</div>
          ${t.details && t.details !== t.title ? `<div class="d">${esc(t.details)}</div>` : ''}
          ${t.notes.length ? `<div class="d">💬 ${esc(who(t.notes[t.notes.length - 1].by).name)}: ${esc(t.notes[t.notes.length - 1].text)}</div>` : ''}
          <div class="f"><select class="st">${Object.entries(TASK_TR).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <select class="as">${opts}</select>
            <span>${esc(who(t.createdBy).name)} açtı</span>
            <button class="x" title="Sil">✕</button></div></div>`);
        el.querySelector('.as').value = t.assignee || '';
        el.querySelector('.st').onchange = (e) => api.taskUpdate({ id: t.id, patch: { status: e.target.value } });
        el.querySelector('.as').onchange = (e) => api.taskUpdate({ id: t.id, patch: { assignee: e.target.value } });
        el.querySelector('.x').onclick = () => confirm(`${t.id} silinsin mi?`) && api.taskDelete(t.id);
        box.append(el);
      }
    }
  }

  // ---- radar ---------------------------------------------------------------
  let scanning = false;
  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      S.radar = await api.scan();
      office.setExternals(S.radar);
      $('#radarCount').textContent = S.radar.length || '';
      if (S.tab === 'radar' && !S.openAsk) renderRadar();
    } finally { scanning = false; }
  }

  function renderRadar() {
    const box = $('#tab-radar');
    const keepScroll = box.scrollTop;
    box.innerHTML = '';
    box.append(h(`<p class="muted" style="margin:0 0 10px;line-height:1.5">Bu bilgisayarda çalışan diğer AI ajanları. Ofisin lobisinde de görünürler. Claude Code oturumlarına, oturumu bozmadan (fork ile) soru sorabilirsin.</p>`));
    if (!S.radar.length) box.append(h('<p class="muted">Şu an çalışan başka ajan yok.</p>'));
    for (const x of S.radar) {
      const s = x.session;
      const el = h(`<div class="card radar-item ${S.radarFocus === x.id ? 'flash' : ''}" data-id="${esc(x.id)}">
        <div class="top"><div class="bot" style="background:${KIND_COLOR[x.kind] || '#8e9aaf'}">${KIND_ICON[x.kind] || '🤖'}</div>
          <div style="min-width:0"><b>${esc(x.label)}</b>${x.project ? ` <span class="muted">· ${esc(x.project)}</span>` : ''}
            <div class="sub">PID ${x.pid} · ${dur(x.uptime)} · CPU %${x.cpu.toFixed(0)} · ${Math.round(x.rss / 1024)} MB${x.model ? ' · ' + esc(x.model) : ''}${x.headless ? ' · headless' : ''}</div></div>
          <span class="pill ${x.status}">${x.status === 'active' ? 'aktif' : 'beklemede'}</span></div>
        ${s?.title ? `<div class="title">🗂 ${esc(s.title)}</div>` : ''}
        ${x.cwd ? `<div class="sub" style="margin-top:4px">📍 ${esc(x.cwd)}</div>` : ''}
        ${s?.recent?.length ? `<details ${S.radarFocus === x.id ? 'open' : ''}><summary class="sub" style="margin-top:6px;cursor:pointer">Son konuşma (${time(s.lastActivity)})</summary><div class="recent">${s.recent.map((r) => `<div class="${r.role}">${r.role === 'user' ? '👤 ' : r.role === 'tool' ? '🔧 ' : '✳ '}${esc(r.text.slice(0, 300))}</div>`).join('')}</div></details>` : ''}
        <div class="acts">
          ${s ? '<button class="btn small" data-a="ask">💬 Sor</button><button class="btn small" data-a="term">Terminal\'de fork aç</button>' : ''}
          ${x.cwd ? '<button class="btn small" data-a="open">Klasörü aç</button>' : ''}
          <button class="btn small danger" data-a="kill">Durdur</button>
        </div></div>`);
      el.querySelectorAll('[data-a]').forEach((b) => {
        b.onclick = async () => {
          const act = b.dataset.a;
          if (act === 'open') api.openPath(x.cwd);
          if (act === 'term') api.extTerminal({ cwd: x.cwd, sessionId: s.sessionId });
          if (act === 'kill') { const r = await api.extKill({ pid: x.pid, label: x.label }); if (r === true) { toast(`${x.label} durduruldu`); setTimeout(scan, 800); } else if (typeof r === 'string') toast(r); }
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
    $('#claudeBinInfo').textContent = `Kullanılan claude: ${S.claudeBin}`;
    const ed = $('#teamEditor');
    ed.innerHTML = '';
    const models = [['', 'Genel model'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-fable-5-1', 'Fable 5.1'], ['claude-haiku-4-5-20251001', 'Haiku 4.5']];
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

  api.on('agent', (snap) => { S.agents.set(snap.id, snap); office.updateAgent(snap); patchAgentDetail(snap); });
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
  api.on('tasks', (tasks) => { S.tasks = tasks; renderTasks(); });
  api.on('cost', (c) => { S.cost = c; renderTop(); });
  api.on('paused', (p) => { S.paused = p; renderTop(); });
  api.on('system', (t) => toast(t));
  api.on('reset', () => load());

  load().then(scan);
  setInterval(() => { if (!document.hidden) scan(); }, 5000);
})();
