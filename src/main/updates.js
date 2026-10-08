'use strict';
// Update check against a feed the owner configures: either a small JSON
// ({ version, url, notes }) or a GitHub "latest release" API address.

function parse(v) { return String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0); }
function compareVersions(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

function normalize(data) {
  const d = Array.isArray(data) ? data[0] : data;
  if (!d || typeof d !== 'object') return null;
  const version = d.version || d.tag_name;
  if (!version) return null;
  return { version: String(version).replace(/^v/i, ''), url: d.url || d.html_url || d.download || '', notes: String(d.notes || d.body || '').slice(0, 2000) };
}

async function check(feed, current, fetchFn = globalThis.fetch) {
  if (!/^https?:\/\//i.test(feed || '')) throw new Error('Güncelleme adresi (http/https) girilmemiş.');
  const res = await fetchFn(feed, { headers: { accept: 'application/json', 'user-agent': 'AgentOffice' } });
  if (!res.ok) throw new Error(`Güncelleme adresi ${res.status} döndü.`);
  const info = normalize(await res.json());
  if (!info) throw new Error('Adresten sürüm bilgisi okunamadı (version ya da tag_name bekleniyor).');
  return { ...info, current, newer: compareVersions(info.version, current) > 0 };
}

module.exports = { compareVersions, normalize, check };
