'use strict';
// Real terminals: every worker and every plain shell runs in its own pty. Output is
// streamed to the renderer and kept in a scrollback buffer so a pane can be
// re-attached (tab switch, reload) without losing what was on screen.
const { EventEmitter } = require('events');
const os = require('os');
const pty = require('node-pty');

const BUFFER_LIMIT = 400 * 1024;

class Terminals extends EventEmitter {
  constructor(env) {
    super();
    this.env = env;
    this.items = new Map();
    this.seq = 0;
  }

  create({ id, kind = 'shell', workerId = null, title = '', cwd, cmd, args = [], env = {}, cols = 100, rows = 30 }) {
    id = id || `t${++this.seq}`;
    if (this.items.has(id)) this.kill(id);
    const shell = process.env.SHELL || '/bin/zsh';
    const proc = pty.spawn(cmd || shell, cmd ? args : ['-l'], {
      name: 'xterm-256color', cols, rows, cwd: cwd || os.homedir(),
      env: { ...this.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: this.env.LANG || 'en_US.UTF-8' },
    });
    const item = { id, kind, workerId, title: title || (kind === 'shell' ? `shell ${this.seq}` : id), cwd, pid: proc.pid, proc, buffer: '', cols, rows, exited: null, created: Date.now() };
    this.items.set(id, item);
    proc.onData((data) => {
      item.buffer += data;
      if (item.buffer.length > BUFFER_LIMIT) item.buffer = item.buffer.slice(-BUFFER_LIMIT * 0.75);
      this.emit('data', { id, data });
    });
    proc.onExit(({ exitCode }) => {
      item.exited = exitCode;
      item.buffer += `\r\n\x1b[90m[çıkış ${exitCode}]\x1b[0m\r\n`;
      this.emit('exit', { id, code: exitCode });
    });
    this.emit('change');
    return this.snapshot(item);
  }

  write(id, data) {
    const it = this.items.get(id);
    if (it && it.exited === null) it.proc.write(data);
  }

  // Multi-line text goes in as a bracketed paste so the program gets it as one block.
  paste(id, text) {
    const t = String(text || '');
    if (t.includes('\n')) this.write(id, `\x1b[200~${t}\x1b[201~`);
    else this.write(id, t);
  }

  resize(id, cols, rows) {
    const it = this.items.get(id);
    if (!it || it.exited !== null) return;
    it.cols = cols; it.rows = rows;
    try { it.proc.resize(Math.max(2, cols | 0), Math.max(1, rows | 0)); } catch { /* exited */ }
  }

  kill(id) {
    const it = this.items.get(id);
    if (!it) return false;
    if (it.exited === null) { try { it.proc.kill(); } catch { /* already gone */ } }
    this.items.delete(id);
    this.emit('change');
    return true;
  }

  remove(id) { return this.kill(id); }

  buffer(id) { return this.items.get(id)?.buffer || ''; }
  get(id) { return this.items.get(id) || null; }
  byWorker(workerId) { return [...this.items.values()].find((t) => t.workerId === workerId) || null; }

  snapshot(it) {
    return { id: it.id, kind: it.kind, workerId: it.workerId, title: it.title, cwd: it.cwd, pid: it.pid, cols: it.cols, rows: it.rows, exited: it.exited, created: it.created };
  }
  list() { return [...this.items.values()].map((it) => this.snapshot(it)); }

  killAll() { for (const id of [...this.items.keys()]) this.kill(id); }
}

module.exports = { Terminals };
