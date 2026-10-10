// Renders scripts/logo.svg to build/icon.png: npx electron scripts/render-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(process.argv[2] || 'scripts/logo.svg', 'utf8');
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true }, useContentSize: true });
  await w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(process.argv[3] || 'build/icon.png', img.toPNG());
  app.quit();
});
