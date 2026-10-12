'use strict';
// Team chat: the owner writes to the whole team (the lead takes it) or to people with
// @name; agents reply by finishing their turn (their answer is mirrored here) or by
// message(to: "sahip"). Agent-to-agent messages show up too, so the owner sees the traffic.
const { EventEmitter } = require('events');
const { redact } = require('./redact');

const crypto = require('crypto');

const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const MAX_TEXT = 4000, MAX_LOG = 1000, MERGE_MS = 2000, DUP_MS = 60000;
const MORE = '\n… (devamı terminalde)';
const NOISE = /^[.…\s_*-]*$/;
const INJECTED = /^(\[[^\]\n]{1,40}\]|# Agent Office)/;   // text the app itself typed into the terminal
const hash = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 12);
const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
const OWNER = /^(sahip|owner|user|patron)$/i;

class Chat extends EventEmitter {
  constructor(store, workers) { super(); this.store = store; this.workers = workers; }


  list(ws) { return (ws.chat ||= []); }

  add(ws, { from, to, text, kind = 'msg', ts = Date.now() }) {
    let t = redact(text).trim();
    if (!t) return null;
    if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT - MORE.length) + MORE;
    const l = this.list(ws);
    const dupe = this.duplicate(ws, l, from, to, t, ts);
    if (dupe) return dupe;
    const m = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ts, from, to, text: t, kind };
    l.push(m);
    if (l.length > MAX_LOG) l.splice(0, l.length - MAX_LOG);
    this.store.save();
    this.emit('change', ws.id);
    return m;
  }

  // The same words from the same sender a moment ago (message tool + terminal answer) are one message.
  duplicate(ws, list, from, to, text, ts) {
    if (from === 'user') return null;
    const n = norm(text);
    for (let i = list.length - 1; i >= 0 && i > list.length - 15; i--) {
      const m = list[i];
      if (m.from !== from || m.to !== to || Math.abs(ts - m.ts) > DUP_MS) continue;
      const o = norm(m.text);
      if (o === n || (n.length > 20 && o.includes(n)) || (o.length > 20 && n.includes(o))) {
        if (n.length > o.length) { m.text = text; this.store.save(); this.emit('change', ws.id); }
        return m;
      }
    }
    return null;
  }

  mentions(ws, text) {
    const out = [];
    for (const m of String(text).matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
      const w = this.workers.resolve(ws, m[1]);
      if (w && !out.includes(w)) out.push(w);
    }
    return out;
  }

  // Owner → team. Returns the workers that received it.
  ownerSend(ws, text) {
    const t = clip(text, 4000);
    if (!t) throw new Error('Mesaj boş olamaz.');
    if (!ws.workers.length) throw new Error('Ofiste çalışan yok.');
    let to = this.mentions(ws, t);
    const team = !to.length;
    if (team) to = [ws.workers.find((w) => w.id === ws.lead) || ws.workers[0]];
    this.add(ws, { from: 'user', to: team ? 'team' : to.map((w) => w.id).join(','), text: t });
    const label = team ? 'Sahip → takım' : 'Sahip';
    for (const w of to) {
      if (!this.workers.running(w.id) && !this.workers.start(ws, w.id)) continue;
      this.workers.send(ws, w.id, `[Sohbet · ${label}] ${t}${team && w.id === ws.lead ? '\n(Takım sohbeti: gerekiyorsa görev oluşturup ekibe dağıt, durumu burada kısaca özetle.)' : ''}`);
    }
    return to.map((w) => w.id);
  }

  // Agent → owner (message tool) or agent → agent (shown for visibility).
  fromAgent(ws, fromId, to, text) {
    if (OWNER.test(String(to).trim())) { return this.add(ws, { from: fromId, to: 'user', text }); }
    const target = this.workers.resolve(ws, to);
    return target ? this.add(ws, { from: fromId, to: target.id, text, kind: 'dm' }) : null;
  }

  // Mirror everything each agent says in its terminal, whatever triggered it. A per-agent cursor
  // (last ts + text hash) lives in the workspace so a restart neither repeats nor drops anything;
  // with no cursor yet only what is said from now on is taken (no backlog dump).
  tick(ws, views) {
    const cur = (ws.chatCursor ||= {});
    let changed = false;
    for (const v of views) {
      const turns = (v.turns || []).filter((x) => x.text && x.ts);
      if (!turns.length) { if (!cur[v.id]) { cur[v.id] = { ts: new Date().toISOString(), h: '' }; changed = true; } continue; }   // a fresh worker: its first words are news
      const keyOf = (x) => ({ ts: x.ts, h: hash(x.text) });
      const c = cur[v.id];
      if (!c) { cur[v.id] = keyOf(turns[turns.length - 1]); changed = true; continue; }
      const i = turns.findIndex((x) => x.ts === c.ts && hash(x.text) === c.h);
      const at = Date.parse(c.ts);
      const fresh = i >= 0 ? turns.slice(i + 1) : turns.filter((x) => Date.parse(x.ts) > at);   // cursor scrolled out of the window: go by time
      if (!fresh.length) continue;
      cur[v.id] = keyOf(fresh[fresh.length - 1]); changed = true;
      let prev = null;
      for (const x of fresh) {
        const ms = Date.parse(x.ts) || Date.now();
        if (x.role === 'user') {
          prev = null;
          if (INJECTED.test(x.text)) continue;
          this.add(ws, { from: 'user', to: v.id, text: x.text, kind: 'term', ts: ms });
        } else if (!NOISE.test(x.text)) {
          if (prev && ms - prev.ms <= MERGE_MS) { prev.text += `\n\n${x.text}`; prev.ms = ms; } else { if (prev) this.mirror(ws, v.id, prev); prev = { text: x.text, ms, first: ms }; }
        }
      }
      if (prev) this.mirror(ws, v.id, prev);
    }
    if (changed) this.store.save();
  }

  mirror(ws, id, p) {
    const l = this.list(ws), last = l[l.length - 1];
    if (last && last.from === id && last.to === 'user' && last.kind === 'msg' && p.first - last.ts <= MERGE_MS && Date.now() - last.ts <= MERGE_MS * 3 && !this.duplicate(ws, l, id, 'user', p.text, p.first)) {
      last.text = clip(`${last.text}\n\n${p.text}`, MAX_TEXT); this.store.save(); this.emit('change', ws.id); return;
    }
    this.add(ws, { from: id, to: 'user', text: p.text, ts: p.first });
  }
}

module.exports = { Chat, OWNER };
