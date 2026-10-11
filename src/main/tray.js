'use strict';
const { tt } = require('./lang');
// Menu-bar icon: live counts at a glance and quick actions without opening the window.
const path = require('path');

function summary(views, decisionsOpen) {
  const n = { working: 0, waiting: 0 };
  for (const v of views) { if (v.status === 'working') n.working++; else if (v.status === 'waiting') n.waiting++; }
  return { ...n, attention: n.waiting + decisionsOpen };
}

function menuTemplate({ views, decisionsOpen, handsOff, actions }) {
  const s = summary(views, decisionsOpen);
  const t = [
    { label: tt(`${s.working} çalışıyor · ${s.waiting} bekliyor · ${decisionsOpen} karar`, `${s.working} working · ${s.waiting} waiting · ${decisionsOpen} decisions`), enabled: false },
    { type: 'separator' },
    { label: tt('Ofisi aç', 'Open the office'), click: actions.show },
  ];
  if (decisionsOpen) t.push({ label: tt(`Bekleyen kararlar (${decisionsOpen})`, `Pending decisions (${decisionsOpen})`), click: actions.decisions });
  t.push({ label: tt(`Otopilot: ${handsOff ? 'açık' : 'kapalı'} (değiştir)`, `Autopilot: ${handsOff ? 'on' : 'off'} (toggle)`), click: actions.toggleAutopilot });
  if (views.length) t.push({ type: 'separator' }, ...views.slice(0, 12).map((v) => ({ label: `${v.name} · ${v.status === 'working' ? tt('çalışıyor', 'working') : v.status === 'waiting' ? tt('seni bekliyor', 'waiting for you') : v.running ? tt('boşta', 'idle') : tt('uyuyor', 'asleep')}`, click: () => actions.worker(v.id) })));
  t.push({ type: 'separator' }, { label: tt('Çık', 'Quit'), click: actions.quit });
  return t;
}

class AppTray {
  constructor({ Tray, Menu, nativeImage }, actions) {
    this.Menu = Menu; this.actions = actions; this.key = '';
    const img = nativeImage.createFromPath(path.join(__dirname, 'tray.png')).resize({ width: 18, height: 18 });
    this.tray = new Tray(img);
    this.tray.setToolTip('Agent Office');
    this.tray.on('click', actions.show);
  }
  update(views, decisionsOpen, handsOff) {
    const s = summary(views, decisionsOpen);
    const key = JSON.stringify([views.map((v) => [v.id, v.status, v.running]), decisionsOpen, handsOff]);
    if (key === this.key) return;
    this.key = key;
    this.tray.setTitle(s.attention ? ` ${s.attention}` : '');
    this.tray.setContextMenu(this.Menu.buildFromTemplate(menuTemplate({ views, decisionsOpen, handsOff, actions: this.actions })));
  }
}

module.exports = { AppTray, menuTemplate, summary };
