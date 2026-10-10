'use strict';
// GitHub through the `gh` CLI: open a pull request for a worker's branch, list issues to import.
const { execFile } = require('child_process');
const { findBin } = require('./engines');

function gh(envPath, args, cwd) {
  const bin = findBin('gh', envPath);
  return new Promise((resolve, reject) => {
    if (!bin) return reject(new Error('GitHub CLI (gh) kurulu değil: brew install gh && gh auth login'));
    execFile(bin, args, { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PATH: envPath, GH_PROMPT_DISABLED: '1' } }, (err, out, errOut) => {
      if (err) { const m = String(errOut || err.message).trim().split('\n').slice(-2).join(' '); return reject(new Error(/no git remotes/i.test(m) ? 'Projede GitHub bağlantısı (origin) yok.' : /not logged|auth login/i.test(m) ? 'gh ile giriş yapılmamış: gh auth login' : m)); }
      resolve(String(out).trim());
    });
  });
}
const git = (cwd, args) => new Promise((resolve, reject) => execFile('git', args, { cwd, timeout: 60000 }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).trim().split('\n').pop())) : resolve(String(out).trim()))));

// Push the worker's branch and open a PR against its base. Returns the PR URL.
async function openPr(envPath, ws, w, { title, body }) {
  const dir = w.worktreePath;
  if (!dir) throw new Error('Bu çalışanın worktree\'si yok.');
  const remotes = await git(dir, ['remote']).catch(() => '');
  if (!remotes) throw new Error('Projede uzak depo (origin) yok; önce GitHub\'a bağla.');
  await git(dir, ['push', '-u', 'origin', w.worktreeBranch]);
  const url = await gh(envPath, ['pr', 'create', '--base', w.worktreeBase || 'main', '--head', w.worktreeBranch, '--title', title, '--body', body], dir);
  return url.split('\n').pop();
}

// Open issues of the project's repository.
async function issues(envPath, ws) {
  const out = await gh(envPath, ['issue', 'list', '--state', 'open', '--limit', '40', '--json', 'number,title,body,labels,url'], ws.dir);
  return JSON.parse(out || '[]').map((i) => ({ number: i.number, title: i.title, body: String(i.body || '').slice(0, 1500), labels: (i.labels || []).map((l) => l.name), url: i.url }));
}

// Lines of pasted text → task titles ("- [ ] x", "1. x", "* x", plain lines).
function parseList(text) {
  return String(text || '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/, '').trim()).filter((l) => l.length > 1).slice(0, 100);
}

module.exports = { openPr, issues, parseList };
