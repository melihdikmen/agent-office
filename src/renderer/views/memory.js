// Memory map: notes and tags as a force-directed graph, coloured per worker.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class MemoryView {
  constructor(root, api) {
    this.root = root; this.api = api;
    this.graph = { nodes: [], links: [] };
    this.workers = [];
    this.filter = null; this.q = '';
    this.pos = new Map();
    this.hover = null;
    this.zoom = 1; this.pan = { x: 0, y: 0 };
    root.innerHTML = `<div class="mm-head"><div><h3>Hafıza haritası</h3><span class="muted">her düğüm bir not, her bağ bir [[etiket]]</span></div>
      <span id="mmStats" class="muted"></span><input id="mmq" type="search" placeholder="hafızada ara…"><button class="btn small" id="mmRefresh">↻</button></div>
      <div class="mm-body"><canvas id="mmCanvas"></canvas><div id="mmLegend" class="mm-legend"></div><div id="mmTip" class="mm-tip hidden"></div></div>`;
    this.cv = root.querySelector('#mmCanvas');
    this.g = this.cv.getContext('2d');
    root.querySelector('#mmRefresh').onclick = () => this.refresh();
    root.querySelector('#mmq').oninput = (e) => { this.q = e.target.value.trim().toLowerCase(); };
    root.querySelector('#mmLegend').onclick = (e) => { const w = e.target.closest('[data-w]')?.dataset.w; if (w !== undefined) { this.filter = this.filter === w ? null : w; this.legend(); } };
    new ResizeObserver(() => this.resize()).observe(root.querySelector('.mm-body'));
    this.bind();
    const loop = () => { requestAnimationFrame(loop); if (!this.cv.isConnected || document.hidden || this.root.classList.contains('hidden')) return; this.step(); this.draw(); };
    requestAnimationFrame(loop);
  }

  setWorkers(workers) { this.workers = workers; this.legend(); }

  async refresh() {
    const g = await this.api.memoryGraph();
    if (g?.nodes) { this.graph = g; this.seed(); this.legend(); }
    this.root.querySelector('#mmStats').textContent = `${this.graph.nodes.filter((n) => n.kind === 'note').length} not · ${this.graph.links.length} bağ`;
  }

  color(workerId) { return this.workers.find((w) => w.id === workerId)?.color || '#9aa4b2'; }

  legend() {
    const counts = new Map();
    for (const n of this.graph.nodes) if (n.kind === 'note') counts.set(n.worker, (counts.get(n.worker) || 0) + 1);
    this.root.querySelector('#mmLegend').innerHTML = `<div class="muted">ÇALIŞAN · tıkla → sadece onun notları</div>${this.workers.map((w) => `<div data-w="${w.id}" class="${this.filter === w.id ? 'on' : ''}"><i style="background:${w.color}"></i>${esc(w.name)}<span>${counts.get(w.id) || 0}</span></div>`).join('')}`;
  }

  seed() {
    const W = this.cv.clientWidth || 600, H = this.cv.clientHeight || 400;
    for (const n of this.graph.nodes) if (!this.pos.has(n.id)) this.pos.set(n.id, { x: W / 2 + (Math.random() - 0.5) * W * 0.6, y: H / 2 + (Math.random() - 0.5) * H * 0.6, vx: 0, vy: 0 });
    for (const id of [...this.pos.keys()]) if (!this.graph.nodes.some((n) => n.id === id)) this.pos.delete(id);
  }

  visible(n) { return (!this.filter || n.kind === 'tag' || n.worker === this.filter) && (!this.q || n.label.toLowerCase().includes(this.q)); }

  step() {
    const nodes = this.graph.nodes.filter((n) => this.visible(n));
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    for (const a of nodes) {
      const pa = this.pos.get(a.id);
      let fx = (W / 2 - pa.x) * 0.002, fy = (H / 2 - pa.y) * 0.002;
      for (const b of nodes) {
        if (a === b) continue;
        const pb = this.pos.get(b.id);
        const dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx * dx + dy * dy + 40;
        const f = 1800 / d2;
        fx += (dx / Math.sqrt(d2)) * f; fy += (dy / Math.sqrt(d2)) * f;
      }
      pa.vx = (pa.vx + fx) * 0.82; pa.vy = (pa.vy + fy) * 0.82;
    }
    for (const l of this.graph.links) {
      const a = this.pos.get(l.source), b = this.pos.get(l.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - 90) * 0.004;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) { const p = this.pos.get(n.id); if (this.dragging === n.id) continue; p.x += p.vx; p.y += p.vy; }
  }

  resize() {
    const box = this.root.querySelector('.mm-body');
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = box.clientWidth * dpr; this.cv.height = box.clientHeight * dpr;
    this.cv.style.width = `${box.clientWidth}px`; this.cv.style.height = `${box.clientHeight}px`;
    this.dpr = dpr;
  }

  toWorld(e) { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left - this.pan.x) / this.zoom, y: (e.clientY - r.top - this.pan.y) / this.zoom }; }
  nodeAt(p) { for (const n of this.graph.nodes) { if (!this.visible(n)) continue; const q = this.pos.get(n.id); if (q && Math.hypot(q.x - p.x, q.y - p.y) < (n.kind === 'tag' ? 10 + Math.min(10, n.count) : 9)) return n; } return null; }

  bind() {
    const tip = this.root.querySelector('#mmTip');
    this.cv.addEventListener('pointerdown', (e) => { const n = this.nodeAt(this.toWorld(e)); this.drag = n ? { node: n.id } : { pan: true, x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y }; this.dragging = n?.id || null; });
    this.cv.addEventListener('pointermove', (e) => {
      if (this.drag?.pan) { this.pan = { x: this.drag.px + e.clientX - this.drag.x, y: this.drag.py + e.clientY - this.drag.y }; return; }
      if (this.drag?.node) { const p = this.pos.get(this.drag.node); const w = this.toWorld(e); p.x = w.x; p.y = w.y; p.vx = p.vy = 0; return; }
      const n = this.nodeAt(this.toWorld(e));
      this.hover = n?.id || null;
      if (n) { tip.classList.remove('hidden'); tip.innerHTML = n.kind === 'tag' ? `<b>[[${esc(n.label)}]]</b> · ${n.count} not` : `<b>${esc(n.name)}</b> <span class="muted">${esc(n.ts)}</span><br>${esc(n.label)}`; tip.style.left = `${e.clientX - this.cv.getBoundingClientRect().left + 12}px`; tip.style.top = `${e.clientY - this.cv.getBoundingClientRect().top + 12}px`; }
      else tip.classList.add('hidden');
    });
    window.addEventListener('pointerup', () => { this.drag = null; this.dragging = null; });
    this.cv.addEventListener('wheel', (e) => { e.preventDefault(); const z = Math.max(0.4, Math.min(3, this.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); this.zoom = z; }, { passive: false });
  }

  draw() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(this.dpr * this.zoom, 0, 0, this.dpr * this.zoom, this.pan.x * this.dpr, this.pan.y * this.dpr);
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1;
    for (const l of this.graph.links) {
      const a = this.graph.nodes.find((n) => n.id === l.source), b = this.graph.nodes.find((n) => n.id === l.target);
      if (!a || !b || !this.visible(a) || !this.visible(b)) continue;
      const pa = this.pos.get(a.id), pb = this.pos.get(b.id);
      g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke();
    }
    g.font = '10px ui-monospace, Menlo, monospace'; g.textAlign = 'center';
    for (const n of this.graph.nodes) {
      if (!this.visible(n)) continue;
      const p = this.pos.get(n.id);
      const r = n.kind === 'tag' ? 8 + Math.min(10, n.count * 2) : 7;
      g.fillStyle = n.kind === 'tag' ? '#9aa4b2' : this.color(n.worker);
      g.globalAlpha = this.hover && this.hover !== n.id ? 0.55 : 1;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
      if (n.kind === 'tag') { g.fillStyle = '#e8e2d8'; g.fillText(n.label.toUpperCase(), p.x, p.y - r - 4); }
      g.globalAlpha = 1;
    }
    if (!this.graph.nodes.length) { g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.fillStyle = '#8a8178'; g.font = '12px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillText('Henüz not yok. Çalışanlar memory_note ile karar ve tercihleri kaydettikçe harita dolar.', this.cv.clientWidth / 2, this.cv.clientHeight / 2); }
  }
}
