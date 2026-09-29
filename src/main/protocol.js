'use strict';
// Team roles, the system prompt each agent gets, and the tag protocol agents
// use to talk to each other. Pure functions only — unit-tested in test/.

const DEFAULT_TEAM = [
  {
    id: 'pm', name: 'Ayşe', title: 'Product Manager', color: '#e76f51', enabled: true,
    aliases: ['product', 'productmanager', 'product-manager'],
    duties: 'Turns the owner\'s goals into a clear scope, acceptance criteria and small tasks. Assigns work, tracks progress on the task board, keeps the owner informed and decides priorities. Sequences work: hands an item to QA only after its developer reports it done. Reports the final outcome to the owner. Does not write production code.',
  },
  {
    id: 'lead', name: 'Mert', title: 'Tech Lead', color: '#2a9d8f', enabled: true,
    aliases: ['techlead', 'tech-lead', 'architect', 'lead-dev'],
    duties: 'Owns architecture and technical decisions, reads the codebase, splits technical work between developers, decides who edits which files, reviews developers\' changes.',
  },
  {
    id: 'frontend', name: 'Deniz', title: 'Frontend Developer', color: '#4895ef', enabled: true,
    aliases: ['fe', 'frontend-dev', 'ui-dev'],
    duties: 'Implements UI, client-side logic and styling. Writes/updates tests for their code. Reports completion with a short summary of changed files.',
  },
  {
    id: 'backend', name: 'Can', title: 'Backend Developer', color: '#7209b7', enabled: true,
    aliases: ['be', 'backend-dev', 'api-dev'],
    duties: 'Implements APIs, data models, services and integrations. Writes/updates tests for their code. Reports completion with a short summary of changed files.',
  },
  {
    id: 'qa', name: 'Elif', title: 'QA Engineer', color: '#f4a261', enabled: true,
    aliases: ['tester', 'test', 'quality'],
    duties: 'Verifies finished work against acceptance criteria: runs the build, tests and linters, reads diffs, writes missing tests. Files bugs as tasks assigned to the responsible developer with exact repro steps. Signs off when work is verified.',
  },
  {
    id: 'designer', name: 'Zeynep', title: 'UI/UX Designer', color: '#ef476f', enabled: false,
    aliases: ['design', 'ux', 'ui'],
    duties: 'Defines user flows, layout, copy and visual guidelines; reviews UI changes for usability and consistency. Writes specs, not production code.',
  },
  {
    id: 'devops', name: 'Burak', title: 'DevOps Engineer', color: '#8d99ae', enabled: false,
    aliases: ['ops', 'infra', 'sre', 'ci'],
    duties: 'Owns build scripts, CI/CD, environment configuration, dependency upgrades and release packaging.',
  },
];

const TASK_STATUSES = ['todo', 'doing', 'review', 'done', 'blocked'];
// Task size picks the assignee's model and effort for that turn (see agents.js).
const TASK_SIZES = ['s', 'm', 'l'];
const SIZE_ALIASES = { s: 's', small: 's', kucuk: 's', 'küçük': 's', m: 'm', medium: 'm', orta: 'm', l: 'l', large: 'l', buyuk: 'l', 'büyük': 'l' };

function normSize(v) {
  return SIZE_ALIASES[String(v || '').trim().toLowerCase()] || null;
}

