'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { currentActivity } = require('../src/main/scanner');

const asst = (content) => ({ type: 'assistant', message: { content } });
const user = (content) => ({ type: 'user', message: { content } });

test('reports a running tool until its result arrives', () => {
  const call = asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }]);
  assert.deepStrictEqual(currentActivity([user('çalıştır'), call]), { phase: 'tool', text: 'Bash: npm test' });
  const after = [user('çalıştır'), call, user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }])];
  assert.strictEqual(currentActivity(after).phase, 'thinking');
});

test('a final text reply means the session waits for a new message', () => {
  assert.strictEqual(currentActivity([user('selam'), asst([{ type: 'text', text: 'Bitti.' }])]).phase, 'replied');
  assert.strictEqual(currentActivity([]), null);
});

test('ignores subagent (sidechain) entries', () => {
  const side = { ...asst([{ type: 'tool_use', id: 's1', name: 'Grep', input: { pattern: 'x' } }]), isSidechain: true };
  assert.strictEqual(currentActivity([user('a'), asst([{ type: 'text', text: 'tamam' }]), side]).phase, 'replied');
});
