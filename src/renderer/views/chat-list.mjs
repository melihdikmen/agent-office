// Pure helpers for the chat list: agent filter, header grouping, long-message folding.
export const GROUP_GAP_MS = 5 * 60 * 1000;
export const LONG_CHARS = 600;

// Only messages that involve `id` (sent by it, or addressed to it); null → all.
export function filterMsgs(msgs, id) {
  if (!id) return msgs;
  return msgs.filter((m) => m.from === id || String(m.to || '').split(',').includes(id));
}

// For each message: does it start a new group (show name/time)? Same sender, same
// kind and addressee, less than 5 minutes apart → continuation without a header.
export function headFlags(msgs) {
  return msgs.map((m, i) => {
    const p = msgs[i - 1];
    if (!p || m.kind === 'dm' || p.kind === 'dm') return true;
    return !(p.from === m.from && p.to === m.to && (m.ts - p.ts) <= GROUP_GAP_MS && m.ts >= p.ts);
  });
}

export const isLong = (text) => String(text || '').length > LONG_CHARS;
export const continuesInTerminal = (text) => /\(devamı terminalde\)\s*$/i.test(String(text || ''));
export const viaTerminal = (m) => m?.via === 'terminal' || m?.kind === 'term';
