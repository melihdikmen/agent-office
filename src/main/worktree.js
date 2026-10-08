'use strict';
// Git worktrees for workers: each one that opts in gets its own checkout on its own
// branch (office/<name>) under the app's data folder, so parallel workers never edit
// the same files. The owner reviews the branch here and merges it into the base.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const git = (cwd, args, opts = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, ...opts }).trim();
const tryGit = (cwd, args) => { try { return { ok: true, out: git(cwd, args) }; } catch (e) { return { ok: false, out: String(e.stderr || e.stdout || e.message).trim() }; } };
const slug = (s) => String(s || 'agent').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';

function isRepo(dir) { return !!dir && tryGit(dir, ['rev-parse', '--is-inside-work-tree']).out === 'true'; }
const currentBranch = (dir) => tryGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
const hasCommits = (dir) => tryGit(dir, ['rev-parse', '--verify', 'HEAD']).ok;

function branchOf(w) { return `office/${slug(w.name)}-${w.id.slice(0, 4)}`; }

// Create (or reuse) the worker's worktree; returns its path. Throws with a readable message.
function ensure(ws, w, dataDir) {
  if (!isRepo(ws.dir)) throw new Error('Proje klasörü bir git deposu değil; worktree için önce `git init` gerekli.');
  if (!hasCommits(ws.dir)) throw new Error('Depoda henüz commit yok; worktree açmak için en az bir commit gerekli.');
  const dir = path.join(dataDir, 'worktrees', ws.id, `${slug(w.name)}-${w.id.slice(0, 4)}`);
  const branch = branchOf(w);
  if (fs.existsSync(path.join(dir, '.git'))) { w.worktreePath = dir; w.worktreeBranch = branch; return dir; }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (!w.worktreeBase) w.worktreeBase = currentBranch(ws.dir);
  const exists = tryGit(ws.dir, ['rev-parse', '--verify', `refs/heads/${branch}`]).ok;
  const r = tryGit(ws.dir, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir, w.worktreeBase]);
  if (!r.ok) throw new Error(`Worktree açılamadı: ${r.out.split('\n').pop()}`);
  // dependencies are usually untracked; share them instead of reinstalling per worker
  const nm = path.join(ws.dir, 'node_modules');
  if (fs.existsSync(nm) && !fs.existsSync(path.join(dir, 'node_modules'))) { try { fs.symlinkSync(nm, path.join(dir, 'node_modules'), 'dir'); } catch { /* optional */ } }
  w.worktreePath = dir; w.worktreeBranch = branch;
  return dir;
}

// What the owner needs to decide: commits ahead, uncommitted files, diff size.
function status(ws, w) {
  const dir = w.worktreePath;
  if (!dir || !fs.existsSync(dir)) return { exists: false };
  const base = w.worktreeBase || currentBranch(ws.dir);
  const dirty = git(dir, ['status', '--porcelain']).split('\n').filter((l) => l && !/ node_modules$/.test(l));
  const ahead = Number(tryGit(dir, ['rev-list', '--count', `${base}..HEAD`]).out) || 0;
  const behind = Number(tryGit(dir, ['rev-list', '--count', `HEAD..${base}`]).out) || 0;
  const stat = tryGit(dir, ['diff', '--shortstat', `${base}...HEAD`]).out;
  const commits = tryGit(dir, ['log', '--format=%h %s', `${base}..HEAD`, '-n', '8']).out.split('\n').filter(Boolean);
  const files = tryGit(dir, ['diff', '--name-only', `${base}...HEAD`]).out.split('\n').filter(Boolean).slice(0, 40);
  return { exists: true, path: dir, branch: w.worktreeBranch || branchOf(w), base, ahead, behind, dirty, stat, commits, files, mainBranch: currentBranch(ws.dir) };
}

function commit(w, message) {
  const dir = w.worktreePath;
  if (!dir) throw new Error('Worktree yok.');
  if (!git(dir, ['status', '--porcelain'])) return { committed: false };
  git(dir, ['add', '-A', '--', '.', ':!node_modules']);                  // the shared dependency symlink never goes into a commit
  const r = tryGit(dir, ['-c', 'user.name=Agent Office', '-c', 'user.email=office@localhost', 'commit', '-q', '-m', message || `office: ${w.name} çalışması`]);
  if (!r.ok && !/nothing to commit/i.test(r.out)) throw new Error(r.out.split('\n').pop());
  return { committed: r.ok };
}

// Merge the worker's branch into the base branch, which must be checked out in the project folder.
function merge(ws, w) {
  const st = status(ws, w);
  if (!st.exists) throw new Error('Worktree yok.');
  if (st.dirty.length) throw new Error('Worktree\'de commitlenmemiş değişiklik var; önce commit et.');
  if (st.mainBranch !== st.base) throw new Error(`Proje klasörü "${st.mainBranch}" dalında; birleştirmek için "${st.base}" dalında olmalı.`);
  if (git(ws.dir, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Proje klasöründe commitlenmemiş değişiklik var; birleştirmeden önce commit ya da stash et.');
  if (!st.ahead) return { merged: false, reason: 'Birleştirilecek commit yok.' };
  const r = tryGit(ws.dir, ['-c', 'user.name=Agent Office', '-c', 'user.email=office@localhost', 'merge', '--no-ff', '-m', `Merge ${st.branch} (${w.name})`, st.branch]);
  if (!r.ok) {
    const conflicts = tryGit(ws.dir, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
    tryGit(ws.dir, ['merge', '--abort']);
    throw new Error(conflicts.length ? `Çakışma: ${conflicts.join(', ')}. Birleştirme geri alındı; ajandan ${st.base} dalını kendi dalına almasını iste.` : r.out.split('\n').pop());
  }
  return { merged: true, commits: st.ahead };
}

function remove(ws, w, { deleteBranch = false } = {}) {
  const dir = w.worktreePath;
  if (dir && fs.existsSync(dir)) {
    try { fs.rmSync(path.join(dir, 'node_modules'), { force: true }); } catch { /* symlink */ }
    const r = tryGit(ws.dir, ['worktree', 'remove', '--force', dir]);
    if (!r.ok) fs.rmSync(dir, { recursive: true, force: true });
    tryGit(ws.dir, ['worktree', 'prune']);
  }
  if (deleteBranch && w.worktreeBranch) tryGit(ws.dir, ['branch', '-D', w.worktreeBranch]);
  w.worktreePath = null;
  return true;
}

module.exports = { isRepo, ensure, status, commit, merge, remove, branchOf, slug };
