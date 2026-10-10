'use strict';
// Usage limits: when a worker's agent says its limit is reached (and when it resets),
// the office parks it and types a "carry on" message once the time has come, also
// after an app restart. Detection needs a limit phrase AND a reset phrase in the last
// lines while the agent is not busy, so code that merely talks about rate limits is safe.
const LIMIT = /(usage|rate|5-hour|five-hour|weekly|session|opus|sonnet|message)?\s*limit\s+(reached|hit|exceeded|resets?)|hit your\s+(\w+\s+)?limit|limit will reset|out of (extra )?usage|quota (exceeded|exhausted)|rate[- ]limited/i;
const RESET = /resets?\b|try again|retry (after|in)|available (again )?(at|in)/i;
const MARGIN_MS = Number(process.env.AO_LIMIT_MARGIN_MS ?? 90 * 1000);                // wait a little past the stated reset
const FALLBACK_MS = 30 * 60 * 1000;         // no time given: try again in half an hour

const num = (s) => parseInt(s, 10);

// "resets 3pm", "resets at 11:30 PM", "in 2h 15m", "try again in 45 minutes" → epoch ms, or null.
function parseReset(text, now = Date.now()) {
  const t = String(text);
  let m = t.match(/(?:in|after)\s+(?:(\d+)\s*(?:h|hr|hrs|hours?))?\s*(?:(\d+)\s*(?:m|min|mins|minutes?))?\s*(?:(\d+)\s*(?:s|secs?|seconds?))?(?![\w])/i);
  if (m && (m[1] || m[2] || m[3])) return now + (((num(m[1]) || 0) * 60 + (num(m[2]) || 0)) * 60 + (num(m[3]) || 0)) * 1000;
  m = t.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    let h = num(m[1]); const min = num(m[2]) || 0, ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    const d = new Date(now); d.setHours(h, min, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return null;
}

// Look at the tail of a worker's terminal output. → { reason, resetAt } or null.
function detect(tail, now = Date.now()) {
  const last = String(tail).split('\n').slice(-12).join('\n');
  if (!LIMIT.test(last) || !RESET.test(last)) return null;
  const at = parseReset(last, now);
  return { reason: (last.match(LIMIT) || [''])[0].trim().slice(0, 60) || 'limit', resetAt: (at ?? now + FALLBACK_MS - MARGIN_MS) + MARGIN_MS, guessed: at == null };
}

module.exports = { detect, parseReset, MARGIN_MS, FALLBACK_MS };
