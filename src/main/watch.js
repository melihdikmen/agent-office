'use strict';
// Live watch: which files in the workspace changed recently, and the diff of one.
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const IGNORE = /(^|\/)(node_modules|\.git|out|dist|build|\.next|\.cache|coverage|\.DS_Store)(\/|$)/;
const LIMIT = 300;

class Watch extends EventEmitter {
  constructor() {
    super();
    this.dir = null;
    this.watcher = null;
    this.changes = new Map();     // relative path → { ts, kind }
    this.timer = null;
  }

  start(dir) {
    if (this.dir === dir) return;
    this.stop();
    if (!dir || !fs.existsSync(dir)) return;
    this.dir = dir;
    try {
      this.watcher = fs.watch(dir, { recursive: true }, (kind, file) => {
        if (!file || IGNORE.test(file)) return;
        this.changes.set(file, { ts: Date.now(), kind });
        if (this.changes.size > LIMIT) this.changes.delete(this.changes.keys().next().value);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.emit('change'), 300);
      });
      this.watcher.on('error', () => this.stop());
    } catch { this.watcher = null; }
  }

  stop() {
    if (this.watcher) { try { this.watcher.close(); } catch { /* closed */ } }
    this.watcher = null;
    this.dir = null;
    this.changes.clear();
  }

  list() {
    return [...this.changes.entries()].map(([file, c]) => ({ file, ...c })).sort((a, b) => b.ts - a.ts);
  }

  git(args) {
    return new Promise((resolve) => {
      execFile('git', args, { cwd: this.dir, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err && !out ? null : String(out)));
    });
  }

  // Unified diff for one file; untracked files show as all-added.
  async diff(file) {
    if (!this.dir || /\.\./.test(file)) return { file, diff: '', error: 'geçersiz yol' };
    const tracked = await this.git(['ls-files', '--error-unmatch', '--', file]);
    if (tracked === null) {
      try {
        const text = fs.readFileSync(path.join(this.dir, file), 'utf8');
        return { file, untracked: true, diff: text.split('\n').slice(0, 2000).map((l) => `+${l}`).join('\n') };
      } catch (e) { return { file, diff: '', error: e.message }; }
    }
    const out = await this.git(['diff', '--no-color', '--', file]);
    return { file, diff: (out || '').slice(0, 200000) };
  }

  async status() {
    if (!this.dir) return [];
    const out = await this.git(['status', '--porcelain', '--untracked-files=all']);
    return (out || '').split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2).trim(), file: l.slice(3) })).filter((x) => !IGNORE.test(x.file));
  }
}

module.exports = { Watch };
