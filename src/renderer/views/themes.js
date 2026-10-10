// App colour themes. A theme is a set of CSS variables on <html> plus a terminal palette;
// the choice lives in localStorage and is applied before the first paint.
export const THEMES = {
  gece: { name: 'Gece', vars: {} },
  derin: { name: 'Derin', vars: { bg: '#070912', panel: '#0c0f1d', panel2: '#131730', panel3: '#1a1f40', line: '#1d2242', line2: '#2c3566', 'term-bg': '#04050c' } },
  komur: { name: 'Kömür', vars: { bg: '#141414', panel: '#1a1a1a', panel2: '#232323', panel3: '#2c2c2c', line: '#2e2e2e', line2: '#464646', 'term-bg': '#0d0d0d', text: '#ececec', muted: '#a0a0a0', muted2: '#a0a0a0', accent: '#f2b24c', 'accent-ink': '#2a1c00' } },
  fosfor: { name: 'Fosfor', vars: { bg: '#07110b', panel: '#0b1a11', panel2: '#11261a', panel3: '#173323', line: '#1a3a26', line2: '#2a5a3c', 'term-bg': '#040a06', text: '#d4f5dd', muted: '#7fb893', muted2: '#7fb893', accent: '#4ade80', 'accent-ink': '#04210f' } },
  kagit: { light: true, name: 'Kağıt', vars: { bg: '#f3f1ec', panel: '#fbfaf7', panel2: '#ebe8e1', panel3: '#e2ded5', line: '#d9d5cb', line2: '#bfb9ab', 'term-bg': '#fffefa', text: '#26231f', muted: '#6e675c', muted2: '#6e675c', accent: '#3d4fd8', 'accent-ink': '#ffffff', green: '#0b7a4a', yellow: '#955800', red: '#c02838', blue: '#2a62c9', purple: '#6b46e0' } },
  gunduz: { light: true, name: 'Gündüz', vars: { bg: '#eceff8', panel: '#fbfbff', panel2: '#f3f4fb', panel3: '#e6e9f6', line: '#dde0ef', line2: '#c3c8e4', 'term-bg': '#f6f7fd', text: '#141833', muted: '#585f82', muted2: '#585f82', accent: '#4b55d6', 'accent-ink': '#ffffff', green: '#0b7a4a', yellow: '#955800', red: '#c02838', blue: '#2a62c9', purple: '#6b46e0' } },
};
const KEY = 'ao.theme';
const DARK_ANSI = { black: '#2b2622', red: '#ff7a85', green: '#4ade9a', yellow: '#fbbf4d', blue: '#6aa5ff', magenta: '#9a7bff', cyan: '#7ad7c0', white: '#eef0fb', brightBlack: '#6b7194', brightRed: '#ff9aa3', brightGreen: '#7af0b8', brightYellow: '#ffd97a', brightBlue: '#8fbcff', brightMagenta: '#b9a0ff', brightCyan: '#9eeadb', brightWhite: '#ffffff' };
const LIGHT_ANSI = { black: '#26231f', red: '#c02838', green: '#0b7a4a', yellow: '#955800', blue: '#2a62c9', magenta: '#6b46e0', cyan: '#0a7893', white: '#8a8f9f', brightBlack: '#6e675c', brightRed: '#d63a4a', brightGreen: '#12945c', brightYellow: '#b06c00', brightBlue: '#3b78e0', brightMagenta: '#8460f0', brightCyan: '#1090b0', brightWhite: '#26231f' };

export const currentTheme = () => { try { return THEMES[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : 'gece'; } catch { return 'gece'; } };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();

export function termTheme() {
  const t = THEMES[currentTheme()];
  return { ...(t.light ? LIGHT_ANSI : DARK_ANSI), background: cssVar('term-bg'), foreground: cssVar('text'), cursor: cssVar('accent'), cursorAccent: cssVar('term-bg'), selectionBackground: t.light ? 'rgba(75,85,214,0.22)' : 'rgba(141,155,255,0.3)' };
}

export function applyTheme(key = currentTheme()) {
  const t = THEMES[key] || THEMES.gece;
  const root = document.documentElement;
  for (const k of Object.keys(THEMES.komur.vars).concat(Object.keys(THEMES.kagit.vars), Object.keys(THEMES.derin.vars))) root.style.removeProperty(`--${k}`);
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v);
  root.dataset.appTheme = key;
  root.style.colorScheme = t.light ? 'light' : 'dark';
  try { localStorage.setItem(KEY, key); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent('themechange', { detail: key }));
}
