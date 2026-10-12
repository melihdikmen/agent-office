// A terminal in its own window: one Panes view bound to the same pty as the main window.
import { Panes } from './views/terminal.js';
import { initI18n } from './i18n.js';

const api = window.office;
const id = new URLSearchParams(location.search).get('id');
let lang = 'tr';
try { lang = localStorage.getItem('ao.lang') === 'en' ? 'en' : 'tr'; } catch { /* storage blocked */ }
initI18n(lang);

const panes = new Panes(document.getElementById('panes'), api, { onFocus: () => {}, onClose: () => window.close() });
let opened = false;
const apply = (st) => {
  const workers = st.active?.workers || [];
  panes.setMeta(st.terminals || [], workers, st.workspaces?.length);
  const t = (st.terminals || []).find((x) => x.id === id);
  if (t) document.title = t.project?.name ? `${t.title || 'Terminal'} · ${t.project.name}` : t.title || 'Terminal';
  if (!opened && t) { opened = true; panes.open(id); }
  if (opened && !t) window.close();                       // the terminal is gone
};
api.on('state', apply);
api.state().then(apply);
window.addEventListener('beforeunload', () => {});
