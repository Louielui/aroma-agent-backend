'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createGateway, OWNER } = require('./governed')
const { createTestStore } = require('./structuredStore')
const source = { kind: 'owner', id: 'test-source', at: '2026-09-29T00:00:00.000Z', attribution: 'owner_statement' }
function fixture() {
  const store = createTestStore(); const calls = []
  const engine = { forScope: scope => ({ retain: async (id, text) => { calls.push(scope); return { id, text, facts: 1 } }, recall: async () => [], forget: async () => ({ state: 'deleted' }) }) }
  return { store, calls, g: createGateway({ store, engine }) }
}
test('approval, supersession and canonical decisions survive a new gateway instance', async () => {
  const { g, store } = fixture()
  const a = await g.propose(OWNER, { type: 'decision', subject: 'cost conversion', text: 'Use verified weight.', scope: 'domain:accounting', source })
  assert.equal((await g.getDecision(OWNER, a.subject, a.scope)), null)
  const active = await g.transition(OWNER, a.id, a.version, 'approve')
  assert.equal(active.decidedBy, 'owner'); assert.ok(active.decidedAt)
  const b = await g.propose(OWNER, { type: 'decision', subject: a.subject, text: 'Use the corrected verified package weight.', scope: a.scope, source, supersedes: a.id })
  await assert.rejects(g.transition({ id: 'purchasing', role: 'agent' }, b.id, b.version, 'approve'))
  await g.transition(OWNER, b.id, b.version, 'approve')
  const next = createGateway({ store, engine: null })
  assert.equal((await next.getDecision(OWNER, a.subject, a.scope)).id, b.id)
  assert.equal((await next.get(OWNER, a.id)).status, 'superseded')
  await assert.rejects(g.transition(OWNER, b.id, b.version, 'archive'), /conflict/)
  assert.ok((await g.audit(OWNER, a.id)).length >= 3)
})
test('private and HR evidence never crosses a purchasing scope; proposals are not decisions', async () => {
  const { g, calls } = fixture()
  await g.propose(OWNER, { type: 'preference', subject: 'private', text: 'Owner private note.', scope: 'private:owner', source })
  const hr = await g.propose(OWNER, { type: 'episodic', subject: 'HR', text: 'Private employee matter.', scope: 'domain:hr', source })
  await g.transition(OWNER, hr.id, hr.version, 'approve')
  await g.grant(OWNER, { id: 'purchasing', scopes: ['domain:purchasing'], writeScopes: ['domain:purchasing'] })
  const agent = { id: 'purchasing', role: 'agent' }
  assert.deepEqual(await g.list(agent), [])
  await assert.rejects(g.get(agent, hr.id), /permission/)
  await assert.rejects(g.recall(agent, 'private', { scope: 'domain:hr' }), /permission/)
  assert.equal(calls.length, 0)
})
test('failed indexing keeps raw history searchable; temporary work expires; archive excludes recall', async () => {
  const { g } = fixture()
  const r = await g.observe(OWNER, { type: 'episodic', subject: 'Failure', text: 'The lavender folder test failed before reply.', scope: 'private:owner', source: { ...source, kind: 'conversation' }, policy: 'owner_history' })
  assert.equal(r.status, 'active')
  const found = await g.recall(OWNER, 'lavender')
  assert.equal(found[0].documentId, r.id)
  await g.transition(OWNER, r.id, r.version, 'archive')
  assert.equal((await g.recall(OWNER, 'lavender')).length, 0)
  const w = await g.working(OWNER, { subject: 'QA run', goal: 'Verify P1', project: 'Aroma', worker: 'codex', runId: 'QA-1', context: ['source-1'], ttlSeconds: 1, scope: 'private:owner' })
  assert.equal(w.details.goal, 'Verify P1')
  await g.finishWork(OWNER, w.id, w.version, 'failed')
  assert.equal((await g.get(OWNER, w.id)).status, 'archived')
})
test('external observations require approval; opt-out does not retain content; no fabricated confidence', async () => {
  const { g } = fixture()
  const r = await g.observe(OWNER, { type: 'episodic', subject: 'Supplier claim', text: 'Prices may increase next week.', scope: 'domain:purchasing', source: { ...source, kind: 'email', attribution: 'external_claim' } })
  assert.equal(r.status, 'candidate'); assert.equal(r.confidence, null)
  await assert.rejects(g.observe(OWNER, { type: 'decision', subject: 'claim', text: 'Use median.', scope: 'domain:purchasing', source, policy: 'owner_history' }))
  const ignored = await g.observe(OWNER, { type: 'episodic', subject: 'opt out', text: 'Do not remember this message.', scope: 'private:owner', source: { ...source, kind: 'conversation' }, policy: 'owner_history' })
  assert.equal(ignored.status, 'ignored'); assert.equal(ignored.text, '')
})
test('reflection remains a candidate, stale evidence prevents approval, and SOPs require canonical version links', async () => {
  const store = createTestStore(); let reflected = 0
  const engine = { forScope: () => ({ reflect: async (q, evidence) => { reflected++; assert.equal(evidence.length, 1); return { text: 'Use verified package weight; this is a proposed lesson.' } }, recall: async () => [] }) }
  const g = createGateway({ store, engine })
  const evidence = await g.propose(OWNER, { type: 'episodic', subject: 'QA failure', text: 'Count-to-mass comparison failed without verified package weight.', scope: 'domain:development', source })
  const approved = await g.transition(OWNER, evidence.id, evidence.version, 'approve')
  const model = await g.reflect(OWNER, { query: 'What can we learn?', subject: 'Costing lesson', scope: approved.scope, evidenceIds: [approved.id] })
  assert.equal(reflected, 1); assert.equal(model.status, 'candidate'); assert.equal(model.details.mentalModel, true)
  await g.transition(OWNER, approved.id, approved.version, 'archive')
  await assert.rejects(g.transition(OWNER, model.id, model.version, 'approve'), /stale_evidence/)
  await assert.rejects(g.propose(OWNER, { type: 'procedural', subject: 'SOP', text: 'Use the official SOP.', scope: 'domain:operations', source }), /sop_link/)
  const sop = await g.propose(OWNER, { type: 'procedural', subject: 'SOP', text: 'Use the official SOP.', scope: 'domain:operations', source: { ...source, url: 'https://drive.google.com/file/d/test/view', version: 'v2' } })
  assert.equal(sop.source.version, 'v2')
})
test('revocation during semantic retrieval cannot leak a previously authorized result', async () => {
  const store = createTestStore(); let g
  const engine = { forScope: () => ({ recall: async () => { await g.grant(OWNER, { id: 'buyer', scopes: [], writeScopes: [], revoked: true }); return [] } }) }
  g = createGateway({ store, engine })
  const r = await g.propose(OWNER, { type: 'preference', subject: 'Supplier', text: 'Preferred supplier.', scope: 'domain:purchasing', source })
  await g.transition(OWNER, r.id, r.version, 'approve')
  const grant = await g.grant(OWNER, { id: 'buyer', scopes: ['domain:purchasing'], writeScopes: [] })
  const actor = await g.authenticate(grant.token)
  await assert.rejects(g.recall(actor, 'supplier'), /permission/)
  await assert.rejects(g.authenticate(grant.token), /permission/)
})
test('working memory expiry cannot become a permanent fact; only gateway modules access Hindsight in agent paths', async () => {
  let now = '2026-09-29T00:00:00.000Z'
  const g = createGateway({ store: createTestStore(), engine: null, clock: () => now })
  const r = await g.working(OWNER, { subject: 'QA', goal: 'Run QA', runId: 'run-expiry', scope: 'private:owner', ttlSeconds: 1 })
  now = '2026-09-29T00:00:02.000Z'
  assert.equal((await g.recall(OWNER, 'QA')).length, 0)
  assert.equal((await g.get(OWNER, r.id)).expiresAt, '2026-09-29T00:00:01.000Z')
  const fs = require('node:fs'); const path = require('node:path')
  function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(path.join(dir, f.name)) : [path.join(dir, f.name)]) }
  for (const dir of ['agent', 'intake', 'context']) for (const file of walk(path.join(__dirname, '..', dir)).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\(['"][^'"]*memory\/hindsight['"]\)/, file)
  }
})

