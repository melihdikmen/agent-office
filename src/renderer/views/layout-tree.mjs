// Pure helpers for the terminal split tree: { leaf } | { dir, ratio, a, b }.

// Drop leaves that no longer exist; a split with one survivor collapses into it.
export function pruneTree(n, alive) {
  if (!n || typeof n !== 'object') return null;
  if (n.leaf) return alive.has(n.leaf) ? { leaf: n.leaf } : null;
  const a = pruneTree(n.a, alive), b = pruneTree(n.b, alive);
  if (!a || !b) return a || b;
  const dir = n.dir === 'col' ? 'col' : 'row';
  const ratio = Number.isFinite(n.ratio) ? Math.max(0.15, Math.min(0.85, n.ratio)) : 0.5;
  return { dir, ratio, a, b };
}

// Parse a saved value defensively; never throws.
export function parseSaved(raw) {
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
