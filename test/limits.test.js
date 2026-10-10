'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detect, parseReset, MARGIN_MS } = require('../src/main/limits');

const at = (h, m = 0, d = 0) => { const x = new Date(2026, 9, 10 + d, h, m, 0, 0); return x.getTime(); };
const NOW = at(14, 10);

test('reset times: clock formats roll to the next occurrence, durations add up', () => {
  assert.equal(parseReset('limit reached · resets 3pm', NOW), at(15));
  assert.equal(parseReset('resets at 11:30 PM', NOW), at(23, 30));
  assert.equal(parseReset('resets 9am', NOW), at(9, 0, 1));                 // already past today → tomorrow
  assert.equal(parseReset('resets 12am', NOW), at(0, 0, 1));
  assert.equal(parseReset('try again in 2h 15m', NOW), NOW + 135 * 60000);
  assert.equal(parseReset('try again in 45 minutes', NOW), NOW + 45 * 60000);
  assert.equal(parseReset('nothing here', NOW), null);
});

test('detect needs a limit phrase and a reset phrase', () => {
  const hit = detect('...\nClaude usage limit reached. Your limit will reset at 3pm.', NOW);
  assert.equal(hit.resetAt, at(15) + MARGIN_MS);
  assert.equal(hit.guessed, false);
  assert.ok(detect('5-hour limit reached ∙ resets 5pm', NOW));
  assert.equal(detect('I added a rate limit middleware to the API', NOW), null);      // talk about limits is not a limit
  assert.equal(detect('the cache resets every night', NOW), null);
});

test('no time given → guess half an hour ahead', () => {
  const hit = detect('You have hit your limit. Please try again later.', NOW);
  assert.equal(hit.guessed, true);
  assert.ok(hit.resetAt > NOW + 25 * 60000 && hit.resetAt < NOW + 40 * 60000);
});

test('only the last lines count', () => {
  const old = 'usage limit reached, resets 3pm\n' + 'x\n'.repeat(30);
  assert.equal(detect(old, NOW), null);
});

test('budget: warn at 80%, stop at 100%, count from the first reading after a start', () => {
  const { Workers } = require('../src/main/workers');
  const events = [], stops = [];
  const w = { id: 'a1', name: 'Ada', budget: 5 };
  const ws = { id: 'w1', workers: [w] };
  const fake = Object.create(Workers.prototype);
  Object.assign(fake, { store: { save() {} }, emit: (n, p) => events.push([n, p.stopped, Math.round(p.spent * 100) / 100]), stop: (_ws, id) => stops.push(id) });
  const tick = (cost, running = true) => fake.budgetTick(ws, [{ id: 'a1', running, cost }]);
  tick(2);                               // first reading = starting point
  tick(5.9);                             // $3.9 spent → below 80%
  assert.equal(events.length, 0);
  tick(6.1);                             // $4.1 → warn
  tick(6.5);                             // no second warning
  assert.deepEqual(events, [['budget', false, 4.1]]);
  tick(7.2);                             // $5.2 → stop
  assert.deepEqual(stops, ['a1']);
  assert.deepEqual(events.at(-1), ['budget', true, 5.2]);
  tick(0, false);                        // stopped: flags reset, ready for the next start
  assert.equal(w.budgetFrom, null);
});
