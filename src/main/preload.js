'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const channels = ['state', 'open-path', 'choose-dir',
  'ws-create', 'ws-switch', 'ws-update', 'ws-remove',
  'worker-create', 'worker-update', 'worker-remove', 'worker-start', 'worker-stop', 'worker-send', 'worker-memory',
  'term-shell', 'term-write', 'term-paste', 'term-resize', 'term-kill', 'term-buffer',
  'task-create', 'task-update', 'task-done', 'task-remove', 'hands-off', 'notify-set', 'tracker-status', 'tracker-save', 'tracker-forget', 'tracker-issues', 'popout-open', 'pr-open', 'issues-list', 'tasks-import', 'parse-list', 'doctor', 'backup-export', 'skill-get', 'skill-save', 'skill-delete', 'report-review', 'worker-unpark', 'decision-answer', 'stt-status', 'stt-setup', 'stt-transcribe', 'mic-access', 'app-ack', 'open-url', 'update-check', 'worktree-status', 'worktree-commit', 'worktree-merge', 'worktree-remove', 'notify-read', 'notify-clear',
  'memory-graph', 'memory-search', 'watch-list', 'watch-status', 'watch-diff', 'integration-set',
  'guest-adopt', 'guest-message', 'guest-terminal'];

const api = {};
for (const ch of channels) api[ch.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = (arg) => ipcRenderer.invoke(ch, arg);
// Real path of a File dropped from Finder (File.path was removed from Electron's renderer).
api.pathForFile = (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } };
api.on = (event, cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(`ev:${event}`, listener);
  return () => ipcRenderer.removeListener(`ev:${event}`, listener);
};

contextBridge.exposeInMainWorld('office', api);
