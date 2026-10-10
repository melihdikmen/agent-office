'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const wt = require('../src/main/worktree');

const sh = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim();
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-wt-'));
  sh(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('worktree: isolated checkout, commit, status, merge, remove', () => {
  const dir = repo(), data = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-data-'));
  const ws = { id: 'w1', dir }, w = { id: 'abcd1234', name: 'Ada Çelik' };
  assert.ok(wt.isRepo(dir));
  const p = wt.ensure(ws, w, data);
  assert.ok(p.startsWith(data));
  assert.equal(w.worktreeBranch, 'office/ada-celik-abcd');
  assert.equal(w.worktreeBase, 'main');
  assert.equal(wt.ensure(ws, w, data), p);                       // idempotent

  fs.writeFileSync(path.join(p, 'b.txt'), 'new\n');
  assert.equal(wt.status(ws, w).dirty.length, 1);
  assert.throws(() => wt.merge(ws, w), /commitlenmemiş/);
  assert.equal(wt.commit(w, 'add b').committed, true);
  const st = wt.status(ws, w);
  assert.equal(st.ahead, 1);
  assert.deepEqual(st.files, ['b.txt']);
  assert.ok(!fs.existsSync(path.join(dir, 'b.txt')));            // the main folder is untouched until merge

  assert.deepEqual(wt.merge(ws, w), { merged: true, commits: 1 });
  assert.ok(fs.existsSync(path.join(dir, 'b.txt')));
  wt.remove(ws, w, { deleteBranch: true });
  assert.ok(!fs.existsSync(p));
});

test('worktree: conflicting merge is aborted and reported', () => {
  const dir = repo(), data = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-data-'));
  const ws = { id: 'w2', dir }, w = { id: 'ffff0000', name: 'Rio' };
  const p = wt.ensure(ws, w, data);
  fs.writeFileSync(path.join(p, 'a.txt'), 'worker\n'); wt.commit(w, 'worker edit');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'main\n'); sh(dir, 'commit', '-qam', 'main edit');
  assert.throws(() => wt.merge(ws, w), /Çakışma: a\.txt/);
  assert.equal(sh(dir, 'status', '--porcelain'), '');             // merge was rolled back
});

test('worktree: refuses a folder that is not a git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-nogit-'));
  assert.throws(() => wt.ensure({ id: 'w3', dir }, { id: 'x1x1x1x1', name: 'Sol' }, dir), /git deposu/);
});

test('worktree review data: per-file counts and a unified diff', () => {
  const dir = repo(), data = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-data-'));
  const ws = { id: 'w1', dir }, w = { id: 'abcd1234', name: 'Kai' };
  const p = wt.ensure(ws, w, data);
  fs.writeFileSync(path.join(p, 'a.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(p, 'c.txt'), 'x\n');
  wt.commit(w, 'edit');
  const f = wt.files(ws, w);
  assert.deepEqual(f.map((x) => [x.file, x.add, x.del, x.kind]), [['a.txt', 1, 0, 'M'], ['c.txt', 1, 0, 'A']]);
  assert.match(wt.diff(ws, w, 'a.txt'), /\+two/);
  assert.throws(() => wt.diff(ws, w, '--output=/tmp/x'), /Geçersiz/);
});
