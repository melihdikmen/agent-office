// The pixel-art office: rooms on a tile grid, furniture, and one character per
// worker sitting at a desk, walking about when idle, glowing when working and
// calling for the owner when blocked. Also the layout editor.
import { TILE, ITEMS, floorTile, characterSprites } from './sprites.js';
import { Scene3D } from './office3d.js';
import { bubbleFor, mayWander, summarize } from './status.mjs';

const SPEED = 3.2;              // tiles per second
const WALL = '#2a2320';
const WALL_TOP = '#4a3f38';

const rnd = (a, b) => a + Math.random() * (b - a);
const key = (x, y) => `${x},${y}`;

// ---- layout -------------------------------------------------------------------
export function defaultLayout() {
  const rooms = [
    { id: 'dev', name: 'DEV WING', x: 0, y: 0, w: 18, h: 13, floor: 'checker' },
    { id: 'meet', name: 'TOPLANTI', x: 18, y: 0, w: 14, h: 13, floor: 'wood' },
    { id: 'lounge', name: 'LOUNGE', x: 0, y: 13, w: 11, h: 13, floor: 'carpet' },
    { id: 'coffee', name: 'KAHVE', x: 11, y: 13, w: 10, h: 13, floor: 'sand' },
    { id: 'lab', name: 'ATÖLYE', x: 21, y: 13, w: 11, h: 13, floor: 'tile' },
  ];
  const items = [];
  let n = 0;
  const add = (type, x, y, extra = {}) => items.push({ id: `i${++n}`, type, x, y, ...extra });
  // desks: dev wing grid first, then the workshop
  for (const [x, y] of [[2, 2], [8, 2], [14, 2], [2, 7], [8, 7], [14, 7], [23, 15], [28, 15], [23, 20], [28, 20]]) add('desk', x, y, { worker: null });
  add('board', 8, 0); add('shelf', 14, 0); add('plant', 0, 12); add('plant', 17, 0); add('rack', 17, 12);
  add('table', 23, 5); add('table', 23, 6); add('board', 22, 0); add('shelf', 29, 0); add('plant', 31, 12); add('plant', 18, 12);
  add('sofa', 2, 16); add('sofa', 2, 21); add('rug', 6, 18); add('plant', 0, 25); add('shelf', 7, 13); add('cooler', 10, 24);
  add('coffee', 12, 13); add('coffee', 13, 13); add('table', 15, 19); add('plant', 20, 25); add('cooler', 20, 13);
  add('shelf', 25, 13); add('plant', 31, 25);
  return { cols: 32, rows: 26, rooms, items };
}

// Doors: a two-tile gap in the middle of every shared wall.
function doorsOf(layout) {
  const doors = new Set();     // "x,y>x,y" edges that may be crossed
  const link = (a, b) => { doors.add(`${key(a[0], a[1])}>${key(b[0], b[1])}`); doors.add(`${key(b[0], b[1])}>${key(a[0], a[1])}`); };
  const rs = layout.rooms;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.x + a.w === b.x || b.x + b.w === a.x) {          // side by side
      const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
      if (y1 - y0 >= 3) { const m = Math.floor((y0 + y1) / 2); const xl = a.x + a.w === b.x ? a.x + a.w - 1 : b.x + b.w - 1; for (const y of [m - 1, m]) link([xl, y], [xl + 1, y]); }
    }
    if (a.y + a.h === b.y || b.y + b.h === a.y) {          // stacked
      const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
      if (x1 - x0 >= 3) { const m = Math.floor((x0 + x1) / 2); const yt = a.y + a.h === b.y ? a.y + a.h - 1 : b.y + b.h - 1; for (const x of [m - 1, m]) link([x, yt], [x, yt + 1]); }
    }
  }
  return doors;
}

