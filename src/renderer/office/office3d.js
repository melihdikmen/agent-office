// 3D view of the office (three.js). The simulation — grid, paths, characters,
// statuses — stays in Office; this only draws it: low-poly rooms and furniture,
// voxel-style people who walk, sit and type, plus HTML labels and bubbles.
import * as THREE from 'three';
import { ITEMS, floorTile, characterColors } from './sprites.js';
import { bubbleFor } from './status.mjs';

const key = (x, y) => `${x},${y}`;
const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const box = (w, h, d, color, x = 0, y = 0, z = 0, extra) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'object' ? color : mat(color, extra));
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
};
const cyl = (r, h, color, x = 0, y = 0, z = 0, seg = 12) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(color)); m.position.set(x, y, z); m.castShadow = true; return m; };

export class Scene3D {
  constructor(office) {
    this.o = office;
    const c = office.container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x100e0c);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.cv = this.renderer.domElement;
    this.cv.className = 'office-canvas office-3d';
    this.cv.style.cursor = 'grab';
    c.append(this.cv);
    this.hud = document.createElement('div');
    this.hud.className = 'o3-hud';
    c.append(this.hud);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x100e0c, 60, 120);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 200);
    this.view = { az: 0.0, el: 0.95, dist: 40, tx: 16, tz: 13 };
    this.hemi = new THREE.HemisphereLight(0xfff1e0, 0x3a3430, 1.15);
    this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffe9d0, 1.2);
    sun.position.set(-14, 34, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
    sun.shadow.bias = -0.0006;
    sun.target.position.set(16, 0, 13);
    this.scene.add(sun, sun.target);
    this.statics = new THREE.Group();
    this.scene.add(this.statics);
    this.people = new Map();      // id → { g, parts, ... }
    this.ray = new THREE.Raycaster();
    this.labels = new Map();      // id → element
    this.roomEls = [];
    this.dirty = true;
    this.bind();
  }

  resize() {
    const w = this.o.container.clientWidth, h = this.o.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.cv.style.width = `${w}px`; this.cv.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  fit() {
    const L = this.o.layout;
    this.view = { az: 0.0, el: 0.95, dist: Math.max(L.cols, L.rows * 1.35) * 0.98, tx: L.cols / 2, tz: L.rows / 2 };
    this.resize();
  }

  zoom(delta) { this.view.dist = Math.max(8, Math.min(90, this.view.dist * (delta > 0 ? 0.8 : 1.25))); }

  place() {
    const v = this.view;
    this.camera.position.set(v.tx + Math.sin(v.az) * Math.cos(v.el) * v.dist, Math.sin(v.el) * v.dist, v.tz + Math.cos(v.az) * Math.cos(v.el) * v.dist);
    this.camera.lookAt(v.tx, 0, v.tz);
  }

  // Light follows the real clock: warm morning and evening, bright noon, dim blue night.
  // Windows on the back walls and the monitors glow once it gets dark.
  daylight() {
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    const day = Math.max(0, Math.min(1, Math.sin(((h - 6) / 14) * Math.PI) * 1.6));       // 0 at night, 1 around midday
    const warm = 1 - Math.min(1, Math.abs(h - 12) / 6);                                     // sun is whiter near noon
    const lerp = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
    this.hemi.intensity = 0.55 + 0.6 * day;
    this.hemi.color.copy(lerp('#8fa4d8', '#fff1e0', day));
    this.hemi.groundColor.copy(lerp('#1c1a26', '#3a3430', day));
    this.sun.intensity = 0.2 + 1.0 * day;
    this.sun.color.copy(lerp('#9db4ff', lerp('#ffb27a', '#fff3e0', warm), day));
    this.night = 1 - day;
    for (const m of this.windows || []) { m.material.emissiveIntensity = 0.15 + 1.1 * this.night; m.material.color.copy(lerp('#bfe3ff', '#ffd98a', this.night)); }
  }

  // ---- static scene ----------------------------------------------------------
  rebuild() {
    this.dirty = false;
    this.lastLight = 0;
    const g = this.statics;
    g.traverse((o) => { if (o.isMesh) { o.geometry?.dispose(); } });
    g.clear();
    const o = this.o, L = o.layout;
    for (const el of this.roomEls) el.remove();
    this.roomEls = [];
    // floors
    for (const r of L.rooms) {
      const tex = new THREE.CanvasTexture(floorTile(r.floor));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(r.w / 2, r.h / 2);
      tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), new THREE.MeshLambertMaterial({ map: tex }));
      m.rotation.x = -Math.PI / 2; m.position.set(r.x + r.w / 2, 0, r.y + r.h / 2); m.receiveShadow = true;
      g.add(m);
      const el = document.createElement('div');
      el.className = 'o3-room'; el.dataset.room = r.id;
      this.hud.append(el); this.roomEls.push(el);
    }
    // slab under everything
    const slab = box(L.cols + 2, 0.4, L.rows + 2, '#1a1613', L.cols / 2, -0.21, L.rows / 2); slab.castShadow = false; g.add(slab);
    // walls (one per shared edge; doors are gaps)
    const seen = new Set();
    const wallMat = mat('#4a3f38'), lowMat = mat('#6a5b50');
    const wall = (x1, z1, x2, z2, high) => {
      const horiz = z1 === z2, len = 1, h = high ? 1.25 : 0.28;
      const m = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 0.14, h, horiz ? 0.14 : len), high ? wallMat : lowMat);
      m.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2); m.castShadow = true; m.receiveShadow = true; g.add(m);
    };
    const edge = (x, y, nx, ny) => {                   // tile (x,y) next to (nx,ny)
      const a = key(x, y), b = key(nx, ny), id = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(id)) return; seen.add(id);
      const ra = o.roomAt.get(a), rb = o.roomAt.get(b);
      if (ra === rb) return;
      if (ra && rb && o.doors.has(`${a}>${b}`)) return;
      if (ny !== y) { const line = Math.max(y, ny); wall(x, line, x + 1, line, !!(ny > y ? rb : ra)); }   // tall only when a room sits south of it
      else wall(Math.max(x, nx), y, Math.max(x, nx), y + 1, false);
    };
    for (const r of L.rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (y === r.y) edge(x, y, x, y - 1);
      if (y === r.y + r.h - 1) edge(x, y, x, y + 1);
      if (x === r.x) edge(x, y, x - 1, y);
      if (x === r.x + r.w - 1) edge(x, y, x + 1, y);
    }
    this.windows = [];
    for (const r of L.rooms) for (let x = r.x + 2; x + 2 <= r.x + r.w - 1; x += 4) {          // windows on the north wall of every room
      const wm = new THREE.MeshLambertMaterial({ color: '#bfe3ff', emissive: new THREE.Color('#ffd98a'), emissiveIntensity: 0.2 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.05), wm);
      m.position.set(x + 1, 0.8, r.y + 0.1); g.add(m); this.windows.push(m);
    }
    for (const it of L.items) { const m = this.furniture(it); if (m) { m.position.x += it.x; m.position.z += it.y; g.add(m); } }
  }

  furniture(it) {
    const G = new THREE.Group();
    switch (it.type) {
      case 'desk': {
        G.add(box(2, 0.08, 1, '#c9a46f', 1, 0.72, 0.5));
        for (const [x, z] of [[0.08, 0.1], [1.92, 0.1], [0.08, 0.9], [1.92, 0.9]]) G.add(box(0.07, 0.7, 0.07, '#4a3f38', x, 0.35, z));
        G.add(box(0.9, 0.02, 0.32, '#2b2622', 1.5, 0.77, 0.75));           // keyboard
        const frame = box(0.8, 0.5, 0.05, '#1b1816', 1.5, 1.08, 0.3);
        const screen = box(0.72, 0.42, 0.02, mat('#243b5a', { emissive: new THREE.Color('#1c2f4d'), emissiveIntensity: 0.6 }), 1.5, 1.08, 0.33);
        screen.castShadow = false; screen.userData.screen = it.id;
        G.add(frame, screen, box(0.1, 0.18, 0.1, '#2b2622', 1.5, 0.86, 0.3));
        G.add(box(0.3, 0.3, 0.3, '#d9d3c8', 0.4, 0.9, 0.5));               // mug / papers
        // chair
        G.add(box(0.5, 0.06, 0.5, '#3b4a6b', 1.5, 0.45, 1.5), box(0.46, 0.3, 0.05, '#3b4a6b', 1.5, 0.63, 1.76), cyl(0.04, 0.4, '#222', 1.5, 0.22, 1.5, 6));
        this.screens = this.screens || new Map(); this.screens.set(it.id, screen);
        break;
      }
      case 'plant': G.add(cyl(0.22, 0.3, '#a0522d', 0.5, 0.15, 0.5), cyl(0.04, 0.3, '#4a3f38', 0.5, 0.45, 0.5, 6));
        for (const [x, y, z, s] of [[0.5, 0.85, 0.5, 0.3], [0.35, 0.7, 0.55, 0.2], [0.65, 0.72, 0.42, 0.22]]) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat('#3f9a4d')); m.position.set(x, y, z); m.castShadow = true; G.add(m); }
        break;
      case 'shelf': G.add(box(0.9, 1.5, 0.45, '#7a5a3a', 0.5, 0.75, 0.5));
        ['#c44536', '#4895ef', '#f2c94c', '#52b788', '#e76f51'].forEach((c, i) => G.add(box(0.14, 0.26, 0.04, c, 0.15 + i * 0.17, 1.1 - (i % 2) * 0.4, 0.74)));
        break;
      case 'sofa': G.add(box(2, 0.35, 0.8, '#7b5cff', 1, 0.28, 0.5), box(2, 0.55, 0.22, '#6a4be8', 1, 0.65, 0.2), box(0.2, 0.5, 0.8, '#6a4be8', 0.1, 0.45, 0.5), box(0.2, 0.5, 0.8, '#6a4be8', 1.9, 0.45, 0.5)); break;
      case 'board': G.add(box(1.9, 0.9, 0.06, '#f3efe6', 1, 1.0, 0.1), box(2, 1, 0.04, '#4a3f38', 1, 1.0, 0.07)); G.add(box(0.5, 0.04, 0.01, '#e76f51', 0.6, 1.1, 0.14), box(0.7, 0.04, 0.01, '#4895ef', 1.3, 0.95, 0.14)); break;
      case 'coffee': G.add(box(0.7, 0.9, 0.55, '#3b3633', 0.5, 0.45, 0.5), box(0.3, 0.05, 0.3, '#f3efe6', 0.5, 0.18, 0.62), box(0.1, 0.1, 0.02, '#e76f51', 0.7, 0.75, 0.78)); break;
      case 'cooler': G.add(box(0.5, 0.7, 0.5, '#e8eef2', 0.5, 0.35, 0.5), cyl(0.2, 0.45, '#8fc6f2', 0.5, 0.95, 0.5)); G.children[1].material.transparent = true; G.children[1].material.opacity = 0.75; break;
      case 'rack': G.add(box(0.7, 1.4, 0.6, '#262a34', 0.5, 0.7, 0.5)); for (let i = 0; i < 5; i++) G.add(box(0.5, 0.05, 0.02, i % 2 ? '#7ad7a0' : '#6ea8ff', 0.5, 0.35 + i * 0.22, 0.81, { emissive: new THREE.Color(i % 2 ? '#2b6b45' : '#1f4a88') })); break;
      case 'table': G.add(box(2, 0.08, 0.9, '#8a5a36', 1, 0.72, 0.5)); for (const [x, z] of [[0.1, 0.15], [1.9, 0.15], [0.1, 0.85], [1.9, 0.85]]) G.add(box(0.08, 0.7, 0.08, '#4a3f38', x, 0.35, z)); break;
      case 'rug': { const r = box(1.9, 0.02, 0.9, '#c44536', 1, 0.011, 0.5); r.castShadow = false; G.add(r, box(1.5, 0.025, 0.5, '#e9c46a', 1, 0.013, 0.5)); break; }
      default: return null;
    }
    return G;
  }

  // ---- people ----------------------------------------------------------------
  person(c) {
    const col = characterColors(c.view.seed ?? 0);
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const skin = mat(col.skin), shirt = mat(col.shirt), pants = mat(col.pants);
    const hip = (x) => { const p = new THREE.Group(); p.position.set(x, 0.42, 0); p.add(box(0.17, 0.42, 0.18, pants, 0, -0.21, 0)); return p; };
    const legL = hip(-0.1), legR = hip(0.1);
    const torso = box(0.42, 0.45, 0.24, shirt, 0, 0.64, 0);
    const shoulder = (x) => { const p = new THREE.Group(); p.position.set(x, 0.82, 0); p.add(box(0.12, 0.4, 0.14, shirt, 0, -0.17, 0), box(0.11, 0.1, 0.12, skin, 0, -0.4, 0)); return p; };
    const armL = shoulder(-0.28), armR = shoulder(0.28);
    const head = new THREE.Group(); head.position.set(0, 1.08, 0);
    head.add(box(0.34, 0.34, 0.32, skin, 0, 0, 0), box(0.37, 0.14, 0.35, col.hair, 0, 0.17, -0.01), box(0.37, 0.3, 0.1, col.hair, 0, 0.05, -0.15));
    head.add(box(0.05, 0.06, 0.02, '#1b1b1b', -0.08, 0.02, 0.165), box(0.05, 0.06, 0.02, '#1b1b1b', 0.08, 0.02, 0.165));
    if (col.specs) head.add(box(0.28, 0.02, 0.02, '#1b1b1b', 0, 0.03, 0.17));
    body.add(legL, legR, torso, armL, armR, head);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 28), new THREE.MeshBasicMaterial({ color: 0x6ea8ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; root.add(ring);
    root.scale.setScalar(1.22);
    this.scene.add(root);
    const el = document.createElement('div');
    el.className = 'o3-label'; this.hud.append(el);
    const bub = document.createElement('div');
    bub.className = 'o3-bubble'; this.hud.append(bub);
    return { root, body, legL, legR, armL, armR, head, torso, ring, el, bub, name: null, bubText: null };
  }

  syncPeople() {
    const o = this.o;
    for (const [id, p] of this.people) if (!o.chars.has(id)) { this.scene.remove(p.root); p.el.remove(); p.bub.remove(); this.people.delete(id); }
    for (const c of o.chars.values()) {
      let p = this.people.get(c.id);
      if (!p || p.seed !== c.view.seed) { if (p) { this.scene.remove(p.root); p.el.remove(); p.bub.remove(); } p = this.person(c); p.seed = c.view.seed; this.people.set(c.id, p); }
    }
  }

  animate(t) {
    const o = this.o, tmp = new THREE.Vector3();
    this.syncPeople();
    const colors = o.colors();
    for (const c of o.chars.values()) {
      const p = this.people.get(c.id); if (!p) continue;
      const v = c.view;
      const seated = !v.guest && !c.path.length && !c.errand && Math.abs(c.x - c.seat.x) < 0.01 && Math.abs(c.y - c.seat.y) < 0.01;
      const walking = c.path.length > 0;
      const face = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[c.dir] ?? 0;
      const target = seated ? Math.PI : face;                       // seated people face the desk (north)
      let d = target - p.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      p.root.rotation.y += d * 0.25;
      p.root.position.set(c.x + 0.5, 0, c.y + 0.5 + (seated ? 0.05 : 0));
      const sw = walking ? Math.sin(c.walk * 1.6) * 0.7 : 0;
      p.legL.rotation.x = seated ? -Math.PI / 2 : sw; p.legR.rotation.x = seated ? -Math.PI / 2 : -sw;
      p.body.position.y = seated ? -0.12 : walking ? Math.abs(Math.sin(c.walk * 1.6)) * 0.05 : Math.sin(t * 1.6 + c.walk) * 0.012;
      p.legL.position.z = p.legR.position.z = seated ? 0.12 : 0;
      p.armL.rotation.x = walking ? -sw : 0; p.armR.rotation.x = walking ? sw : 0;
      p.armL.rotation.z = 0.05; p.armR.rotation.z = -0.05;
      p.head.rotation.x = 0; p.head.rotation.z = 0;
      if (seated && v.status === 'working') {                       // typing
        p.armL.rotation.x = -1.25 + Math.sin(t * 17) * 0.12; p.armR.rotation.x = -1.25 + Math.sin(t * 17 + 2) * 0.12;
        p.head.rotation.x = 0.1 + Math.sin(t * 2.2) * 0.05;
      } else if (seated) { p.armL.rotation.x = p.armR.rotation.x = -0.9; }
      if (v.status === 'waiting') { p.armR.rotation.x = -Math.PI + 0.2 + Math.sin(t * 7) * 0.35; p.armR.rotation.z = -0.15; }    // waving for attention
      if (v.status === 'offline') { p.head.rotation.x = 0.45; p.armL.rotation.x = p.armR.rotation.x = -0.3; }
      if (c.errand) { p.armR.rotation.x = -1.5; }                    // holds the coffee
      const ringOn = o.selected === c.id || ((v.status === 'working' || v.status === 'waiting') && (seated || v.guest));
      p.ring.material.opacity = ringOn ? (o.selected === c.id ? 0.95 : 0.35 + 0.2 * Math.sin(t * 4)) : 0;
      p.ring.material.color.set(o.selected === c.id ? '#f28b6a' : v.status === 'waiting' ? '#f2c94c' : '#6ea8ff');
      // HUD: name tag + bubble projected to the screen
      tmp.set(c.x + 0.5, 0, c.y + 0.5 + 0.35).project(this.camera);
      const sx = (tmp.x * 0.5 + 0.5) * this.w, sy = (-tmp.y * 0.5 + 0.5) * this.h;      // feet
      tmp.set(c.x + 0.5, 1.95, c.y + 0.5).project(this.camera);
      const hy = (-tmp.y * 0.5 + 0.5) * this.h;                                          // above the head
      const name = (v.guest ? '✦ ' : '') + String(v.name).toUpperCase().slice(0, v.guest ? 9 : 16);
      if (p.name !== name || p.sel !== (o.selected === c.id)) { p.name = name; p.sel = o.selected === c.id; p.el.textContent = name; p.el.classList.toggle('sel', p.sel); p.el.classList.toggle('guest', !!v.guest); }
      p.el.style.transform = `translate(${sx}px,${sy + 2}px) translate(-50%,0)`;
      p.el.style.opacity = v.status === 'offline' ? 0.6 : 1;
      const b = bubbleFor(c, v, o.t, colors, Date.now());
      if (!b) p.bub.style.display = 'none';
      else {
        const lift = b.bounce ? Math.abs(Math.sin(o.t * 5 * (b.pulse || 1))) * b.bounce : b.float ? (o.t * 4) % 4 : 0;
        p.bub.style.display = 'block';
        if (p.bubText !== b.text) { p.bubText = b.text; p.bub.textContent = b.text; }
        p.bub.style.background = b.bg; p.bub.style.color = b.fg; p.bub.style.fontWeight = b.bold ? 700 : 400;
        p.bub.style.opacity = b.pulse ? 0.75 + 0.25 * Math.sin(o.t * 3 * b.pulse) : 1;
        p.bub.style.transform = `translate(${sx}px,${hy - 4 - lift}px) translate(-50%,-100%)`;
      }
    }
    // monitors glow while their worker is working
    if (this.screens) for (const it of o.layout.items) if (it.type === 'desk') {
      const s = this.screens.get(it.id), v = it.worker && o.chars.get(it.worker)?.view;
      if (s) { const on = v && v.status === 'working'; s.material.color.set(on ? '#6ea8ff' : '#243b5a'); s.material.emissive.set(on ? '#3f78d8' : '#1c2f4d'); s.material.emissiveIntensity = on ? 0.9 + 0.2 * Math.sin(t * 8) : 0.35; }
    }
    // room names
    this.roomEls.forEach((el, i) => {
      const r = o.layout.rooms[i]; if (!r) return;
      tmp.set(r.x + 0.6, 0.3, r.y + r.h - 0.3).project(this.camera);
      let active = 0; for (const c of o.chars.values()) if (c.view.status === 'working' && o.roomAt.get(key(Math.round(c.x), Math.round(c.y))) === r.id) active++;
      const label = `// ${r.name}${active ? ` · ${active}` : ''}`;
      if (el.textContent !== label) el.textContent = label;
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * this.w}px,${(-tmp.y * 0.5 + 0.5) * this.h}px) translate(0,-100%)`;
    });
  }

  // Selecting an agent glides the camera to them (any manual pan/rotate cancels it).
  followSelected() {
    const o = this.o, v = this.view;
    if (o.selected !== this.lastSel) { this.lastSel = o.selected; this.following = !!o.selected && o.chars.has(o.selected); }
    if (!this.following) return;
    const c = o.chars.get(o.selected);
    if (!c) return;
    v.tx += (c.x + 0.5 - v.tx) * 0.08; v.tz += (c.y + 0.5 - v.tz) * 0.08;
    if (v.dist > 26) v.dist += (26 - v.dist) * 0.06;
  }

  render(t) {
    if (this.dirty) { this.screens = new Map(); this.rebuild(); }
    if (!this.w) this.fit();
    if (!this.lastLight || t - this.lastLight > 30) { this.lastLight = t; this.daylight(); }
    this.followSelected();
    this.place();
    this.camera.updateMatrixWorld();
    this.animate(t);
    this.renderer.render(this.scene, this.camera);
    this.summaryEl ||= (() => { const e = document.createElement('div'); e.className = 'o3-summary'; this.hud.append(e); return e; })();
    const n = this.o.summary();
    const html = `<span style="color:var(--blue)">●</span> ${n.working} çalışıyor <span style="color:var(--yellow)">●</span> ${n.waiting} bekliyor <span style="color:var(--muted)">○</span> ${n.sleeping} uyuyor`;
    if (this.summaryHtml !== html) { this.summaryHtml = html; this.summaryEl.innerHTML = html; }
  }

  // ---- input -----------------------------------------------------------------
  pick(e) {
    const r = this.cv.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    let best = null, bd = 1e9;
    for (const [id, p] of this.people) {
      const hits = this.ray.intersectObject(p.root, true);
      if (hits.length && hits[0].distance < bd) { bd = hits[0].distance; best = id; }
    }
    return best;
  }

  bind() {
    const cv = this.cv, v = () => this.view;
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      drag = { x: e.clientX, y: e.clientY, az: v().az, el: v().el, tx: v().tx, tz: v().tz, pan: e.shiftKey || e.button === 1, moved: false };
      cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) { cv.style.cursor = this.pick(e) ? 'pointer' : 'grab'; return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 3) { drag.moved = true; this.o.userMoved = true; this.following = false; }
      if (!drag.moved) return;
      if (drag.pan) {
        const k = v().dist * 0.0016, s = Math.sin(v().az), c = Math.cos(v().az);
        v().tx = drag.tx - (dx * c + dy * s) * k; v().tz = drag.tz - (-dx * s + dy * c) * k;
      } else { v().az = drag.az - dx * 0.006; v().el = Math.max(0.35, Math.min(1.45, drag.el + dy * 0.005)); }
    });
    cv.addEventListener('pointerup', (e) => {
      const d = drag; drag = null; cv.style.cursor = 'grab';
      if (d && !d.moved) this.o.onSelect?.(this.pick(e));
    });
    cv.addEventListener('dblclick', (e) => { const id = this.pick(e); if (id) this.o.onOpen?.(id); });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); const id = this.pick(e); if (id) this.o.onContext?.(id, e.clientX, e.clientY); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.o.userMoved = true; this.following = false; this.view.dist = Math.max(8, Math.min(90, this.view.dist * (1 + Math.sign(e.deltaY) * Math.min(0.12, Math.abs(e.deltaY) * 0.002)))); }, { passive: false });
  }
}
