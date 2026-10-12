// Who is expected to answer the owner's last chat message, and in what state — DOM-free.
export const LATE_MS = 180000;

// Mentions in the text resolve by name (as the main process does); otherwise the lead takes it.
export function recipientsOf(text, workers, leadId) {
  const out = [];
  for (const m of String(text).matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const w = workers.find((x) => String(x.name).toLowerCase() === m[1].toLowerCase());
    if (w && !out.includes(w.id)) out.push(w.id);
  }
  if (out.length) return out;
  const lead = workers.find((w) => w.id === leadId) || workers[0];
  return lead ? [lead.id] : [];
}

// msgs: chat log; optimistic: { ts, text } for a message still in flight (or null).
// Returns [{ id, name, color, kind }], kind: thinking | waking | asleep | approval | late.
export function pendingList({ msgs, workers, leadId, optimistic = null, now = Date.now() }) {
  const real = [...msgs].reverse().find((m) => m.from === 'user');
  const useOpt = optimistic && !(real && real.ts >= optimistic.ts - 1000);
  const src = useOpt ? { ts: optimistic.ts, ids: recipientsOf(optimistic.text, workers, leadId) }
    : real ? { ts: real.ts, ids: real.to === 'team' ? recipientsOf('', workers, leadId) : String(real.to).split(',').filter(Boolean) } : null;
  if (!src) return [];
  const out = [];
  for (const id of src.ids) {
    const w = workers.find((x) => x.id === id);
    if (!w) continue;
    if (msgs.some((m) => m.from === id && m.to === 'user' && m.ts >= src.ts)) continue;
    let kind = 'thinking';
    if (now - src.ts > LATE_MS) kind = 'late';
    else if (w.status === 'waiting') kind = 'approval';
    else if (w.status === 'offline') kind = 'asleep';
    else if (w.status === 'idle' || w.status === 'starting') kind = 'waking';
    out.push({ id, name: w.name, color: w.color, kind });
  }
  return out;
}

// ms until the oldest unanswered entry turns "late" (null when nothing is waiting).
export function lateIn(msgs, optimistic, now = Date.now()) {
  const real = [...msgs].reverse().find((m) => m.from === 'user');
  const ts = optimistic && !(real && real.ts >= optimistic.ts - 1000) ? optimistic.ts : real?.ts;
  return ts != null && now - ts < LATE_MS ? LATE_MS - (now - ts) + 50 : null;
}
