'use strict';
// Worker memory: one Markdown file per worker in the workspace's data folder.
// Workers append notes through the memory_note tool; [[tags]] link notes to each
// other and feed the memory graph.
const fs = require('fs');
const path = require('path');

const LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) — (.*)$/;
const TAG = /\[\[([^\]]+)\]\]/g;

function stamp(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

class Memory {
  constructor(store) { this.store = store; }

  dir(ws) {
    const d = path.join(this.store.workspaceDir(ws.id), 'memory');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  file(ws, worker) { return path.join(this.dir(ws), `${worker.id}.md`); }

  ensure(ws, worker) {
    const f = this.file(ws, worker);
    if (!fs.existsSync(f)) fs.writeFileSync(f, `# ${worker.name} — ${worker.role}\n\nKararlar, tercihler ve öğrenilenler. Her satır: \`- tarih — not [[etiket]]\`.\n\n`);
    return f;
  }

  note(ws, worker, text, tags = []) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('boş not');
    const tagStr = [...new Set(tags.map((t) => String(t).trim().toLowerCase().replace(/[\[\]]/g, '')).filter(Boolean))].map((t) => ` [[${t}]]`).join('');
    fs.appendFileSync(this.ensure(ws, worker), `- ${stamp()} — ${clean}${tagStr}\n`);
    return 'kaydedildi';
  }

  read(ws, worker) {
    try { return fs.readFileSync(this.file(ws, worker), 'utf8'); } catch { return ''; }
  }

  notes(ws) {
    const out = [];
    for (const w of ws.workers) {
      const text = this.read(ws, w);
      text.split('\n').forEach((line, i) => {
        const m = line.match(LINE);
        if (!m) return;
        const tags = [...m[2].matchAll(TAG)].map((x) => x[1].trim().toLowerCase());
        out.push({ id: `${w.id}:${i}`, worker: w.id, name: w.name, ts: m[1], text: m[2].replace(TAG, '').replace(/\s+/g, ' ').trim(), tags });
      });
    }
    return out;
  }

  search(ws, query) {
    const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!q.length) return [];
    return this.notes(ws).filter((n) => { const hay = `${n.text} ${n.tags.join(' ')}`.toLowerCase(); return q.every((w) => hay.includes(w)); }).slice(-40)
      .map((n) => `${n.name} (${n.ts}): ${n.text}${n.tags.length ? ` [${n.tags.join(', ')}]` : ''}`);
  }

  // Nodes: every note and every tag; links: note → its tags. Enough for a map.
  graph(ws) {
    const notes = this.notes(ws);
    const tags = new Map();
    const links = [];
    for (const n of notes) for (const t of n.tags) {
      if (!tags.has(t)) tags.set(t, { id: `tag:${t}`, kind: 'tag', label: t, count: 0 });
      tags.get(t).count++;
      links.push({ source: n.id, target: `tag:${t}` });
    }
    return {
      nodes: [...notes.map((n) => ({ id: n.id, kind: 'note', worker: n.worker, name: n.name, label: n.text, ts: n.ts })), ...tags.values()],
      links,
    };
  }
}

module.exports = { Memory, stamp };
