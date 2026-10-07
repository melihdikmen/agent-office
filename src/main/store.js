'use strict';
// Persistent state of the office: workspaces, their workers, task board, reports,
// floor layout and the owner's settings. One JSON file, written atomically.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const id = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);

class Store {
  constructor(dir, { readonly = false } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'office.json');
    this.readonly = readonly;
    this.data = { version: 2, workspaces: [], activeWorkspace: null, handsOff: false, integrations: {}, ui: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw.version === 2) Object.assign(this.data, raw);
    } catch { /* first run */ }
    this.timer = null;
  }

  get workspaces() { return this.data.workspaces; }
  workspace(wid) { return this.workspaces.find((w) => w.id === wid) || null; }
  get active() { return this.workspace(this.data.activeWorkspace) || this.workspaces[0] || null; }

  createWorkspace({ name, dir }) {
    const ws = {
      id: id(), name: String(name || '').trim() || path.basename(dir || '') || 'Ofis', dir: dir || '',
      lead: null, workers: [], tasks: [], reports: [], nextTask: 1, layout: null, created: Date.now(),
    };
    this.workspaces.push(ws);
    if (!this.data.activeWorkspace) this.data.activeWorkspace = ws.id;
    this.save();
    return ws;
  }

  removeWorkspace(wid) {
    this.data.workspaces = this.workspaces.filter((w) => w.id !== wid);
    if (this.data.activeWorkspace === wid) this.data.activeWorkspace = this.workspaces[0]?.id || null;
    this.save();
  }

  // Per-workspace folder for things workers write (memory files, reports).
  workspaceDir(wid) {
    const d = path.join(this.dir, 'workspaces', wid);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  save() {
    if (this.readonly) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    if (this.readonly) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (e) { console.error('store save failed', e); }
  }
}

module.exports = { Store, id };
