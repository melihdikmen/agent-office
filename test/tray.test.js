'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { menuTemplate, summary } = require('../src/main/tray');
const { parseList } = require('../src/main/github');

const actions = { show() {}, decisions() {}, toggleAutopilot() {}, worker() {}, quit() {} };
const views = [{ id: 'a', name: 'Ada', status: 'working', running: true }, { id: 'b', name: 'Rio', status: 'waiting', running: true }, { id: 'c', name: 'Sol', status: 'offline', running: false }];

test('tray summary counts what needs attention', () => {
  assert.deepEqual(summary(views, 2), { working: 1, waiting: 1, attention: 3 });
});

test('tray menu lists counts, decisions only when open, every worker and quit', () => {
  const labels = (t) => t.filter((x) => x.label).map((x) => x.label);
  const m = labels(menuTemplate({ views, decisionsOpen: 2, handsOff: true, actions }));
  assert.equal(m[0], '1 çalışıyor · 1 bekliyor · 2 karar');
  assert.ok(m.includes('Bekleyen kararlar (2)'));
  assert.ok(m.includes('Otopilot: açık (değiştir)'));
  assert.ok(m.includes('Rio · seni bekliyor') && m.includes('Sol · uyuyor'));
  assert.equal(m.at(-1), 'Çık');
  assert.ok(!labels(menuTemplate({ views, decisionsOpen: 0, handsOff: false, actions })).some((l) => /Bekleyen kararlar/.test(l)));
});

test('pasted lists become task titles', () => {
  assert.deepEqual(parseList('- [ ] Giriş ekranı\n* Şifre sıfırlama\n1. Profil sayfası\n2) Raporlar\n\nx\nDüz satır'), ['Giriş ekranı', 'Şifre sıfırlama', 'Profil sayfası', 'Raporlar', 'Düz satır']);
});