test('index metadata does not invalidate reflection evidence, but archiving does', async () => {
  const store = createTestStore()
  const engine = { forScope: () => ({ reflect: async () => ({ text: 'A proposed source-grounded lesson.' }), retain: async () => ({ facts: 1 }) }) }
  const g = createGateway({ store, engine })
  const proposed = await g.propose(OWNER, { type: 'episodic', subject: 'QA', text: 'A measured QA result.', scope: 'domain:development', source })
  const evidence = await g.transition(OWNER, proposed.id, proposed.version, 'approve')
  const model = await g.reflect(OWNER, { query: 'What happened?', subject: 'QA lesson', scope: evidence.scope, evidenceIds: [evidence.id] })
  const indexed = await g.index(OWNER, evidence.id)
  await g.transition(OWNER, model.id, model.version, 'approve')
  assert.deepEqual((await g.status(OWNER)).staleModels, [])
  await g.transition(OWNER, evidence.id, indexed.version, 'archive')
  assert.deepEqual((await g.status(OWNER)).staleModels, [model.id])
})

test('excluded content cannot survive in the subject or source identifier', async () => {
  const { g, store } = fixture()
  const secret = 'password: this-is-a-private-password'
  const row = await g.propose(OWNER, { type: 'episodic', subject: secret, text: 'A routine observation.', scope: 'private:owner', source: { ...source, id: secret } })
  assert.equal(row.status, 'ignored')
  assert.ok(!JSON.stringify(await store.all()).includes(secret))
})
