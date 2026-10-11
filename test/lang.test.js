'use strict';
const test = require('node:test');
const assert = require('node:assert');
const lang = require('../src/main/lang');
const { menuTemplate } = require('../src/main/tray');
const { KINDS, describeResumed } = require('../src/main/notify');
const { phrase } = require('../src/main/speak');

const actions = { show() {}, decisions() {}, toggleAutopilot() {}, worker() {}, quit() {} };

test('main-process text follows the chosen language (tray, notifications, spoken phrases)', () => {
  const views = [{ id: 'a', name: 'Ada', status: 'waiting', running: true }];
  try {
    lang.setLang('en');
    const labels = menuTemplate({ views, decisionsOpen: 1, handsOff: true, actions }).map((i) => i.label).filter(Boolean);
    assert.ok(labels.includes('Open the office') && labels.includes('Quit'));
    assert.ok(labels.some((l) => /Ada · waiting for you/.test(l)));
    assert.equal(KINDS.done.label, 'Task completed');
    assert.equal(describeResumed({ name: 'P' }, { name: 'Ada', id: 'a' }).subtitle, 'Limit reset');
    assert.match(phrase({ kind: 'waiting', title: 'P · Ada' }), /is waiting for you/);
    lang.setLang('tr');
    assert.equal(KINDS.done.label, 'Görev tamamlandı');
    assert.ok(menuTemplate({ views, decisionsOpen: 0, handsOff: false, actions }).some((i) => i.label === 'Çık'));
  } finally { lang.setLang('tr'); }
});