function buildSystemPrompt(agent, team, opts = {}) {
  const roster = team
    .map((a) => `- id="${a.id}" — ${a.name}, ${a.title}${a.id === agent.id ? ' (you)' : ''}: ${a.duties}`)
    .join('\n');
  const lang = opts.language || 'Turkish';
  return `# Agent Office
You are ${agent.name}, the ${agent.title} of a small software team. Every teammate is an AI agent like you, running in its own session in the same project directory: ${opts.projectDir || '(current directory)'}.
The human "owner" (id="user") watches the office and may message anyone.

## Your role
${agent.duties}
${agent.extra ? `\nExtra instructions from the owner:\n${agent.extra}\n` : ''}
## Team
${roster}

## How to communicate (the ONLY way teammates can hear you)
Put these tags anywhere in your reply text. Anything outside tags is only visible to the owner in your log.
- <message to="qa">text</message> — direct message. to can be an id, a comma list ("frontend,backend"), "all", or "user" (the owner).
- <task assignee="backend" title="Short title" size="s|m|l">details / acceptance criteria</task> — creates a task on the shared board and notifies the assignee.
- <task-update id="T-3" status="doing|review|done|blocked">short note</task-update> — updates a task. The task creator is notified on done/blocked.
The shared board exists ONLY through these tags — task ids (T-n) are assigned by the office and shown to you in each turn. To assign work, always create a <task>; a task id you invent does not exist.
A request that arrived as a plain message (not a board task) gets its answer as a <message> back to the sender.

## Task size (always set it)
size picks the assignee's model: s = fast/cheap, m = standard, l = strongest. Pick the smallest that fits; don't inflate.
- s: one small or mechanical change, a quick check, a lookup, a single command.
- m: a normal feature or bug fix across a few files, a normal review or verification.
- l: cross-cutting or architectural work, hard debugging, anything risky.

## Working rules
- Write messages and task text in ${lang}. Keep them short and concrete (file paths, commands, results).
- Do not send acknowledgements, thanks or "on it" messages. Only message when someone needs information or must act.
- When you finish work someone asked for, report back to them once, with a summary. Mark your tasks with <task-update>.
- Check the board shown in each turn before creating a task; never duplicate an existing task — update it instead.
- Verification waits for completion: don't test or review something until its owner reports it done.
- Before editing files, make sure the Tech Lead (or the task) assigned those files to you, so two agents never edit the same file at once.
- Ask the owner (to="user") only for decisions you cannot make yourself.
- Each incoming batch of messages is one turn: do the work with your tools, then reply. Your session remembers previous turns.

## Token budget (every tool call re-sends your whole context — keep it small)
- Effort matches the task size. Do what the task asks, nothing more; no side investigations.
- Find with Grep/Glob, then read only the relevant lines (Read with offset/limit). Don't read whole large files or re-read files you already have.
- Keep command output short: pipe through tail/grep/head; run only the tests related to the change.
- Reuse existing tests and scripts. Write a new test or script only when the task asks for it or nothing existing covers it.
- Don't redo work that is already done or verified; trust teammates' reports unless something contradicts them.
- One tag per recipient per turn: put all details and notes for a task inside the <task> itself, not in a follow-up <message>.
- When you close a task, the report goes in the <task-update> note only; don't send the same content again as a <message>.
- Reply text outside tags: at most 2 short lines.`;
}

function parseAttrs(s) {
  const out = {};
  const re = /([a-zA-Z_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

// Extracts protocol actions from an agent's reply text.
function parseActions(text) {
  const actions = [];
  if (!text) return actions;
  const re = /<(message|task-update|task)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1\s*>)/gi;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    const body = (m[4] || '').trim();
    if (tag === 'message') {
      if (!attrs.to || !body) continue;
      actions.push({ type: 'message', to: attrs.to.split(',').map((t) => t.trim()).filter(Boolean), text: body });
    } else if (tag === 'task') {
      const title = (attrs.title || body.split('\n')[0] || '').trim();
      if (!title) continue;
      actions.push({ type: 'task', assignee: (attrs.assignee || attrs.to || '').trim(), title, details: body, size: normSize(attrs.size) });
    } else {
      if (!attrs.id) continue;
      const status = (attrs.status || '').toLowerCase();
      actions.push({ type: 'task-update', id: attrs.id.toUpperCase(), status: TASK_STATUSES.includes(status) ? status : null, note: body });
    }
  }
  return actions;
}

function stripActions(text) {
  return (text || '')
    .replace(/<(message|task-update|task)\b[^>]*?(\/>|>[\s\S]*?<\/\1\s*>)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Maps a recipient token (id, name, alias, "all", "user") to agent ids.
function resolveRecipients(tokens, team, fromId) {
  const ids = new Set();
  const unknown = [];
  for (const raw of tokens) {
    const t = raw.toLowerCase().replace(/^@/, '');
    if (t === 'all' || t === 'everyone' || t === 'team') {
      team.forEach((a) => a.id !== fromId && ids.add(a.id));
      continue;
    }
    if (t === 'user' || t === 'owner' || t === 'human') { ids.add('user'); continue; }
    const hit = team.find((a) => a.id === t || a.name.toLowerCase() === t || (a.aliases || []).includes(t) || a.title.toLowerCase() === t);
    if (hit) ids.add(hit.id);
    else unknown.push(raw);
  }
  ids.delete(fromId);
  return { ids: [...ids], unknown };
}

function summarizeToolUse(name, input = {}) {
  const short = (s, n = 60) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const file = input.file_path || input.notebook_path || input.path;
  if (file) return `${name} ${short(String(file).split('/').slice(-2).join('/'))}`;
  if (input.command) return `${name}: ${short(input.command)}`;
  if (input.pattern) return `${name} "${short(input.pattern, 40)}"`;
  if (input.url) return `${name} ${short(input.url)}`;
  if (input.description) return `${name}: ${short(input.description)}`;
  return name;
}

module.exports = { DEFAULT_TEAM, TASK_STATUSES, TASK_SIZES, normSize, buildSystemPrompt, parseActions, stripActions, resolveRecipients, summarizeToolUse };
