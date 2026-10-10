'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Designs } = require('../src/main/designs');

function rig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-des-'));
  return { d: new Designs({ save() {}, workspaceDir: (id) => path.join(root, id) }), ws: { id: 'w1' }, root };
}

test('same title adds a version; get returns html and file', () => {
  const { d, ws } = rig();
  const a = d.save(ws, { id: 'k1' }, { title: 'Ana ekran', html: '<h1>v1</h1>' });
  const b = d.save(ws, { id: 'k1' }, { title: 'ana EKRAN', html: '<h1>v2</h1>', summary: 'kart eklendi' });
  assert.equal(a.design.id, 'D-1'); assert.equal(b.design.id, 'D-1'); assert.equal(b.v, 2);
  assert.equal(d.list(ws).length, 1);
  assert.equal(d.get(ws, 'D-1').html, '<h1>v2</h1>');
  assert.equal(d.get(ws, 'D-1', 1).html, '<h1>v1</h1>');
  assert.equal(d.save(ws, { id: 'k1' }, { title: 'Profil', html: 'x' }).design.id, 'D-2');
});

test('approve, a new version reopens it, validation and removal', () => {
  const { d, ws } = rig();
  d.save(ws, { id: 'k1' }, { title: 'A', html: 'x' });
  assert.equal(d.approve(ws, 'D-1').status, 'approved');
  d.save(ws, { id: 'k1' }, { title: 'A', html: 'y' });
  assert.equal(d.list(ws)[0].status, 'draft');
  assert.throws(() => d.save(ws, null, { title: '', html: 'x' }), /Başlık/);
  assert.throws(() => d.save(ws, null, { title: 'B', html: '   ' }), /boş/);
  assert.throws(() => d.save(ws, null, { title: 'B', html: 'x'.repeat(700 * 1024) }), /büyük/);
  assert.throws(() => d.get(ws, 'D-9'), /bulunamadı/);
  d.remove(ws, 'D-1');
  assert.equal(d.list(ws).length, 0);
});
