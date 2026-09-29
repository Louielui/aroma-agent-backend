'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createGateway, OWNER } = require('./governed')
const { createTestStore } = require('./structuredStore')
function setup(extract) {
  const store = createTestStore(); let calls = 0
  const g = createGateway({ store, engine: { forScope: () => ({ consolidate: async (...args) => { calls++; return extract(...args) }, recall: async () => [] }) } })
  const event = (id, text, attribution = 'owner_statement') => g.observe(OWNER, { type: 'episodic', subject: id, text, scope: 'private:owner', policy: 'owner_history', source: { kind: 'conversation', id, at: '2026-09-29T00:00:00Z', attribution } })
  return { g, store, event, calls: () => calls }
}
const suggestion = (kind, quote, extra = {}) => ({ kind, subject: 'Folder colour', text: quote, reason: 'Explicit source statement.', quote, supersedes: null, taskState: null, ...extra })
test('four kinds become grounded candidates atomically, never approved or executable', async () => {
  const { g, event, calls } = setup(s => ({ candidates: ['preference','decision','experience','todo'].map(kind => suggestion(kind, s.text, kind === 'todo' ? { taskState: 'open' } : {})) }))
  const source = await event('four-kinds', 'Use green folders. Review this later.')
  const result = await g.consolidate(OWNER, source.id)
  assert.equal(result.state, 'done'); assert.equal(result.candidateIds.length, 4)
  for (const id of result.candidateIds) {
    const r = await g.get(OWNER, id); assert.equal(r.status, 'candidate'); assert.equal(r.approval, null)
    assert.equal(r.details.quote, source.text); assert.equal(r.source.at, source.source.at)
    assert.equal(r.source.attribution, 'derived'); assert.equal(r.details.evidenceVersions[0].id, source.id)
  }
  assert.equal((await g.recall(OWNER, 'green')).filter(r => r.type !== 'episodic').length, 0)
  await g.consolidate(OWNER, source.id); assert.equal(calls(), 1)
})
test('correction requires approval and retains the old version; index changes do not stale evidence', async () => {
  let old
  const { g, event } = setup(s => ({ candidates: [suggestion('preference', s.text, { supersedes: old?.id || null })] }))
  const first = await event('initial', 'Use blue folders.')
  const a = await g.consolidate(OWNER, first.id); old = await g.get(OWNER, a.candidateIds[0])
  old = await g.transition(OWNER, old.id, old.version, 'approve')
  const changed = await event('changed', 'Use green folders instead.')
  const b = await g.consolidate(OWNER, changed.id); const candidate = await g.get(OWNER, b.candidateIds[0])
  assert.equal((await g.get(OWNER, old.id)).status, 'active')
  assert.equal(candidate.details.replaces.text, 'Use blue folders.')
  await g.index(OWNER, changed.id)
  await g.transition(OWNER, candidate.id, candidate.version, 'approve')
  assert.equal((await g.get(OWNER, old.id)).status, 'superseded')
  assert.equal((await g.get(OWNER, old.id)).supersededBy, candidate.id)
  assert.equal((await g.recall(OWNER, 'folders'))[0].id, candidate.id)
})
test('unsupported quotes and assistant claims cannot create grounded preferences', async () => {
  const { g, event } = setup(() => ({ candidates: [suggestion('preference', 'Not in source.')] }))
  const s = await event('bad-quote', 'Use green folders.')
  const result = await g.consolidate(OWNER, s.id)
  assert.equal(result.state, 'failed'); assert.equal(result.error, 'invalid_consolidation')
  assert.equal((await g.list(OWNER)).length, 1)
  const assistant = await event('assistant', 'The owner prefers red.', 'assistant_claim')
  await assert.rejects(g.consolidate(OWNER, assistant.id), /not_consolidatable/)
  await assert.rejects(g.consolidate({ id: 'agent', role: 'agent' }, s.id), /permission_denied/)
})
test('archived evidence prevents both proposal generation and later approval', async () => {
  const { g, event } = setup(s => ({ candidates: [suggestion('experience', s.text)] }))
  const s = await event('lesson', 'The verification failed because the sample was missing.')
  const result = await g.consolidate(OWNER, s.id); const row = await g.get(OWNER, result.candidateIds[0])
  const source = await g.get(OWNER, s.id); await g.transition(OWNER, s.id, source.version, 'archive')
  await assert.rejects(g.transition(OWNER, row.id, row.version, 'approve'), /stale_evidence/)
})
test('failure state is durable and sanitized; no extraction is a measured empty result', async () => {
  const { g, event } = setup(() => { throw Error('provider-secret-content') })
  const s = await event('failure', 'Use green folders.')
  const failed = await g.consolidate(OWNER, s.id)
  assert.equal(failed.state, 'failed'); assert.equal(failed.attempts, 1); assert.ok(failed.nextRetryAt)
  assert.ok(!JSON.stringify(await g.get(OWNER, s.id)).includes('provider-secret-content'))
  const f = setup(() => ({ candidates: [] })); const greeting = await f.event('greeting', 'Hello there.')
  assert.equal((await f.g.consolidate(OWNER, greeting.id)).state, 'empty')
})
test('two approved preferences for the same subject are refused without supersession', async () => {
  const { g, event } = setup(s => ({candidates:[suggestion('preference',s.text)]}))
  const a=await event('a','Use blue folders.'); const b=await event('b','Use green folders.')
  const [pa,pb]=await Promise.all([g.consolidate(OWNER,a.id),g.consolidate(OWNER,b.id)])
  const ra=await g.get(OWNER,pa.candidateIds[0]),rb=await g.get(OWNER,pb.candidateIds[0])
  await g.transition(OWNER,ra.id,ra.version,'approve')
  await assert.rejects(g.transition(OWNER,rb.id,rb.version,'approve'),/decision_conflict/)
})
test('source withdrawal during extraction commits no candidates',async()=>{
  let g
  const f=setup(async s=>{const latest=await g.get(OWNER,s.id);await g.transition(OWNER,s.id,latest.version,'archive');return{candidates:[suggestion('preference',s.text)]}});g=f.g
  const s=await f.event('withdrawn','Use green folders.');const result=await g.consolidate(OWNER,s.id)
  assert.equal(result.state,'failed');assert.equal(result.error,'stale_evidence');assert.equal((await g.list(OWNER)).length,1)
})
