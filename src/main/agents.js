'use strict';
// Runs the team: one headless Claude Code session per role, an inbox per agent,
// and a message bus that routes <message>/<task> tags between them.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TASK_SIZES, buildSystemPrompt, parseActions, stripActions, resolveRecipients, summarizeToolUse } = require('./protocol');

const LOG_LIMIT = 300;
// Built-in Claude Code tools that would bypass the office board/bus (their own
// todo lists, inter-session messaging, worktrees) and confuse teammates.
const BLOCKED_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskStop', 'SendMessage', 'ListAgents',
  'EnterWorktree', 'ExitWorktree', 'CronCreate', 'CronDelete', 'ScheduleWakeup', 'PushNotification', 'RemoteTrigger'];

class AgentManager extends EventEmitter {
  constructor(store, runtimeEnv) {
    super();
    this.store = store;
    this.env = runtimeEnv;          // { claudeBin, env }
    this.rt = new Map();            // id -> runtime state
    this.paused = false;
    this.seq = Date.now();
  }

  get team() { return this.store.settings.team.filter((a) => a.enabled); }
  agent(id) { return this.team.find((a) => a.id === id); }

  runtime(id) {
    if (!this.rt.has(id)) this.rt.set(id, { status: 'idle', activity: '', inbox: [], outbox: [], log: [], proc: null, turns: 0, cost: 0, lastError: '' });
    return this.rt.get(id);
  }

  snapshot(id) {
    const r = this.runtime(id);
    const s = this.store.project().sessions[id];
    return { id, status: r.status, activity: r.activity, inbox: r.inbox.length, turns: r.turns, cost: r.cost, lastError: r.lastError, sessionId: s?.id || null,
      model: r.model || '', size: r.size || '', ctx: s?.ctx || 0 };
  }

  state() {
    const p = this.store.project();
    return {
      settings: this.store.settings,
      paused: this.paused,
      agents: this.team.map((a) => this.snapshot(a.id)),
      messages: p.messages.slice(-300),
      tasks: p.tasks,
      cost: p.cost,
    };
  }

  logs(id) { return this.runtime(id).log; }

  // ---- project switching ---------------------------------------------------
  switchProject() {
    this.stopAll();
    this.rt.clear();
    this.emit('reset');
  }

  // ---- messaging -----------------------------------------------------------
  nextId() { return (++this.seq).toString(36); }

  sendFromUser(to, text) {
    const tokens = Array.isArray(to) ? to : [to];
    const { ids } = resolveRecipients(tokens, this.team, 'user');
    if (!ids.length || !text.trim()) return null;
    return this.deliver({ from: 'user', to: ids, text: text.trim(), depth: 0, kind: 'message' });
  }

  deliver(partial) {
    const msg = { id: this.nextId(), ts: Date.now(), held: false, ...partial };
    const agentTargets = msg.to.filter((t) => t !== 'user');
    if (msg.from !== 'user' && msg.depth > this.store.settings.maxHops && agentTargets.length) {
      msg.held = true;
    }
    this.store.pushMessage(msg);
    this.emit('message', msg);
    if (msg.to.includes('user') && msg.from !== 'user') this.emit('notify', msg);
    if (!msg.held) {
      // Hold an agent's outgoing items until its turn ends, so a <task> and the
      // <message> that follows it reach the recipient in one batch, not two turns.
      const sender = msg.from !== 'user' && this.rt.get(msg.from);
      if (sender?.proc) sender.outbox.push({ msg, targets: agentTargets });
      else this.enqueue(msg, agentTargets);
    }
    return msg;
  }

  flushOutbox(id) {
    const r = this.runtime(id);
    for (const { msg, targets } of r.outbox.splice(0)) this.enqueue(msg, targets);
  }

  enqueue(msg, targets) {
    for (const id of targets) {
      if (!this.agent(id)) continue;
      const r = this.runtime(id);
      r.inbox.push(msg);
      if (r.status === 'idle' || r.status === 'error' || (r.status === 'stopped' && msg.from === 'user')) r.status = 'queued';
      this.emit('agent', this.snapshot(id));
    }
    this.schedule();
  }

  release(msgId) {
    const p = this.store.project();
    const msg = p.messages.find((m) => m.id === msgId);
    if (!msg || !msg.held) return;
    msg.held = false;
    msg.depth = 0;
    this.store.save();
    this.emit('message', msg);
    this.enqueue(msg, msg.to.filter((t) => t !== 'user'));
  }

