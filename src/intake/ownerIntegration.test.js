'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-http-'))
process.env.AROMA_ARTIFACT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-artifacts-'))
test('R1 subscription facade verifies before inference and rejects returned identities without fallback', async () => {
  const { verifiedSubscription } = require('./ownerIntegration')
  const calls = [], choice = { model: 'gpt-6-astra', effort: 'high' }
  const request = async (route, input) => { calls.push({ route, input }); return { model: choice.model, billing: 'chatgpt-subscription', text: '{}', stopReason: 'end_turn' } }
  const adapter = verifiedSubscription(choice, { request })
  await assert.rejects(adapter.complete('x'), /preflight_required/)
  await adapter.preflight(); assert.equal(adapter.model, choice.model); assert.equal(adapter.billing, 'chatgpt-subscription')
  await adapter.complete('x'); assert.deepEqual(calls.map(c => c.route), ['/status', '/complete'])
  assert(calls.every(c => c.input.effort === 'high' && c.input.model === choice.model))
  const bad = verifiedSubscription(choice, { request: async () => ({ model: choice.model, billing: 'api' }) })
  await assert.rejects(bad.preflight()); await assert.rejects(bad.complete('x'), /preflight_required/)
  let changed = false
  const flip = verifiedSubscription(choice, { request: async () => ({ model: changed ? 'gpt-6.1-sol' : choice.model, billing: 'chatgpt-subscription', text: '{}', stopReason: 'end_turn' }) })
  await flip.preflight(); changed = true; await assert.rejects(flip.complete('x'))
})
for (const phase of ['status','complete']) test('R1 actual HTTP model/billing mismatch at ' + phase + ' prevents source access', async () => {
  const f=await require('../../scripts/r1/fixture.cjs').fixture({transport:async(route,input)=>({model:input.model,billing:route==='/'+phase?'paid-api':'chatgpt-subscription',text:'{}',stopReason:'end_turn'})})
  try { const r=await f.post(f.start); assert.notEqual(r.body.unifiedTask?.executionState,'WAITING_CLARIFICATION'); assert.equal(f.calls.length,0); assert.equal(f.modelCalls.filter(c=>c.route==='/status').length,1); assert(f.modelCalls.length<=2) }finally{await f.close()}
})
test('R1 Owner session revoked during a read discards its content and prevents follow-up access', async()=>{
  let f
  f=await require('../../scripts/r1/fixture.cjs').fixture({beforeRead:async()=>{await f.logout()}})
  try{await f.post(f.start);assert.equal(f.calls.length,1);const r=f.reads.all().at(-1);assert.equal(r.state,'failed');assert.equal(r.result,undefined)}finally{await f.close()}
})
test('R1 actual application login and Main Owner route preserve same-task five-read clarification and reject bearer/origin/session bypasses', async () => {
  const f = await require('../../scripts/r1/fixture.cjs').fixture()
  try {
    for (const headers of [{ cookie: '' }, { cookie: '', authorization: 'Bearer synthetic-service-token' }, { cookie: 'aroma_owner_session=invalid' }, { origin: 'http://evil.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
      const r = await f.post(f.start, headers); assert([401,403].includes(r.status)); assert.equal(f.calls.length, 0); assert.equal(f.modelCalls.length, 0)
    }
    const first = await f.post(f.start); assert.equal(first.status, 200, JSON.stringify(first.body)); const v = first.body.unifiedTask
    assert.equal(v.executionState, 'WAITING_CLARIFICATION', JSON.stringify({ body: first.body, records: f.reads.all(), modelCalls: f.modelCalls })); assert.equal(f.calls.length, 1)
    const body = f.reply(v), r = await f.post(body); assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.unifiedTask.executionState, 'CLARIFICATION_COMPLETED', JSON.stringify(r.body))
    assert.deepEqual(f.calls.map(c => c.operation), ['search','search','get','search','get'])
    assert.equal(f.calls[2].input.fileId, f.ids[1]); assert.equal(f.calls[3].input.query, 'INV-BLACK-29'); assert.equal(f.calls[4].input.sourceId, f.invoiceId)
    assert.equal(r.body.unifiedTask.taskId, v.taskId); assert.equal(r.body.unifiedTask.goalId, v.goalId)
    const record = f.reads.get(r.body.unifiedTask.executionRef.id)
    assert.equal(record.result.taskEvidence.selection.goal.goalId, v.goalId)
    assert.equal(r.body.unifiedTask.investigation.goalVerifiedComplete, false)
    assert.equal(r.body.unifiedTask.investigation.goal.goalId, v.goalId)
    assert.equal(r.body.unifiedTask.investigation.readState, 'retrieved')
    assert.equal(r.body.unifiedTask.investigation.groundedAnswer, true)
    assert.equal(r.body.unifiedTask.investigation.answerCoverage, 'partial_or_unknown')
    await f.post(body); assert.equal(f.calls.length, 5)
    assert(f.modelCalls.filter(c => c.route === '/status').length === 2)
  } finally { await f.close() }
})
for (const scenario of ['suspended','goal_not_shared','content_not_shared','source_not_shared','flag_off','expired_session','revoked','changed_candidate','cancelled','duplicate_concurrent','restart','missing_source_b']) test('R1 actual Main HTTP boundary: ' + scenario, async () => {
  const f = await require('../../scripts/r1/fixture.cjs').fixture({ flag: scenario !== 'flag_off', missingB: scenario === 'missing_source_b' })
  try {
    if (scenario === 'suspended') f.state.users[0].suspended = true
    if (scenario === 'goal_not_shared') process.env.OWNER_TASK_GOAL_SHARING = 'false'
    if (scenario === 'content_not_shared') process.env.OWNER_TASK_CONTENT_SHARING = 'false'
    if (scenario === 'source_not_shared') process.env.CONTEXT_DRIVE_OPENAI = 'off'
    if (scenario === 'expired_session') await f.logout()
    const first = await f.post(f.start)
    if (['suspended','goal_not_shared','content_not_shared','source_not_shared','flag_off','expired_session'].includes(scenario)) {
      assert.equal(f.calls.length, 0); assert.notEqual(first.body.unifiedTask?.executionState, 'WAITING_CLARIFICATION'); return
    }
    const v = first.body.unifiedTask; assert.equal(v.executionState, 'WAITING_CLARIFICATION')
    const body = f.reply(v)
    if (scenario === 'revoked') { f.state.users[0].grants = []; f.versions.drive++ }
    if (scenario === 'changed_candidate') f.rows['drive.company_files'][1].title = 'Changed title'
    if (scenario === 'cancelled') assert.equal((await f.cancel(v)).status, 200)
    if (scenario === 'restart') {
      // Real app reconstruction triggers existing startup reconciliation. It
      // must not dispatch or revive the persisted waiting task.
      f.app.createApp = require('../app').createApp
      f.app.createApp({ ownerPassword: 'synthetic-owner-password', serviceToken: 'synthetic-service-token', liveContext: f.liveContext, companyOptions: { registry: { snapshot: () => structuredClone(f.state) } } })
      assert.equal(f.calls.length, 1)
      // A fresh explicit authenticated reply is required after a waiting
      // restart; reconstruction itself performs no follow-up work.
      const fresh = await f.post(body); assert.equal(fresh.body.unifiedTask?.executionState, 'CLARIFICATION_COMPLETED'); assert.equal(f.calls.length, 5); return
    }
    if (scenario === 'duplicate_concurrent') {
      const results = await Promise.all([f.post(body), f.post(body), f.post({ ...body, clientSubmissionId: require('node:crypto').randomUUID() })])
      assert(results.some(r => r.status === 200)); assert.equal(f.calls.length, 5)
      await f.post(body); assert.equal(f.calls.length, 5); return
    }
    const result = await f.post(body)
    if (scenario === 'missing_source_b') { assert.equal(f.calls.length, 4); assert.notEqual(result.body.unifiedTask?.goalStatus, 'GOAL_COMPLETED'); assert(!result.body.reply.includes('CAD 126.00')) }
    else { assert(f.calls.length <= (scenario === 'changed_candidate' ? 2 : 1)); assert.notEqual(result.body.unifiedTask?.executionState, 'CLARIFICATION_COMPLETED') }
  } finally { delete process.env.CONTEXT_DRIVE_OPENAI; await f.close() }
})
test('R1 long-document projection retains bounded verbatim segments with explicit omitted spans and original identity', () => {
  const { buildEvidence } = require('./toolSelection/synthesis')
  const content = 'Opening fact.\n' + 'Middle evidence sentence.\n'.repeat(200) + 'Final fact CAD 120.00.'
  const pack = { source: 'drive', resource: 'drive.company_files', operation: 'get', state: 'ok', content: [{ sourceId: 'doc1', title: 'Long document', content }], coverage: { complete: true, truncated: false } }
  const report = buildEvidence({ tools: [{ id: 'drive.company_files.get' }] }, { packs: [pack] })
  const s = report.sections[0]
  assert(s.records.length > 0); assert.equal(s.state, 'partial'); assert(s.projection.omittedCharacters > 0)
  assert.equal(s.records[0].originalSourceId, 'doc1')
  for (const row of s.records) { assert(row.content.length <= 320); assert.equal(content.slice(row.start, row.end), row.content) }
  assert(Buffer.byteLength(JSON.stringify(report)) <= 12000)
  const omitted = content.slice(600, 900)
  assert(!JSON.stringify(report.sections[0].records).includes(omitted))
  const { bindClaim } = require('../investigation/semanticAnswer')
  assert(bindClaim({id:'c1',text:'An omitted fact.',kind:'observation',evidenceState:'supported',temporalScope:'historical',references:[{sourceId:'S1',recordId:s.records[0].sourceId,field:'content',value:omitted}]},report).reason)
})
