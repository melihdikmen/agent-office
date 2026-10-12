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

test('chat send: box empties at once, double send ignored, text returns on failure', async () => {
  const { sendDraft } = await import('../src/renderer/views/chat-send.mjs');
  const mk = (send) => { const box = { v: '  merhaba ' }; const toasts = []; return { box, toasts, ctx: { get: () => box.v, set: (v) => { box.v = v; }, send, toast: (m) => toasts.push(m) } }; };
  // slow send: box already empty while pending, second Enter is ignored
  let release; const sent = [];
  const slow = mk((t) => new Promise((r) => { sent.push(t); release = r; }));
  const p1 = sendDraft(slow.ctx);
  assert.strictEqual(slow.box.v, '');
  slow.box.v = 'ikinci';
  assert.strictEqual(await sendDraft(slow.ctx), false);
  assert.deepStrictEqual(sent, ['merhaba']);
  release({}); assert.strictEqual(await p1, true);
  assert.strictEqual(slow.box.v, 'ikinci');
  // error result and thrown error both restore the text and toast
  const bad = mk(async () => ({ error: 'ağ yok' }));
  assert.strictEqual(await sendDraft(bad.ctx), false);
  assert.strictEqual(bad.box.v, 'merhaba'); assert.deepStrictEqual(bad.toasts, ['ağ yok']);
  const boom = mk(async () => { throw new Error('düştü'); });
  await sendDraft(boom.ctx); assert.strictEqual(boom.box.v, 'merhaba'); assert.deepStrictEqual(boom.toasts, ['düştü']);
  // owner typed something new meanwhile: don't overwrite it
  const typed = mk(async () => ({ error: 'x' })); typed.ctx.send = async () => { typed.box.v = 'yeni'; return { error: 'x' }; };
  await sendDraft(typed.ctx); assert.strictEqual(typed.box.v, 'yeni');
  assert.strictEqual(await sendDraft(mk(async () => ({})).ctx = { get: () => '   ', set() {}, send() {}, toast() {} }), false);
});

test('chat pending: recipients, states, clearing on reply, late timeout, optimistic', async () => {
  const { pendingList, recipientsOf, lateIn, LATE_MS } = await import('../src/renderer/views/chat-pending.mjs');
  const ws = [{ id: 'n', name: 'Nova', color: 'N', status: 'working' }, { id: 'a', name: 'Ada', color: 'A', status: 'offline' }, { id: 'r', name: 'Rio', color: 'R', status: 'waiting' }];
  const kinds = (o) => pendingList({ workers: ws, leadId: 'n', now: 1000, ...o }).map((p) => `${p.name}:${p.kind}`);
  assert.deepStrictEqual(recipientsOf('selam @ada ve @RIO', ws, 'n'), ['a', 'r']);
  assert.deepStrictEqual(recipientsOf('selam', ws, 'n'), ['n']);
  assert.deepStrictEqual(kinds({ msgs: [{ from: 'user', to: 'team', ts: 500 }] }), ['Nova:thinking']);
  assert.deepStrictEqual(kinds({ msgs: [{ from: 'user', to: 'a,r', ts: 500 }] }), ['Ada:asleep', 'Rio:approval']);
  // a reply after the message clears only that person; an older reply does not
  const msgs = [{ from: 'a', to: 'user', ts: 100 }, { from: 'user', to: 'a,r', ts: 500 }, { from: 'a', to: 'user', ts: 600 }];
  assert.deepStrictEqual(kinds({ msgs }), ['Rio:approval']);
  assert.deepStrictEqual(kinds({ msgs: msgs.slice(0, 2) }), ['Ada:asleep', 'Rio:approval']);
  // timeout
  assert.deepStrictEqual(pendingList({ workers: ws, leadId: 'n', msgs: [{ from: 'user', to: 'team', ts: 0 }], now: LATE_MS + 1 }).map((p) => p.kind), ['late']);
  assert.ok(lateIn([{ from: 'user', ts: 0 }], null, 1000) > 0); assert.strictEqual(lateIn([{ from: 'user', ts: 0 }], null, LATE_MS + 5), null);
  // optimistic shows before the real message arrives, then yields to it
  assert.deepStrictEqual(kinds({ msgs: [], optimistic: { ts: 900, text: '@ada hey' } }), ['Ada:asleep']);
  assert.deepStrictEqual(kinds({ msgs: [{ from: 'user', to: 'team', ts: 905 }], optimistic: { ts: 900, text: '@ada hey' } }), ['Nova:thinking']);
  assert.deepStrictEqual(kinds({ msgs: [], optimistic: null }), []);
});

