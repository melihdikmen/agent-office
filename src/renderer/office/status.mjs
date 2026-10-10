// Pure status → look rules for the office (no DOM, so they can be tested).
// See docs/design-agentspace.md §1–2.

export const MAX_WANDERERS = 2;
const APPROVAL = /izin|onay|permission|approve|allow/i;

export const isApproval = (waitingFor) => APPROVAL.test(String(waitingFor || ''));

// How long (s) an agent has been in its current status.
export const sinceSecs = (v, now = Date.now()) => (v.statusSince ? Math.max(0, (now - v.statusSince) / 1000) : 0);

// Colors come from CSS variables (single source); `colors` maps name → value.
// Returns { text, bg, fg, bold, bounce, pulse } or null. One bubble per character.
// Priority: manual c.bubble > waiting > offline > starting > working hint.
export function bubbleFor(c, v, t, colors, now = Date.now()) {
  if (c.bubble?.text) return { text: c.bubble.text, bg: colors.paper, fg: colors.ink };
  if (v.parkedUntil) return { text: `⏳ ${new Date(v.parkedUntil).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`, bg: colors.purple, fg: colors.ink, bold: true, pulse: 0.5 };
  if (v.decisionOpen) return { text: '⚑ Karar', bg: colors.yellow, fg: colors.ink, bold: true, bounce: 3, pulse: 1 };
  if (v.status === 'waiting') {
    const urgent = sinceSecs(v, now) >= 60;
    const pulse = urgent ? 2.2 : 1;
    if (isApproval(v.waitingFor)) return { text: '? Onay', bg: colors.yellow, fg: colors.ink, bold: true, bounce: 3, pulse };
    return { text: '…?', bg: colors.purple, fg: colors.ink, pulse: urgent ? 2.2 : 0.5 };
  }
  if (v.status === 'offline') return { text: 'z'.repeat(1 + (Math.floor(t * 1.5) % 3)), bg: colors.dark, fg: colors.muted, float: true };
  if (v.status === 'starting') return { text: '…', bg: colors.paper, fg: colors.muted };
  if (v.status === 'working') {
    const dots = '.'.repeat(1 + (Math.floor(t / 0.4) % 3));
    const title = v.taskTitle && Math.floor(t / 4) % 2 === 1 ? String(v.taskTitle).slice(0, 24) : null;
    return { text: title || dots, bg: colors.paper, fg: colors.blue };
  }
  return null;
}

// Whether a character may start a stroll right now.
export function mayWander(c, v, wanderers) {
  if (v.guest || v.status !== 'idle') return false;       // waiting/working never walk
  return wanderers < MAX_WANDERERS;
}

// Status counts for the summary line (top right of the office).
export function summarize(views) {
  const n = { working: 0, waiting: 0, sleeping: 0 };
  for (const v of views) {
    if (v.status === 'working') n.working++;
    else if (v.status === 'waiting') n.waiting++;
    else if (v.status === 'offline') n.sleeping++;
  }
  return n;
}
