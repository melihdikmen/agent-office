'use strict';
// Skills: reusable how-to playbooks a worker can be given. Claude workers get them as a
// plugin directory (`claude --plugin-dir`), so they are loaded for that session only and
// nothing is written into the project. Codex / Gemini workers get the text in their briefing.
const fs = require('fs');
const path = require('path');

const BUILTIN = [
  { id: 'systematic-debugging', name: 'Sistematik hata ayıklama', description: 'Use when a bug, failing test or unexpected behaviour must be root-caused before fixing: reproduce, narrow down, form a hypothesis, prove it, then fix.',
    body: `# Systematic debugging\n\n1. **Reproduce** the failure with the smallest reliable steps or a failing test. If you cannot reproduce it, say so and stop guessing.\n2. **Read** the actual error, stack trace and recent changes (git log / diff) before touching code.\n3. **Narrow down**: bisect by inputs, by commits or by commenting out halves until the cause is isolated to one place.\n4. **Hypothesis**: write one sentence "X happens because Y". Predict what you will observe if it is true, then check it with a log, a debugger or a test — not by editing code.\n5. **Fix the cause**, not the symptom. Keep the change minimal.\n6. **Prove**: the reproduction now passes, nearby tests still pass, and add a regression test.\n7. Report: cause, fix, evidence. If three hypotheses fail, step back and re-read the code path from the entry point.` },
  { id: 'test-driven-development', name: 'Test güdümlü geliştirme (TDD)', description: 'Use when writing new behaviour or fixing a bug: write the failing test first, make it pass with the least code, then refactor.',
    body: `# Test-driven development\n\nRED → GREEN → REFACTOR, in small steps.\n\n1. **RED**: write one test that describes the next small behaviour. Run it and watch it fail *for the right reason*.\n2. **GREEN**: write the least code that makes it pass. No extra features.\n3. **REFACTOR**: with the tests green, remove duplication and improve names. Run the tests again.\n4. Repeat. Commit when a coherent step is green.\n\nRules: never write production code without a failing test that demands it; do not edit a test just to make it pass; for a bug, the first step is a test that reproduces it.` },
  { id: 'pre-commit-review', name: 'Commit öncesi kontrol', description: 'Use before committing or closing a task: review your own diff for bugs, leftovers and missing tests, and run the project checks.',
    body: `# Pre-commit review\n\nBefore you close a task or commit:\n\n1. Run \`git status\` and \`git diff\`; read every hunk as if someone else wrote it.\n2. Hunt for: debug prints, commented-out code, TODOs you added, secrets or keys, unrelated edits, files that should not be committed.\n3. Check behaviour: edge cases (empty, null, large, concurrent), error paths, and anything the diff touches indirectly.\n4. Run the project's checks (typecheck, lint, tests, build) and read the output; do not assume they pass.\n5. Missing tests for new behaviour? Add them.\n6. Write the commit / task summary: what changed, why, how it was verified (with the real commands and results).` },
  { id: 'spike', name: 'Spike (kısa deney)', description: 'Use to answer one technical question quickly before committing to a build: timebox it, keep the code throwaway, report the answer.',
    body: `# Spike\n\nA spike answers ONE question. Not a feature.\n\n1. Write the question and what answer would change your plan.\n2. Set a timebox (e.g. 30 minutes) and keep to it.\n3. Work in a scratch folder or branch; hack freely, no polish, no tests.\n4. Stop when the question is answered or the timebox ends.\n5. Report: the question, the answer, evidence (output, numbers), and a recommendation for the real build.\n6. Delete the spike code (or leave it clearly marked as throwaway). Never merge it as-is.` },
  { id: 'safe-refactor', name: 'Güvenli refactor', description: 'Use when restructuring code without changing behaviour: pin behaviour with tests, move in small steps, keep everything green.',
    body: `# Safe refactor\n\n1. State the goal in one line and what must NOT change (public behaviour).\n2. Make sure tests cover the behaviour; add characterisation tests where they do not.\n3. Move in small steps (rename, extract, move, inline) and run the tests after each; commit when green.\n4. Do not mix refactoring with behaviour changes or bug fixes in the same commit.\n5. Delete code that became dead. Update imports, docs and comments that mention moved things.\n6. Finish with the full check suite and a summary of what moved where.` },
  { id: 'dogfood-qa', name: 'Kullanıcı gibi QA (dogfood)', description: 'Use to test a running app like a real user: explore flows, try odd inputs, collect evidence and file a triaged bug list.',
    body: `# Dogfood QA\n\n1. Start the app the way a user would and write down the main flows (what a person came here to do).\n2. Walk each flow end to end. Then try to break it: empty fields, very long text, wrong order of steps, double clicks, back/refresh, slow or failing network, small windows.\n3. For every problem record: steps to reproduce, expected vs actual, and evidence (screenshot, console output, log lines).\n4. Triage: blocker / major / minor / cosmetic. Merge duplicates.\n5. Report a short list ordered by severity; open a board task for each blocker and major issue with its reproduction steps.` },
  { id: 'doc-to-action-items', name: 'Dokümandan eylem maddeleri', description: 'Use to turn a document, thread or meeting notes into action items with owners and deadlines, each backed by a quote from the source.',
    body: `# Document to action items\n\n1. Read the whole source once; do not skim.\n2. Extract only real commitments or requests: who must do what, by when.\n3. For each item write: the action (verb first), the owner (or "unassigned"), the deadline (or "none stated"), and a short **quote** from the source that justifies it.\n4. Do not invent owners or dates. Mark anything ambiguous as a question.\n5. Output a table, then a separate list of open questions. Offer to create board tasks from the items.` },
  { id: 'release-notes', name: 'Sürüm notu yazımı', description: 'Use when preparing release notes or a changelog entry from commits and merged work: group by user-visible impact, plain language.',
    body: `# Release notes\n\n1. Collect the changes since the last release (\`git log\`, merged branches, closed tasks).\n2. Drop internal noise (refactors, formatting, CI tweaks) unless users feel them.\n3. Group: **New**, **Improved**, **Fixed**, and **Heads-up** (breaking changes, migrations, new permissions).\n4. Write each line from the user's point of view: what they can do now or what stopped breaking. One sentence, no jargon, no commit hashes.\n5. Mention how to upgrade if anything needs action. Keep the whole entry short.` },
];

