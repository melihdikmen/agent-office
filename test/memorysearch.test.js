'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Memory } = require('../src/main/memory');

function rig(list) {
  const m = Object.create(Memory.prototype);
  m.notes = () => list.map((n, i) => ({ id: `n${i}`, worker: 'a', name: 'Ada', ts: '2026-10-0' + (i + 1), tags: [], ...n }));
  return m;
}

test('turkish letters and word endings still match', () => {
  const m = rig([{ text: 'Şifre sıfırlama akışında token süresi 15 dakika' }, { text: 'Kahve makinesi bozuk' }]);
  assert.match(m.search({}, 'sifre sifirlama')[0], /Şifre sıfırlama/);
  assert.match(m.search({}, 'dakikalik')[0] || '', /dakika/);          // longer form of the stored word
  assert.deepEqual(m.search({}, 'zzz'), []);
});

test('best match first, not all words required, rarer words and tags weigh more', () => {
  const m = rig([
    { text: 'Veritabanı olarak SQLite seçildi', tags: ['db'] },
    { text: 'Arayüz renkleri koyu tema olacak' },
    { text: 'SQLite dosyası out klasöründe tutulur, yedek alınır' },
  ]);
  const r = m.search({}, 'sqlite veritabani karari');
  assert.match(r[0], /Veritabanı olarak SQLite/);
  assert.equal(r.length, 2);                                            // the UI note does not match at all
  assert.match(m.search({}, 'db')[0], /Veritabanı/);                    // tag hit
});

test('newer notes win ties', () => {
  const m = rig([{ text: 'deploy adımı eski' }, { text: 'deploy adımı yeni' }]);
  assert.match(m.search({}, 'deploy')[0], /yeni/);
});
