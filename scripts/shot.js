'use strict';
// Dev aid: `npm run shot` opens the app on a throwaway office (out/shot-data,
// project folder out/shot-proj), hires a demo crew and saves screenshots of the
// main views to out/shots/. Two workers are started for real so their terminals
// show Claude Code; they are stopped again at the end.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'out', 'shots');
const proj = path.join(root, 'out', 'shot-proj');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(proj, { recursive: true });
fs.rmSync(path.join(root, 'out', 'shot-data'), { recursive: true, force: true });
process.env.AGENT_OFFICE_DATA = path.join(root, 'out', 'shot-data');
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
      await api.wsCreate({ name: 'Ürün HQ', dir: ${JSON.stringify(proj)} });
      const roles = [['Ada', 'Lider', true], ['Nova', 'Frontend Geliştirici'], ['Kai', 'Backend Geliştirici'], ['Rio', 'QA'], ['Sol', 'Tasarımcı']];
      const ids = [];
      for (const [name, role, lead] of roles) ids.push(await api.workerCreate({ name, role, lead: !!lead, model: 'haiku' }));
      await api.workerStart({ id: ids[0], cols: 100, rows: 30 });
      await api.workerStart({ id: ids[1], cols: 100, rows: 30 });
      const t1 = await api.taskCreate({ title: 'Giriş ekranına "şifremi unuttum" akışı', details: 'E-posta ile sıfırlama bağlantısı, 15 dk geçerli token, başarı/hata ekranları.' });
      const t2 = await api.taskCreate({ title: 'Form doğrulama (zod)', assignee: ids[1] });
      await api.taskUpdate({ id: t2, patch: { status: 'doing' } });
      const t3 = await api.taskCreate({ title: 'API: POST /auth/reset', assignee: ids[2] });
      await api.taskCreate({ title: 'Dark mode kontrast kontrolü', assignee: ids[4] });
      await api.taskDone({ id: t3, report: { summary: 'Endpoint eklendi, token 15 dk geçerli, e-posta kuyruğa yazılıyor.', evidence: [{ label: 'npm run typecheck', ok: true, detail: '0 hata' }, { label: 'npm test', ok: true, detail: '42 passed' }, { label: 'Manuel: Postman ile 3 senaryo', ok: false, detail: 'süresi dolmuş token 500 döndürüyor' }], files: ['src/api/auth/reset.ts', 'src/api/auth/reset.test.ts'] } });
      window.__office.S.layoutFor = null;
    })()`);
    await wait(6000);
    console.log('debug', await js('JSON.stringify({ wheels: window.__office.office.wheels || 0, userMoved: window.__office.office.userMoved, h: document.getElementById("office").clientHeight })'));
    await shot('office', `(() => { const o = window.__office; o.select(o.S.ws.workers[1].id); })()`, 2500);
    await shot('terminal', `(() => { const o = window.__office; o.openWorkerTerminal(o.S.ws.workers[0].id); })()`, 3500);
    await shot('terminal2', `(() => { const o = window.__office; o.openWorkerTerminal(o.S.ws.workers[1].id); })()`, 3500);
    await wait(Number(process.env.SHOT_WAIT || 0));
    await shot('board', `(() => { const o = window.__office; o.setRTab('board'); o.board.open = o.S.ws.tasks[0].id; o.board.render(); })()`, 1200);
    await shot('reports', `window.__office.setRTab('reports')`, 1000);
    await shot('memory', `window.__office.setRTab('memory')`, 1500);
    await shot('code', `(() => { const o = window.__office; o.setRTab('terminal'); o.setLTab('code'); })()`, 1500);
    await shot('edit', `(() => { const o = window.__office; o.setLTab('office'); document.getElementById('editBtn').click(); })()`, 1200);
    await shot('hub', `(() => { const o = window.__office; document.getElementById('editBtn').click(); o.setRTab('hub'); })()`, 1000);
    await shot('browser', `(() => { const o = window.__office; o.setRTab('browser'); })()`, 2500);
    await shot('chat', `(async () => { const o = window.__office; await window.office.chatSend({ text: 'Giriş ekranına şifremi unuttum akışı ekleyelim, @' + o.S.ws.workers[1].name + ' tasarımı yapsın.' }); o.setRTab('chat'); })()`, 2500);
    await shot('board-list', `(() => { const o = window.__office; o.setRTab('board'); o.board.open = null; o.board.mode = 'list'; o.board.render(); })()`, 1000);
    await shot('theme-light', `(() => { const o = window.__office; o.setRTab('reports'); document.querySelector('.rp')?.click(); window.__applyTheme && window.__applyTheme('gunduz'); })()`, 1200);
    await js(`(() => { const o = window.__office; o.setRTab('browser'); const b = o.browser; b.view.src = 'data:text/html,' + encodeURIComponent('<body style="font:20px sans-serif;padding:30px"><h1 id=t>Merhaba</h1><button class=cta>Kaydet</button></body>'); b.started = true; })()`);
    await new Promise((r) => setTimeout(r, 1500));
    await shot('annot', `(() => { const o = window.__office; const b = o.browser; b.toggle(true); b.marks = [{ x: 80, y: 90, text: 'Başlık çok küçük' }, { x: 120, y: 160, text: 'Düğme mavi olsun' }]; b.draw(); })()`, 800);
    console.log('annot-send', await js(`(async () => { const b = window.__office.browser; const r = await window.office.annotSend ? 'api-ok' : 'no-api'; await b.send(); return r; })()`));
    await shot('review', `(() => { window.__applyTheme('gece'); window.__office.setRTab('review'); })()`, 1200);
    await shot('skills', `(() => { window.__office.setRTab('skills'); })()`, 1000);
    await shot('hire', `(() => { const o = window.__office; o.setRTab('terminal'); o.workerDialog(); })()`, 1000);
    await js(`(async () => { for (const w of window.__office.S.ws.workers) await window.office.workerStop({ id: w.id }); })()`);
    await wait(800);
    app.quit();
  });
});
