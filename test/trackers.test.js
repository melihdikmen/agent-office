'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { linearIssues, jiraIssues, adfText } = require('../src/main/trackers');

const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('linear: maps issues and sends the key as the Authorization header', async () => {
  let seen;
  const f = async (url, init) => { seen = { url, auth: init.headers.authorization, q: JSON.parse(init.body).query }; return { ok: true, status: 200, json: async () => ({ data: { issues: { nodes: [{ identifier: 'ENG-12', title: 'Giriş hatası', description: 'ayrıntı', url: 'https://linear.app/x/ENG-12', state: { name: 'Todo' } }] } } }) }; };
  const r = await linearIssues('lin_api_123', f);
  assert.deepEqual(r, [{ key: 'ENG-12', title: 'Giriş hatası', body: 'ayrıntı', url: 'https://linear.app/x/ENG-12', status: 'Todo' }]);
  assert.equal(seen.auth, 'lin_api_123');
  assert.match(seen.q, /backlog/);
  await assert.rejects(() => linearIssues('x', async () => ({ ok: false, status: 401 })), /geçersiz/);
  await assert.rejects(() => linearIssues('x', ok({ errors: [{ message: 'nope' }] })), /nope/);
});

test('jira: basic auth, ADF description flattened, site normalised', async () => {
  let seen;
  const f = async (url, init) => { seen = { url, auth: init.headers.authorization }; return { ok: true, status: 200, json: async () => ({ issues: [{ key: 'PRJ-5', fields: { summary: 'Rapor sayfası', status: { name: 'In Progress' }, description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Birinci' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'İkinci' }] }] } } }] }) }; };
  const r = await jiraIssues({ site: 'https://acme.atlassian.net/jira', email: 'a@b.c', token: 'tok' }, '', f);
  assert.equal(r[0].key, 'PRJ-5');
  assert.equal(r[0].body, 'Birinci\nİkinci');
  assert.equal(r[0].url, 'https://acme.atlassian.net/browse/PRJ-5');
  assert.match(seen.url, /^https:\/\/acme\.atlassian\.net\/rest\/api\/3\/search\/jql\?jql=/);
  assert.equal(seen.auth, `Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
  await assert.rejects(() => jiraIssues({ site: '', email: '', token: '' }), /site adresi/);
  await assert.rejects(() => jiraIssues({ site: 'x.atlassian.net', email: 'a', token: 'b' }, '', async () => ({ ok: false, status: 401 })), /geçersiz/);
});

test('adfText handles plain strings and empty input', () => { assert.equal(adfText('düz'), 'düz'); assert.equal(adfText(null), ''); });
