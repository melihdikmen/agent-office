// Terminal panes: a splittable grid of xterm views, each attached to a pty in the
// main process. Workers and plain shells look the same here; a worker's pane
// carries its name, model and usage.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { pruneTree, parseSaved } from './layout-tree.mjs';
import { chipModel } from './project-chip.mjs';
import { tt } from '../i18n.js';

import { termTheme } from './themes.js';
const SIZES = { S: 11, M: 13, L: 15 };
const THEME = {
  background: '#0a0c16', foreground: '#eef0fb', cursor: '#8d9bff', cursorAccent: '#0a0c16', selectionBackground: 'rgba(141,155,255,0.3)',
  black: '#2b2622', red: '#e76f51', green: '#7ad7a0', yellow: '#f2c94c', blue: '#6ea8ff', magenta: '#c58bf2', cyan: '#7ad7c0', white: '#eef0fb',
  brightBlack: '#6b625b', brightRed: '#ff8a6a', brightGreen: '#9af0bf', brightYellow: '#ffd97a', brightBlue: '#8fbcff', brightMagenta: '#d9a8ff', brightCyan: '#9eeadb', brightWhite: '#ffffff',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 'it''s' style single-quote escaping; plain safe paths stay unquoted.
const shellQuote = (p) => (/^[A-Za-z0-9_\/.,:@%+=~-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

// Small popup menu at the pointer: items are [label, fn] or 'sep'.
function popupMenu(x, y, title, items) {
  document.querySelector('.ctx-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  m.innerHTML = `<div class="ctx-title">${esc(title)}</div>` + items.map((it, i) => (it === 'sep' ? '<div class="ctx-sep"></div>' : `<button data-i="${i}"${it[2] ? ' class="danger"' : ''}>${esc(it[0])}</button>`)).join('');
  document.body.append(m);
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 4))}px`;
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 4))}px`;
  m.onclick = (e) => { const i = e.target.closest('[data-i]')?.dataset.i; if (i == null) return; m.remove(); items[i][1](); };
  m.oncontextmenu = (e) => e.preventDefault();
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); removeEventListener('keydown', esc2, true); } };
  const esc2 = (e) => { if (e.key === 'Escape') off({ target: document.body }); };
  setTimeout(() => { addEventListener('pointerdown', off, true); addEventListener('keydown', esc2, true); }, 0);
}

export class Panes {
  constructor(root, api, { onFocus, onClose, onMove, onMic, onPopout }) {
    this.root = root;
    this.api = api;
    this.onFocus = onFocus; this.onClose = onClose; this.onMove = onMove; this.onMic = onMic; this.onPopout = onPopout;
    // Tab groups: each group is its own split layout { leaf: termId } | { dir: 'row'|'col', ratio, a, b };
    // terminals of hidden groups stay alive, only the active group is on screen.
    this.groups = [{ id: 'g1', name: 'Terminal', tree: null, focused: null, maximized: null }];
    this.active = 0;
    this.terms = new Map();           // termId → { term, fit, el, info }
    this.size = 'M';
    this.meta = new Map();            // termId → snapshot from main
    this.workersById = new Map();
    this.key = null;                  // workspace id the layout is saved under
    this.restored = false;
    window.addEventListener('themechange', () => { for (const { term } of this.terms.values()) term.options.theme = termTheme(); });
    api.on('pty-data', ({ id, data }) => this.terms.get(id)?.term.write(data));
    api.on('pty-exit', ({ id }) => { const t = this.terms.get(id); if (t) t.info.exited = true; this.render(); });
    window.addEventListener('resize', () => this.fitAll());
    root.addEventListener('dragover', (e) => { if (Panes.drag && !this.tree) e.preventDefault(); });          // empty area accepts a pane
    root.addEventListener('drop', (e) => { const d = Panes.drag; if (d && !this.tree && d.owner !== this) { e.preventDefault(); Panes.drag = null; document.querySelectorAll('.panes').forEach((r) => r.classList.remove('dragging')); this.receive(d.owner, d.id, null); } });
  }

