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

// Concept groups: a query word also finds its neighbours ("parola" finds "şifre", "giriş" finds "login").
const SYN = [
  'sifre parola password credential', 'giris login signin oturum auth kimlik dogrulama', 'cikis logout signout', 'kullanici user uye hesap account',
  'veritabani db database sqlite postgres mysql tablo sema', 'hata bug error sorun problem arizi crash', 'duzelt fix cozum onar', 'test dogrula verify kontrol qa',
  'tasarim design arayuz ui ekran layout', 'renk color tema theme koyu dark acik light', 'performans hiz hizli speed slow yavas optimize', 'guvenlik security izin yetki permission',
  'api endpoint servis backend sunucu server', 'frontend istemci client react bilesen component', 'surum version release yayin deploy', 'karar decision tercih secim',
  'gorev task is ticket kart', 'rapor report ozet summary sonuc', 'mail eposta email posta', 'odeme payment fatura billing abonelik subscription', 'dosya file klasor folder dizin', 'belge doc dokuman documentation readme',
];
const SYN_OF = new Map();
for (const g of SYN) { const ws = g.split(' '); for (const w of ws) SYN_OF.set(w, ws); }
const grams = (w) => { const s = `  ${w} `, out = new Set(); for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3)); return out; };
const jaccard = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };

class Memory {
  constructor(store) { this.store = store; this.cache = new Map(); }

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

  // The "index": parsed notes per file, rebuilt only when the file changes.
  parsed(ws, w) {
    const f = this.file(ws, w);
    let st; try { st = fs.statSync(f); } catch { return []; }
    const c = this.cache?.get(f);
    if (c && c.m === st.mtimeMs && c.s === st.size) return c.notes;
    const notes = [];
    this.read(ws, w).split('\n').forEach((line, i) => {
      const m = line.match(LINE);
      if (!m) return;
      const tags = [...m[2].matchAll(TAG)].map((x) => x[1].trim().toLowerCase());
      notes.push({ id: `${w.id}:${i}`, worker: w.id, name: w.name, ts: m[1], text: m[2].replace(TAG, '').replace(/\s+/g, ' ').trim(), tags });
    });
    (this.cache ||= new Map()).set(f, { m: st.mtimeMs, s: st.size, notes });
    return notes;
  }

  notes(ws) { return ws.workers.flatMap((w) => this.parsed(ws, w)); }

  // Ranked search: accents and Turkish letters are folded ("sifre" finds "şifre"), word
  // beginnings count ("dogrulama" finds "doğrulaması"), rarer words weigh more, tags and
  // newer notes get a small boost. No exact-all-words requirement: best matches first.
  search(ws, query, limit = 15) {
    const q0 = tokens(query);
    if (!q0.length) return [];
    const q = q0;
    const alt = q0.map((t) => (SYN_OF.get(t) || []).filter((x) => x !== t));
    const notes = this.notes(ws);
    if (!notes.length) return [];
    const docs = notes.map((n) => ({ n, words: tokens(`${n.text} ${n.tags.join(' ')}`), tags: new Set(n.tags.map(fold)) }));
    const hit = (w, t) => w === t || (t.length >= 4 && (w.startsWith(t) || (w.length >= 4 && t.startsWith(w.slice(0, Math.max(4, w.length - 2))))));
    const df = q.map((t) => docs.filter((d) => d.words.some((w) => hit(w, t))).length);
    const scored = docs.map((d, i) => {
      let score = 0, matched = 0;
      q.forEach((t, k) => {
        const tf = df[k] ? d.words.filter((w) => hit(w, t)).length : 0;
        if (tf) {
          matched++;
          score += (1 + Math.log(tf)) * Math.log(1 + docs.length / df[k]) + (d.tags.has(t) ? 1.5 : 0);
        } else if (alt[k].length && d.words.some((w) => alt[k].some((a) => hit(w, a)))) {   // same concept, other word
          matched += 0.7; score += 0.7 * Math.log(1 + docs.length);
        } else if (t.length >= 5) {                                                         // typos: shared letter triples
          const g = grams(t); const best = Math.max(0, ...d.words.filter((w) => w.length >= 4).map((w) => jaccard(g, grams(w))));
          if (best >= 0.5) { matched += 0.5; score += 0.5 * best * Math.log(1 + docs.length); }
        }
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
