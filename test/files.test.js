'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const files = require('../src/main/files');

function proj() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-files-'));
  fs.mkdirSync(path.join(d, 'src')); fs.mkdirSync(path.join(d, 'node_modules'));
  fs.writeFileSync(path.join(d, 'src', 'a.js'), 'x = 1\n');
  fs.writeFileSync(path.join(d, 'README.md'), '# hi\n');
  fs.writeFileSync(path.join(d, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
  return d;
}

test('list: folders first, noise skipped; read/write round trip', () => {
  const d = proj();
  assert.deepEqual(files.list(d).map((e) => e.name), ['src', 'bin.dat', 'README.md']);
  assert.deepEqual(files.list(d, 'src'), [{ name: 'a.js', dir: false, path: 'src/a.js' }]);
  assert.equal(files.read(d, 'src/a.js').text, 'x = 1\n');
  assert.equal(files.read(d, 'bin.dat').binary, true);
  files.write(d, 'src/new.js', 'y');
  assert.equal(fs.readFileSync(path.join(d, 'src/new.js'), 'utf8'), 'y');
  assert.deepEqual(files.walk(d).sort(), ['README.md', 'bin.dat', 'src/a.js', 'src/new.js']);
});

test('paths cannot leave the root, not even through symlinks or .git', () => {
  const d = proj(), out = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-out-'));
  fs.symlinkSync(out, path.join(d, 'link'));
  assert.throws(() => files.read(d, '../etc/passwd'), /dışında/);
  assert.throws(() => files.write(d, '../x.txt', 'a'), /dışında/);
  assert.throws(() => files.write(d, 'link/x.txt', 'a'), /dışında/);
  fs.mkdirSync(path.join(d, '.git'));
  assert.throws(() => files.write(d, '.git/config', 'a'), /\.git/);
});

test('create and rename stay inside the root and refuse to overwrite', () => {
  const d = proj();
  files.create(d, 'src/lib/x.js', false);
  files.create(d, 'docs', true);
  assert.ok(fs.existsSync(path.join(d, 'src/lib/x.js')) && fs.statSync(path.join(d, 'docs')).isDirectory());
  assert.throws(() => files.create(d, 'docs', true), /zaten/);
  files.rename(d, 'src/lib/x.js', 'src/lib/y.js');
  assert.ok(fs.existsSync(path.join(d, 'src/lib/y.js')));
  assert.throws(() => files.rename(d, 'src/a.js', 'README.md'), /zaten/);
  assert.throws(() => files.rename(d, 'src/a.js', '../out.js'), /dışında/);
  assert.throws(() => files.create(d, '../evil', false), /dışında/);
});