  // ---- tasks ---------------------------------------------------------------
  createTask({ title, details = '', assignee, createdBy, depth = 0, size = null }) {
    const p = this.store.project();
    const { ids } = resolveRecipients([assignee || ''], this.team, null);
    const target = ids.find((i) => i !== 'user') || null;
    const task = { id: `T-${p.nextTask++}`, title, details, size: TASK_SIZES.includes(size) ? size : null, assignee: target, createdBy, status: 'todo', notes: [], created: Date.now(), updated: Date.now() };
    p.tasks.push(task);
    this.store.save();
    this.emit('tasks', p.tasks);
    if (target && target !== createdBy) {
      this.deliver({ from: createdBy, to: [target], text: `New task ${task.id}: ${title}${details && details !== title ? `\n${details}` : ''}`, depth, kind: 'task', taskId: task.id, assign: true });
    }
    return task;
  }

  updateTask(id, { status, note, assignee, size }, by = 'user', depth = 0) {
    const p = this.store.project();
    const task = p.tasks.find((t) => t.id === id);
    if (!task) return null;
    if (status) task.status = status;
    if (assignee !== undefined) task.assignee = assignee || null;
    if (size !== undefined) task.size = TASK_SIZES.includes(size) ? size : null;
    if (note) task.notes.push({ by, ts: Date.now(), text: note });
    task.updated = Date.now();
    this.store.save();
    this.emit('tasks', p.tasks);
    if (by !== 'user' && (status === 'done' || status === 'blocked') && task.createdBy && task.createdBy !== by && task.createdBy !== 'user') {
      this.deliver({ from: by, to: [task.createdBy], text: `${task.id} "${task.title}" → ${status}${note ? `: ${note}` : ''}`, depth, kind: 'task', taskId: task.id });
    }
    if (by === 'user' && assignee && assignee !== 'user') {
      this.deliver({ from: 'user', to: [assignee], text: `Task ${task.id} is now assigned to you: ${task.title}\n${task.details || ''}`, depth: 0, kind: 'task', taskId: task.id, assign: true });
    }
    return task;
  }

  deleteTask(id) {
    const p = this.store.project();
    p.tasks = p.tasks.filter((t) => t.id !== id);
    this.store.save();
    this.emit('tasks', p.tasks);
  }

  // ---- scheduling ----------------------------------------------------------
  running() { return [...this.rt.values()].filter((r) => r.proc).length; }

  schedule() {
    if (this.paused) return;
    const max = Math.max(1, this.store.settings.maxConcurrent | 0);
    const waiting = this.team
      .map((a) => ({ a, r: this.runtime(a.id) }))
      .filter(({ r }) => !r.proc && r.inbox.length && r.status !== 'stopped')
      .sort((x, y) => x.r.inbox[0].ts - y.r.inbox[0].ts);
    for (const { a } of waiting) {
      if (this.running() >= max) break;
      this.runTurn(a);
    }
  }

  setPaused(p) {
    this.paused = !!p;
    this.emit('paused', this.paused);
    if (!this.paused) {
      for (const [id, r] of this.rt) if (r.status === 'stopped') { r.status = r.inbox.length ? 'queued' : 'idle'; this.emit('agent', this.snapshot(id)); }
      this.schedule();
    }
  }

  stopAgent(id) {
    const r = this.runtime(id);
    if (r.proc) { r.stopRequested = true; r.proc.kill('SIGTERM'); }
    r.status = 'stopped';
    r.activity = '';
    this.emit('agent', this.snapshot(id));
  }

  stopAll() {
    this.paused = true;
    for (const id of this.rt.keys()) this.stopAgent(id);
    this.emit('paused', true);
  }

  clearInbox(id) {
    const r = this.runtime(id);
    r.inbox = [];
    if (!r.proc) r.status = 'idle';
    this.emit('agent', this.snapshot(id));
  }

  resetSession(id) {
    this.stopAgent(id);
    delete this.store.project().sessions[id];
    this.store.save();
    const r = this.runtime(id);
    r.status = r.inbox.length ? 'queued' : 'idle';
    r.log = [];
    this.emit('agent', this.snapshot(id));
    this.emit('log-reset', id);
  }

  pushLog(id, entry) {
    const r = this.runtime(id);
    entry.ts = Date.now();
    r.log.push(entry);
    if (r.log.length > LOG_LIMIT) r.log.splice(0, r.log.length - LOG_LIMIT);
    this.emit('log', { id, entry });
  }

  setActivity(id, status, activity) {
    const r = this.runtime(id);
    r.status = status;
    if (activity !== undefined) r.activity = activity;
    this.emit('agent', this.snapshot(id));
  }

