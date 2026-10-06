'use strict';
// Canvas office: desks for team agents, a meeting room for broadcasts, a coffee
// corner for idle agents, and a lobby where agents detected on this machine wait.
(() => {
  const W = 1200, H = 660, CY = 292;
  const SEATS = [
    { x: 110, y: 150, row: 0 }, { x: 280, y: 150, row: 0 }, { x: 450, y: 150, row: 0 }, { x: 620, y: 150, row: 0 },
    { x: 110, y: 430, row: 1 }, { x: 280, y: 430, row: 1 }, { x: 450, y: 430, row: 1 },
  ];
  const OWNER = { x: 620, y: 430, row: 1 };
  const SPEAKER = { x: 1125, y: 125 };
  const COFFEE = { x: 850, y: 560 };
  const LOBBY = { x0: 990, y0: 400, cols: 4, dx: 54, dy: 64, max: 12 };
  const SKINS = ['#f1c7a3', '#e0ac85', '#c68863', '#f5d0b5', '#d99e78', '#b97a56', '#f0bf9a'];
  const HAIR = ['#2b2118', '#6b3e26', '#111', '#a0522d', '#3d2b1f', '#d4a15a', '#222'];
  const KIND_COLORS = {
    'claude-code': '#d97757', 'claude-desktop': '#c15f3c', cursor: '#d9d9de', 'cursor-agent': '#9aa0aa', 'cursor-cli': '#9aa0aa',
    codex: '#10a37f', gemini: '#4c8bf5', ollama: '#f2f2f2', aider: '#14b8a6', opencode: '#f59e0b', goose: '#a78bfa', copilot: '#6e40c9',
    amp: '#ef4444', windsurf: '#34d399', lmstudio: '#6366f1',
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  class OfficeCanvas {
    constructor(canvas, { onSelect, onSelectExternal }) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.onSelect = onSelect;
      this.onSelectExternal = onSelectExternal;
      this.chars = new Map();
      this.team = [];
      this.externals = [];
      this.envelopes = [];
      this.selected = null;
      this.hover = null;
      this.mouse = null;
      this.t = 0;
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      canvas.addEventListener('mousemove', (e) => { this.mouse = this.toWorld(e); this.hover = this.hit(this.mouse); canvas.style.cursor = this.hover ? 'pointer' : 'default'; });
      canvas.addEventListener('mouseleave', () => { this.mouse = null; this.hover = null; });
      canvas.addEventListener('click', (e) => {
        const h = this.hit(this.toWorld(e));
        if (h?.type === 'agent') this.onSelect(h.id);
        else if (h?.type === 'ext') this.onSelectExternal(h.id);
      });
      this.resize();
      let last = performance.now();
      const loop = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        this.t += dt;
        this.update(dt);
        this.draw();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    // ---- data in ---------------------------------------------------------
    setTeam(team, snapshots) {
      this.team = team;
      const keep = new Set(team.map((a) => a.id));
      for (const id of this.chars.keys()) if (!keep.has(id)) this.chars.delete(id);
      team.forEach((a, i) => {
        const seat = SEATS[i % SEATS.length];
        let c = this.chars.get(a.id);
        if (!c) {
          c = { id: a.id, x: seat.x, y: seat.y, actions: [], cur: null, path: [], bubble: null, errand: null, wanderAt: performance.now() / 1000 + rand(20, 60), skin: SKINS[i % SKINS.length], hair: HAIR[(i * 3) % HAIR.length] };
          this.chars.set(a.id, c);
        }
        Object.assign(c, { seat, name: a.name, title: a.title, color: a.color });
      });
      for (const s of snapshots || []) this.updateAgent(s);
    }

    updateAgent(s) {
      const c = this.chars.get(s.id);
      if (!c) return;
      const was = c.status;
      Object.assign(c, { status: s.status, activity: s.activity, inbox: s.inbox });
      if (s.status === 'working' && was !== 'working' && c.errand === 'wander') {
        c.actions = []; c.cur = null; c.path = []; c.errand = null; c.bubble = null;
        this.goHome(c);
      }
    }

    setExternals(list) { this.externals = list; }
    setSelected(id) { this.selected = id; }

    onMessage(msg) {
      if (msg.held) return;
      const label = (msg.kind === 'task' ? '📋 ' : '') + clip(msg.text.split('\n')[0], 46);
      if (msg.from === 'user') {
        for (const to of msg.to) this.flyEnvelope({ x: OWNER.x, y: OWNER.y }, this.visitSpot(to), '#ffd166');
        return;
      }
      const c = this.chars.get(msg.from);
      if (!c) return;
      const targets = msg.to;
      if (c.errand === 'wander') { c.actions = []; c.cur = null; c.path = []; c.bubble = null; }
      if (c.actions.length > 6) {
        for (const to of targets) this.flyEnvelope(c, this.visitSpot(to), c.color);
        return;
      }
      c.errand = 'msg';
      if (targets.length >= 3) {
        c.actions.push({ t: 'go', ...SPEAKER }, { t: 'say', text: `📢 ${label}`, dur: 2.6 });
        c.actions.push({ t: 'fn', fn: () => targets.forEach((to) => this.flyEnvelope(SPEAKER, this.visitSpot(to), c.color)) });
      } else {
        for (const to of targets) {
          c.actions.push({ t: 'go', ...this.visitSpot(to) }, { t: 'say', text: label, dur: 2.4 });
        }
      }
      c.actions.push({ t: 'home' });
    }

    visitSpot(id) {
      if (id === 'user') return { x: OWNER.x + 36, y: OWNER.y + 2 };
      const c = this.chars.get(id);
      const s = c ? c.seat : OWNER;
      return { x: s.x + 36, y: s.y + 2 };
    }

    flyEnvelope(from, to, color) {
      this.envelopes.push({ x0: from.x, y0: from.y - 20, x1: to.x - 36, y1: to.y - 20, t: 0, dur: 1.1, color });
    }

    goHome(c) { c.actions.push({ t: 'home' }); }

    // ---- simulation ------------------------------------------------------
    update(dt) {
      const now = performance.now() / 1000;
      for (const c of this.chars.values()) {
        if (!c.cur && c.actions.length) { c.cur = c.actions.shift(); c.path = []; c.timer = 0; }
        if (!c.cur) {
          c.walking = false;
          if (c.errand) c.errand = null;
          if ((c.status === 'idle' || !c.status) && now > c.wanderAt) {
            c.wanderAt = now + rand(35, 80);
            c.errand = 'wander';
            c.actions.push({ t: 'go', x: COFFEE.x + rand(-40, 40), y: COFFEE.y + rand(-10, 10) }, { t: 'say', text: '☕', dur: 5 }, { t: 'home' });
          }
          continue;
        }
        const a = c.cur;
        if (a.t === 'go' || a.t === 'home') {
          if (!c.path.length) {
            const q = a.t === 'home' ? { x: c.seat.x, y: c.seat.y } : a;
            if (Math.abs(c.x - q.x) < 1 && Math.abs(c.y - q.y) < 1) { c.cur = null; continue; }
            c.path = Math.abs(c.y - q.y) < 2 ? [q] : [{ x: c.x, y: CY + (c.id.length % 3) * 6 }, { x: q.x, y: CY + (c.id.length % 3) * 6 }, q];
          }
          const p = c.path[0];
          const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
          const step = 150 * dt;
          c.walking = true;
          if (d <= step) { c.x = p.x; c.y = p.y; c.path.shift(); if (!c.path.length) c.cur = null; }
          else { c.x += (dx / d) * step; c.y += (dy / d) * step; }
        } else if (a.t === 'say') {
          c.walking = false;
          if (!c.bubble) c.bubble = { text: a.text };
          c.timer += dt;
          if (c.timer >= a.dur) { c.bubble = null; c.cur = null; }
        } else if (a.t === 'fn') {
          a.fn(); c.cur = null;
        }
      }
      for (const e of this.envelopes) e.t += dt;
      this.envelopes = this.envelopes.filter((e) => e.t < e.dur);
    }

    // ---- geometry --------------------------------------------------------
    resize() {
      const box = this.cv.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.cv.width = Math.max(1, box.width * dpr);
      this.cv.height = Math.max(1, box.height * dpr);
      this.cv.style.width = box.width + 'px';
      this.cv.style.height = box.height + 'px';
      this.scale = Math.min(box.width / W, box.height / H);
      this.ox = (box.width - W * this.scale) / 2;
      this.oy = (box.height - H * this.scale) / 2;
      this.dpr = dpr;
    }

    toWorld(e) {
      const r = this.cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - this.ox) / this.scale, y: (e.clientY - r.top - this.oy) / this.scale };
    }

    hit(p) {
      if (!p) return null;
      for (const c of this.chars.values()) {
        if (Math.hypot(p.x - c.x, p.y - (c.y - 8)) < 22) return { type: 'agent', id: c.id };
        const s = c.seat, dy = s.row === 0 ? -88 : 40;
        if (p.x > s.x - 52 && p.x < s.x + 52 && p.y > s.y + dy && p.y < s.y + dy + 54) return { type: 'agent', id: c.id };
      }
      for (const [i, x] of this.externals.slice(0, LOBBY.max).entries()) {
        const pos = this.lobbyPos(i);
        if (Math.hypot(p.x - pos.x, p.y - pos.y) < 22) return { type: 'ext', id: x.id };
      }
      return null;
    }

    lobbyPos(i) { return { x: LOBBY.x0 + (i % LOBBY.cols) * LOBBY.dx, y: LOBBY.y0 + Math.floor(i / LOBBY.cols) * LOBBY.dy }; }

    // ---- drawing ---------------------------------------------------------
    draw() {
      const g = this.ctx;
      const s = this.scale * this.dpr;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#101218';
      g.fillRect(0, 0, this.cv.width, this.cv.height);
      g.setTransform(s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr);
      this.drawFloor(g);
      this.drawFurniture(g);
      const chars = [...this.chars.values()].sort((a, b) => a.y - b.y);
      for (const c of chars) this.drawChar(g, c);
      this.drawExternals(g);
      for (const e of this.envelopes) this.drawEnvelope(g, e);
      for (const c of chars) if (c.bubble) this.bubble(g, c.x, c.y - 44, c.bubble.text, '#fff', '#1b1d24');
      this.drawTooltip(g);
    }

    drawFloor(g) {
      // Open office: wood planks
      g.fillStyle = '#2a2520';
      g.fillRect(20, 20, 740, 620);
      g.strokeStyle = 'rgba(255,255,255,0.035)';
      g.lineWidth = 1;
      for (let y = 20; y < 640; y += 22) { g.beginPath(); g.moveTo(20, y); g.lineTo(760, y); g.stroke(); }
      for (let y = 20, r = 0; y < 640; y += 22, r++) for (let x = 20 + (r % 2) * 60; x < 760; x += 120) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 22); g.stroke(); }
      // Corridor rug
      g.fillStyle = '#342d27';
      g.fillRect(20, CY - 22, 1160, 44);
      // Meeting room carpet
      g.fillStyle = '#23303a';
      g.fillRect(760, 20, 420, 240);
      // Kitchen tiles
      for (let x = 760; x < 930; x += 20) for (let y = 330; y < 640; y += 20) { g.fillStyle = ((x + y) / 20) % 2 ? '#2d3238' : '#272b30'; g.fillRect(x, y, 20, 20); }
      // Lobby
      g.fillStyle = '#1f2a26';
      g.fillRect(930, 330, 250, 310);
      // Walls
      g.strokeStyle = '#4a4f5c';
      g.lineWidth = 8;
      g.lineCap = 'round';
      const wall = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
      g.strokeRect(20, 20, 1160, 620);
      wall(760, 20, 760, 262); wall(760, 322, 760, 640);          // office | right side
      wall(760, 260, 800, 260); wall(1150, 260, 1180, 260);       // meeting room front (wide door)
      wall(760, 324, 780, 324); wall(920, 324, 960, 324);         // kitchen front
      wall(930, 324, 930, 640);                                   // kitchen | lobby
      wall(1150, 324, 1180, 324);
      // Room labels
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.font = '600 11px -apple-system, system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText('AÇIK OFİS', 34, 40);
      g.fillText('TOPLANTI ODASI', 774, 40);
      g.fillText('MUTFAK', 774, 350);
      g.fillText('LOBİ · RADAR', 944, 350);
    }

    drawFurniture(g) {
      const t = this.t;
      // Meeting table + chairs + whiteboard
      this.round(g, 860, 100, 220, 90, 40, '#5b4636');
      for (let i = 0; i < 4; i++) { this.round(g, 880 + i * 52, 78, 24, 16, 6, '#39414f'); this.round(g, 880 + i * 52, 196, 24, 16, 6, '#39414f'); }
      this.round(g, 1160, 60, 10, 130, 3, '#e8eaf0');
      // Kitchen
      this.round(g, 780, 600, 140, 30, 4, '#555c66');
      this.round(g, 830, 592, 30, 26, 4, '#1e1f22');
      g.fillStyle = '#ff6b6b'; g.beginPath(); g.arc(845, 600, 2.5, 0, 7); g.fill();
      this.round(g, 790, 400, 60, 60, 30, '#6d5a48');
      // Plants
      for (const [x, y] of [[40, 620], [740, 40], [740, 620], [1160, 620]]) this.plant(g, x, y);
      // Owner desk
      this.desk(g, OWNER, 'owner');
      // Team desks
      this.chars.forEach((c) => this.desk(g, c.seat, c));
      void t;
    }

    desk(g, s, c) {
      const top = s.row === 0 ? s.y - 88 : s.y + 40;
      this.round(g, s.x - 50, top, 100, 50, 6, '#6f5a47');
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(s.x - 50, top + 46, 100, 4);
      // chair
      this.round(g, s.x - 14, s.y - 4, 28, 22, 8, '#30343d');
      // monitor
      const my = s.row === 0 ? top + 8 : top + 14;
      this.round(g, s.x - 22, my, 44, 26, 3, '#15171c');
      let screen = '#20242c';
      const status = c === 'owner' ? 'owner' : c.status;
      if (status === 'working') screen = '#0f3b3a';
      else if (status === 'queued') screen = '#4a3b12';
      else if (status === 'error') screen = '#4a1616';
      else if (status === 'owner') screen = '#1c2a44';
      this.round(g, s.x - 19, my + 3, 38, 20, 2, screen);
      if (status === 'working') {
        g.save(); g.beginPath(); g.rect(s.x - 19, my + 3, 38, 20); g.clip();
        const off = (this.t * 14) % 5;
        for (let i = 0; i < 6; i++) {
          const w = 8 + ((i * 7 + Math.floor(this.t * 3)) % 5) * 5;
          g.fillStyle = i % 3 === 0 ? '#5eead4' : '#94f0c8';
          g.fillRect(s.x - 16 + (i % 2) * 4, my + 5 + i * 5 - off, w, 2);
        }
        g.restore();
      } else if (status === 'queued') {
        g.fillStyle = `rgba(255,209,102,${0.5 + 0.5 * Math.sin(this.t * 6)})`;
        g.beginPath(); g.arc(s.x, my + 13, 4, 0, 7); g.fill();
      } else if (status === 'error') {
        g.fillStyle = '#ff6b6b'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillText('!', s.x, my + 18);
      } else if (status === 'owner') {
        g.fillStyle = '#8ab4ff'; g.fillRect(s.x - 14, my + 8, 28, 2); g.fillRect(s.x - 14, my + 13, 18, 2);
      }
      // keyboard + mug
      this.round(g, s.x - 16, s.row === 0 ? top + 38 : top + 4, 32, 7, 2, '#2c2f36');
      g.fillStyle = '#d9d9d9'; g.beginPath(); g.arc(s.x + 38, top + 14, 5, 0, 7); g.fill();
      if (c === 'owner') {
        this.label(g, s.x, s.y + 4, 'Sen', '#ffd166', 'Owner');
        return;
      }
      // accent strip
      g.fillStyle = c.color; g.fillRect(s.x - 50, s.row === 0 ? top : top + 46, 100, 4);
    }

    drawChar(g, c) {
      const walking = c.walking;
      const bob = walking ? Math.sin(this.t * 14) * 2 : (c.status === 'working' ? Math.sin(this.t * 20) * 0.6 : 0);
      const x = c.x, y = c.y + bob;
      if (this.selected === c.id) {
        g.strokeStyle = c.color; g.lineWidth = 2.5;
        g.beginPath(); g.ellipse(c.x, c.y + 14, 20, 7, 0, 0, 7); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.ellipse(c.x, c.y + 14, 13, 4.5, 0, 0, 7); g.fill();
      if (walking) {
        const sw = Math.sin(this.t * 14) * 4;
        g.strokeStyle = '#23252b'; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - 5, y + 6); g.lineTo(x - 5 + sw, y + 14); g.moveTo(x + 5, y + 6); g.lineTo(x + 5 - sw, y + 14); g.stroke();
      }
      // body
      this.round(g, x - 12, y - 6, 24, 20, 9, c.color);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x - 1, y - 5, 2, 12);
      // arms typing
      if (c.status === 'working' && !walking) {
        const k = Math.sin(this.t * 22) * 2;
        g.fillStyle = c.skin;
        g.beginPath(); g.arc(x - 12, y + 2 + k, 3.2, 0, 7); g.arc(x + 12, y + 2 - k, 3.2, 0, 7); g.fill();
      }
      // head
      g.fillStyle = c.skin;
      g.beginPath(); g.arc(x, y - 16, 11, 0, 7); g.fill();
      g.fillStyle = c.hair;
      g.beginPath(); g.arc(x, y - 18, 11.5, Math.PI * 1.02, Math.PI * 1.98); g.fill();
      g.fillRect(x - 11.5, y - 20, 23, 3);
      g.fillStyle = '#1b1b1b';
      const blink = (this.t + c.id.length) % 4 < 0.12;
      if (blink) { g.fillRect(x - 5, y - 14, 3, 1); g.fillRect(x + 2, y - 14, 3, 1); }
      else { g.beginPath(); g.arc(x - 4, y - 14, 1.5, 0, 7); g.arc(x + 4, y - 14, 1.5, 0, 7); g.fill(); }
      // status badge
      const bx = x + 13, by = y - 28;
      if (c.status === 'working' && !c.bubble) {
        this.round(g, x - 14, y - 44, 28, 14, 7, '#e8f7f3');
        for (let i = 0; i < 3; i++) {
          g.fillStyle = `rgba(20,110,95,${0.35 + 0.65 * ((Math.floor(this.t * 4) % 3) === i ? 1 : 0)})`;
          g.beginPath(); g.arc(x - 6 + i * 6, y - 37, 2, 0, 7); g.fill();
        }
      } else if (c.status === 'queued') this.badge(g, bx, by, String(c.inbox || '•'), '#ffd166', '#3b2f00');
      else if (c.status === 'error') this.badge(g, bx, by, '!', '#ff6b6b', '#fff');
      else if (c.status === 'stopped') this.badge(g, bx, by, 'II', '#8b93a7', '#fff');
      else if (c.status === 'idle' && !c.bubble && !walking && (this.t + c.id.length * 3) % 12 < 2.5) {
        g.fillStyle = 'rgba(200,210,230,0.7)'; g.font = 'italic 600 10px sans-serif'; g.textAlign = 'left';
        g.fillText('z', x + 12, y - 28 - ((this.t * 6) % 6)); g.fillText('z', x + 18, y - 36 - ((this.t * 6) % 6));
      }
      // name + activity (only at desk)
      const atDesk = Math.abs(c.x - c.seat.x) < 2 && Math.abs(c.y - c.seat.y) < 2;
      if (atDesk) this.label(g, c.seat.x, c.seat.y + (c.seat.row === 0 ? 4 : 4), c.name, c.color, c.status === 'working' ? clip(c.activity, 26) : c.title);
      else { g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '600 10px -apple-system, sans-serif'; g.textAlign = 'center'; g.fillText(c.name, x, y + 28); }
    }

    label(g, x, y, name, color, sub) {
      g.textAlign = 'center';
      g.font = '700 11px -apple-system, system-ui, sans-serif';
      const w = Math.max(g.measureText(name).width, (() => { g.font = '10px -apple-system, sans-serif'; return g.measureText(sub || '').width; })()) + 14;
      this.round(g, x - w / 2, y + 17, w, sub ? 28 : 16, 6, 'rgba(12,14,18,0.78)');
      g.fillStyle = color; g.font = '700 11px -apple-system, system-ui, sans-serif'; g.fillText(name, x, y + 29);
      if (sub) { g.fillStyle = 'rgba(220,225,235,0.75)'; g.font = '10px -apple-system, sans-serif'; g.fillText(sub, x, y + 41); }
    }

    drawExternals(g) {
      const list = this.externals.slice(0, LOBBY.max);
      list.forEach((a, i) => {
        const { x, y } = this.lobbyPos(i);
        const col = KIND_COLORS[a.kind] || '#8e9aaf';
        const active = a.status === 'active';
        const bob = Math.sin(this.t * (active ? 5 : 1.5) + i) * (active ? 2 : 1);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x, y + 16, 12, 4, 0, 0, 7); g.fill();
        // antenna
        g.strokeStyle = '#9aa3b2'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y - 20 + bob); g.lineTo(x, y - 27 + bob); g.stroke();
        g.fillStyle = active ? `rgba(94,234,212,${0.5 + 0.5 * Math.sin(this.t * 8 + i)})` : '#5b6170';
        g.beginPath(); g.arc(x, y - 28 + bob, 2.6, 0, 7); g.fill();
        this.round(g, x - 12, y - 20 + bob, 24, 18, 5, col);
        this.round(g, x - 9, y - 17 + bob, 18, 11, 3, '#15171c');
        g.fillStyle = active ? '#5eead4' : '#9aa3b2';
        g.fillRect(x - 6, y - 13 + bob, 3, 3); g.fillRect(x + 3, y - 13 + bob, 3, 3);
        this.round(g, x - 10, y + bob, 20, 14, 5, col);
        if (this.hover?.id === a.id) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x - 16, y - 32, 32, 50); }
        if (a.status === 'waiting') {
          // Needs the owner: pulsing "!" bubble above the head.
          const k = 0.65 + 0.35 * Math.sin(this.t * 6 + i);
          g.fillStyle = `rgba(255,209,102,${k})`; g.beginPath(); g.arc(x + 13, y - 34, 7, 0, 7); g.fill();
          g.fillStyle = '#1b1e26'; g.font = '800 10px -apple-system, sans-serif'; g.textAlign = 'center'; g.fillText('!', x + 13, y - 30.5);
        }
        g.fillStyle = a.status === 'waiting' ? '#ffd166' : 'rgba(230,235,245,0.85)'; g.font = '600 9px -apple-system, sans-serif'; g.textAlign = 'center';
        g.fillText(clip(a.name || a.project || a.label, 10), x, y + 28);
      });
      if (this.externals.length > LOBBY.max) {
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 11px sans-serif'; g.textAlign = 'right';
        g.fillText(`+${this.externals.length - LOBBY.max}`, 1170, 630);
      }
      if (!this.externals.length) {
        g.fillStyle = 'rgba(255,255,255,0.3)'; g.font = '11px sans-serif'; g.textAlign = 'center';
        g.fillText('Başka ajan bulunamadı', 1055, 480);
      }
    }

    drawEnvelope(g, e) {
      const k = e.t / e.dur;
      const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = e.x0 + (e.x1 - e.x0) * ease;
      const y = e.y0 + (e.y1 - e.y0) * ease - Math.sin(k * Math.PI) * 60;
      g.save(); g.translate(x, y); g.rotate(Math.sin(k * Math.PI * 2) * 0.2);
      this.round(g, -9, -6, 18, 12, 2, '#f8f5ec');
      g.strokeStyle = e.color; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-9, -6); g.lineTo(0, 1); g.lineTo(9, -6); g.stroke();
      g.restore();
    }

    drawTooltip(g) {
      const h = this.hover;
      if (!h || !this.mouse) return;
      let lines;
      if (h.type === 'agent') {
        const c = this.chars.get(h.id); if (!c) return;
        const st = { idle: 'boşta', queued: `sırada (${c.inbox})`, working: 'çalışıyor', error: 'hata', stopped: 'durduruldu' }[c.status] || 'boşta';
        lines = [`${c.name} · ${c.title}`, st + (c.activity ? ` — ${clip(c.activity, 40)}` : '')];
      } else {
        const a = this.externals.find((x) => x.id === h.id); if (!a) return;
        lines = [`${a.label}${a.project ? ' · ' + a.project : ''}`, `${a.status === 'active' ? 'aktif' : 'beklemede'} · PID ${a.pid}${a.session?.title ? ' · ' + clip(a.session.title, 30) : ''}`];
      }
      g.font = '11px -apple-system, sans-serif';
      const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 16;
      let x = this.mouse.x + 14, y = this.mouse.y + 14;
      if (x + w > W) x = this.mouse.x - w - 8;
      if (y + 40 > H) y = this.mouse.y - 44;
      this.round(g, x, y, w, 36, 6, 'rgba(8,10,14,0.92)');
      g.textAlign = 'left';
      g.fillStyle = '#fff'; g.font = '600 11px -apple-system, sans-serif'; g.fillText(lines[0], x + 8, y + 15);
      g.fillStyle = 'rgba(210,215,225,0.85)'; g.font = '11px -apple-system, sans-serif'; g.fillText(lines[1], x + 8, y + 29);
    }

    bubble(g, x, y, text, bg, fg) {
      g.font = '600 11px -apple-system, system-ui, sans-serif';
      const w = Math.min(260, g.measureText(text).width + 16);
      const bx = Math.max(24, Math.min(W - 24 - w, x - w / 2));
      this.round(g, bx, y - 20, w, 22, 8, bg);
      g.fillStyle = bg; g.beginPath(); g.moveTo(x - 5, y + 2); g.lineTo(x + 5, y + 2); g.lineTo(x, y + 8); g.fill();
      g.fillStyle = fg; g.textAlign = 'left';
      g.save(); g.beginPath(); g.rect(bx + 6, y - 20, w - 12, 22); g.clip();
      g.fillText(text, bx + 8, y - 5);
      g.restore();
    }

    badge(g, x, y, text, bg, fg) {
      g.fillStyle = bg; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
      g.fillStyle = fg; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText(text, x, y + 3);
    }

    plant(g, x, y) {
      g.fillStyle = '#6b4f3a'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
      g.fillStyle = '#3f8f5a';
      for (let i = 0; i < 6; i++) { const a = i * 1.05 + Math.sin(this.t + x) * 0.05; g.beginPath(); g.ellipse(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 7, 4, a, 0, 7); g.fill(); }
      g.fillStyle = '#56b273'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    }

    round(g, x, y, w, h, r, fill) {
      g.fillStyle = fill;
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fill();
    }
  }

  window.OfficeCanvas = OfficeCanvas;
})();
