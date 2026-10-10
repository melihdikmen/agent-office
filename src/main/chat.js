'use strict';
// Team chat: the owner writes to the whole team (the lead takes it) or to people with
// @name; agents reply by finishing their turn (their answer is mirrored here) or by
// message(to: "sahip"). Agent-to-agent messages show up too, so the owner sees the traffic.
const { EventEmitter } = require('events');
const { redact } = require('./redact');

const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const OWNER = /^(sahip|owner|user|patron)$/i;

class Chat extends EventEmitter {
  constructor(store, workers) { super(); this.store = store; this.workers = workers; this.pending = new Map(); }

  list(ws) { return (ws.chat ||= []); }

  add(ws, { from, to, text, kind = 'msg' }) {
    const t = clip(redact(text), 2000);
    if (!t) return null;
    const m = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ts: Date.now(), from, to, text: t, kind };
    const l = this.list(ws);
    l.push(m);
    if (l.length > 300) l.splice(0, l.length - 300);
    this.store.save();
    this.emit('change', ws.id);
    return m;
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
      this.pending.set(`${ws.id}:${w.id}`, Date.now());
    }
    return to.map((w) => w.id);
  }

  // Agent → owner (message tool) or agent → agent (shown for visibility).
  fromAgent(ws, fromId, to, text) {
    if (OWNER.test(String(to).trim())) { this.pending.delete(`${ws.id}:${fromId}`); return this.add(ws, { from: fromId, to: 'user', text }); }
    const target = this.workers.resolve(ws, to);
    return target ? this.add(ws, { from: fromId, to: target.id, text, kind: 'dm' }) : null;
  }

  // When a worker that got a chat message finishes its turn, mirror its answer.
  tick(ws, views, now = Date.now()) {
    for (const v of views) {
      const k = `${ws.id}:${v.id}`, at = this.pending.get(k);
      if (!at || v.status !== 'idle' || now - at < 4000) continue;
      this.pending.delete(k);
      this.add(ws, { from: v.id, to: 'user', text: v.lastAnswer || '(yanıt terminalinde)' });
    }
  }
}

module.exports = { Chat, OWNER };
