'use strict';
// Dev aid: `node_modules/.bin/electron scripts/i18n-audit.js` lists text that is still Turkish in English mode.
// (based on shot.js) `npm run shot` opens the app on a throwaway office (out/shot-data,
// project folder out/shot-proj), hires a demo crew and saves screenshots of the
// main views to out/shots/. Two workers are started for real so their terminals
// show Claude Code; they are stopped again at the end.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'out', 'i18n-audit');
const proj = path.join(root, 'out', 'audit-proj');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(proj, { recursive: true });
fs.rmSync(path.join(root, 'out', 'audit-data'), { recursive: true, force: true });
process.env.AGENT_OFFICE_DATA = path.join(root, 'out', 'audit-data');
fs.mkdirSync(process.env.AGENT_OFFICE_DATA, { recursive: true });
fs.writeFileSync(path.join(process.env.AGENT_OFFICE_DATA, 'office.json'), JSON.stringify({ version: 2, tourDone: true, lang: 'en', lastSeenVersion: app.getVersion() }));
process.env.AGENT_OFFICE_OFFSCREEN = '1';
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
require(path.join(root, 'src', 'main', 'main.js'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.env.SHOT_ONLY || '').split(',').filter(Boolean);

app.on('browser-window-created', (_e, w) => {
  // macOS drags off-screen windows back on screen, so hide it a different way:
  // fully transparent and click-through, tucked into the bottom-right corner.
  w.setOpacity(0);
  w.setIgnoreMouseEvents(true);
  w.setFocusable(false);
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  w.setPosition(area.x + area.width - 60, area.y + area.height - 60);
  w.showInactive();
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log(`[renderer ${e.level}]`, e.message, e.sourceId ? `(${path.basename(e.sourceId)}:${e.lineNumber})` : ''); });
  w.webContents.once('did-finish-load', async () => {
    const js = (code) => w.webContents.executeJavaScript(code).catch((err) => console.log('[eval failed]', err.message));
    const shot = async (name, before, ms = 1500) => {
      if (only.length && !only.includes(name)) return;
      if (before) await js(before);
      await wait(ms);
      await w.webContents.capturePage();
      await wait(120);
      fs.writeFileSync(path.join(outDir, `${name}.png`), (await w.webContents.capturePage()).toPNG());
      console.log('saved', name, await js('JSON.stringify({ scale: window.__office.office.scale, pan: window.__office.office.pan, statuses: window.__office.S.ws.workers.map((w) => w.status).join(",") })'));
    };
    await wait(2500);
    await js(`(async () => {
      const api = window.office;
      await api.appAck({ tour: true, lang: 'en' });
      await api.wsCreate({ name: 'Product HQ', dir: ${JSON.stringify(proj)} });
      const ids = [];
      for (const [name, role, lead] of [['Ada', 'Lead', true], ['Nova', 'Frontend Developer'], ['Kai', 'Backend Developer']]) ids.push(await api.workerCreate({ name, role, lead: !!lead, model: 'haiku' }));
      const t1 = await api.taskCreate({ title: 'Forgot password flow', details: 'Reset link by email.' });
      await api.taskCreate({ title: 'Form validation', parent: t1, assignee: ids[1] });
      await api.taskDone({ id: t1, report: { summary: 'Done.', evidence: [{ label: 'npm test', ok: true, detail: '42 passed' }], files: ['src/a.js'] } });
      await api.taskCreate({ title: 'Second task' });
      await api.chatSend({ text: 'hello team' }).catch(() => {});
      window.__office.S.layoutFor = null;
    })()`);
    await wait(2500);
    const seen = new Map();
    const ALL = process.env.ALL === '1';
    const COLLECT = `(() => { const ALL = ${ALL};
      const TR = /[çğıöşüÇĞİÖŞÜ]|\\b(ve|bir|için|yok|ile|henüz|görev\\w*|çalış\\w*|ekle|sil|bekl\\w*|uyu\\w*|düşün\\w*|hafıza|ofis\\w*|seç\\w*|aç|kapat|gönder\\w*|yaz|boş|dosya|kaydet|vazgeç|yeni|ara|tamam|bitti|durum|atanan|notlar?|sahip|sohbet|kod|tasarım|editör|inceleme|tarayıcı|beceri\\w*|karar\\w*|rapor\\w*|onay\\w*|yorum|işaret\\w*|kaydır|katla|satır|yol|sürüm|tema|takım|proje\\w*|klasör|başla\\w*|durdur|ayar\\w*|gör\\w*|bul|kopyala|ekran|liste|pano|ofis|hepsi\\w*|yenile|uyarı|bütçe|limit|çıkar|kur\\w*)\\b/i;
      const out = new Set();
      const add = (s) => { s = (s || '').replace(/\\s+/g, ' ').trim(); if (s && s.length > 1 && (ALL || TR.test(s))) out.add(s.slice(0, 140)); };
      const walk = (n) => {
        if (n.nodeType === 3) return add(n.nodeValue);
        if (n.nodeType !== 1 || /^(SCRIPT|STYLE|CANVAS)$/.test(n.tagName) || n.classList.contains('xterm') || n.classList.contains('cm-editor')) return;
        for (const a of ['title', 'placeholder', 'aria-label']) if (n.hasAttribute(a)) add(n.getAttribute(a));
        n.childNodes.forEach(walk);
      };
      walk(document.body);
      return JSON.stringify([...out]);
    })()`;
    const grab = async (label, before, ms = 700) => {
      if (before) await js(before);
      await wait(ms);
      const list = JSON.parse((await js(COLLECT)) || '[]');
      for (const s of list) if (!seen.has(s)) seen.set(s, label);
      console.log(`[${label}] ${list.length}`);
    };
    const O = 'window.__office';
    await grab('office', `${O}.setLTab('office')`);
    await grab('select', `(() => { const o = ${O}; o.select(o.S.ws.workers[1].id); })()`);
    await grab('edit', `document.getElementById('editBtn').click()`);
    await js(`document.getElementById('editBtn').click()`);
    for (const k of ['chat', 'terminal', 'board', 'design', 'editor', 'review', 'reports', 'memory', 'browser', 'skills', 'decisions', 'hub']) await grab(k, `${O}.setRTab('${k}')`, 900);
    await grab('board-drawer', `(() => { const o = ${O}; o.setRTab('board'); o.board.open = o.S.ws.tasks[0].id; o.board.render(); })()`);
    await grab('board-new', `(() => { const o = ${O}; o.board.open = 'new'; o.board.render(); })()`);
    await grab('board-list', `(() => { const o = ${O}; o.board.open = null; o.board.mode = 'list'; o.board.render(); })()`);
    await grab('report-open', `(() => { const o = ${O}; o.setRTab('reports'); document.querySelector('.rp')?.click(); })()`);
    await grab('design-req', `(() => { ${O}.setRTab('design'); document.querySelector('[data-a=req]')?.click(); })()`);
    await grab('skills-new', `(() => { ${O}.setRTab('skills'); document.querySelector('[data-act=new]')?.click(); })()`);
    await js(`document.getElementById('dlg').close?.()`);
    await grab('memory-graph', `(() => { ${O}.setRTab('memory'); })()`, 1500);
    for (const [label, expr] of [
      ['dlg-hire', `${O}.workerDialog()`],
      ['dlg-worker', `${O}.workerDialog(${O}.S.ws.workers[1])`],
      ['dlg-team', `${O}.teamDialog()`],
      ['dlg-manage', `${O}.manageDialog()`],
      ['dlg-about', `document.getElementById('tabInfo').click()`],
      ['dlg-import', `document.querySelector('[data-import]') ? ${O}.setRTab('board') || document.querySelector('[data-import]').click() : 0`],
      ['dlg-ws', `document.getElementById('wsName').click()`],
      ['dlg-wsmenu', `document.getElementById('wsMenuBtn').click()`],
    ]) { await grab(label, expr, 900); await js(`document.getElementById('dlg').open && document.getElementById('dlg').close()`); }
    await grab('notify', `document.getElementById('bellBtn').click()`);
    await js(`document.getElementById('bellBtn').click()`);
    await grab('palette', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))`);
    await js(`document.getElementById('palInput')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await grab('mic-setup', `document.getElementById('micBtn').click()`, 1200);
    await js(`document.getElementById('dlg').open && document.getElementById('dlg').close()`);
    await grab('hub-form', `(() => { ${O}.setRTab('hub'); const b = [...document.querySelectorAll('#rtab-hub button')].find((x) => /bağla|connect/i.test(x.textContent)); b?.click(); })()`, 900);
    await js(`document.getElementById('dlg').open && document.getElementById('dlg').close()`);
    await grab('memory-note', `(async () => { const ws = ${O}.S.ws; await window.office.workerMemory({ id: ws.workers[0].id }); ${O}.setRTab('memory'); })()`, 1200);
    await grab('about-tour', `document.getElementById('tabInfo').click()`, 700);
    await js(`document.querySelector('[data-a=tour]')?.click()`);
    for (let i = 0; i < 7; i++) { await grab(`tour-${i}`, i ? `document.querySelector('.tour-card [data-t=next]')?.click()` : '', 500); }
    await js(`document.querySelector('.tour-card [data-t=skip]')?.click(); document.querySelector('.tour-veil')?.remove()`);
    await grab('agent-menu', `(() => { const o = ${O}; const w = o.S.ws.workers[1]; o.office.onContext?.({ id: w.id, x: 300, y: 300 }); })()`);
    await grab('tour', `(() => { window.dispatchEvent(new Event('ao-tour')); })()`);
    fs.mkdirSync(outDir, { recursive: true });
    const rows = [...seen].map(([s, l]) => `${l}\t${s}`);
    fs.writeFileSync(path.join(outDir, 'strings.tsv'), rows.join('\n'));
    console.log('TOTAL', rows.length, '->', path.join(outDir, 'strings.tsv'));
    app.exit(0);
  });
});
