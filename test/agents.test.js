'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { AgentManager } = require('../src/main/agents');
const { DEFAULT_SETTINGS } = require('../src/main/store');

function fakeStore(settings = {}) {
  const project = { sessions: {}, messages: [], tasks: [], nextTask: 1, cost: 0 };
  return { settings: { ...DEFAULT_SETTINGS, ...settings }, project: () => project, pushMessage: (m) => project.messages.push(m), save() {} };
}

test('turn model follows the largest assigned task size', () => {
  const store = fakeStore();
  const m = new AgentManager(store, {});
  const qa = store.settings.team.find((a) => a.id === 'qa');
  store.project().tasks.push({ id: 'T-1', size: 's' }, { id: 'T-2', size: 'l' }, { id: 'T-3', size: null });
  const small = m.turnProfile(qa, [{ assign: true, taskId: 'T-1' }]);
  assert.deepStrictEqual(small, { size: 's', model: 'claude-haiku-4-5-20251001', effort: 'low' });
  assert.strictEqual(m.turnProfile(qa, [{ assign: true, taskId: 'T-1' }, { assign: true, taskId: 'T-2' }]).size, 'l');
  // Unsized tasks, plain messages and status notices count as medium.
  assert.strictEqual(m.turnProfile(qa, [{ assign: true, taskId: 'T-3' }]).size, 'm');
  assert.strictEqual(m.turnProfile(qa, [{ kind: 'message' }]).model, 'claude-sonnet-5-5');
  assert.strictEqual(m.turnProfile(qa, [{ kind: 'task', taskId: 'T-1' }]).size, 'm');
});

test('role and global model settings override automatic choice', () => {
  const store = fakeStore({ model: 'claude-opus-5-5' });
  const m = new AgentManager(store, {});
  const qa = store.settings.team.find((a) => a.id === 'qa');
  assert.deepStrictEqual(m.turnProfile(qa, [{ kind: 'message' }]), { size: 'm', model: 'claude-opus-5-5', effort: '' });
  assert.strictEqual(m.turnProfile({ ...qa, model: 'claude-haiku-4-5-20251001' }, [{ kind: 'message' }]).model, 'claude-haiku-4-5-20251001');
});

test('recap lists recent conversation and open tasks, not the current batch', () => {
  const store = fakeStore();
  const m = new AgentManager(store, {});
  const qa = store.settings.team.find((a) => a.id === 'qa');
  const p = store.project();
  p.messages.push({ id: 'a', from: 'pm', to: ['qa'], text: 'eski mesaj' }, { id: 'b', from: 'pm', to: ['lead'], text: 'başkasına' }, { id: 'c', from: 'pm', to: ['qa'], text: 'yeni batch' });
  p.tasks.push({ id: 'T-1', assignee: 'qa', status: 'todo', title: 'Doğrula', details: 'kriterler' }, { id: 'T-2', assignee: 'qa', status: 'done', title: 'Bitti' });
  const r = m.recap(qa, [p.messages[2]]);
  assert.match(r, /eski mesaj/);
  assert.doesNotMatch(r, /başkasına|yeni batch|T-2/);
  assert.match(r, /T-1 \[todo\] Doğrula: kriterler/);
});
