'use strict';
// "System check": what the office needs, what is missing, and how to fix it.
const { execFile } = require('child_process');
const fs = require('fs');
const { findBin } = require('./engines');

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 8000 }, (err, out, errOut) => resolve(err ? '' : String(out || errOut).trim())));

async function check({ claudeBin, envPath, dataDir, stt, micStatus, notifyOk = true }) {
  const items = [];
  const add = (id, label, ok, detail, fix = '') => items.push({ id, label, ok, detail, fix });
  const claude = claudeBin && fs.existsSync(claudeBin) ? await run(claudeBin, ['--version']) : '';
  add('claude', 'Claude Code', !!claude, claude || 'bulunamadı', 'npm i -g @anthropic-ai/claude-code ya da claude.ai/code adresinden kur');
  const git = await run('git', ['--version']);
  add('git', 'git', !!git, git || 'bulunamadı', 'xcode-select --install');
  const gh = findBin('gh', envPath);
  add('gh', 'GitHub CLI (gh)', !!gh, gh ? await run(gh, ['auth', 'status']).then((o) => (o ? 'giriş yapılmış' : 'kurulu, giriş yok (gh auth login)')) : 'kurulu değil (isteğe bağlı: PR açmak için)', 'brew install gh');
  for (const [id, label] of [['codex', 'Codex CLI'], ['gemini', 'Gemini CLI']]) {
    const p = findBin(id, envPath);
    add(id, label, !!p, p || 'kurulu değil (isteğe bağlı)', id === 'codex' ? 'npm i -g @openai/codex' : 'npm i -g @google/gemini-cli');
  }
  const st = stt?.status();
  add('stt', 'Sesli komut (whisper)', !!st?.ready, st?.ready ? 'hazır' : st?.bin ? 'model eksik' : 'kurulu değil (isteğe bağlı)', '🎤 düğmesine basınca kurulum açılır');
  add('mic', 'Mikrofon izni', micStatus === 'granted', micStatus || 'bilinmiyor', 'Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon');
  add('brew', 'Homebrew', !!findBin('brew', envPath), findBin('brew', envPath) || 'kurulu değil (isteğe bağlı)', 'brew.sh');
  let free = null;
  try { const s = fs.statfsSync(dataDir); free = (s.bavail * s.bsize) / 1073741824; } catch { /* unsupported */ }
  if (free != null) add('disk', 'Boş disk', free > 2, `${free.toFixed(1)} GB`, 'En az birkaç GB boş yer bırak');
  return items;
}

module.exports = { check };