export class Office {
  constructor(container, { onSelect, onOpen, onContext, onLayout, onDesk }) {
    this.container = container;
    this.cv = document.createElement('canvas');
    this.cv.className = 'office-canvas';
    container.append(this.cv);
    this.g = this.cv.getContext('2d');
    try { this.r3 = new Scene3D(this); this.cv.style.display = 'none'; } catch (err) { console.warn('3D view unavailable, using 2D:', err.message); this.r3 = null; }
    this.onSelect = onSelect; this.onOpen = onOpen; this.onContext = onContext; this.onLayout = onLayout; this.onDesk = onDesk;
    this.layout = defaultLayout();
    this.workers = [];
    this.chars = new Map();
    this.selected = null;
    this.edit = false;
    this.scale = 2;
    this.pan = { x: 0, y: 0 };
    this.userMoved = false;
    this.drag = null;
    this.editSel = null;
    this.t = 0;
    this.reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.rebuild();
    new ResizeObserver(() => this.fit(!this.userMoved)).observe(container);
    this.bind();
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (document.hidden || !this.cv.isConnected || !this.container.offsetWidth) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.t += dt;
      this.update(dt);
      if (this.use3d()) this.r3.render(this.t); else this.draw();
    };
    requestAnimationFrame(loop);
  }

  // ---- data ----------------------------------------------------------------
  setLayout(layout) {
    this.layout = layout && layout.rooms ? layout : defaultLayout();
    this.rebuild();
    this.fit(true);
  }

  rebuild() {
    const L = this.layout;
    this.roomAt = new Map();
    for (const r of L.rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.roomAt.set(key(x, y), r.id);
    this.blocked = new Set();
    for (const it of L.items) for (const [dx, dy] of (ITEMS[it.type]?.blocks || [])) this.blocked.add(key(it.x + dx, it.y + dy));
    this.doors = doorsOf(L);
    if (this.r3) this.r3.dirty = true;
  }

  canStep(ax, ay, bx, by) {
    if (!this.roomAt.has(key(bx, by)) || this.blocked.has(key(bx, by))) return false;
    if (this.roomAt.get(key(ax, ay)) === this.roomAt.get(key(bx, by))) return true;
    return this.doors.has(`${key(ax, ay)}>${key(bx, by)}`);
  }

  path(from, to) {
    const start = key(from.x, from.y), goal = key(to.x, to.y);
    if (start === goal) return [];
    const prev = new Map([[start, null]]);
    const q = [[from.x, from.y]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (prev.has(k) || !this.canStep(x, y, nx, ny)) continue;
        prev.set(k, key(x, y));
        if (k === goal) {
          const out = [];
          for (let c = k; c && c !== start; c = prev.get(c)) { const [px, py] = c.split(',').map(Number); out.unshift({ x: px, y: py }); }
          return out;
        }
        q.push([nx, ny]);
      }
      if (prev.size > 4000) break;
    }
    return null;
  }

  desks() { return this.layout.items.filter((i) => i.type === 'desk'); }
  deskOf(workerId) { return this.desks().find((d) => d.worker === workerId) || null; }
  seatOf(desk) { const s = ITEMS.desk.seat; return { x: desk.x + s.dx, y: desk.y + s.dy }; }

  // Guests (sessions running elsewhere) stand around the lounge.
  guestSpots(n) {
    const room = this.layout.rooms.find((r) => /lounge/i.test(r.id) || /lounge|lobi/i.test(r.name)) || this.layout.rooms[this.layout.rooms.length - 1];
    const spots = [];
    for (let y = room.y + 2; y < room.y + room.h - 1 && spots.length < n; y += 3) for (let x = room.x + 2; x < room.x + room.w - 1 && spots.length < n; x += 3) if (!this.blocked.has(key(x, y))) spots.push({ x, y });
    return spots;
  }

  // Give every worker a desk; unassigned workers take the first free one.
  setWorkers(views, guests = []) {
    this.workers = views;
    this.guests = guests;
    let changed = false;
    const ids = new Set(views.map((v) => v.id));
    for (const d of this.desks()) if (d.worker && !ids.has(d.worker)) { d.worker = null; changed = true; }
    for (const v of views) {
      if (this.deskOf(v.id)) continue;
      const free = this.desks().find((d) => !d.worker);
      if (free) { free.worker = v.id; changed = true; } else {
        const room = this.layout.rooms[0];
        const spot = this.freeSpot(room, 2, 2);
        if (spot) { this.layout.items.push({ id: `i${Date.now()}`, type: 'desk', x: spot.x, y: spot.y, worker: v.id }); this.rebuild(); changed = true; }
      }
    }
    const spots = this.guestSpots(guests.length);
    for (const g of guests) ids.add(g.id);
    for (const id of [...this.chars.keys()]) if (!ids.has(id)) this.chars.delete(id);
    for (const v of [...views, ...guests]) {
      let c = this.chars.get(v.id);
      const desk = v.guest ? null : this.deskOf(v.id);
      const seat = desk ? this.seatOf(desk) : v.guest ? (spots[guests.indexOf(v)] || { x: 1, y: 1 }) : { x: 1, y: 1 };
      if (!c) {
        c = { id: v.id, x: seat.x, y: seat.y, dir: 'down', frame: 0, walk: 0, path: [], sprites: characterSprites(v.seed), bubble: null, nextWander: this.t + rnd(20, 60), errand: null };
        this.chars.set(v.id, c);
      } else if (c.seed !== v.seed) c.sprites = characterSprites(v.seed);
      c.seed = v.seed;
      c.view = v;
      c.seat = seat;
    }
    if (changed) this.onLayout?.(this.layout);
  }

  freeSpot(room, w, h) {
    for (let y = room.y + 1; y + h <= room.y + room.h - 1; y++) for (let x = room.x + 1; x + w <= room.x + room.w - 1; x++) {
      let ok = true;
      for (let j = -1; j <= h && ok; j++) for (let i = -1; i <= w && ok; i++) if (this.blocked.has(key(x + i, y + j)) || this.layout.items.some((it) => it.x === x + i && it.y === y + j)) ok = false;
      if (ok) return { x, y };
    }
    return null;
  }

  say(workerId, text, secs = 4) {
    const c = this.chars.get(workerId);
    if (c) c.bubble = { text: String(text).slice(0, 60), until: this.t + secs };
  }

  select(id) { this.selected = id; }
  use3d() { return !!this.r3 && !this.edit; }
  setEdit(on) {
    this.edit = on; this.editSel = null; this.cv.style.cursor = on ? 'default' : 'grab';
    if (this.r3) {                       // layout editing stays on the flat 2D plan
      this.cv.style.display = on ? '' : 'none';
      this.r3.cv.style.display = on ? 'none' : '';
      this.r3.hud.style.display = on ? 'none' : '';
      if (on) this.fit(true); else this.r3.dirty = true;
    }
  }

  // ---- simulation ------------------------------------------------------------
  update(dt) {
    for (const c of this.chars.values()) {
      const v = c.view;
      if (c.bubble && this.t > c.bubble.until) c.bubble = null;
      const busy = v.status !== 'idle';
      if (busy && c.errandAfter) { c.errandAfter = null; c.path = this.path({ x: Math.round(c.x), y: Math.round(c.y) }, c.seat) || []; }
      if (c.errand && (busy || this.t > c.errand.until)) { c.errand = null; c.path = this.path({ x: Math.round(c.x), y: Math.round(c.y) }, c.seat) || []; }
      if (!c.path.length && !c.errand) {
        const dx = c.seat.x - c.x, dy = c.seat.y - c.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.01) { c.path = this.path({ x: Math.round(c.x), y: Math.round(c.y) }, c.seat) || []; if (!c.path.length) { c.x = c.seat.x; c.y = c.seat.y; } }
        else {
          c.strolling = false;
          if (this.t > c.nextWander && !this.edit && !this.reduced && mayWander(c, v, this.wanderers())) {
            c.nextWander = this.t + rnd(40, 120);
            const spot = this.wanderSpot(this.wanderers() > 0);
            const p = spot && this.path(c.seat, spot);
            if (p && p.length) { c.path = p; c.strolling = true; c.errandAfter = { until: this.t + rnd(5, 9), icon: '☕' }; }
          }
        }
      }
      if (c.path.length) {
        const p = c.path[0];
        const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
        const step = SPEED * dt;
        c.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        if (d <= step) { c.x = p.x; c.y = p.y; c.path.shift(); if (!c.path.length && c.errandAfter) { c.errand = c.errandAfter; c.errandAfter = null; c.dir = 'down'; } }
        else { c.x += (dx / d) * step; c.y += (dy / d) * step; }
        c.walk += dt * 8;
        c.frame = 1 + (Math.floor(c.walk) % 2);
      } else { c.frame = 0; if (!c.errand) c.dir = 'down'; }
    }
  }

  wanderers() { let n = 0; for (const c of this.chars.values()) if (c.strolling) n++; return n; }

  // Someone already strolling → meet in the meeting room, otherwise coffee/lounge.
  wanderSpot(meet = false) {
    const pick = meet ? /toplant|meet/i : /lounge|kahve|coffee/i;
    let rooms = this.layout.rooms.filter((r) => pick.test(r.name) || pick.test(r.id));
    if (!rooms.length) rooms = this.layout.rooms.filter((r) => /lounge|kahve|coffee|toplant|meet/i.test(r.name) || /lounge|coffee|meet/.test(r.id));
    const room = (rooms.length ? rooms : this.layout.rooms)[Math.floor(Math.random() * (rooms.length || this.layout.rooms.length))];
    for (let i = 0; i < 20; i++) {
      const x = room.x + 1 + Math.floor(Math.random() * (room.w - 2)), y = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
      if (!this.blocked.has(key(x, y))) return { x, y };
    }
    return null;
  }

  // ---- view ------------------------------------------------------------------
  fit(force = false) {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = `${w}px`; this.cv.style.height = `${h}px`;
    this.dpr = dpr;
    if (this.r3) { this.r3.resize(); if (force || !this.r3.fitted) { this.r3.fit(); this.r3.fitted = true; } }
    if (force || !this.fitted) {
      const L = this.layout;
      // fractional scale so the floor fills the column; pixels stay crisp enough at these sizes
      const s = Math.max(0.5, Math.min(4, Math.floor(Math.min((w - 16) / (L.cols * TILE), (h - 16) / (L.rows * TILE)) * 4) / 4));
      this.scale = s;
      this.pan = { x: Math.round((w - L.cols * TILE * s) / 2), y: Math.round((h - L.rows * TILE * s) / 2) };
      this.fitted = true;
      this.userMoved = false;
    }
  }

  zoom(delta) {
    if (this.use3d()) { this.r3.zoom(delta); return; }
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const s = Math.max(0.5, Math.min(4, this.scale + delta * 0.5));
    if (s === this.scale) return;
    this.userMoved = true;
    const cx = (w / 2 - this.pan.x) / this.scale, cy = (h / 2 - this.pan.y) / this.scale;
    this.scale = s;
    this.pan = { x: Math.round(w / 2 - cx * s), y: Math.round(h / 2 - cy * s) };
  }

  toTile(e) {
    const r = this.cv.getBoundingClientRect();
    const px = (e.clientX - r.left - this.pan.x) / this.scale, py = (e.clientY - r.top - this.pan.y) / this.scale;
    return { x: Math.floor(px / TILE), y: Math.floor(py / TILE), px, py };
  }

  charAt(t) {
    for (const c of [...this.chars.values()].reverse()) {
      if (Math.abs(t.px - (c.x * TILE + 8)) < 10 && t.py > c.y * TILE - 12 && t.py < c.y * TILE + 16) return c;
    }
    return null;
  }

  itemAt(t) {
    for (const it of [...this.layout.items].reverse()) {
      const d = ITEMS[it.type];
      if (t.x >= it.x && t.x < it.x + d.w && t.y >= it.y && t.y < it.y + d.h) return it;
    }
    return null;
  }

  bind() {
    const cv = this.cv;
    cv.style.cursor = 'grab';
    cv.addEventListener('pointerdown', (e) => {
      const t = this.toTile(e);
      if (this.edit) {
        const it = this.itemAt(t);
        this.editSel = it?.id || null;
        this.drag = it ? { item: it, ox: t.x - it.x, oy: t.y - it.y, moved: false } : { pan: true, x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y };
      } else this.drag = { pan: true, x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag) { const t = this.toTile(e); cv.style.cursor = this.edit ? (this.itemAt(t) ? 'move' : 'default') : this.charAt(t) ? 'pointer' : 'grab'; return; }
      if (this.drag.pan) {
        if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 3) { this.drag.moved = true; this.userMoved = true; }
        this.pan = { x: this.drag.px + e.clientX - this.drag.x, y: this.drag.py + e.clientY - this.drag.y };
      } else {
        const t = this.toTile(e);
        const nx = t.x - this.drag.ox, ny = t.y - this.drag.oy;
        if (nx !== this.drag.item.x || ny !== this.drag.item.y) { this.drag.moved = true; if (this.placeable(this.drag.item, nx, ny)) { this.drag.item.x = nx; this.drag.item.y = ny; this.rebuild(); } }
      }
    });
    cv.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.item) { if (d.moved) this.onLayout?.(this.layout); else if (d.item.type === 'desk') this.onDesk?.(d.item); return; }
      if (d.moved) return;
      const c = this.charAt(this.toTile(e));
      this.onSelect?.(c ? c.id : null);
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.edit) return;
      const c = this.charAt(this.toTile(e));
      if (c) this.onContext?.(c.id, e.clientX, e.clientY);
    });
    cv.addEventListener('dblclick', (e) => { const c = this.charAt(this.toTile(e)); if (c) this.onOpen?.(c.id); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); if (!e.deltaX && !e.deltaY) return; this.userMoved = true; this.wheels = (this.wheels || 0) + 1; if (e.ctrlKey || e.metaKey) this.zoom(e.deltaY < 0 ? 1 : -1); else this.pan = { x: this.pan.x - e.deltaX, y: this.pan.y - e.deltaY }; }, { passive: false });
    document.addEventListener('keydown', (e) => {
      if (!this.edit || !this.editSel || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      if (e.key === 'Backspace' || e.key === 'Delete') { this.removeItem(this.editSel); }
    });
  }

  placeable(item, x, y) {
    const d = ITEMS[item.type];
    const room = this.roomAt.get(key(x, y));
    if (!room) return false;
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
      if (this.roomAt.get(key(x + i, y + j)) !== room) return false;
      const other = this.layout.items.find((o) => o !== item && x + i >= o.x && x + i < o.x + ITEMS[o.type].w && y + j >= o.y && y + j < o.y + ITEMS[o.type].h);
      if (other) return false;
    }
    return true;
  }

  addItem(type) {
    const d = ITEMS[type];
    if (!d) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const cx = Math.floor((w / 2 - this.pan.x) / this.scale / TILE), cy = Math.floor((h / 2 - this.pan.y) / this.scale / TILE);
    const item = { id: `i${Date.now()}`, type, x: cx, y: cy, ...(type === 'desk' ? { worker: null } : {}) };
    for (let r = 0; r < 12 && !this.placeable(item, item.x, item.y); r++) { item.x = cx + ((r * 7) % 9) - 4; item.y = cy + ((r * 3) % 7) - 3; }
    if (!this.placeable(item, item.x, item.y)) { const room = this.layout.rooms[0]; const s = this.freeSpot(room, d.w, d.h); if (!s) return; item.x = s.x; item.y = s.y; }
    this.layout.items.push(item);
    this.editSel = item.id;
    this.rebuild();
    this.onLayout?.(this.layout);
  }

  removeItem(id) {
    this.layout.items = this.layout.items.filter((i) => i.id !== id);
    this.editSel = null;
    this.rebuild();
    this.onLayout?.(this.layout);
  }

  assignDesk(deskId, workerId) {
    for (const d of this.desks()) { if (d.worker === workerId) d.worker = null; if (d.id === deskId) d.worker = workerId || null; }
    this.onLayout?.(this.layout);
    this.setWorkers(this.workers);
  }

  cycleFloor(roomId) {
    const names = ['checker', 'wood', 'tile', 'dark', 'carpet', 'sand', 'lavender'];
    const r = this.layout.rooms.find((x) => x.id === roomId);
    if (!r) return;
    r.floor = names[(names.indexOf(r.floor) + 1) % names.length];
    this.onLayout?.(this.layout);
  }

  // ---- drawing ---------------------------------------------------------------
  draw() {
    const g = this.g, L = this.layout, s = this.scale;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#100e0c';
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.imageSmoothingEnabled = false;
    g.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.pan.x * this.dpr, this.pan.y * this.dpr);

    for (const r of L.rooms) {
      const pat = g.createPattern(floorTile(r.floor), 'repeat');
      g.fillStyle = pat;
      g.save(); g.translate(r.x * TILE, r.y * TILE); g.fillRect(0, 0, r.w * TILE, r.h * TILE); g.restore();
    }
    // walls: top edge thick, others thin; doors cut through
    for (const r of L.rooms) {
      g.fillStyle = WALL_TOP; g.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, 4);
      g.fillStyle = WALL;
      g.fillRect(r.x * TILE, r.y * TILE + 4, r.w * TILE, 2);
      g.fillRect(r.x * TILE, r.y * TILE, 2, r.h * TILE); g.fillRect((r.x + r.w) * TILE - 2, r.y * TILE, 2, r.h * TILE);
      g.fillRect(r.x * TILE, (r.y + r.h) * TILE - 2, r.w * TILE, 2);
    }
    for (const e of this.doors) {
      const [a, b] = e.split('>').map((p) => p.split(',').map(Number));
      if (a[0] < b[0] || a[1] < b[1]) {
        const pat = g.createPattern(floorTile(L.rooms.find((r) => r.id === this.roomAt.get(key(b[0], b[1])))?.floor || 'checker'), 'repeat');
        g.fillStyle = pat;
        g.save();
        if (a[0] < b[0]) { g.translate(b[0] * TILE - 2, a[1] * TILE); g.fillRect(0, 2, 4, TILE - 2); } else { g.translate(a[0] * TILE, b[1] * TILE - 2); g.fillRect(2, 0, TILE - 2, 8); }
        g.restore();
      }
    }

    // items and characters in y order
    const drawables = [];
    for (const it of L.items) drawables.push({ y: it.y + ITEMS[it.type].h - 0.5, kind: 'item', it });
    for (const c of this.chars.values()) drawables.push({ y: c.y + 0.6, kind: 'char', c });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) {
      if (d.kind === 'item') {
        const it = d.it, def = ITEMS[it.type];
        const worker = it.type === 'desk' && it.worker ? this.chars.get(it.worker)?.view : null;
        const img = it.type === 'desk' && worker && worker.status === 'working' ? def.work : def.sprite;
        const oy = img.height - def.h * TILE;
        g.drawImage(img, it.x * TILE, it.y * TILE - oy);
        if (this.edit && this.editSel === it.id) { g.strokeStyle = '#f28b6a'; g.lineWidth = 1; g.strokeRect(it.x * TILE + 0.5, it.y * TILE + 0.5, def.w * TILE - 1, def.h * TILE - 1); }
      } else this.drawChar(g, d.c);
    }

    // room names (pixel-ish small text) and bubbles in screen space
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.font = 'bold 9px ui-monospace, Menlo, monospace';
    g.textBaseline = 'top';
    for (const r of L.rooms) {
      const x = Math.round(this.pan.x + (r.x * TILE + 4) * s), y = Math.round(this.pan.y + (r.y * TILE + 7) * s);
      let active = 0;
      for (const c of this.chars.values()) if (c.view.status === 'working' && this.roomAt.get(key(Math.round(c.x), Math.round(c.y))) === r.id) active++;
      const label = `// ${r.name}${active ? ` · ${active}` : ''}`;
      g.fillStyle = 'rgba(16,14,12,0.7)';
      g.fillRect(x - 3, y - 2, g.measureText(label).width + 6, 13);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(label, x, y);
    }
    for (const c of this.chars.values()) this.drawLabel(g, c);
    this.drawSummary(g);
    if (this.edit) {
      g.fillStyle = 'rgba(242,139,106,0.9)'; g.font = 'bold 10px ui-monospace, Menlo, monospace';
      g.fillText('DÜZENLEME: eşyaları sürükle · masaya tıkla → çalışan ata · Delete siler', 10, this.cv.height / this.dpr - 16);
    }
  }

  drawChar(g, c) {
    const v = c.view;
    const x = c.x * TILE + 2, y = c.y * TILE - 2;
    const seated = !v.guest && !c.path.length && !c.errand && Math.abs(c.x - c.seat.x) < 0.01 && Math.abs(c.y - c.seat.y) < 0.01;
    if (v.status === 'working' && (seated || v.guest)) {
      g.fillStyle = `rgba(110,168,255,${0.35 + 0.15 * Math.sin(this.t * 4)})`;
      g.beginPath(); g.ellipse(x + 6, y + 13, 10, 5, 0, 0, Math.PI * 2); g.fill();
    } else if (v.status === 'waiting') {
      g.fillStyle = `rgba(242,201,76,${0.35 + 0.2 * Math.sin(this.t * 6)})`;
      g.beginPath(); g.ellipse(x + 6, y + 13, 10, 5, 0, 0, Math.PI * 2); g.fill();
    }
    if (this.selected === c.id) { g.strokeStyle = '#f28b6a'; g.lineWidth = 1; g.beginPath(); g.ellipse(x + 6, y + 13, 11, 6, 0, 0, Math.PI * 2); g.stroke(); }
    const frames = seated ? c.sprites.sit : c.sprites[c.dir];
    const img = frames[Math.min(c.frame, frames.length - 1)];
    const bob = v.status === 'working' && seated ? Math.round(Math.sin(this.t * 10) * 0.5 + 0.5) : 0;
    g.globalAlpha = v.status === 'offline' ? 0.45 : 1;
    g.drawImage(img, x, y + bob);
    g.globalAlpha = 1;
  }

  drawLabel(g, c) {
    const s = this.scale, v = c.view;
    const sx = this.pan.x + (c.x * TILE + 8) * s, sy = this.pan.y + (c.y * TILE + 15) * s;
    const name = (v.guest ? '✦ ' : '') + String(v.name).toUpperCase().slice(0, v.guest ? 9 : 16);
    g.font = 'bold 9px ui-monospace, Menlo, monospace';
    const w = g.measureText(name).width + 8;
    g.fillStyle = this.selected === c.id ? 'rgba(242,139,106,0.95)' : v.guest ? 'rgba(74,58,110,0.9)' : 'rgba(20,17,15,0.85)';
    g.fillRect(Math.round(sx - w / 2), Math.round(sy), Math.round(w), 12);
    g.fillStyle = this.selected === c.id ? '#1b1510' : '#f3ede4';
    g.fillText(name, Math.round(sx - w / 2) + 4, Math.round(sy) + 2);
    // one bubble above the head (rules in status.js)
    const b = bubbleFor(c, v, this.t, this.colors(), Date.now());
    if (!b) return;
    const pulse = this.reduced ? 0 : (b.pulse || 0);
    g.font = `${b.bold ? 'bold 11px' : '9px'} ui-monospace, Menlo, monospace`;
    const bw = Math.round(g.measureText(b.text).width + 10), bh = 14;
    const lift = this.reduced ? 0 : (b.bounce ? Math.abs(Math.sin(this.t * 5 * (b.pulse || 1))) * b.bounce : b.float ? (this.t * 4) % 4 : 0);
    const bx = Math.round(sx - bw / 2), by = Math.round(this.pan.y + (c.y * TILE - 6) * s - bh - lift);
    g.globalAlpha = pulse ? 0.75 + 0.25 * Math.sin(this.t * 3 * pulse) : 1;
    g.fillStyle = 'rgba(20,17,15,0.9)'; g.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    g.fillStyle = b.bg; g.fillRect(bx, by, bw, bh);
    g.fillStyle = 'rgba(20,17,15,0.9)'; g.fillRect(Math.round(sx) - 2, by + bh, 4, 3);
    g.fillStyle = b.bg; g.fillRect(Math.round(sx) - 1, by + bh, 2, 2);
    g.fillStyle = b.fg; g.fillText(b.text, bx + 5, by + 3);
    g.globalAlpha = 1;
  }

  // top-right one-liner: ● working ● waiting ○ sleeping (same colors as the bubbles)
  drawSummary(g) {
    const n = this.summary(), col = this.colors();
    const parts = [[col.blue, '●', `${n.working} çalışıyor`], [col.yellow, '●', `${n.waiting} bekliyor`], [col.muted, '○', `${n.sleeping} uyuyor`]];
    g.font = '10px ui-monospace, Menlo, monospace';
    let w = 0; for (const [, d, t] of parts) w += g.measureText(`${d} ${t}`).width + 12;
    let x = this.cv.width / this.dpr - w - 6;
    g.fillStyle = 'rgba(16,14,12,0.75)'; g.fillRect(x - 6, 6, w + 6, 16);
    for (const [c, d, t] of parts) { g.fillStyle = c; g.fillText(d, x, 10); g.fillStyle = col.paper; g.fillText(` ${t}`, x + g.measureText(d).width, 10); x += g.measureText(`${d} ${t}`).width + 12; }
  }

  // Status colors come from CSS variables (single source of truth).
  colors() {
    if (!this._colors) {
      const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
      this._colors = { yellow: v('--yellow', '#f2c94c'), purple: v('--purple', '#c58bf2'), blue: v('--blue', '#6ea8ff'), muted: v('--muted', '#8a8178'), paper: v('--text', '#eae2d8'), ink: v('--bg', '#15120f'), dark: v('--panel', '#1b1816') };
    }
    return this._colors;
  }

  summary() { return summarize(this.workers); }
}