test('chat list: agent filter, header grouping, folding helpers', async () => {
  const { filterMsgs, headFlags, isLong, continuesInTerminal, viaTerminal } = await import('../src/renderer/views/chat-list.mjs');
  const msgs = [
    { from: 'user', to: 'a,b', ts: 0 }, { from: 'a', to: 'user', ts: 1000 }, { from: 'a', to: 'user', ts: 2000 },
    { from: 'b', to: 'user', ts: 3000 }, { from: 'a', to: 'user', ts: 3000 + 6 * 60000 }, { from: 'a', to: 'user', ts: 3000 + 6 * 60000 + 10 }, { from: 'a', to: 'b', kind: 'dm', ts: 3000 + 6 * 60000 + 20 },
  ];
  assert.strictEqual(filterMsgs(msgs, null), msgs);
  assert.deepStrictEqual(filterMsgs(msgs, 'b').map((m) => m.ts), [0, 3000, 3000 + 6 * 60000 + 20]);
  assert.deepStrictEqual(headFlags(msgs), [true, true, false, true, true, false, true]);
  assert.deepStrictEqual(headFlags([]), []);
  assert.ok(isLong('x'.repeat(601)) && !isLong('x'.repeat(600)) && !isLong(undefined));
  assert.ok(continuesInTerminal('uzun cevap … (devamı terminalde)') && !continuesInTerminal('devamı terminalde değil'));
  assert.ok(viaTerminal({ via: 'terminal' }) && !viaTerminal({}) && !viaTerminal(null));
});

test('chat: terminal-typed owner messages (kind:"term") get the badge, filter by agent, never trigger "thinking"', async () => {
  const { viaTerminal, filterMsgs } = await import('../src/renderer/views/chat-list.mjs');
  const { pendingList, lateIn } = await import('../src/renderer/views/chat-pending.mjs');
  const term = { from: 'user', to: 'a', kind: 'term', ts: 1000, text: 'terminalden' };
  assert.ok(viaTerminal(term) && viaTerminal({ via: 'terminal' }) && !viaTerminal({ from: 'user', to: 'team' }));
  assert.deepStrictEqual(filterMsgs([term, { from: 'user', to: 'b', ts: 1 }], 'a'), [term]);
  const ws = [{ id: 'a', name: 'Ada', color: 'A', status: 'working' }];
  assert.deepStrictEqual(pendingList({ msgs: [term], workers: ws, leadId: 'a', now: 2000 }), []);
  assert.strictEqual(lateIn([term], null, 2000), null);
  // a chat message before it still counts; the later terminal message does not replace it
  const chat = { from: 'user', to: 'team', ts: 500 };
  assert.deepStrictEqual(pendingList({ msgs: [chat, term], workers: ws, leadId: 'a', now: 2000 }).map((p) => p.kind), ['thinking']);
});

test('project chip: name shortening, stable colors, agent vs shell label', async () => {
  const { shortName, projectColor, chipModel, MAX_NAME } = await import('../src/renderer/views/project-chip.mjs');
  assert.strictEqual(shortName('Product HQ'), 'Product HQ');
  const long = shortName('Çok uzun bir ofis adı burada'); assert.ok(long.length <= MAX_NAME && long.endsWith('…'));
  assert.strictEqual(shortName(null), '');
  assert.strictEqual(projectColor('Product HQ'), projectColor('Product HQ'));
  assert.match(projectColor('x'), /^#[0-9a-f]{6}$/);
  assert.notStrictEqual(new Set(['A', 'B', 'C', 'Product HQ', 'Docs', 'Web'].map(projectColor)).size, 1);
  const p = { name: 'Product HQ', dir: '/Users/me/work/product' };
  const a = chipModel(p, { multi: true });
  assert.deepStrictEqual([a.icon, a.label, a.dim, a.path], ['📁', 'Product HQ', false, '/Users/me/work/product']);
  const sh = chipModel(p, { shell: true });
  assert.deepStrictEqual([sh.icon, sh.label, sh.dim], ['⌂', 'product', true]);
  assert.strictEqual(chipModel({ name: 'product', dir: '/x/product' }).path, '');   // folder = office name: no extra path
  assert.strictEqual(chipModel(null), null);
  assert.strictEqual(chipModel({ name: 'A', dir: '/a', color: '#123456' }).color, '#123456');
});
