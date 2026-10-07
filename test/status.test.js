'use strict';
// Office status → look rules (renderer/office/status.mjs) and the terminal gutter clamp.
const test = require('node:test');
const assert = require('node:assert');

const colors = { yellow: 'Y', purple: 'P', blue: 'B', muted: 'M', paper: 'W', ink: 'K', dark: 'D' };
const load = () => import('../src/renderer/office/status.mjs');

test('approval waiting gets the yellow "? Onay" capsule, other waiting the purple "…?"', async () => {
  const { bubbleFor, isApproval } = await load();
  assert.ok(isApproval('Bash izin istiyor'));
  assert.ok(!isApproval('hangi dal?'));
  const a = bubbleFor({}, { status: 'waiting', waitingFor: 'permission to run' }, 0, colors);
  assert.strictEqual(a.text, '? Onay'); assert.strictEqual(a.bg, 'Y'); assert.ok(a.bounce);
  const q = bubbleFor({}, { status: 'waiting', waitingFor: 'soru' }, 0, colors);
  assert.strictEqual(q.text, '…?'); assert.strictEqual(q.bg, 'P'); assert.ok(!q.bounce);
});

test('one bubble, priority: manual > waiting > offline > starting > working; urgent pulses faster', async () => {
  const { bubbleFor } = await load();
  assert.strictEqual(bubbleFor({ bubble: { text: 'selam' } }, { status: 'waiting' }, 0, colors).text, 'selam');
  assert.strictEqual(bubbleFor({}, { status: 'idle' }, 0, colors), null);
  assert.match(bubbleFor({}, { status: 'working' }, 0, colors).text, /^\.{1,3}$/);
  assert.match(bubbleFor({}, { status: 'offline' }, 0, colors).text, /^z{1,3}$/);
  const now = 1e6;
  const fresh = bubbleFor({}, { status: 'waiting', waitingFor: 'onay', statusSince: now - 5000 }, 0, colors, now);
  const old = bubbleFor({}, { status: 'waiting', waitingFor: 'onay', statusSince: now - 61000 }, 0, colors, now);
  assert.ok(old.pulse > fresh.pulse);
});

test('only idle workers wander, at most two at once', async () => {
  const { mayWander, summarize } = await load();
  assert.ok(mayWander({}, { status: 'idle' }, 1));
  assert.ok(!mayWander({}, { status: 'idle' }, 2));
  assert.ok(!mayWander({}, { status: 'waiting' }, 0));
  assert.ok(!mayWander({}, { status: 'working' }, 0));
  assert.ok(!mayWander({}, { status: 'idle', guest: true }, 0));
  assert.deepStrictEqual(summarize([{ status: 'working' }, { status: 'waiting' }, { status: 'offline' }, { status: 'idle' }]), { working: 1, waiting: 1, sleeping: 1 });
});

test('terminal layout: pruneTree drops dead panes, collapses splits, clamps ratio', async () => {
  const { pruneTree, parseSaved } = await import('../src/renderer/views/layout-tree.mjs');
  const tree = { dir: 'row', ratio: 0.5, a: { leaf: 'a' }, b: { dir: 'col', ratio: 0.99, a: { leaf: 'b' }, b: { leaf: 'c' } } };
  assert.deepStrictEqual(pruneTree(tree, new Set(['a', 'b', 'c'])), { dir: 'row', ratio: 0.5, a: { leaf: 'a' }, b: { dir: 'col', ratio: 0.85, a: { leaf: 'b' }, b: { leaf: 'c' } } });
  assert.deepStrictEqual(pruneTree(tree, new Set(['a', 'c'])), { dir: 'row', ratio: 0.5, a: { leaf: 'a' }, b: { leaf: 'c' } });
  assert.deepStrictEqual(pruneTree(tree, new Set(['b'])), { leaf: 'b' });
  assert.strictEqual(pruneTree(tree, new Set()), null);
  assert.strictEqual(pruneTree('junk', new Set(['a'])), null);
  assert.strictEqual(parseSaved('{oops'), null);
  assert.deepStrictEqual(parseSaved('{"tree":null}'), { tree: null });
});
