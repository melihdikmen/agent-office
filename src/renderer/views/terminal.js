// Terminal panes: a splittable grid of xterm views, each attached to a pty in the
// main process. Workers and plain shells look the same here; a worker's pane
// carries its name, model and usage.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const SIZES = { S: 11, M: 13, L: 15 };
const THEME = {
  background: '#1b1715', foreground: '#eae2d8', cursor: '#f28b6a', cursorAccent: '#1b1715', selectionBackground: 'rgba(242,139,106,0.3)',
  black: '#2b2622', red: '#e76f51', green: '#7ad7a0', yellow: '#f2c94c', blue: '#6ea8ff', magenta: '#c58bf2', cyan: '#7ad7c0', white: '#eae2d8',
  brightBlack: '#6b625b', brightRed: '#ff8a6a', brightGreen: '#9af0bf', brightYellow: '#ffd97a', brightBlue: '#8fbcff', brightMagenta: '#d9a8ff', brightCyan: '#9eeadb', brightWhite: '#ffffff',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Panes {
  constructor(root, api, { onFocus, onClose }) {
    this.root = root;
    this.api = api;
    this.onFocus = onFocus; this.onClose = onClose;
    this.tree = null;                 // { leaf: termId } | { dir: 'row'|'col', ratio, a, b }
    this.terms = new Map();           // termId → { term, fit, el, info }
    this.size = 'M';
    this.focused = null;
    this.maximized = null;
    this.meta = new Map();            // termId → snapshot from main
    this.workersById = new Map();
    api.on('pty-data', ({ id, data }) => this.terms.get(id)?.term.write(data));
    api.on('pty-exit', ({ id }) => { const t = this.terms.get(id); if (t) t.info.exited = true; this.render(); });
    window.addEventListener('resize', () => this.fitAll());
  }

  setMeta(list, workers) {
    this.meta = new Map(list.map((t) => [t.id, t]));
    this.workersById = new Map(workers.map((w) => [w.id, w]));
    let changed = false;
    for (const id of [...this.terms.keys()]) if (!this.meta.has(id)) { this.detach(id); changed = true; }
    if (changed) this.render(); else this.updateHeaders();
  }

  has(id) { return this.terms.has(id); }
  list() { return [...this.terms.keys()]; }

  // ---- tree ------------------------------------------------------------------
  leaves(n = this.tree, out = []) { if (!n) return out; if (n.leaf) out.push(n.leaf); else { this.leaves(n.a, out); this.leaves(n.b, out); } return out; }
  findParent(id, n = this.tree, parent = null) {
    if (!n) return null;
    if (n.leaf) return n.leaf === id ? parent : null;
    return this.findParent(id, n.a, n) || this.findParent(id, n.b, n);
  }

  // Open a pane for a pty; splits the focused pane (or fills the root).
  async open(id, { dir = 'row', replace = false } = {}) {
    if (this.terms.has(id)) { this.focus(id); return; }
    if (!this.meta.has(id)) return;
    const node = { leaf: id };
    if (!this.tree) this.tree = node;
    else {
      const target = this.focused && this.terms.has(this.focused) ? this.focused : this.leaves().pop();
      const parent = this.findParent(target);
      const old = { leaf: target };
      const split = { dir, ratio: 0.5, a: old, b: node };
      if (replace) { if (!parent) this.tree = node; else if (parent.a.leaf === target) parent.a = node; else parent.b = node; this.detach(target); }
      else if (!parent) this.tree = split;
      else if (parent.a.leaf === target) parent.a = split; else parent.b = split;
    }
    this.attach(id);
    this.focused = id;
    this.render();
    const buf = await this.api.termBuffer({ id });
    if (buf) this.terms.get(id)?.term.write(buf);
    this.focus(id);
  }

  attach(id) {
    const term = new Terminal({ fontSize: SIZES[this.size], fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace', theme: THEME, cursorBlink: true, scrollback: 5000, allowProposedApi: true, macOptionIsMeta: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.onData((d) => this.api.termWrite({ id, data: d }));
    term.onResize(({ cols, rows }) => this.api.termResize({ id, cols, rows }));
    const info = { exited: this.meta.get(id)?.exited != null };
    this.terms.set(id, { term, fit, el: null, info });
  }

  detach(id) {
    const t = this.terms.get(id);
    if (!t) return;
    t.term.dispose();
    this.terms.delete(id);
    this.removeLeaf(id);
    if (this.focused === id) this.focused = this.leaves()[0] || null;
    if (this.maximized === id) this.maximized = null;
  }
  // Take a leaf out of the layout tree (the terminal itself stays alive).
  removeLeaf(id) {
    const parent = this.findParent(id);
    if (!parent) { if (this.tree?.leaf === id) this.tree = null; return; }
    const keep = parent.a.leaf === id ? parent.b : parent.a;
    const gp = this.findParentNode(parent);
    if (!gp) this.tree = keep; else if (gp.a === parent) gp.a = keep; else gp.b = keep;
  }

  // Drag-and-drop: drop `src` on an edge of `target` to split there, or on the
  // centre to swap the two panes.
  movePane(src, target, zone) {
    if (src === target || !this.terms.has(src) || !this.terms.has(target)) return;
    if (zone === 'center') {
      const swap = (n) => { if (!n) return; if (n.leaf) { if (n.leaf === src) n.leaf = target; else if (n.leaf === target) n.leaf = src; } else { swap(n.a); swap(n.b); } };
      swap(this.tree);
    } else {
      this.removeLeaf(src);
      const parent = this.findParent(target);
      const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
      const mine = { leaf: src }, theirs = { leaf: target };
      const split = { dir, ratio: 0.5, a: zone === 'left' || zone === 'top' ? mine : theirs, b: zone === 'left' || zone === 'top' ? theirs : mine };
      if (!parent) this.tree = split; else if (parent.a.leaf === target) parent.a = split; else parent.b = split;
    }
    this.maximized = null;
    this.focused = src;
    this.render();
  }

  dropZone(el, e) {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x > 0.28 && x < 0.72 && y > 0.28 && y < 0.72) return 'center';
    const d = { left: x, right: 1 - x, top: y, bottom: 1 - y };
    return Object.keys(d).reduce((a, b) => (d[a] <= d[b] ? a : b));
  }

  findParentNode(node, n = this.tree, parent = null) {
    if (!n || n.leaf) return null;
    if (n === node) return parent;
    return this.findParentNode(node, n.a, n) || this.findParentNode(node, n.b, n);
  }

  async close(id, { kill = true } = {}) {
    const m = this.meta.get(id);
    this.detach(id);
    this.render();
    if (kill && m) { if (m.kind === 'shell' || m.exited != null) await this.api.termKill({ id }); }
    this.onClose?.(id);
  }

  focus(id) { this.focused = id; this.updateHeaders(); setTimeout(() => this.terms.get(id)?.term.focus(), 0); }
  setSize(s) { this.size = s; for (const t of this.terms.values()) t.term.options.fontSize = SIZES[s]; this.fitAll(); }
  toggleMax(id) { this.maximized = this.maximized === id ? null : id; this.render(); }

  // ---- DOM -------------------------------------------------------------------
  render() {
    const root = this.root;
    for (const t of this.terms.values()) if (t.el) t.el.remove();
    root.innerHTML = '';
    if (!this.tree) { root.innerHTML = '<div class="panes-empty">Bir çalışanın sprite\'ına çift tıkla ya da <b>+ shell</b> ile terminal aç.</div>'; return; }
    const node = this.maximized && this.terms.has(this.maximized) ? { leaf: this.maximized } : this.tree;
    root.append(this.build(node));
    this.fitAll();
    this.updateHeaders();
  }

  build(n) {
    if (n.leaf) return this.pane(n.leaf);
    const el = document.createElement('div');
    el.className = `split ${n.dir}`;
    const a = this.build(n.a), b = this.build(n.b);
    a.style.flex = `${n.ratio} 1 0`; b.style.flex = `${1 - n.ratio} 1 0`;
    const gutter = document.createElement('div');
    gutter.className = 'gutter';
    gutter.addEventListener('pointerdown', (e) => {
      const rect = el.getBoundingClientRect();
      const move = (ev) => {
        const r = n.dir === 'row' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        n.ratio = Math.max(0.15, Math.min(0.85, r));
        a.style.flex = `${n.ratio} 1 0`; b.style.flex = `${1 - n.ratio} 1 0`;
        this.fitAll();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      e.preventDefault();
    });
    el.append(a, gutter, b);
    return el;
  }

  pane(id) {
    const t = this.terms.get(id);
    const el = document.createElement('div');
    el.className = 'pane';
    el.dataset.id = id;
    el.innerHTML = `<div class="pane-head" draggable="true" title="Sürükleyip başka bir terminalin kenarına bırak"></div><div class="pane-body"></div><div class="pane-drop"></div>`;
    const drop = el.querySelector('.pane-drop');
    const head = el.querySelector('.pane-head');
    head.addEventListener('dragstart', (e) => {
      if (e.target.closest('button')) { e.preventDefault(); return; }
      this.dragId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      requestAnimationFrame(() => { this.root.classList.add('dragging'); el.classList.add('drag-src'); });
    });
    head.addEventListener('dragend', () => { this.dragId = null; this.root.classList.remove('dragging'); this.root.querySelectorAll('.drag-src').forEach((x) => x.classList.remove('drag-src')); drop.removeAttribute('data-zone'); });
    drop.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === id) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      drop.dataset.zone = this.dropZone(drop, e);
    });
    drop.addEventListener('dragleave', () => drop.removeAttribute('data-zone'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const zone = this.dropZone(drop, e), src = this.dragId;
      drop.removeAttribute('data-zone'); this.dragId = null; this.root.classList.remove('dragging');
      if (src) this.movePane(src, id, zone);
    });
    const body = el.querySelector('.pane-body');
    if (!t.opened) { t.term.open(body); t.opened = true; } else { body.append(t.term.element); }
    // any click in the pane (header included) puts the keyboard on this terminal
    el.addEventListener('pointerdown', (e) => { this.focused = id; this.updateHeaders(); if (!e.target.closest('button')) setTimeout(() => t.term.focus(), 0); });
    el.querySelector('.pane-head').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'row' || act === 'col') this.splitFrom(id, act);
      if (act === 'max') this.toggleMax(id);
      if (act === 'close') this.close(id);
      if (act === 'clear') t.term.clear();
    });
    t.el = el;
    return el;
  }

  async splitFrom(id, dir) {
    this.focused = id;
    const snap = await this.api.termShell({ cols: 100, rows: 30 });
    if (snap?.id) { this.meta.set(snap.id, snap); await this.open(snap.id, { dir }); }
  }

  headerHtml(id) {
    const m = this.meta.get(id) || {};
    const w = m.workerId ? this.workersById.get(m.workerId) : null;
    const dot = m.exited != null ? '#6b625b' : w ? ({ working: '#6ea8ff', waiting: '#f2c94c', idle: '#7ad7a0' }[w.status] || '#7ad7a0') : '#7ad7a0';
    const chips = w ? `<span class="chip">${esc(w.model)}</span>${w.branch ? `<span class="chip">⎇ ${esc(w.branch)}</span>` : ''}<span class="chip usage" title="Bu oturumun toplam maliyeti ve token kullanımı">$${(w.cost || 0).toFixed(2)} · ${Math.round((w.tokens || 0) / 1000)}k tok</span>` : '';
    return `<i class="dot" style="background:${dot}"></i><b>${esc(m.title || id)}</b>${w ? `<span class="muted">${esc(w.role)}</span>` : ''}<span class="spacer"></span>${chips}
      <button data-act="row" title="Yana böl">◫</button><button data-act="col" title="Alta böl">⬓</button><button data-act="clear" title="Temizle">⌫</button><button data-act="max" title="Büyüt/küçült">⤢</button><button data-act="close" title="Kapat">✕</button>`;
  }

  updateHeaders() {
    for (const [id, t] of this.terms) {
      if (!t.el) continue;
      const head = t.el.querySelector('.pane-head');
      const html = this.headerHtml(id);
      if (head.innerHTML !== html) head.innerHTML = html;
      t.el.classList.toggle('focused', this.focused === id);
    }
  }

  fitAll() {
    requestAnimationFrame(() => { for (const t of this.terms.values()) if (t.el && t.el.isConnected) { try { t.fit.fit(); } catch { /* not laid out yet */ } } });
  }
}
