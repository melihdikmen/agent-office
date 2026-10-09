'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Stt, clean } = require('../src/main/stt');

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-stt-'));
  const bin = path.join(dir, 'whisper-cli');
  fs.writeFileSync(bin, '#!/bin/sh\n# fake whisper: echoes args it was given on the text line\necho " [BLANK_AUDIO] merhaba dünya   test "\n');
  fs.chmodSync(bin, 0o755);
  const model = path.join(dir, 'm.bin');
  fs.writeFileSync(model, 'x');
  const store = { data: { sttBin: bin, sttModel: model } };
  return { stt: new Stt({ dataDir: dir, envPath: process.env.PATH, store }), dir, store, bin };
}

test('clean drops silence markers and extra spaces', () => {
  assert.equal(clean(' [BLANK_AUDIO] merhaba   dünya (müzik) '), 'merhaba dünya');
  assert.equal(clean('[ Silence ]'), '');
});

test('status: ready only with a binary and a model', () => {
  const { stt, store } = rig();
  assert.equal(stt.status().ready, true);
  store.data.sttModel = '/nope/model.bin';
  assert.equal(stt.status().ready, false);
  assert.equal(stt.status().bin !== null, true);
});

test('transcribe runs the binary on the wav and returns cleaned text', async () => {
  const { stt } = rig();
  assert.equal(await stt.transcribe(Buffer.from('RIFF'), { lang: 'tr' }), 'merhaba dünya test');
});

test('transcribe refuses when not set up', async () => {
  const { stt, store } = rig();
  store.data.sttBin = '/nope/whisper-cli'; store.data.sttModel = '/nope/m.bin';
  const bare = new Stt({ dataDir: os.tmpdir(), envPath: '/nonexistent', store });
  await assert.rejects(() => bare.transcribe(Buffer.from('x')), /kurulu değil/);
});

test('setup downloads the model through the given fetch and reports progress', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-stt-dl-'));
  const bin = path.join(dir, 'whisper-cli'); fs.writeFileSync(bin, '#!/bin/sh\n'); fs.chmodSync(bin, 0o755);
  const store = { data: { sttBin: bin } };
  const stt = new Stt({ dataDir: dir, envPath: process.env.PATH, store, minBytes: 1000 });
  const chunk = Buffer.alloc(1000, 1);
  const body = new ReadableStream({ start(c) { for (let i = 0; i < 4; i++) c.enqueue(chunk); c.close(); } });
  const msgs = [];
  await stt.setup((t) => msgs.push(t), async () => ({ ok: true, headers: { get: () => String(chunk.length * 4) }, body }));
  assert.equal(stt.status().ready, true);
  assert.ok(msgs.some((m) => /Model indiriliyor/.test(m)) && msgs.at(-1) === 'Hazır.');
});
