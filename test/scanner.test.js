'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { currentActivity, sentMessages, summarizeToolUse } = require('../src/main/scanner');

const asst = (content) => ({ type: 'assistant', timestamp: '2026-10-06T12:00:00.000Z', message: { content } });
const user = (content) => ({ type: 'user', message: { content } });
const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
const result = (id) => ({ type: 'tool_result', tool_use_id: id, content: 'ok' });

test('reports a running tool until its result arrives', () => {
  const call = asst([use('t1', 'Bash', { command: 'npm test' })]);
  assert.deepStrictEqual(currentActivity([user('çalıştır'), call]), { phase: 'tool', tool: 'Bash', text: 'Bash: npm test', helpers: 0 });
  assert.strictEqual(currentActivity([user('çalıştır'), call, user([result('t1')])]).phase, 'thinking');
});

test('a final text reply means the session waits for a new message', () => {
  assert.strictEqual(currentActivity([user('selam'), asst([{ type: 'text', text: 'Bitti.' }])]).phase, 'replied');
  assert.strictEqual(currentActivity([]), null);
});

test('ignores subagent (sidechain) entries', () => {
  const side = { ...asst([use('s1', 'Grep', { pattern: 'x' })]), isSidechain: true };
  assert.strictEqual(currentActivity([user('a'), asst([{ type: 'text', text: 'tamam' }]), side]).phase, 'replied');
});

test('counts subagents still running and prefers a real tool for the label', () => {
  const entries = [user('araştır'), asst([use('a1', 'Agent', { description: 'SEO' })]), asst([use('a2', 'Agent', { description: 'rakipler' })]), asst([use('r1', 'Read', { file_path: '/p/src/app.js' })])];
  const act = currentActivity(entries);
  assert.strictEqual(act.helpers, 2);
  assert.strictEqual(act.tool, 'Read');
  const later = currentActivity([...entries, user([result('r1'), result('a1')])]);
  assert.deepStrictEqual([later.helpers, later.tool], [1, 'Agent']);
});

test('tool calls from an earlier turn do not count as running', () => {
  const act = currentActivity([user('ilk'), asst([use('old', 'Bash', { command: 'sleep 9' })]), user('yeni istek'), asst([{ type: 'text', text: 'Tamam.' }])]);
  assert.strictEqual(act.phase, 'replied');
});

test('lists messages sent to other sessions', () => {
  const sends = sentMessages([asst([use('m1', 'SendMessage', { to: 'pazarlama-seo', summary: 'Brif hazır', message: 'uzun metin' })]), asst([use('x', 'Bash', { command: 'ls' })])]);
  assert.strictEqual(sends.length, 1);
  assert.deepStrictEqual({ id: sends[0].id, to: sends[0].to, text: sends[0].text }, { id: 'm1', to: 'pazarlama-seo', text: 'Brif hazır' });
  assert.ok(sends[0].ts > 0);
});

test('summarizes tool calls for labels', () => {
  assert.strictEqual(summarizeToolUse('Edit', { file_path: '/a/b/src/world/Hazards.ts' }), 'Edit world/Hazards.ts');
  assert.strictEqual(summarizeToolUse('WebSearch', { query: 'platformer keywords' }), 'WebSearch "platformer keywords"');
  assert.strictEqual(summarizeToolUse('Mystery'), 'Mystery');
});
