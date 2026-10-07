'use strict';
// The task board: cards the owner and the workers create, move and close with a
// report. Assigning a card types it into the worker's terminal; hands-off mode
// keeps idle workers fed with the next open card.
const { EventEmitter } = require('events');

const STATUSES = ['backlog', 'todo', 'doing', 'review', 'done'];

class Board extends EventEmitter {
  constructor(store, workers) {
    super();
    this.store = store;
    this.workers = workers;
  }

  task(ws, id) { return ws.tasks.find((t) => t.id === String(id || '').toUpperCase()) || null; }
  list(ws, status) { return status ? ws.tasks.filter((t) => t.status === status) : ws.tasks; }

  who(ws, by) {
    if (!by || by === 'user') return 'Sahip';
    return ws.workers.find((w) => w.id === by)?.name || by;
  }

  create(ws, { title, details = '', assignee = null, createdBy = 'user', parent = null }) {
    const assignTo = assignee ? this.workers.resolve(ws, assignee) : null;
    if (assignee && !assignTo) throw new Error(`Çalışan bulunamadı: ${assignee}`);
    const parentTask = parent ? this.task(ws, parent) : null;
    const task = {
      id: `T-${ws.nextTask++}`, title: String(title || '').trim().slice(0, 200), details: String(details || '').trim(),
      status: assignTo ? 'todo' : 'backlog', assignee: assignTo?.id || null, createdBy, parent: parentTask?.id || null,
      notes: [], report: null, created: Date.now(), updated: Date.now(),
    };
    ws.tasks.push(task);
    this.store.save();
    this.emit('change', ws.id);
    if (assignTo) this.notifyAssigned(ws, task, createdBy);
    else if (createdBy === 'user' && ws.lead && this.workers.running(ws.lead)) this.notifyLead(ws, task);
    return task;
  }

  // Hand a card to its worker; a sleeping worker is woken up for it.
  notifyAssigned(ws, task, by) {
    const w = ws.workers.find((x) => x.id === task.assignee);
    if (!w || w.id === by) return;
    const text = `[Pano] Yeni görev ${task.id} (${this.who(ws, by)}): ${task.title}${task.details ? `\n${task.details}` : ''}`;
    if (!this.workers.running(w.id)) this.workers.start(ws, w.id);
    this.workers.send(ws, w.id, text);
  }

  notifyLead(ws, task) {
    const text = `[Pano] Sahipten yeni hedef ${task.id}: ${task.title}${task.details ? `\n${task.details}` : ''}\nBunu alt görevlere böl ve task_create ile takıma dağıt (parent="${task.id}"); kendine de bir parça ayır. Hepsi bitince ${task.id} için task_done ile özet raporu ver.`;
    this.workers.send(ws, ws.lead, text);
    task.notes.push({ by: 'office', ts: Date.now(), text: `Lidere (${this.who(ws, ws.lead)}) bölmesi için iletildi.` });
    this.store.save();
  }

  update(ws, id, { status, assignee, note, title, details }, by = 'user') {
    const task = this.task(ws, id);
    if (!task) throw new Error(`Görev yok: ${id}`);
    const before = { status: task.status, assignee: task.assignee };
    if (status && STATUSES.includes(status)) task.status = status;
    if (assignee !== undefined) {
      const w = assignee ? this.workers.resolve(ws, assignee) : null;
      if (assignee && !w) throw new Error(`Çalışan bulunamadı: ${assignee}`);
      task.assignee = w?.id || null;
      if (w && task.status === 'backlog') task.status = 'todo';
    }
    if (title !== undefined) task.title = String(title).trim().slice(0, 200);
    if (details !== undefined) task.details = String(details).trim();
    if (note) task.notes.push({ by, ts: Date.now(), text: String(note).trim().slice(0, 2000) });
    task.updated = Date.now();
    this.store.save();
    this.emit('change', ws.id);
    if (task.assignee && task.assignee !== before.assignee && task.status !== 'done') this.notifyAssigned(ws, task, by);
    return task;
  }

  done(ws, id, { summary, evidence = [], files = [] }, by) {
    const task = this.task(ws, id);
    if (!task) throw new Error(`Görev yok: ${id}`);
    if (by !== 'user' && !evidence.length) throw new Error('Kanıt olmadan kapatılamaz: evidence listesine en az bir doğrulama ekle.');
    task.status = 'done';
    task.updated = Date.now();
    task.report = { by, ts: Date.now(), summary: String(summary || '').trim(), evidence: evidence.slice(0, 30), files: files.slice(0, 200) };
    ws.reports.unshift({ id: `${task.id}@${task.report.ts}`, taskId: task.id, title: task.title, ...task.report });
    if (ws.reports.length > 500) ws.reports.length = 500;
    this.store.save();
    this.emit('change', ws.id);
    this.emit('report', { wsId: ws.id, task });
    // tell whoever asked for it (a worker), and the lead when a subtask closes
    const targets = new Set();
    if (task.createdBy !== 'user' && task.createdBy !== by) targets.add(task.createdBy);
    if (task.parent && ws.lead && ws.lead !== by) targets.add(ws.lead);
    for (const wid of targets) {
      if (!this.workers.running(wid)) continue;
      const failed = evidence.filter((e) => !e.ok).length;
      this.workers.send(ws, wid, `[Pano] ${task.id} "${task.title}" tamamlandı (${this.who(ws, by)}): ${task.report.summary}${failed ? `\nDikkat: ${failed} doğrulama başarısız.` : ''}`);
    }
    return task;
  }

  remove(ws, id) {
    ws.tasks = ws.tasks.filter((t) => t.id !== id);
    this.store.save();
    this.emit('change', ws.id);
  }

  message(ws, fromId, to, text) {
    const target = this.workers.resolve(ws, to);
    if (!target) throw new Error(`Çalışan bulunamadı: ${to}`);
    if (!this.workers.running(target.id) && !this.workers.start(ws, target.id)) throw new Error(`${target.name} başlatılamadı.`);
    this.workers.send(ws, target.id, `[Mesaj · ${this.who(ws, fromId)}] ${String(text).trim()}`);
    this.emit('message', { wsId: ws.id, from: fromId, to: target.id, text: String(text).trim().slice(0, 300), ts: Date.now() });
    return `${target.name} aldı.`;
  }

  // Hands-off: every idle worker without a card in progress takes the next open one.
  tick(ws, views) {
    if (!this.store.data.handsOff) return;
    for (const v of views) {
      if (v.status !== 'idle') continue;
      if (ws.tasks.some((t) => t.assignee === v.id && t.status === 'doing')) continue;
      const next = ws.tasks.find((t) => t.assignee === v.id && t.status === 'todo')
        || ws.tasks.find((t) => !t.assignee && (t.status === 'todo' || t.status === 'backlog') && !t.notes.some((n) => n.by === 'office'));
      if (!next) continue;
      next.assignee = v.id;
      next.status = 'todo';
      next.notes.push({ by: 'office', ts: Date.now(), text: `Hands-off: ${v.name} boşta olduğu için atandı.` });
      next.updated = Date.now();
      this.store.save();
      this.emit('change', ws.id);
      this.notifyAssigned(ws, next, 'office');
    }
  }
}

module.exports = { Board, STATUSES };
