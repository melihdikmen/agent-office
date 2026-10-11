'use strict';
const { tt } = require('./lang');
// Notifications: which agent did what in which project. Every event is kept in a
// short history (the bell in the office), and shown as a system notification
// when the owner is looking elsewhere. Kinds can be switched off one by one.

const KINDS = {
  done: { get label() { return tt('Görev tamamlandı', 'Task completed'); }, icon: '✓' },
  waiting: { get label() { return tt('Onay / yanıt bekliyor', 'Waiting for approval / reply'); }, icon: '?' },
  finished: { get label() { return tt('Çalışmayı bıraktı (boşta)', 'Stopped working (idle)'); }, icon: '●' },
  assigned: { get label() { return tt('Yeni görev atandı', 'New task assigned'); }, icon: '→' },
  decision: { get label() { return tt('Karar istiyor', 'Wants a decision'); }, icon: '⚑' },
  limit: { get label() { return tt('Kullanım limiti doldu / devam etti', 'Usage limit hit / resumed'); }, icon: '⏳' },
  budget: { get label() { return tt('Bütçe uyarısı / aşıldı', 'Budget warning / exceeded'); }, icon: '$' },
};
const DEFAULTS = { enabled: true, onlyUnfocused: true, sound: true, speak: false, kinds: { done: true, waiting: true, finished: true, assigned: false, decision: true, limit: true, budget: true } };
const MAX_HISTORY = 100;
const MIN_WORK_SECS = 20;          // a "finished" notification needs at least this much work before it

// macOS refuses Electron notifications until the app is allowed in System Settings
// (UNErrorDomain 1); then fall back to an AppleScript notification, which still shows.
function osaNotify({ title, subtitle, body }, silent) {
  if (process.platform !== 'darwin') return;
  const q = (t) => `"${String(t ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' · ')}"`;
  const script = `display notification ${q(body)} with title ${q(title)}${subtitle ? ` subtitle ${q(subtitle)}` : ''}${silent ? '' : ' sound name "Glass"'}`;
  require('child_process').execFile('osascript', ['-e', script], () => {});
}

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

function prefsOf(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return { enabled: p.enabled !== false, onlyUnfocused: p.onlyUnfocused !== false, sound: p.sound !== false, speak: p.speak === true, kinds: { ...DEFAULTS.kinds, ...(p.kinds || {}) } };
}

// Should this event produce a system notification right now?
function shouldPopup(prefs, kind, focused) {
  if (!prefs.enabled || !prefs.kinds[kind]) return false;
  return !(prefs.onlyUnfocused && focused);
}

// Text for a closed task: project · agent, the task, what was done and how it checked out.
function describeDone(ws, task, who) {
  const r = task.report || {};
  const ev = r.evidence || [];
  const failed = ev.filter((e) => e && e.ok === false).length;
  const check = ev.length ? (failed ? tt(`✗ ${failed}/${ev.length} doğrulama başarısız`, `✗ ${failed}/${ev.length} checks failed`) : tt(`✓ ${ev.length} doğrulama geçti`, `✓ ${ev.length} checks passed`)) : tt('doğrulama yok', 'no checks');
  const files = (r.files || []).length;
  return {
    kind: 'done', warn: failed > 0,
    title: `${ws.name} · ${who}`,
    subtitle: `${task.id} · ${clip(task.title, 70)}`,
    body: `${clip(r.summary, 160) || tt('Özet yok.', 'No summary.')}\n${check}${files ? ` · ${files} ${tt('dosya', 'files')}` : ''}`,
    ref: { type: 'task', id: task.id },
  };
}

function describeWaiting(ws, worker, task) {
  return {
    kind: 'waiting', warn: true,
    title: `${ws.name} · ${worker.name}`,
    subtitle: tt('Seni bekliyor', 'Waiting for you'),
    body: `${clip(worker.waitingFor, 140) || tt('Onay ya da yanıt gerekiyor.', 'Approval or an answer is needed.')}${task ? `\n${task.id} · ${clip(task.title, 70)}` : ''}`,
    ref: { type: 'worker', id: worker.id },
  };
}

function describeFinished(ws, worker, task, secs) {
  const m = Math.floor(secs / 60);
  return {
    kind: 'finished', warn: false,
    title: `${ws.name} · ${worker.name}`,
    subtitle: tt('Çalışmayı bıraktı', 'Stopped working'),
    body: `${task ? `${task.id} · ${clip(task.title, 70)}\n` : ''}${tt(`${m ? `${m} dk` : `${Math.round(secs)} sn`} çalıştı, şimdi boşta.`, `Worked for ${m ? `${m} min` : `${Math.round(secs)} s`}, now idle.`)}`,
    ref: { type: 'worker', id: worker.id },
  };
}

function describeDecision(ws, d, who) {
  return {
    kind: 'decision', warn: true,
    title: `${ws.name} · ${who}`,
    subtitle: `${tt('Karar istiyor', 'Wants a decision')} · ${d.id}`,
    body: `${clip(d.question, 160)}${d.options.length ? `\n${tt('Seçenekler', 'Options')}: ${d.options.join(' / ')}` : ''}`,
    ref: { type: 'decision', id: d.id },
  };
}

