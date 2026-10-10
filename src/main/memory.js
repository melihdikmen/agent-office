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

const fold = (s) => String(s).toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);

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
    const clean = require('./redact').redact(String(text || '').replace(/\s+/g, ' ').trim());
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

  // Ranked search: accents and Turkish letters are folded ("sifre" finds "şifre"), word
  // beginnings count ("dogrulama" finds "doğrulaması"), rarer words weigh more, tags and
  // newer notes get a small boost. No exact-all-words requirement: best matches first.
  search(ws, query, limit = 15) {
    const q = tokens(query);
    if (!q.length) return [];
    const notes = this.notes(ws);
    if (!notes.length) return [];
    const docs = notes.map((n) => ({ n, words: tokens(`${n.text} ${n.tags.join(' ')}`), tags: new Set(n.tags.map(fold)) }));
    const hit = (w, t) => w === t || (t.length >= 4 && (w.startsWith(t) || (w.length >= 4 && t.startsWith(w.slice(0, Math.max(4, w.length - 2))))));
    const df = q.map((t) => docs.filter((d) => d.words.some((w) => hit(w, t))).length);
    const scored = docs.map((d, i) => {
      let score = 0, matched = 0;
      q.forEach((t, k) => {
        if (!df[k]) return;
        const tf = d.words.filter((w) => hit(w, t)).length;
        if (!tf) return;
        matched++;
        score += (1 + Math.log(tf)) * Math.log(1 + docs.length / df[k]) + (d.tags.has(t) ? 1.5 : 0);
      });
      return { n: d.n, score: matched ? score * (0.6 + 0.4 * matched / q.length) + (i / docs.length) * 0.3 : 0 };
    }).filter((x) => x.score > 0).sort((a, c) => c.score - a.score).slice(0, limit);
    return scored.map(({ n }) => `${n.name} (${n.ts}): ${n.text}${n.tags.length ? ` [${n.tags.join(', ')}]` : ''}`);
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