  get g() { return this.groups[this.active]; }
  get tree() { return this.g.tree; }
  set tree(v) { this.g.tree = v; }
  get focused() { return this.g.focused; }
  set focused(v) { this.g.focused = v; }
  get maximized() { return this.g.maximized; }
  set maximized(v) { this.g.maximized = v; }
  groupOf(id) { return this.groups.findIndex((g) => this.leaves(g.tree).includes(id)); }
  setActive(i) { if (i >= 0 && i < this.groups.length && i !== this.active) { this.active = i; this.save(); this.render(); const f = this.focused; if (f) setTimeout(() => this.terms.get(f)?.term.focus(), 0); } }
  addGroup() { this.groups.push({ id: `g${Date.now().toString(36)}`, name: `Grup ${this.groups.length + 1}`, tree: null, focused: null, maximized: null }); this.active = this.groups.length - 1; this.save(); this.render(); }
  renameGroup(i) { const n = prompt('Grup adı', this.groups[i].name); if (n && n.trim()) { this.groups[i].name = n.trim().slice(0, 24); this.save(); this.render(); } }
  // Closing a group never kills terminals: its panes move to the neighbouring group.
  closeGroup(i) {
    if (this.groups.length < 2) return;
    const to = i > 0 ? i - 1 : 1;
    const target = this.groups[to];
    for (const id of this.leaves(this.groups[i].tree)) this.placeInGroup(id, target, false);
    this.groups.splice(i, 1);
    this.active = this.groups.indexOf(target);
    this.save(); this.render();
  }
  placeInGroup(id, g, removeFirst = true) {
    if (removeFirst) this.removeLeaf(id);
    const last = this.leaves(g.tree).pop();
    if (!g.tree) g.tree = { leaf: id };
    else {
      const parent = this.findParent(last, g.tree);
      const split = { dir: 'row', ratio: 0.5, a: { leaf: last }, b: { leaf: id } };
      if (!parent) g.tree = split; else if (parent.a.leaf === last) parent.a = split; else parent.b = split;
    }
    g.focused = id;
  }
  moveToGroup(id, gi) {
    const from = this.groupOf(id);
    if (from < 0 || from === gi || !this.groups[gi]) return;
    this.placeInGroup(id, this.groups[gi]);
    this.active = gi;
    this.save(); this.render();
  }

  setMeta(list, workers, offices = 0) {
    this.meta = new Map(list.map((t) => [t.id, t]));
    this.multi = Math.max(offices, new Set(list.map((t) => t.project?.id).filter(Boolean)).size) > 1;
    this.workersById = new Map(workers.map((w) => [w.id, w]));
    let changed = false;
    for (const id of [...this.terms.keys()]) if (!this.meta.has(id)) { this.detach(id); changed = true; }
    if (!this.restored && this.key && this.meta.size) { this.restore(); return; }
    if (changed) this.render(); else this.updateHeaders();
  }

  // ---- persistence -----------------------------------------------------------
  setKey(key) { if (key && key !== this.key) { this.key = key; this.restored = false; } }

  save() {
    if (!this.key || !this.restored) return;
    try { localStorage.setItem(`ao.panes.${this.key}`, JSON.stringify({ groups: this.groups.map((g) => ({ id: g.id, name: g.name, tree: g.tree, focused: g.focused })), active: this.active })); } catch { /* storage blocked */ }
  }

