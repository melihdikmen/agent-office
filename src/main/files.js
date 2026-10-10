'use strict';
// File access for the built-in editor. Everything is resolved inside one root folder
// (the project or a worker's worktree); paths that leave it, even through symlinks, are refused.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['.git', 'node_modules', '.DS_Store', 'out', 'dist', '.next', '.cache', '__pycache__', '.venv', 'build', 'coverage']);
const MAX_READ = 1024 * 1024;

function inside(root, rel) {
  const base = fs.realpathSync(root);
  const abs = path.resolve(base, String(rel || '.'));
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Yol proje dışında.');
  // the deepest existing parent must also stay inside (symlinks)
  let p = abs;
  while (!fs.existsSync(p) && p !== base) p = path.dirname(p);
  const real = fs.realpathSync(p);
  if (real !== base && !real.startsWith(base + path.sep)) throw new Error('Yol proje dışında.');
  return abs;
}

function list(root, rel = '') {
  const dir = inside(root, rel);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name) && !(e.name.startsWith('.') && !['.env.example', '.gitignore', '.github'].includes(e.name)))
    .map((e) => ({ name: e.name, dir: e.isDirectory(), path: path.posix.join(String(rel).split(path.sep).join('/'), e.name).replace(/^\//, '') }))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'tr'));
}

function read(root, rel) {
  const f = inside(root, rel);
  const st = fs.statSync(f);
  if (!st.isFile()) throw new Error('Dosya değil.');
  if (st.size > MAX_READ) return { tooBig: true, size: st.size };
  const buf = fs.readFileSync(f);
  if (buf.subarray(0, 4096).includes(0)) return { binary: true, size: st.size };
  return { text: buf.toString('utf8'), mtime: st.mtimeMs, size: st.size };
}

function write(root, rel, text) {
  const f = inside(root, rel);
  if (/(^|[\\/])\.git([\\/]|$)/.test(path.relative(root, f))) throw new Error('.git içine yazılamaz.');
  fs.writeFileSync(f, String(text));
  return { mtime: fs.statSync(f).mtimeMs };
}

const mtime = (root, rel) => { try { return fs.statSync(inside(root, rel)).mtimeMs; } catch { return 0; } };

// Flat list of files for quick open (bounded).
function walk(root, limit = 4000) {
  const out = [];
  const go = (rel) => {
    if (out.length >= limit) return;
    for (const e of list(root, rel)) { if (e.dir) go(e.path); else out.push(e.path); if (out.length >= limit) return; }
  };
  go('');
  return out;
}

module.exports = { list, read, write, mtime, walk, inside };