  // Model + effort for one turn. A per-role or global model setting wins; otherwise
  // the largest task assigned in this batch decides. Everything else (plain messages,
  // status notices, owner requests) counts as "m".
  turnProfile(agent, batch) {
    const s = this.store.settings;
    const tasks = this.store.project().tasks;
    let size = 's';
    for (const m of batch) {
      const t = m.assign && tasks.find((x) => x.id === m.taskId);
      const sz = (t && t.size) || 'm';
      if (TASK_SIZES.indexOf(sz) > TASK_SIZES.indexOf(size)) size = sz;
    }
    const fixed = agent.model || s.model;
    const auto = (s.autoModels || {})[size] || {};
    return { size, model: fixed || auto.model || '', effort: fixed ? '' : auto.effort || '' };
  }

  // Short memory for an agent whose session was reset: its recent conversation and open tasks.
  recap(agent, batch) {
    const p = this.store.project();
    const skip = new Set(batch.map((m) => m.id));
    const clip = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
    const msgs = p.messages.filter((m) => !skip.has(m.id) && (m.from === agent.id || m.to.includes(agent.id))).slice(-8)
      .map((m) => `- ${m.from} → ${m.to.join(',')}: ${clip(m.text.replace(/\s+/g, ' '), 300)}`);
    const mine = p.tasks.filter((t) => t.assignee === agent.id && t.status !== 'done')
      .map((t) => `- ${t.id} [${t.status}] ${t.title}: ${clip((t.details || '').replace(/\s+/g, ' '), 400)}`);
    return `\n\n(Your previous session was closed to save tokens. Recap — re-read files only if you need them.)${msgs.length ? `\nRecent conversation:\n${msgs.join('\n')}` : ''}${mine.length ? `\nYour open tasks:\n${mine.join('\n')}` : ''}`;
  }

  buildPrompt(agent, batch, recap = '') {
    const nameOf = (id) => (id === 'user' ? 'Owner (user)' : (() => { const a = this.agent(id); return a ? `${a.name} (${a.title}, id=${a.id})` : id; })());
    const parts = batch.map((m) => `--- ${m.kind === 'task' ? 'Task notice' : 'Message'} from ${nameOf(m.from)} · to ${m.to.map((t) => (t === agent.id ? 'you' : t)).join(', ')}\n${m.text}`);
    const open = this.store.project().tasks.filter((t) => t.status !== 'done').slice(-20);
    const board = open.length
      ? `\n\nOpen tasks on the board:\n${open.map((t) => `- ${t.id} [${t.status}] ${t.title} → ${t.assignee === agent.id ? 'YOU' : t.assignee || 'unassigned'}`).join('\n')}`
      : '';
    return `[Agent Office] ${batch.length} new item(s) in your inbox:\n\n${parts.join('\n\n')}${recap}${board}\n\nHandle them now. Use <message>/<task>/<task-update> tags to talk to teammates.`;
  }

  runTurn(agent, retried = false) {
    const r = this.runtime(agent.id);
    const batch = r.inbox.splice(0);
    const depth = Math.max(0, ...batch.map((m) => m.depth || 0));
    const settings = this.store.settings;
    const project = this.store.project();
    let session = project.sessions[agent.id];
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--append-system-prompt', buildSystemPrompt(agent, this.team, { projectDir: settings.projectDir, language: settings.language }),
      '--permission-mode', settings.permissionMode || 'acceptEdits',
      '--disallowedTools', BLOCKED_TOOLS.join(',')];
    if (settings.lean !== false) {
      args.push('--disable-slash-commands', '--strict-mcp-config');
      const projectMcp = path.join(settings.projectDir || '', '.mcp.json');
      if (settings.projectDir && fs.existsSync(projectMcp)) args.push('--mcp-config', projectMcp);
    }
    const allowed = (settings.allowedTools || []).filter(Boolean);
    if (allowed.length) args.push('--allowedTools', ...allowed);
    const profile = this.turnProfile(agent, batch);
    if (profile.model) args.push('--model', profile.model);
    if (profile.effort) args.push('--effort', profile.effort);
    // Every tool call re-sends the whole session, so a long session gets replaced
    // by a fresh one with a short recap instead of growing without bound.
    let recap = '';
    const limit = +settings.contextLimit || 0;
    if (session?.started && limit && session.ctx > limit) {
      this.pushLog(agent.id, { kind: 'system', text: `Bağlam ${Math.round(session.ctx / 1000)}k token — yeni oturum açılıyor.` });
      session = null;
      recap = this.recap(agent, batch);
    }
    if (session?.started) args.push('--resume', session.id);
    else {
      session = { id: crypto.randomUUID(), started: false, ctx: 0 };
      project.sessions[agent.id] = session;
      args.push('--session-id', session.id);
    }
    this.store.save();

