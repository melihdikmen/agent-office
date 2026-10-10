'use strict';
// Backups of the office data (offices, workers, tasks, reports, notes, memory files).
// Secrets from the Hub are left out. A rolling daily copy is kept automatically.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const stamp = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '');

// Strip anything that holds credentials from a copy of the store.
function scrub(data) {
  const copy = JSON.parse(JSON.stringify(data));
  if (copy.integrations) for (const k of Object.keys(copy.integrations)) { const i = copy.integrations[k]; if (i && typeof i === 'object') { delete i.secrets; delete i.secret; } }
  delete copy.trackers;                                   // Linear / Jira credentials
  for (const ws of copy.workspaces || []) for (const w of ws.workers || []) delete w.token;
  return copy;
}

// Roll one snapshot per day, keep the last 7. Returns the file written (or null).
function daily(store, dataDir, now = new Date()) {
  const dir = path.join(dataDir, 'backups');
  const file = path.join(dir, `office-${stamp(now)}.json`);
  if (fs.existsSync(file)) return null;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(scrub(store.data), null, 1));
  const old = fs.readdirSync(dir).filter((f) => /^office-\d{8}\.json$/.test(f)).sort().slice(0, -7);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}

// A zip with the scrubbed store and every worker memory file.
function exportZip(store, dataDir, outFile) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ao-backup-'));
  const root = path.join(tmp, `AgentOffice-yedek-${stamp()}`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'office.json'), JSON.stringify(scrub(store.data), null, 1));
  const ws = path.join(dataDir, 'workspaces');
  if (fs.existsSync(ws)) fs.cpSync(ws, path.join(root, 'workspaces'), { recursive: true });
  execFileSync('ditto', ['-c', '-k', '--keepParent', root, outFile]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return outFile;
}

module.exports = { scrub, daily, exportZip, stamp };