const slug = (s) => String(s || 'skill').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'skill';

class Skills {
  constructor(store, dataDir) { this.store = store; this.dataDir = dataDir; }

  custom() { return (this.store.data.skills ||= []); }
  all() { return [...BUILTIN.map((s) => ({ ...s, builtin: true })), ...this.custom().map((s) => ({ ...s, builtin: false }))]; }
  find(id) { return this.all().find((s) => s.id === id) || null; }
  known(ids) { return (ids || []).filter((id) => this.find(id)); }

  save({ id, name, description, body }) {
    const n = String(name || '').trim().slice(0, 60), d = String(description || '').trim().slice(0, 400), b = String(body || '').trim().slice(0, 20000);
    if (!n || !d || !b) throw new Error('Ad, ne zaman kullanılacağı ve içerik gerekli.');
    const list = this.custom();
    const cur = id ? list.find((s) => s.id === id) : null;
    if (id && !cur) throw new Error('Beceri bulunamadı (hazır beceriler düzenlenemez).');
    if (cur) Object.assign(cur, { name: n, description: d, body: b });
    else { let sid = `my-${slug(n)}`; while (this.find(sid)) sid += '-2'; list.push({ id: sid, name: n, description: d, body: b }); }
    this.store.save();
    return (cur || list.at(-1)).id;
  }

  remove(id) {
    this.store.data.skills = this.custom().filter((s) => s.id !== id);
    for (const ws of this.store.workspaces) for (const w of ws.workers) if (w.skills) w.skills = w.skills.filter((x) => x !== id);
    this.store.save();
  }

  // SKILL.md text for one skill.
  markdown(s) { return `---\nname: ${slug(s.id)}\ndescription: ${s.description.replace(/\n/g, ' ')}\n---\n\n${s.body}\n`; }

  // Plugin directory for `claude --plugin-dir`; null when the worker has no skills.
  pluginFor(worker) {
    const skills = this.known(worker.skills).map((id) => this.find(id));
    const dir = path.join(this.dataDir, 'engines', worker.id, 'skills-plugin');
    fs.rmSync(dir, { recursive: true, force: true });
    if (!skills.length) return null;
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'office-skills', version: '1.0.0', description: 'Skills handed out by Agent Office' }, null, 2));
    for (const s of skills) {
      fs.mkdirSync(path.join(dir, 'skills', slug(s.id)), { recursive: true });
      fs.writeFileSync(path.join(dir, 'skills', slug(s.id), 'SKILL.md'), this.markdown(s));
    }
    return dir;
  }

  // For engines without skill support: the playbooks as a briefing section.
  briefing(worker) {
    const skills = this.known(worker.skills).map((id) => this.find(id));
    if (!skills.length) return [];
    return ['', '## Skills', 'Follow these playbooks when their description matches the work:', ...skills.flatMap((s) => ['', `### ${s.name} — ${s.description}`, s.body.slice(0, 3500)])];
  }
}

module.exports = { Skills, BUILTIN, slug };