    r.model = profile.model;
    r.size = profile.size;
    r.turns++;
    r.lastError = '';
    r.stopRequested = false;
    this.setActivity(agent.id, 'working', 'mesajları okuyor');
    this.pushLog(agent.id, { kind: 'in', text: batch.map((m) => `${m.from} → ${m.text}`).join('\n\n') });

    let proc;
    try {
      proc = spawn(this.env.claudeBin, args, { cwd: settings.projectDir || process.env.HOME, env: { ...this.env.env, AGENT_OFFICE_ROLE: agent.id } });
    } catch (e) {
      r.inbox.unshift(...batch);
      r.lastError = e.message;
      this.setActivity(agent.id, 'error', '');
      return;
    }
    r.proc = proc;
    this.emit('pids', this.pids());
    proc.stdin.end(this.buildPrompt(agent, batch, recap));

    let buf = '';
    let stderr = '';
    let gotResult = false;
    const onLine = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'system' && ev.subtype === 'init') {
        session.started = true;
        this.store.save();
      } else if (ev.type === 'assistant') {
        const u = ev.message?.usage;
        if (u) session.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        for (const block of ev.message?.content || []) {
          if (block.type === 'text' && block.text) this.handleText(agent, block.text, depth + 1);
          else if (block.type === 'thinking') this.setActivity(agent.id, 'working', 'düşünüyor…');
          else if (block.type === 'tool_use') {
            const label = summarizeToolUse(block.name, block.input);
            this.setActivity(agent.id, 'working', label);
            this.pushLog(agent.id, { kind: 'tool', text: label });
          }
        }
      } else if (ev.type === 'user') {
        for (const block of ev.message?.content || []) {
          if (block.type === 'tool_result' && block.is_error) {
            const c = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            this.pushLog(agent.id, { kind: 'tool-error', text: c.slice(0, 400) });
          }
        }
      } else if (ev.type === 'result') {
        gotResult = true;
        const cost = ev.total_cost_usd || 0;
        r.cost += cost;
        project.cost = (project.cost || 0) + cost;
        this.emit('cost', project.cost);
        if (ev.is_error) {
          r.lastError = String(ev.result || ev.subtype || 'error').slice(0, 300);
          this.pushLog(agent.id, { kind: 'error', text: r.lastError });
        }
      }
    };
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
    proc.on('error', (e) => { stderr += e.message; });
    proc.on('close', (code) => {
      if (buf) onLine(buf);
      r.proc = null;
      this.emit('pids', this.pids());
      this.flushOutbox(agent.id);
      if (r.stopRequested) {
        this.pushLog(agent.id, { kind: 'system', text: 'Durduruldu.' });
      } else if (code !== 0 && !gotResult) {
        if (!retried && /no conversation found|session.*(not found|already in use)/i.test(stderr)) {
          delete project.sessions[agent.id];
          r.inbox.unshift(...batch);
          this.runTurn(agent, true);
          return;
        }
        r.lastError = (stderr.trim().split('\n').pop() || `exit ${code}`).slice(0, 300);
        this.pushLog(agent.id, { kind: 'error', text: r.lastError });
      }
      if (r.status !== 'stopped') r.status = r.lastError ? 'error' : r.inbox.length ? 'queued' : 'idle';
      r.activity = '';
      this.emit('agent', this.snapshot(agent.id));
      this.store.save();
      this.schedule();
    });
  }

  handleText(agent, text, depth) {
    const visible = stripActions(text);
    if (visible) this.pushLog(agent.id, { kind: 'text', text: visible });
    for (const act of parseActions(text)) {
      if (act.type === 'message') {
        const { ids, unknown } = resolveRecipients(act.to, this.team, agent.id);
        if (unknown.length) this.emit('system', `${agent.name}: bilinmeyen alıcı ${unknown.join(', ')}`);
        if (ids.length) this.deliver({ from: agent.id, to: ids, text: act.text, depth, kind: 'message' });
      } else if (act.type === 'task') {
        this.createTask({ title: act.title, details: act.details, size: act.size, assignee: act.assignee, createdBy: agent.id, depth });
      } else if (act.type === 'task-update') {
        if (!this.updateTask(act.id, { status: act.status, note: act.note }, agent.id, depth)) {
          this.emit('system', `${agent.name}: panoda olmayan görev güncellendi (${act.id})`);
        }
      }
    }
  }

  pids() { return [...this.rt.values()].map((r) => r.proc?.pid).filter(Boolean); }
}

module.exports = { AgentManager };
