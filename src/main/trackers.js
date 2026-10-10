'use strict';
// Issue trackers to import tasks from: Linear (GraphQL, personal API key) and Jira Cloud
// (REST, email + API token). Read-only: nothing is written back to the tracker.

const clip = (s, n) => String(s ?? '').trim().slice(0, n);

// Jira descriptions come as Atlassian Document Format (a JSON tree); flatten to text.
function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content || []).map(adfText).join(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type) ? '' : '');
  return ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type) ? `${inner}\n` : inner;
}

async function linearIssues(apiKey, fetchFn = globalThis.fetch) {
  const res = await fetchFn('https://api.linear.app/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: apiKey },
    body: JSON.stringify({ query: '{ issues(first: 40, filter: { state: { type: { in: ["backlog","unstarted","started"] } } }, orderBy: updatedAt) { nodes { identifier title description url state { name } } } }' }),
  });
  if (res.status === 401 || res.status === 400) throw new Error('Linear anahtarı geçersiz.');
  if (!res.ok) throw new Error(`Linear ${res.status} döndü.`);
  const j = await res.json();
  if (j.errors?.length) throw new Error(`Linear: ${j.errors[0].message}`);
  return (j.data?.issues?.nodes || []).map((i) => ({ key: i.identifier, title: clip(i.title, 200), body: clip(i.description, 1500), url: i.url, status: i.state?.name || '' }));
}

async function jiraIssues({ site, email, token }, jql, fetchFn = globalThis.fetch) {
  const host = String(site || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) throw new Error('Jira site adresi gerekli (örn. sirket.atlassian.net).');
  const q = jql || 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
  const url = `https://${host}/rest/api/3/search/jql?jql=${encodeURIComponent(q)}&maxResults=40&fields=summary,description,status`;
  const res = await fetchFn(url, { headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` } });
  if (res.status === 401 || res.status === 403) throw new Error('Jira e-posta / API token geçersiz.');
  if (!res.ok) throw new Error(`Jira ${res.status} döndü.`);
  const j = await res.json();
  return (j.issues || []).map((i) => ({ key: i.key, title: clip(i.fields?.summary, 200), body: clip(adfText(i.fields?.description), 1500), url: `https://${host}/browse/${i.key}`, status: i.fields?.status?.name || '' }));
}

module.exports = { linearIssues, jiraIssues, adfText };
