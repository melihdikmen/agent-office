'use strict';
// Read notifications aloud with the system voice (macOS `say`); a Turkish voice when installed.
const { execFile, execFileSync } = require('child_process');

let voices = null;
function voiceFor(lang) {
  if (process.platform !== 'darwin') return null;
  if (!voices) { try { voices = execFileSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5000 }); } catch { voices = ''; } }
  const want = lang === 'en' ? /\ben_(US|GB)\b/ : /\btr_TR\b/;
  const line = voices.split('\n').find((l) => want.test(l));
  return line ? line.split(/\s{2,}/)[0].trim() : null;
}

let busy = 0;
function speak(text, lang = 'tr') {
  if (process.platform !== 'darwin' || busy >= 2) return false;           // never pile up
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!t) return false;
  const v = voiceFor(lang);
  busy++;
  execFile('say', [...(v ? ['-v', v] : []), t], () => { busy--; });
  return true;
}

// What to say for a notification (short, spoken-language).
function phrase(n) {
  const who = String(n.title || '').split(' · ').pop();
  if (n.kind === 'done') return `${who} bir görevi bitirdi. ${String(n.body || '').split('\n')[0]}`;
  if (n.kind === 'waiting') return `${who} seni bekliyor.`;
  if (n.kind === 'decision') return `${who} bir karar istiyor. ${String(n.body || '').split('\n')[0]}`;
  if (n.kind === 'limit') return `${who}: ${n.subtitle}.`;
  if (n.kind === 'budget') return `${who}: ${n.subtitle}.`;
  return '';
}

module.exports = { speak, phrase, voiceFor };
