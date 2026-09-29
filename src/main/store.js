'use strict';
// Small JSON store: global settings + per-project state (sessions, messages, tasks).
const fs = require('fs');
const path = require('path');
const { DEFAULT_TEAM } = require('./protocol');

const MAX_MESSAGES = 600;

const DEFAULT_SETTINGS = {
  projectDir: '',
  model: '',                    // '' = automatic: picked per turn from task size (autoModels)
  // Task size → model + effort. Plain messages count as "m".
  autoModels: {
    s: { model: 'claude-haiku-4-5-20251001', effort: 'low' },
    m: { model: 'claude-sonnet-5-5', effort: 'medium' },
    l: { model: 'claude-opus-5-5', effort: 'high' },
  },
  contextLimit: 60000,          // tokens; a session above this starts fresh next turn (0 = never)
  lean: true,                   // skip skills and user/global MCP servers in agent sessions
  permissionMode: 'acceptEdits',
  language: 'Turkish',
  maxConcurrent: 3,
  maxHops: 12,                  // agent→agent chain depth before messages are held for the owner
  claudePath: '',
  // Headless agents can't answer permission prompts; these commands run without asking.
  allowedTools: ['Bash(npm *)', 'Bash(npx *)', 'Bash(yarn *)', 'Bash(pnpm *)', 'Bash(node *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(ls *)', 'Bash(cat *)'],
  team: DEFAULT_TEAM,
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'state.json');
    this.data = { settings: { ...DEFAULT_SETTINGS }, projects: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
      this.data.projects = raw.projects || {};
      // Keep roles added in newer versions.
      for (const role of DEFAULT_TEAM) {
        if (!this.data.settings.team.some((a) => a.id === role.id)) this.data.settings.team.push(role);
      }
    } catch { /* first run */ }
    this.timer = null;
  }

  get settings() { return this.data.settings; }

  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  project(dir = this.settings.projectDir) {
    const key = dir || '(none)';
    if (!this.data.projects[key]) this.data.projects[key] = { sessions: {}, messages: [], tasks: [], nextTask: 1, cost: 0 };
    return this.data.projects[key];
  }

  pushMessage(msg) {
    const p = this.project();
    p.messages.push(msg);
    if (p.messages.length > MAX_MESSAGES) p.messages.splice(0, p.messages.length - MAX_MESSAGES);
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (e) { console.error('store save failed', e); }
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