const clock = (ts) => new Date(ts).toLocaleTimeString(tt('tr-TR', 'en-GB'), { hour: '2-digit', minute: '2-digit' });
function describeLimit(ws, worker, parked) {
  return {
    kind: 'limit', warn: true,
    title: `${ws.name} · ${worker.name}`,
    subtitle: tt('Kullanım limiti doldu', 'Usage limit reached'),
    body: tt(`${clock(parked.until)} civarında kaldığı yerden devam ettirilecek${parked.guessed ? ' (saat bilinmiyor, tahmin)' : ''}.`, `Will resume around ${clock(parked.until)}${parked.guessed ? ' (time unknown, a guess)' : ''}.`),
    ref: { type: 'worker', id: worker.id },
  };
}
function describeResumed(ws, worker) {
  return { kind: 'limit', warn: false, title: `${ws.name} · ${worker.name}`, subtitle: tt('Limit sıfırlandı', 'Limit reset'), body: tt('Kaldığı yerden devam ettirildi.', 'Resumed where it left off.'), ref: { type: 'worker', id: worker.id } };
}

function describeBudget(ws, worker, { spent, budget, stopped }) {
  return {
    kind: 'budget', warn: true,
    title: `${ws.name} · ${worker.name}`,
    subtitle: stopped ? tt('Bütçe doldu, durduruldu', 'Budget reached, stopped') : tt('Bütçenin %80\'i harcandı', '80% of the budget is spent'),
    body: `$${spent.toFixed(2)} / $${budget.toFixed(2)}${stopped ? tt('. Bütçeyi yükseltip yeniden başlatabilirsin.', '. Raise the budget and restart to continue.') : '.'}`,
    ref: { type: 'worker', id: worker.id },
  };
}

function describeAssigned(ws, task, who, assignee) {
  return {
    kind: 'assigned', warn: false,
    title: `${ws.name} · ${assignee}`,
    subtitle: `${tt('Yeni görev', 'New task')} (${who})`,
    body: `${task.id} · ${clip(task.title, 100)}`,
    ref: { type: 'task', id: task.id },
  };
}

class Notifier {
  // env: { store, send(ch, payload), win() → BrowserWindow|null, onOpen(ref) }
  constructor(env) {
    this.env = env;
    this.seen = new Map();                    // worker id → { status, since } for transitions
  }

  get prefs() { return prefsOf(this.env.store.data.notifyPrefs); }
  get history() { return (this.env.store.data.notifications ||= []); }
  unread() { return this.history.filter((n) => !n.read).length; }
  view() { return { items: this.history.slice(0, 50), unread: this.unread(), prefs: this.prefs, kinds: KINDS }; }

  setPrefs(p) {
    const cur = this.prefs;
    this.env.store.data.notifyPrefs = prefsOf({ ...cur, ...p, kinds: { ...cur.kinds, ...(p?.kinds || {}) } });
    this.env.store.save();
    return this.prefs;
  }

  read(id) {
    for (const n of this.history) if (!id || n.id === id) n.read = true;
    this.env.store.save();
    this.badge();
  }

  clear() { this.env.store.data.notifications = []; this.env.store.save(); this.badge(); }

  badge() { try { require('electron').app.dock?.setBadge(this.unread() ? String(this.unread()) : ''); } catch { /* not in electron (tests) */ } }

  // Record the event, tell the renderer, and pop a system notification when it fits.
  push(ws, d) {
    if (!this.prefs.enabled || !this.prefs.kinds[d.kind]) return null;
    const n = { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ts: Date.now(), wsId: ws.id, project: ws.name, read: false, ...d };
    this.history.unshift(n);
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    this.env.store.save();
    this.env.send('ev:notify', n);
    if (this.prefs.speak && this.env.speak) this.env.speak(n);
    this.badge();
    const win = this.env.win();
    const focused = !!win && !win.isDestroyed() && win.isFocused();
    if (shouldPopup(this.prefs, d.kind, focused)) {
      const { Notification } = require('electron');
      if (Notification?.isSupported?.()) {
        const note = new Notification({ title: n.title, subtitle: n.subtitle, body: n.body, silent: !this.prefs.sound });
        note.on('click', () => { this.read(n.id); this.env.onOpen({ ...n.ref, wsId: ws.id }); });
        note.on('failed', () => osaNotify(n, !this.prefs.sound));
        note.show();
      } else osaNotify(n, !this.prefs.sound);
    }
    return n;
  }

  taskDone(ws, task, who) { return this.push(ws, describeDone(ws, task, who)); }
  budgetHit(ws, worker, info) { return this.push(ws, describeBudget(ws, worker, info)); }
  limitHit(ws, worker, parked) { return this.push(ws, describeLimit(ws, worker, parked)); }
  limitResumed(ws, worker) { return this.push(ws, describeResumed(ws, worker)); }
  decisionAsked(ws, d, who) { return this.push(ws, describeDecision(ws, d, who)); }
  taskAssigned(ws, task, who, assignee) { return this.push(ws, describeAssigned(ws, task, who, assignee)); }

  // Called every status tick with the views of one workspace: detects waiting / stopped-working edges.
  tick(ws, views) {
    for (const v of views) {
      const prev = this.seen.get(v.id);
      const task = ws.tasks.find((t) => t.assignee === v.id && t.status === 'doing') || null;
      if (prev) {
        if (v.status === 'waiting' && prev.status !== 'waiting') this.push(ws, describeWaiting(ws, v, task));
        if (prev.status === 'working' && v.status === 'idle') {
          const secs = (Date.now() - prev.since) / 1000;
          if (secs >= MIN_WORK_SECS) this.push(ws, describeFinished(ws, v, task, secs));
        }
      }
      if (!prev || prev.status !== v.status) this.seen.set(v.id, { status: v.status, since: Date.now() });
    }
  }
}

module.exports = { describeBudget, describeLimit, describeResumed, osaNotify, Notifier, KINDS, DEFAULTS, prefsOf, shouldPopup, describeDone, describeWaiting, describeFinished, describeAssigned };
