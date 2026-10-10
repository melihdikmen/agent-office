'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Skills, BUILTIN } = require('../src/main/skills');

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-skills-'));
  const store = { data: {}, workspaces: [], save() {} };
  return { sk: new Skills(store, dir), dir, store };
}

test('built-in skills are well formed', () => {
  const ids = new Set();
  for (const s of BUILTIN) {
    assert.ok(s.id && s.name && s.description.length > 30 && s.body.length > 100, s.id);
    assert.ok(!ids.has(s.id)); ids.add(s.id);
  }
  assert.ok(BUILTIN.length >= 7);
});

test('custom skills: create, edit, delete, validation, unique ids', () => {
  const { sk, store } = rig();
  const id = sk.save({ name: 'Kod Stili', description: 'Use when formatting code.', body: 'Use tabs.' });
  assert.equal(id, 'my-kod-stili');
  assert.equal(sk.save({ name: 'Kod Stili', description: 'x'.repeat(10), body: 'b' }), 'my-kod-stili-2');
  sk.save({ id, name: 'Kod Stili 2', description: 'Use when styling.', body: 'Use spaces.' });
  assert.equal(sk.find(id).body, 'Use spaces.');
  assert.throws(() => sk.save({ name: '', description: 'd', body: 'b' }), /gerekli/);
  assert.throws(() => sk.save({ id: 'systematic-debugging', name: 'x', description: 'd', body: 'b' }), /düzenlenemez/);
  store.workspaces.push({ workers: [{ id: 'w', skills: [id, 'spike'] }] });
  sk.remove(id);
  assert.equal(sk.find(id), null);
  assert.deepEqual(store.workspaces[0].workers[0].skills, ['spike']);
});

test('plugin dir has a manifest and one SKILL.md per skill; none → null and old dir removed', () => {
  const { sk, dir } = rig();
  const w = { id: 'w1', skills: ['spike', 'nope', 'test-driven-development'] };
  const p = sk.pluginFor(w);
  assert.equal(JSON.parse(fs.readFileSync(path.join(p, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'office-skills');
  const md = fs.readFileSync(path.join(p, 'skills', 'spike', 'SKILL.md'), 'utf8');
  assert.match(md, /^---\nname: spike\ndescription: .+\n---\n\n# Spike/);
  assert.ok(fs.existsSync(path.join(p, 'skills', 'test-driven-development', 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(p, 'skills', 'nope')));
  w.skills = [];
  assert.equal(sk.pluginFor(w), null);
  assert.ok(!fs.existsSync(path.join(dir, 'engines', 'w1', 'skills-plugin')));
});

test('briefing section for engines without skills', () => {
  const { sk } = rig();
  assert.deepEqual(sk.briefing({ skills: [] }), []);
  assert.match(sk.briefing({ skills: ['spike'] }).join('\n'), /## Skills[\s\S]*### Spike/);
});

test('proposals: a worker drafts a skill, the owner accepts it into the library', () => {
  const store = { data: {}, workspaces: [], save() {} };
  const sk = new Skills(store, require('os').tmpdir());
  const p = sk.propose({ id: 'w1', name: 'Ada' }, { name: 'Sürüm notu akışı', description: 'Use when shipping a release.', body: '1. Topla\n2. Yaz' });
  assert.equal(sk.proposals().length, 1);
  sk.propose({ id: 'w1', name: 'Ada' }, { name: 'sürüm notu akışı', description: 'Use when shipping.', body: 'x' });   // same name updates
  assert.equal(sk.proposals().length, 1);
  assert.throws(() => sk.propose({ id: 'w1', name: 'Ada' }, { name: 'a', description: '', body: 'b' }), /gerekli/);
  const id = sk.acceptProposal(p.id);
  assert.ok(sk.find(id));
  assert.equal(sk.proposals().length, 0);
});
