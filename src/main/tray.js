'use strict';
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
    { label: `${s.working} çalışıyor · ${s.waiting} bekliyor · ${decisionsOpen} karar`, enabled: false },
    { type: 'separator' },
    { label: 'Ofisi aç', click: actions.show },
  ];
  if (decisionsOpen) t.push({ label: `Bekleyen kararlar (${decisionsOpen})`, click: actions.decisions });
  t.push({ label: `Otopilot: ${handsOff ? 'açık' : 'kapalı'} (değiştir)`, click: actions.toggleAutopilot });
  if (views.length) t.push({ type: 'separator' }, ...views.slice(0, 12).map((v) => ({ label: `${v.name} · ${v.status === 'working' ? 'çalışıyor' : v.status === 'waiting' ? 'seni bekliyor' : v.running ? 'boşta' : 'uyuyor'}`, click: () => actions.worker(v.id) })));
  t.push({ type: 'separator' }, { label: 'Çık', click: actions.quit });
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
