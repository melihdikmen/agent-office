// Code editor: project (or a worker's worktree) file tree, tabs, CodeMirror with syntax colours,
// ⌘S to save, quick file search, and "send to a worker": selection or line + a comment.
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap, foldAll, unfoldAll } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, openSearchPanel, gotoLine } from '@codemirror/search';
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
  '&': { height: '100%', backgroundColor: 'var(--term-bg)', color: 'var(--text)', fontSize: 'var(--ed-fs, 12.5px)' },
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
    this.lang = new Compartment(); this.wrapC = new Compartment();
    this.wrap = false; this.size = 12.5;
    root.innerHTML = `<div class="ed">
      <aside class="ed-tree"><div class="ed-tools"><select id="edRoot"></select><input id="edQ" type="search" placeholder="${tt('dosya ara…', 'find file…')}" spellcheck="false">
        <div class="ed-ibar"><button data-ed="newfile" title="${tt('Yeni dosya', 'New file')}">＋ ${tt('Dosya', 'File')}</button><button data-ed="newdir" title="${tt('Yeni klasör', 'New folder')}">＋ ${tt('Klasör', 'Folder')}</button><button data-ed="refresh" title="${tt('Ağacı yenile', 'Refresh tree')}">↻</button><button data-ed="collapse" title="${tt('Tüm klasörleri kapat', 'Collapse all')}">⊟</button></div></div><div id="edFiles" class="ed-files"></div></aside>
      <section class="ed-main"><div id="edTabs" class="ed-tabs"></div>
        <div class="ed-bar">
          <button data-ed="undo" title="${tt('Geri al', 'Undo')} ⌘Z">↶</button><button data-ed="redo" title="${tt('Yinele', 'Redo')} ⇧⌘Z">↷</button><i></i>
          <button data-ed="find" title="${tt('Bul / değiştir', 'Find / replace')} ⌘F">⌕ ${tt('Bul', 'Find')}</button><button data-ed="goto" title="${tt('Satıra git', 'Go to line')} ⌘G">⇥ ${tt('Satır', 'Line')}</button><i></i>
          <button data-ed="wrap" id="edWrap" title="${tt('Uzun satırları kaydır', 'Wrap long lines')}">↵ ${tt('Kaydır', 'Wrap')}</button><button data-ed="foldall" title="${tt('Tüm blokları katla', 'Fold all')}">⊟</button><button data-ed="unfoldall" title="${tt('Tüm blokları aç', 'Unfold all')}">⊞</button><button data-ed="smaller" title="${tt('Yazıyı küçült', 'Smaller text')}">A−</button><button data-ed="bigger" title="${tt('Yazıyı büyüt', 'Bigger text')}">A+</button><i></i>
          <button data-ed="copypath" title="${tt('Dosya yolunu kopyala', 'Copy file path')}">⧉ ${tt('Yol', 'Path')}</button><button data-ed="reveal" title="${tt('Finder\'da göster', 'Reveal in Finder')}">⌂ Finder</button><button data-ed="disk" title="${tt('Diskten yeniden yükle', 'Reload from disk')}">⟳</button>
          <span class="spacer"></span>
          <button data-ed="send" title="${tt('Seçili kodu (ya da satırı) bir çalışana yorumla gönder', 'Send the selection (or line) to a worker with a comment')}">✦ ${tt('Çalışana gönder', 'Send to worker')}</button><button data-ed="saveall" title="${tt('Tüm değişen sekmeleri kaydet', 'Save all changed tabs')}">${tt('Hepsini kaydet', 'Save all')}</button><button class="primary" data-ed="save" title="⌘S">${tt('Kaydet', 'Save')}</button></div>
        <div id="edBanner" class="ed-banner hidden"></div><div id="edHost" class="ed-host"></div>
        <div class="ed-foot"><span id="edPos" class="muted"></span><span id="edLang" class="muted"></span><span class="spacer"></span><span id="edSz" class="muted"></span></div></section></div>`;
    this.cm = new EditorView({ parent: root.querySelector('#edHost'), state: this.makeState('', 'txt') });
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('contextmenu', (e) => { const row = e.target.closest('.ed-row'); if (row) this.menu(e, row); });
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
      syntaxHighlighting(hl), theme, this.lang.of(l ? l() : []), this.wrapC.of(this.wrap ? EditorView.lineWrapping : []),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && this.active) { const tab = this.tab(); if (tab) { const d = u.state.doc.toString() !== tab.orig; if (d !== tab.dirty) { tab.dirty = d; this.drawTabs(); } } }
        if (u.selectionSet || u.docChanged) { const p = u.state.selection.main.head, ln = u.state.doc.lineAt(p); this.root.querySelector('#edLang').textContent = (this.active || '').split('.').pop().toUpperCase(); this.root.querySelector('#edPos').textContent = `${tt('Satır', 'Ln')} ${ln.number}, ${tt('Sütun', 'Col')} ${p - ln.from + 1}`; }
      }),
    ] });
  }

  tab() { return this.tabs.find((x) => x.path === this.active) || null; }

  // The office (project) changed: stash this project's tabs and tree, bring back the new one's (or start empty).
  setWorkspace(id) {
    if (this.wsId === id) return;
    const first = this.wsId === undefined;
    if (!first) {
      const cur = this.tab(); if (cur) cur.state = this.cm.state;
      (this.stash ||= new Map()).set(this.wsId, { rootId: this.rootId, tree: this.tree, open: this.open, tabs: this.tabs, active: this.active });
    }
    this.wsId = id;
    if (first) return;
    const back = this.stash?.get(id);
    this.rootId = back?.rootId || 'project'; this.tree = back?.tree || new Map(); this.open = back?.open || new Set(['']);
    this.tabs = back?.tabs || []; this.active = null; this.all = null; this.q = ''; this.roots = [];
    this.root.querySelector('#edQ').value = '';
    this.root.querySelector('#edBanner').classList.add('hidden');
    this.root.querySelector('#edFiles').innerHTML = ''; this.root.querySelector('#edRoot').innerHTML = '';
    const want = back?.active && this.tabs.some((x) => x.path === back.active) ? back.active : this.tabs[0]?.path;
    if (want) this.switchTo(want); else { this.cm.setState(this.makeState('', 'txt')); this.drawTabs(); this.showEmpty(); }
    if (this.visible) this.show(true);
  }

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

  // small inline question (prompt() does not exist in Electron renderers)
  ask(label, value = '') {
    return new Promise((res) => {
      const box = this.root.querySelector('#edBanner');
      box.innerHTML = `<div class="ed-send"><div class="row"><b>${esc(label)}</b><input id="edAsk" value="${esc(value)}" spellcheck="false"><button class="btn small primary" data-k="ok">OK</button><button class="btn small" data-k="no">✕</button></div></div>`;
      box.classList.remove('hidden');
      const inp = box.querySelector('#edAsk'); inp.focus(); inp.select();
      const done = (v) => { box.classList.add('hidden'); res(v); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); };
      box.onclick = (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k === 'ok') done(inp.value.trim() || null); if (k === 'no') done(null); };
    });
  }

  dirOf(p) { return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; }
  curDir() { const t = this.sel || this.active; return t ? (this.tree.get(t) ? t : this.dirOf(t)) : ''; }

  async create(isDir, base = this.curDir()) {
    const name = await this.ask(isDir ? tt('Yeni klasör adı', 'New folder name') : tt('Yeni dosya adı', 'New file name'), base ? `${base}/` : '');
    if (!name) return;
    const r = await this.api.fsCreate({ root: this.rootId, path: name, dir: isDir });
    if (r?.error) return this.toast(r.error, 'err');
    this.all = null;
    for (let d = this.dirOf(name); d; d = this.dirOf(d)) this.open.add(d);
    await this.refreshTree();
    if (!isDir) this.openFile(name);
  }

  async refreshTree() {
    const dirs = ['', ...[...this.open].filter((p) => p)];
    for (const d of dirs) { const r = await this.api.fsList({ root: this.rootId, path: d }); if (!r?.error) this.tree.set(d, r); }
    this.drawTree();
  }

  async rename(p) {
    const to = await this.ask(tt('Yeni ad / yol', 'New name / path'), p);
    if (!to || to === p) return;
    const r = await this.api.fsRename({ root: this.rootId, from: p, to });
    if (r?.error) return this.toast(r.error, 'err');
    for (const t of this.tabs) if (t.path === p || t.path.startsWith(`${p}/`)) t.path = to + t.path.slice(p.length);
    if (this.active && (this.active === p || this.active.startsWith(`${p}/`))) this.active = to + this.active.slice(p.length);
    this.all = null; this.drawTabs(); this.refreshTree();
  }

  async trash(p) {
    if (!confirm(tt(`${p} çöp kutusuna taşınsın mı?`, `Move ${p} to the Trash?`))) return;
    const r = await this.api.fsTrash({ root: this.rootId, path: p });
    if (r?.error) return this.toast(r.error, 'err');
    for (const t of [...this.tabs]) if (t.path === p || t.path.startsWith(`${p}/`)) { t.dirty = false; this.closeTab(t.path); }
    this.all = null; this.refreshTree();
  }

  async copyPath(p, abs = true) {
    const text = abs ? await this.api.fsAbs({ root: this.rootId, path: p }) : p;
    try { await navigator.clipboard.writeText(typeof text === 'string' ? text : p); this.toast(tt('Yol kopyalandı', 'Path copied')); } catch { this.toast(String(text), undefined); }
  }

  menu(e, row) {
    e.preventDefault();
    const p = row.dataset.path, dir = row.dataset.dir === '1';
    this.sel = p;
    const items = [
      [tt('Yeni dosya…', 'New file…'), () => this.create(false, dir ? p : this.dirOf(p))],
      [tt('Yeni klasör…', 'New folder…'), () => this.create(true, dir ? p : this.dirOf(p))],
      [tt('Yeniden adlandır…', 'Rename…'), () => this.rename(p)],
      [tt('Çöp kutusuna taşı', 'Move to Trash'), () => this.trash(p)],
      [tt('Yolu kopyala', 'Copy path'), () => this.copyPath(p)],
      [tt('Göreli yolu kopyala', 'Copy relative path'), () => this.copyPath(p, false)],
      [tt('Finder\'da göster', 'Reveal in Finder'), () => this.api.fsReveal({ root: this.rootId, path: p })],
      ...(dir ? [] : [[tt('Çalışana gönder…', 'Send to worker…'), async () => { await this.openFile(p); this.cm.dispatch({ selection: { anchor: 0 } }); this.sendDialog(); }]]),
    ];
    document.querySelector('.ed-ctx')?.remove();
    const m = document.createElement('div'); m.className = 'ed-ctx';
    m.innerHTML = items.map(([l], i) => `<button data-i="${i}">${esc(l)}</button>`).join('');
    m.style.left = `${Math.min(e.clientX, innerWidth - 200)}px`; m.style.top = `${Math.min(e.clientY, innerHeight - items.length * 30 - 10)}px`;
    m.onclick = (ev) => { const i = ev.target.closest('[data-i]')?.dataset.i; m.remove(); if (i != null) items[Number(i)][1](); };
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('pointerdown', () => m.remove(), { once: true }), 0);
  }

  toggleWrap() { this.wrap = !this.wrap; this.cm.dispatch({ effects: this.wrapC.reconfigure(this.wrap ? EditorView.lineWrapping : []) }); this.root.querySelector('#edWrap').classList.toggle('on', this.wrap); }
  setSize(d) { this.size = Math.max(9, Math.min(24, this.size + d)); this.root.querySelector('.ed-host').style.setProperty('--ed-fs', `${this.size}px`); this.root.querySelector('#edSz').textContent = `${this.size}px`; this.cm.requestMeasure(); }
  async saveAll() {
    const cur = this.active; let n = 0;
    for (const t of this.tabs.filter((x) => x.dirty)) { if (t.path !== cur) { /* other tabs hold their text in saved state */ const text = t.state.doc.toString(); const r = await this.api.fsWrite({ root: this.rootId, path: t.path, text }); if (!r?.error) { t.orig = text; t.mtime = r.mtime; t.dirty = false; n++; } } }
    if (this.tab()?.dirty) { await this.save(); n++; }
    this.drawTabs(); if (n) this.toast(tt(`${n} dosya kaydedildi`, `${n} files saved`));
  }

  click(e) {
    const row = e.target.closest('.ed-row');
    if (row) {
      this.sel = row.dataset.path;
      if (row.dataset.dir === '1') { const p = row.dataset.path; this.open.has(p) ? this.open.delete(p) : this.open.add(p); if (!this.tree.has(p)) this.loadDir(p); else this.drawTree(); }
      else this.openFile(row.dataset.path);
      return;
    }
    const cl = e.target.closest('[data-close]'); if (cl) { e.stopPropagation(); return this.closeTab(cl.dataset.close); }
    const tb = e.target.closest('[data-tab]'); if (tb) return this.switchTo(tb.dataset.tab);
    const act = e.target.closest('[data-ed]')?.dataset.ed;
    if (act === 'save') this.save();
    if (act === 'saveall') this.saveAll();
    if (act === 'undo') { undo(this.cm); this.cm.focus(); }
    if (act === 'redo') { redo(this.cm); this.cm.focus(); }
    if (act === 'find') { this.cm.focus(); openSearchPanel(this.cm); }
    if (act === 'goto') { this.cm.focus(); gotoLine(this.cm); }
    if (act === 'wrap') this.toggleWrap();
    if (act === 'foldall') foldAll(this.cm);
    if (act === 'unfoldall') unfoldAll(this.cm);
    if (act === 'smaller') this.setSize(-1);
    if (act === 'bigger') this.setSize(1);
    if (act === 'copypath' && this.active) this.copyPath(this.active);
    if (act === 'reveal') this.api.fsReveal({ root: this.rootId, path: this.active || '' });
    if (act === 'disk') this.reload();
    if (act === 'newfile') this.create(false);
    if (act === 'newdir') this.create(true);
    if (act === 'refresh') this.refreshTree();
    if (act === 'collapse') { this.open = new Set(['']); this.drawTree(); }
    if (act === 'send') this.sendDialog();
    if (act === 'go') this.sendNow();
    if (act === 'x') this.root.querySelector('#edBanner').classList.add('hidden');
    if (act === 'reload') this.reload();
  }
}
