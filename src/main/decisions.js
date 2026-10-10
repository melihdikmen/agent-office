'use strict';
// Decisions: a worker asks the owner something with a few options (ask_owner) and
// goes on with independent work; the owner answers in the office (or from a
// notification) and the answer is typed into that worker's terminal.
const { EventEmitter } = require('events');

const clip = (s, n) => String(s ?? '').trim().slice(0, n);

class Decisions extends EventEmitter {
  // workers: the Workers instance (running / start / send); notifier: optional
  constructor(store, workers, notifier = null) { super(); this.store = store; this.workers = workers; this.notifier = notifier; }

  list(ws) { return (ws.decisions ||= []); }
  open(ws, workerId) { return this.list(ws).filter((d) => d.status === 'open' && (!workerId || d.by === workerId)); }

  ask(ws, workerId, { question, options = [], details = '', task = '', recommended = '', auto_min = 0 }) {
    const { redact } = require('./redact');
    const q = redact(clip(question, 400));
    if (!q) throw new Error('Soru boş olamaz.');
    ws.decisionSeq = (ws.decisionSeq || 0) + 1;
    const d = {
      id: `K-${ws.decisionSeq}`, by: workerId, question: q, details: redact(clip(details, 1500)), task: clip(task, 40),
      options: options.map((o) => clip(o, 120)).filter(Boolean).slice(0, 5), status: 'open', answer: null, ts: Date.now(), answeredTs: null,
    };
    const rec = clip(recommended, 120).toLowerCase();
    d.recommended = d.options.find((o) => o.toLowerCase() === rec) || (Number.isInteger(+recommended) && +recommended >= 1 ? d.options[+recommended - 1] : '') || '';
    const mins = Math.min(240, Math.max(0, Number(auto_min) || 0));
    d.autoAt = d.recommended && mins ? d.ts + mins * 60000 : null;
    this.list(ws).unshift(d);
    if (ws.decisions.length > 200) ws.decisions.length = 200;
    this.store.save();
    this.emit('change', ws.id);
    this.notifier?.decisionAsked(ws, d, ws.workers.find((w) => w.id === workerId)?.name || 'Ajan');
    return d;
  }

  // Open decisions whose timer ran out take the worker's recommended option.
  tick(ws, now = Date.now()) {
    for (const d of this.open(ws)) if (d.autoAt && d.autoAt <= now) this.answer(ws, d.id, `${d.recommended} (süre doldu, önerilen seçenek otomatik uygulandı)`);
  }

  answer(ws, id, answer) {
    const d = this.list(ws).find((x) => x.id === id);
    if (!d) throw new Error(`Karar yok: ${id}`);
    if (d.status !== 'open') throw new Error(`${id} zaten cevaplanmış.`);
    const a = clip(answer, 1500);
    if (!a) throw new Error('Cevap boş olamaz.');
    d.status = 'answered'; d.answer = a; d.answeredTs = Date.now();
    this.store.save();
    if (!this.workers.running(d.by)) this.workers.start(ws, d.by);
    this.workers.send(ws, d.by, `[Karar ${d.id}] Sahip cevapladı: ${a}\n(Soru: ${d.question})`);
    this.emit('change', ws.id);
    return d;
  }
}

module.exports = { Decisions };