  // Bring back the saved layout once the terminals exist; dead panes are pruned.
  async restore() {
    this.restored = true;
    let saved = null;
    try { saved = parseSaved(localStorage.getItem(`ao.panes.${this.key}`)); } catch { /* storage blocked */ }
    if (this.groups.some((g) => g.tree)) { this.render(); return; }
    const raw = saved?.groups?.length ? saved.groups : saved?.tree ? [{ id: 'g1', name: 'Terminal', tree: saved.tree, focused: saved.focused }] : [];
    const alive = new Set(this.meta.keys()), seen = new Set();
    const groups = raw.slice(0, 12).map((g, i) => {
      const tree = pruneTree(g.tree, new Set([...alive].filter((id) => !seen.has(id))));
      for (const id of this.leaves(tree)) seen.add(id);
      return { id: String(g.id || `g${i}`), name: String(g.name || `Grup ${i + 1}`).slice(0, 24), tree, focused: null, maximized: null, want: g.focused };
    });
    if (!groups.some((g) => g.tree)) { this.render(); return; }
    for (const g of groups) { const l = this.leaves(g.tree); g.focused = l.includes(g.want) ? g.want : l[0] || null; delete g.want; }
    this.groups = groups;
    this.active = Math.max(0, Math.min(groups.length - 1, Number(saved.active) || 0));
    const ids = groups.flatMap((g) => this.leaves(g.tree));
    for (const id of ids) if (!this.terms.has(id)) this.attach(id);
    this.render();
    for (const id of ids) { const buf = await this.api.termBuffer({ id }); if (buf) this.terms.get(id)?.term.write(buf); }
    if (this.focused) this.focus(this.focused);
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
    const term = new Terminal({ fontSize: SIZES[this.size], fontFamily: '"Hack", "JetBrains Mono", "SF Mono", Menlo, monospace', theme: termTheme(), cursorBlink: true, scrollback: 5000, allowProposedApi: true, macOptionIsMeta: true });
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
    if (Panes.full?.id === id) { Panes.full = null; document.body.classList.remove('term-full'); }
    if (this.focused === id) this.focused = this.leaves()[0] || null;
    if (this.maximized === id) this.maximized = null;
  }
  // Take a leaf out of the layout tree (the terminal itself stays alive).
  removeLeaf(id) {
    const gi = this.groupOf(id);
    if (gi >= 0 && gi !== this.active) { const keep = this.active; this.active = gi; try { this.removeLeaf(id); } finally { this.active = keep; } return; }
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

  // A pane dragged in from the other terminal area (office area <-> side panel).
  async receive(from, src, target, zone) {
    if (!from.has(src)) return;
    await from.close(src, { kill: false });
    this.meta = from.meta;
    if (target && this.terms.has(target)) {
      this.focused = target;
      await this.open(src, { dir: zone === 'top' || zone === 'bottom' ? 'col' : 'row' });
      this.movePane(src, target, zone);
    } else await this.open(src);
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

  setRecording(id, on) { for (const [k, t] of this.terms) t.el?.classList.toggle('recording', on && k === id); }

  focus(id) { const gi = this.groupOf(id); if (gi >= 0 && gi !== this.active) { this.active = gi; this.render(); } this.focused = id; this.save(); this.updateHeaders(); setTimeout(() => this.terms.get(id)?.term.focus(), 0); }
  setSize(s) { this.size = s; for (const t of this.terms.values()) t.term.options.fontSize = SIZES[s]; this.fitAll(); }
  // Window-wide: the pane covers the office column too (unlike "max", which stays inside its own area).
  toggleFull(id) {
    const on = Panes.full?.id !== id;
    if (Panes.full) { Panes.full.owner.terms.get(Panes.full.id)?.el?.classList.remove('pane-full'); Panes.full = null; }
    if (on) { Panes.full = { id, owner: this }; this.terms.get(id)?.el?.classList.add('pane-full'); this.focused = id; }
    document.body.classList.toggle('term-full', on);
    this.fitAll();
    setTimeout(() => this.terms.get(id)?.term.focus(), 0);
  }
  toggleMax(id) { this.maximized = this.maximized === id ? null : id; this.render(); }

  // ---- DOM -------------------------------------------------------------------
  render() {
    const root = this.root;
    this.save();
    for (const t of this.terms.values()) if (t.el) t.el.remove();
    root.innerHTML = '';
    root.classList.add('grouped');
    root.append(this.groupBar());
    const area = document.createElement('div');
    area.className = 'pane-area';
    root.append(area);
    if (!this.tree) { area.innerHTML = '<div class="panes-empty">Bir çalışanın karakterine çift tıkla ya da <b>+ shell</b> ile terminal aç.</div>'; return; }
    const node = this.maximized && this.terms.has(this.maximized) ? { leaf: this.maximized } : this.tree;
    area.append(this.build(node));
    this.fitAll();
    this.updateHeaders();
  }

  groupBar() {
    const bar = document.createElement('div');
    bar.className = 'pane-groups';
    this.groups.forEach((g, i) => {
      const n = this.leaves(g.tree).length;
      const b = document.createElement('button');
      b.className = `pg${i === this.active ? ' on' : ''}`;
      const projs = new Set(this.leaves(g.tree).map((l) => this.meta.get(l)?.project?.name).filter(Boolean));
      const gm = projs.size === 1 ? this.meta.get(this.leaves(g.tree).find((l) => this.meta.get(l)?.project)) : null;
      b.innerHTML = `<span>${esc(g.name)}</span>${gm ? this.projectChip(gm) : ''}<i>${n}</i>${this.groups.length > 1 ? '<u data-x title="Grubu kapat (terminaller yanındaki gruba taşınır)">✕</u>' : ''}`;
      b.title = 'Tıkla: aç · çift tıkla: yeniden adlandır · terminal başlığını buraya sürükle: gruba taşı';
      b.onclick = (e) => { if (e.target.closest('[data-x]')) this.closeGroup(i); else this.setActive(i); };
      b.ondblclick = () => this.renameGroup(i);
      b.addEventListener('dragover', (e) => { if (Panes.drag) { e.preventDefault(); b.classList.add('over'); } });
      b.addEventListener('dragleave', () => b.classList.remove('over'));
      b.addEventListener('drop', async (e) => {
        e.preventDefault(); b.classList.remove('over');
        const d = Panes.drag; Panes.drag = null;
        document.querySelectorAll('.panes').forEach((r) => r.classList.remove('dragging'));
        if (!d) return;
        if (d.owner === this) this.moveToGroup(d.id, i);
        else { await d.owner.close(d.id, { kill: false }); this.meta = d.owner.meta; this.active = i; await this.open(d.id); }
      });
      bar.append(b);
    });
    const add = document.createElement('button');
    add.className = 'pg add'; add.textContent = '＋'; add.title = 'Yeni terminal grubu';
    add.onclick = () => this.addGroup();
    bar.append(add);
    return bar;
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
      const up = () => { this.save(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
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
    // Files dragged in from Finder: type their paths into this terminal, quoted like a shell would.
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    el.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('file-over'); });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('file-over'); });
    el.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); el.classList.remove('file-over');
      const paths = [...e.dataTransfer.files].map((f) => this.api.pathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      this.api.termPaste({ id, text: `${paths.map(shellQuote).join(' ')} ` });
      this.focus(id);
    });
    const drop = el.querySelector('.pane-drop');
    const head = el.querySelector('.pane-head');
    head.addEventListener('dragstart', (e) => {
      if (e.target.closest('button')) { e.preventDefault(); return; }
      Panes.drag = { id, owner: this };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      requestAnimationFrame(() => { document.querySelectorAll('.panes').forEach((r) => r.classList.add('dragging')); el.classList.add('drag-src'); });
    });
    head.addEventListener('dragend', () => { Panes.drag = null; document.querySelectorAll('.panes').forEach((r) => r.classList.remove('dragging')); document.querySelectorAll('.drag-src').forEach((x) => x.classList.remove('drag-src')); drop.removeAttribute('data-zone'); });
    drop.addEventListener('dragover', (e) => {
      if (!Panes.drag || Panes.drag.id === id) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      drop.dataset.zone = this.dropZone(drop, e);
    });
    drop.addEventListener('dragleave', () => drop.removeAttribute('data-zone'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const zone = this.dropZone(drop, e), d = Panes.drag;
      drop.removeAttribute('data-zone'); Panes.drag = null; document.querySelectorAll('.panes').forEach((r) => r.classList.remove('dragging'));
      if (!d) return;
      if (d.owner === this) this.movePane(d.id, id, zone); else this.receive(d.owner, d.id, id, zone);
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
      if (act === 'full') this.toggleFull(id);
      if (act === 'mic') this.onMic?.(id, this);
      if (act === 'close') this.close(id);
      if (act === 'move') this.onMove?.(id, this);
      if (act === 'clear') t.term.clear();
    });
    if (Panes.full?.id === id && Panes.full.owner === this) el.classList.add('pane-full');
    el.querySelector('.pane-head').addEventListener('contextmenu', (e) => { e.preventDefault(); this.focused = id; this.updateHeaders(); this.headerMenu(id, e.clientX, e.clientY); });
    el.querySelector('.pane-head').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) this.toggleFull(id); });
    t.el = el;
    return el;
  }

  // Right-click on a pane header: the same actions as the header buttons, plus group moves and copy.
  headerMenu(id, x, y) {
    const t = this.terms.get(id), m = this.meta.get(id) || {};
    const w = m.workerId ? this.workersById.get(m.workerId) : null;
    const gi = this.groupOf(id);
    const items = [
      ['Yana böl', () => this.splitFrom(id, 'row')], ['Alta böl', () => this.splitFrom(id, 'col')], 'sep',
      [Panes.full?.id === id ? 'Tam ekrandan çık' : 'Tüm pencereyi kapla', () => this.toggleFull(id)],
      [this.maximized === id ? 'Küçült' : 'Bu alanda büyüt', () => this.toggleMax(id)],
    ];
    if (this.onMove) items.push(['Diğer alana taşı (ofis alanı ⇄ sağ panel)', () => this.onMove(id, this)]);
    this.groups.forEach((g, i) => { if (i !== gi) items.push([`Gruba taşı: ${g.name}`, () => this.moveToGroup(id, i)]); });
    items.push(['Yeni gruba taşı', () => { this.addGroup(); this.moveToGroup(id, this.groups.length - 1); }], 'sep');
    if (this.onPopout) items.push(['Ayrı pencereye çıkar', () => this.onPopout(id, this)]);
    items.push(['Çıktıyı kopyala', () => { t.term.selectAll(); const text = t.term.getSelection(); t.term.clearSelection(); navigator.clipboard?.writeText(text); }]);
    items.push(['Ekranı temizle', () => t.term.clear()]);
    if (w?.running) items.push(['Çalışanı durdur (uyut)', () => this.api.workerStop({ id: w.id })]);
    items.push('sep', ['Paneli kapat', () => this.close(id), true]);
    popupMenu(x, y, m.title || id, items);
  }

  async splitFrom(id, dir) {
    this.focused = id;
    const snap = await this.api.termShell({ cols: 100, rows: 30 });
    if (snap?.id) { this.meta.set(snap.id, snap); await this.open(snap.id, { dir }); }
  }

  // Project chip for a terminal header or group tab: office name (agents) or folder (shells).
  projectChip(m) {
    const c = chipModel(m.project, { shell: !m.workerId, multi: this.multi });
    if (!c) return '';
    const tip = `${tt('Proje', 'Project')}: ${c.full}${c.path ? ` — ${c.path}` : ''}`;
    return `<span class="proj${c.dim ? ' dim' : ''}" title="${esc(tip)}"><i style="background:${c.color}"></i><span class="pt">${c.icon} ${esc(c.label)}</span></span>`;
  }

  headerHtml(id) {
    const m = this.meta.get(id) || {};
    const w = m.workerId ? this.workersById.get(m.workerId) : null;
    const dot = m.exited != null ? '#6b625b' : w ? ({ working: '#6ea8ff', waiting: '#f2c94c', idle: '#7ad7a0' }[w.status] || '#7ad7a0') : '#7ad7a0';
    const other = w && w.engine && w.engine !== 'claude';
    const chips = w ? `<span class="chip">${esc(other ? `${w.engine}${w.model ? ` · ${w.model}` : ''}` : w.model)}</span>${w.branch ? `<span class="chip">⎇ ${esc(w.branch)}</span>` : ''}${other ? '' : `<span class="chip usage" title="Bu oturumun toplam maliyeti ve token kullanımı">$${(w.cost || 0).toFixed(2)}${w.budget > 0 ? ` / $${w.budget}` : ''} · ${Math.round((w.tokens || 0) / 1000)}k tok</span>`}` : '';
    return `<i class="dot" style="background:${dot}"></i><b>${esc(m.title || id)}</b>${this.projectChip(m)}${w ? `<span class="muted">${esc(w.role)}</span>` : ''}<span class="spacer"></span>${chips}
      <button data-act="row" title="Yana böl">◫</button><button data-act="col" title="Alta böl">⬓</button><button data-act="clear" title="Temizle">⌫</button>${this.onMic ? '<button data-act="mic" title="Konuşarak yaz (⌘⇧M)">🎤</button>' : ''}<button data-act="max" title="Büyüt/küçült">⤢</button><button data-act="full" title="Tüm pencereyi kapla (⌘⇧↵ ya da başlığa çift tıkla)">⛶</button>${this.onMove ? '<button data-act="move" title="Terminali diğer alana taşı (ofis alanı ⇄ sağ panel)">⇄</button>' : ''}<button data-act="close" title="Kapat">✕</button>`;
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
