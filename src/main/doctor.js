'use strict';
const { tt } = require('./lang');
// "System check": what the office needs, what is missing, and how to fix it.
const { execFile } = require('child_process');
const fs = require('fs');
const { findBin } = require('./engines');

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 8000 }, (err, out, errOut) => resolve(err ? '' : String(out || errOut).trim())));

async function check({ claudeBin, envPath, dataDir, stt, micStatus, notifyOk = true }) {
  const items = [];
  const add = (id, label, ok, detail, fix = '') => items.push({ id, label, ok, detail, fix });
  const claude = claudeBin && fs.existsSync(claudeBin) ? await run(claudeBin, ['--version']) : '';
  add('claude', 'Claude Code', !!claude, claude || tt('bulunamadı', 'not found'), tt('npm i -g @anthropic-ai/claude-code ya da claude.ai/code adresinden kur', 'npm i -g @anthropic-ai/claude-code or install from claude.ai/code'));
  const git = await run('git', ['--version']);
  add('git', 'git', !!git, git || tt('bulunamadı', 'not found'), 'xcode-select --install');
  const gh = findBin('gh', envPath);
  add('gh', 'GitHub CLI (gh)', !!gh, gh ? await run(gh, ['auth', 'status']).then((o) => (o ? tt('giriş yapılmış', 'logged in') : tt('kurulu, giriş yok (gh auth login)', 'installed, not logged in (gh auth login)'))) : tt('kurulu değil (isteğe bağlı: PR açmak için)', 'not installed (optional: for opening PRs)'), 'brew install gh');
  for (const [id, label] of [['codex', 'Codex CLI'], ['gemini', 'Gemini CLI']]) {
    const p = findBin(id, envPath);
    add(id, label, !!p, p || tt('kurulu değil (isteğe bağlı)', 'not installed (optional)'), id === 'codex' ? 'npm i -g @openai/codex' : 'npm i -g @google/gemini-cli');
  }
  const st = stt?.status();
  add('stt', tt('Sesli komut (whisper)', 'Voice input (whisper)'), !!st?.ready, st?.ready ? tt('hazır', 'ready') : st?.bin ? tt('model eksik', 'model missing') : tt('kurulu değil (isteğe bağlı)', 'not installed (optional)'), tt('🎤 düğmesine basınca kurulum açılır', 'setup opens when you press the 🎤 button'));
  add('mic', tt('Mikrofon izni', 'Microphone permission'), micStatus === 'granted', micStatus || tt('bilinmiyor', 'unknown'), tt('Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon', 'System Settings → Privacy & Security → Microphone'));
  add('brew', 'Homebrew', !!findBin('brew', envPath), findBin('brew', envPath) || tt('kurulu değil (isteğe bağlı)', 'not installed (optional)'), 'brew.sh');
  let free = null;
  try { const s = fs.statfsSync(dataDir); free = (s.bavail * s.bsize) / 1073741824; } catch { /* unsupported */ }
  if (free != null) add('disk', tt('Boş disk', 'Free disk'), free > 2, `${free.toFixed(1)} GB`, tt('En az birkaç GB boş yer bırak', 'Leave at least a few GB free'));
  return items;
}

module.exports = { check };
