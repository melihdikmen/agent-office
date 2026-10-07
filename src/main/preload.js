'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const channels = ['state', 'open-path', 'choose-dir',
  'ws-create', 'ws-switch', 'ws-update', 'ws-remove',
  'worker-create', 'worker-update', 'worker-remove', 'worker-start', 'worker-stop', 'worker-send', 'worker-memory',
  'term-shell', 'term-write', 'term-paste', 'term-resize', 'term-kill', 'term-buffer',
  'task-create', 'task-update', 'task-done', 'task-remove', 'hands-off',
  'memory-graph', 'memory-search', 'watch-list', 'watch-status', 'watch-diff', 'integration-set',
  'guest-adopt', 'guest-message', 'guest-terminal'];

const api = {};
for (const ch of channels) api[ch.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = (arg) => ipcRenderer.invoke(ch, arg);
api.on = (event, cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(`ev:${event}`, listener);
  return () => ipcRenderer.removeListener(`ev:${event}`, listener);
};

contextBridge.exposeInMainWorld('office', api);
