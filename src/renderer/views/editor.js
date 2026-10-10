// Code editor: project (or a worker's worktree) file tree, tabs, CodeMirror with syntax colours,
// ⌘S to save, quick file search, and "send to a worker": selection or line + a comment.
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { tt } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LANGS = { js: () => javascript(), mjs: () => javascript(), cjs: () => javascript(), jsx: () => javascript({ jsx: true }), ts: () => javascript({ typescript: true }), tsx: () => javascript({ typescript: true, jsx: true }), json: () => json(), css: () => css(), html: () => html(), htm: () => html(), md: () => markdown(), py: () => python() };
const ext = (p) => p.split('.').pop().toLowerCase();

const hl = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--syn-kw)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-str)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-cm)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--syn-fn)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-prop)' },
  { tag: [t.tagName, t.heading], color: 'var(--syn-kw)', fontWeight: '600' },
  { tag: [t.link, t.url], color: 'var(--syn-fn)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--red)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--term-bg)', color: 'var(--text)', fontSize: '12.5px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--term-bg)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)', color: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent) !important' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--yellow) 30%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
  '.cm-panel input, .cm-panel button': { font: 'inherit' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--panel2)', border: 'none', color: 'var(--muted)' },
});

export class EditorPane {
  constructor(root, api, { toast, workers }) {
    this.root = root; this.api = api; this.toast = toast; this.workers = workers;
    this.roots = []; this.rootId = 'project'; this.tree = new Map(); this.open = new Set(['']);
    this.tabs = []; this.active = null; this.visible = false; this.all = null; this.q = '';
    this.lang = new Compartment();
    root.innerHTML = `<div class="ed">
      <aside class="ed-tree"><div class="ed-tools"><select id="edRoot"></select><input id="edQ" type="search" placeholder="${tt('dosya ara…', 'find file…')}" spellcheck="false"></div><div id="edFiles" class="ed-files"></div></aside>
      <section class="ed-main"><div id="edTabs" class="ed-tabs"></div><div id="edBanner" class="ed-banner hidden"></div><div id="edHost" class="ed-host"></div>
        <div class="ed-foot"><span id="edPos" class="muted"></span><span class="spacer"></span><button class="btn small" data-ed="send" title="${tt('Seçili kodu (ya da satırı) bir çalışana yorumla gönder', 'Send the selection (or line) to a worker with a comment')}">${tt('✦ Çalışana gönder', '✦ Send to worker')}</button><button class="btn small primary" data-ed="save">${tt('Kaydet', 'Save')} <kbd>⌘S</kbd></button></div></section></div>`;
    this.cm = new EditorView({ parent: root.querySelector('#edHost'), state: this.makeState('', 'txt') });
    root.addEventListener('click', (e) => this.click(e));
    root.querySelector('#edRoot').onchange = (e) => { this.rootId = e.target.value; this.tree.clear(); this.open = new Set(['']); this.all = null; this.tabs = []; this.active = null; this.showEmpty(); this.loadDir(''); this.drawTabs(); };
    let timer = null;
    root.querySelector('#edQ').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => this.search(e.target.value), 120); };
    root.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); } });
    setInterval(() => this.poll(), 2500);
  }

  makeState(doc, name) {
    const l = LANGS[ext(name)];
    return EditorState.create({ doc, extensions: [
      lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightActiveLine(), history(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(), highlightSelectionMatches(),
      syntaxHighlighting(hl), theme, this.lang.of(l ? l() : []),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && this.active) { const tab = this.tab(); if (tab) { const d = u.state.doc.toString() !== tab.orig; if (d !== tab.dirty) { tab.dirty = d; this.drawTabs(); } } }
        if (u.selectionSet || u.docChanged) { const p = u.state.selection.main.head, ln = u.state.doc.lineAt(p); this.root.querySelector('#edPos').textContent = `${tt('Satır', 'Ln')} ${ln.number}, ${tt('Sütun', 'Col')} ${p - ln.from + 1}`; }
      }),
    ] });
  }

  tab() { return this.tabs.find((x) => x.path === this.active) || null; }

  async show(on) {
    this.visible = on;
    if (!on) return;
    const r = await this.api.fsRoots();
    if (r?.error) { this.root.querySelector('#edFiles').innerHTML = `<div class="muted pad">${esc(r.error)}</div>`; return; }
    this.roots = r;
    if (!r.some((x) => x.id === this.rootId)) this.rootId = 'project';
    this.root.querySelector('#edRoot').innerHTML = r.map((x) => `<option value="${esc(x.id)}" ${x.id === this.rootId ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    if (!this.tree.has('')) await this.loadDir('');
    this.drawTree(); this.cm.requestMeasure();
    if (!this.tabs.length) this.showEmpty();
  }

  showEmpty() { this.root.querySelector('#edHost').classList.toggle('empty', !this.tabs.length); }

  async loadDir(p) {
    const r = await this.api.fsList({ root: this.rootId, path: p });
    if (r?.error) return this.toast(r.error, 'err');
    this.tree.set(p, r); this.drawTree();
  }

  drawTree() {
    const box = this.root.querySelector('#edFiles');
    if (this.q) return;
    const row = (e, depth) => `<div class="ed-row ${e.dir ? 'dir' : ''} ${this.active === e.path ? 'on' : ''}" style="padding-left:${8 + depth * 14}px" data-path="${esc(e.path)}" data-dir="${e.dir ? 1 : 0}"><span class="ic">${e.dir ? (this.open.has(e.path) ? '▾' : '▸') : '·'}</span>${esc(e.name)}</div>`;
    const walk = (p, depth) => (this.tree.get(p) || []).map((e) => row(e, depth) + (e.dir && this.open.has(e.path) ? walk(e.path, depth + 1) : '')).join('');
    box.innerHTML = walk('', 0) || `<div class="muted pad">${tt('Klasör boş.', 'Empty folder.')}</div>`;
  }

  async search(q) {
    this.q = q.trim();
    const box = this.root.querySelector('#edFiles');
    if (!this.q) { this.drawTree(); return; }
    if (!this.all) { const r = await this.api.fsWalk({ root: this.rootId }); this.all = Array.isArray(r) ? r : []; }
    const parts = this.q.toLowerCase().split(/\s+/);
    const hits = this.all.filter((f) => parts.every((p) => f.toLowerCase().includes(p))).sort((a, b) => a.split('/').pop().length - b.split('/').pop().length).slice(0, 60);
    box.innerHTML = hits.map((f) => `<div class="ed-row" data-path="${esc(f)}" data-dir="0"><span class="ic">·</span>${esc(f.split('/').pop())}<small>${esc(f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')}</small></div>`).join('') || `<div class="muted pad">${tt('Eşleşme yok.', 'No match.')}</div>`;
  }

  async openFile(path, line = 0) {
    let tab = this.tabs.find((x) => x.path === path);
    if (!tab) {
      const r = await this.api.fsRead({ root: this.rootId, path });
      if (r?.error) return this.toast(r.error, 'err');
      if (r.binary || r.tooBig) return this.toast(r.binary ? tt('İkili dosya, açılamaz.', 'Binary file.') : tt('Dosya çok büyük (1 MB üstü).', 'File too large (over 1 MB).'), 'err');
      tab = { path, orig: r.text, mtime: r.mtime, dirty: false, state: this.makeState(r.text, path) };
      this.tabs.push(tab);
    }
    this.switchTo(path);
    if (line) { const ln = this.cm.state.doc.line(Math.min(line, this.cm.state.doc.lines)); this.cm.dispatch({ selection: { anchor: ln.from }, scrollIntoView: true }); }
    this.cm.focus();
  }

  switchTo(path) {
    const cur = this.tab(); if (cur) cur.state = this.cm.state;
    this.active = path;
    this.cm.setState(this.tab().state);
    this.root.querySelector('#edBanner').classList.add('hidden');
    this.showEmpty(); this.drawTabs(); this.drawTree();
  }

  drawTabs() {
    this.root.querySelector('#edTabs').innerHTML = this.tabs.map((x) => `<div class="ed-tab ${x.path === this.active ? 'on' : ''}" data-tab="${esc(x.path)}" title="${esc(x.path)}"><span>${esc(x.path.split('/').pop())}</span>${x.dirty ? '<i class="dirty">●</i>' : ''}<button class="x" data-close="${esc(x.path)}">✕</button></div>`).join('');
  }

  closeTab(path) {
    const i = this.tabs.findIndex((x) => x.path === path);
    if (i < 0) return;
    if (this.tabs[i].dirty && !confirm(tt(`${path} kaydedilmedi. Yine de kapatılsın mı?`, `${path} is not saved. Close anyway?`))) return;
    this.tabs.splice(i, 1);
    if (this.active === path) { this.active = null; const n = this.tabs[Math.max(0, i - 1)]; if (n) this.switchTo(n.path); else { this.cm.setState(this.makeState('', 'txt')); this.showEmpty(); } }
    this.drawTabs(); this.drawTree();
  }

  async save() {
    const tab = this.tab(); if (!tab) return;
    const text = this.cm.state.doc.toString();
    const r = await this.api.fsWrite({ root: this.rootId, path: tab.path, text });
    if (r?.error) return this.toast(r.error, 'err');
    tab.orig = text; tab.mtime = r.mtime; tab.dirty = false; this.drawTabs();
    this.root.querySelector('#edBanner').classList.add('hidden');
    this.toast(tt('Kaydedildi', 'Saved'));
  }

  // Someone else (usually a worker) may edit the open file: reload quietly when clean, warn when dirty.
  async poll() {
    if (!this.visible || !this.root.offsetParent) return;
    const tab = this.tab(); if (!tab) return;
    const m = await this.api.fsMtime({ root: this.rootId, path: tab.path });
    if (typeof m !== 'number' || !m || m === tab.mtime) return;
    if (tab.dirty) { const b = this.root.querySelector('#edBanner'); b.innerHTML = `${tt('Dosya diskte değişti.', 'The file changed on disk.')} <button class="link" data-ed="reload">${tt('Diskten yeniden yükle', 'Reload from disk')}</button>`; b.classList.remove('hidden'); return; }
    await this.reload();
  }

  async reload() {
    const tab = this.tab(); if (!tab) return;
    const r = await this.api.fsRead({ root: this.rootId, path: tab.path });
    if (r?.error || r.binary || r.tooBig) return;
    const head = this.cm.state.selection.main.head;
    this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: r.text }, selection: { anchor: Math.min(head, r.text.length) } });
    tab.orig = r.text; tab.mtime = r.mtime; tab.dirty = false; this.drawTabs();
    this.root.querySelector('#edBanner').classList.add('hidden');
  }

  sendDialog() {
    const tab = this.tab(); if (!tab) return;
    const sel = this.cm.state.selection.main, doc = this.cm.state.doc;
    const a = doc.lineAt(sel.from), b = doc.lineAt(sel.to);
    const code = sel.empty ? a.text : doc.sliceString(sel.from, sel.to);
    const ws = this.workers();
    if (!ws.length) return this.toast(tt('Ofiste çalışan yok.', 'No workers in the office.'), 'err');
    const box = this.root.querySelector('#edBanner');
    box.innerHTML = `<div class="ed-send"><b>${esc(tab.path)}:${a.number}${b.number !== a.number ? `-${b.number}` : ''}</b><pre>${esc(code.slice(0, 240))}${code.length > 240 ? '…' : ''}</pre>
      <div class="row"><select id="edTo">${ws.map((w) => `<option value="${esc(w.id)}">${esc(w.name)} · ${esc(w.role)}</option>`).join('')}</select><input id="edCm" placeholder="${tt('Ne yapılsın? (örn. bunu sadeleştir, test ekle)', 'What should they do? (e.g. simplify, add a test)')}"><button class="btn small primary" data-ed="go">${tt('Gönder', 'Send')}</button><button class="btn small" data-ed="x">✕</button></div></div>`;
    box.classList.remove('hidden');
    this.pending = { file: tab.path, from: a.number, to: b.number, code };
    box.querySelector('#edCm').focus();
    box.querySelector('#edCm').onkeydown = (e) => { if (e.key === 'Enter') this.sendNow(); };
  }

  async sendNow() {
    const box = this.root.querySelector('#edBanner');
    const r = await this.api.editorSend({ worker: box.querySelector('#edTo').value, comment: box.querySelector('#edCm').value, ...this.pending });
    if (r?.error) return this.toast(r.error, 'err');
    box.classList.add('hidden'); this.toast(tt('Çalışana iletildi', 'Sent to the worker'));
  }

  click(e) {
    const row = e.target.closest('.ed-row');
    if (row) {
      if (row.dataset.dir === '1') { const p = row.dataset.path; this.open.has(p) ? this.open.delete(p) : this.open.add(p); if (!this.tree.has(p)) this.loadDir(p); else this.drawTree(); }
      else this.openFile(row.dataset.path);
      return;
    }
    const cl = e.target.closest('[data-close]'); if (cl) { e.stopPropagation(); return this.closeTab(cl.dataset.close); }
    const tb = e.target.closest('[data-tab]'); if (tb) return this.switchTo(tb.dataset.tab);
    const act = e.target.closest('[data-ed]')?.dataset.ed;
    if (act === 'save') this.save();
    if (act === 'send') this.sendDialog();
    if (act === 'go') this.sendNow();
    if (act === 'x') this.root.querySelector('#edBanner').classList.add('hidden');
    if (act === 'reload') this.reload();
  }
}
