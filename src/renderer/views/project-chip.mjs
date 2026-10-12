// The "which project does this terminal belong to" chip: name shortening and a stable color.
export const MAX_NAME = 18;
const PALETTE = ['#6ea8ff', '#7ad7a0', '#f2c94c', '#c58bf2', '#f28b6a', '#7ad7c0', '#ff8fb1', '#a6b3ff'];

export function shortName(name, max = MAX_NAME) {
  const s = String(name ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// Same name → same color, always (FNV-1a over the name, folded into the palette).
export function projectColor(name) {
  let h = 2166136261;
  for (const ch of String(name ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return PALETTE[h % PALETTE.length];
}

const base = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();

// project: { name, dir, color? } or null. Agents show the office name; plain shells the folder name.
// Returns null when there is nothing to show.
export function chipModel(project, { shell = false, multi = false } = {}) {
  if (!project || !project.name) return null;
  const folder = base(project.dir);
  const label = shell ? (folder || project.name) : project.name;
  return {
    icon: shell ? '⌂' : '📁',
    label: shortName(label),
    full: label,
    path: project.dir && (shell || folder !== project.name) ? project.dir : '',
    color: project.color || projectColor(project.name),
    dim: !multi,                          // a single office: shown, but quiet
  };
}
