'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_TEAM, parseActions, stripActions, resolveRecipients, buildSystemPrompt } = require('../src/main/protocol');

test('parses messages, tasks and task updates', () => {
  const text = `Plan hazır.
<message to="qa">Login akışını test et.\nKomut: npm test</message>
<message to='frontend, backend'>API sözleşmesi docs/api.md'de</message>
<task assignee="backend" title="Reset endpoint">POST /auth/reset</task>
<task-update id="t-3" status="done">bitti</task-update>
<task-update id="T-4" status="review"/>`;
  const acts = parseActions(text);
  assert.deepStrictEqual(acts.map((a) => a.type), ['message', 'message', 'task', 'task-update', 'task-update']);
  assert.deepStrictEqual(acts[0], { type: 'message', to: ['qa'], text: 'Login akışını test et.\nKomut: npm test' });
  assert.deepStrictEqual(acts[1].to, ['frontend', 'backend']);
  assert.strictEqual(acts[2].assignee, 'backend');
  assert.strictEqual(acts[2].title, 'Reset endpoint');
  assert.deepStrictEqual(acts[3], { type: 'task-update', id: 'T-3', status: 'done', note: 'bitti' });
  assert.strictEqual(acts[4].status, 'review');
  assert.strictEqual(stripActions(text), 'Plan hazır.');
});

test('ignores empty or malformed tags', () => {
  assert.deepStrictEqual(parseActions('<message to="qa"></message><message>hi</message><task-update status="done">x</task-update>'), []);
  assert.strictEqual(parseActions('<task-update id="T-1" status="weird">x</task-update>')[0].status, null);
});

test('resolves recipients by id, name, alias and all', () => {
  const team = DEFAULT_TEAM.filter((a) => a.enabled);
  assert.deepStrictEqual(resolveRecipients(['QA', 'Deniz', 'be'], team, 'pm').ids, ['qa', 'frontend', 'backend']);
  const all = resolveRecipients(['all'], team, 'pm').ids;
  assert.ok(!all.includes('pm') && all.length === team.length - 1);
  assert.deepStrictEqual(resolveRecipients(['user', 'nobody'], team, 'pm'), { ids: ['user'], unknown: ['nobody'] });
  assert.deepStrictEqual(resolveRecipients(['pm'], team, 'pm').ids, []);
});

test('system prompt lists team and protocol', () => {
  const team = DEFAULT_TEAM.filter((a) => a.enabled);
  const p = buildSystemPrompt(team[0], team, { projectDir: '/tmp/x', language: 'Turkish' });
  assert.match(p, /id="qa"/);
  assert.match(p, /<message to=/);
  assert.match(p, /\/tmp\/x/);
  assert.match(p, /\(you\)/);
});
