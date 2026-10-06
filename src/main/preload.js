'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const channels = ['state', 'logs', 'send', 'release', 'pause', 'stop-all', 'stop-agent', 'clear-inbox', 'reset-session',
  'task-create', 'task-update', 'task-delete', 'choose-project', 'update-settings', 'open-path', 'scan', 'ext-kill', 'ext-terminal', 'ext-attach', 'ext-ask'];

const api = {};
for (const ch of channels) api[ch.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = (arg) => ipcRenderer.invoke(ch, arg);
api.on = (event, cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(`ev:${event}`, listener);
  return () => ipcRenderer.removeListener(`ev:${event}`, listener);
};

contextBridge.exposeInMainWorld('office', api);
