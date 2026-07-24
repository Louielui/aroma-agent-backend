'use strict'

// decisionRecall.test.js — Decision Recall v1. Deterministic only, ZERO paid calls.
// Sealed in-memory fixtures + a recording adapter + captured-final-adapter-INPUT proofs.
// A throwaway AROMA_DATA_DIR isolates any store write to a temp dir (never the real store).

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-recall-test-'))

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { buildDecisionRecallContext, SAFETY_HEADER } = require('./decisionRecall')
const { processIntake } = require('../intake/intakeService')
const { MockAdapter } = require('../adapters/MockAdapter')

const OPEN = '<decision_recall_context>'
const CLOSE = '</decision_recall_context>'

/* ------------------------------- fixtures --------------------------------- */
function dec (id, over = {}) {
  return Object.assign({
    id, statement: 'statement ' + id, rationale: '', status: 'active',
    provenance: { proposed_by: 'louie', source: 'homepage-intake', approved_by: null, decided_at: '2026-07-20T00:00:00Z' }
  }, over)
}
function task (id, decision_id, over = {}) {
  return Object.assign({ id, decision_id, title: 't', note: '', state: '待派工', created_at: 'x', proposalId: null }, over)
}
// counting fns — call listDecisionsFn / listTasksFn at most once each
function fns (decisions, tasks) {
  const c = { dc: 0, tc: 0 }
  return { listDecisionsFn: () => { c.dc++; return decisions }, listTasksFn: () => { c.tc++; return tasks }, c }
}

/* ============================ BUILDER unit tests ========================== */

test('builder: NO_RECORDS when zero decisions → block null', () => {
  const r = buildDecisionRecallContext(fns([], []))
  assert.deepEqual(r, { block: null, status: 'NO_RECORDS' })
})

test('builder: SOURCE_UNAVAILABLE when a read throws → block null (fail-soft signal)', () => {
  const r = buildDecisionRecallContext({ listDecisionsFn: () => { throw new Error('boom') }, listTasksFn: () => [] })
  assert.deepEqual(r, { block: null, status: 'SOURCE_UNAVAILABLE' })
})

test('builder: listDecisionsFn + listTasksFn each called at most once', () => {
  const f = fns([dec('d1')], [task('t1', 'd1')])
  buildDecisionRecallContext(f)
  assert.equal(f.c.dc, 1)
  assert.equal(f.c.tc, 1)
})

test('builder: verbatim safety header is the first line inside the wrapper tags', () => {
  const { block } = buildDecisionRecallContext(fns([dec('d1')], []))
  assert.ok(block.startsWith(OPEN + '\n' + SAFETY_HEADER))
  assert.ok(block.endsWith(CLOSE))
})

test('builder: deterministic sort — decided_at newest-first, undated last, id tie-break', () => {
  const decisions = [
    dec('b', { provenance: { proposed_by: 'x', source: 's', approved_by: null, decided_at: '2026-07-10T00:00:00Z' } }),
    dec('a', { provenance: { proposed_by: 'x', source: 's', approved_by: null, decided_at: '2026-07-10T00:00:00Z' } }), // tie with b → id 'a' first
    dec('newest', { provenance: { proposed_by: 'x', source: 's', approved_by: null, decided_at: '2026-07-21T00:00:00Z' } }),
    dec('undated', { provenance: { proposed_by: 'x', source: 's', approved_by: null } }), // no decided_at → last
    dec('bad', { provenance: { proposed_by: 'x', source: 's', approved_by: null, decided_at: 'not-a-date' } }) // invalid → last
  ]
  const { block } = buildDecisionRecallContext(fns(decisions, []))
  const order = [...block.matchAll(/Decision (\S+) \[status=/g)].map(m => m[1])
  assert.deepEqual(order.slice(0, 3), ['newest', 'a', 'b']) // newest, then tie-break a<b
  assert.ok(order.indexOf('undated') > 2 && order.indexOf('bad') > 2) // undated/invalid last
})

test('builder: SELECT limit=5 (7 decisions → 5 records, TRUNCATED)', () => {
  const decisions = ['1', '2', '3', '4', '5', '6', '7'].map((n) => dec('d' + n, { provenance: { proposed_by: 'x', source: 's', approved_by: null, decided_at: '2026-07-2' + n + 'T00:00:00Z' } }))
  const r = buildDecisionRecallContext(fns(decisions, []))
  assert.equal([...r.block.matchAll(/Decision /g)].length, 5)
  assert.equal(r.status, 'TRUNCATED')
})

test('builder: tasks max 3 by id asc + omission count + TRUNCATED', () => {
  const tasks = ['t5', 't1', 't4', 't2', 't3'].map((id) => task(id, 'd1'))
  const r = buildDecisionRecallContext(fns([dec('d1')], tasks))
  const line = r.block.split('\n').find((l) => l.startsWith('Tasks: '))
  assert.ok(line.indexOf('t1') < line.indexOf('t2') && line.indexOf('t2') < line.indexOf('t3')) // id asc
  assert.ok(!line.includes('t4') && !line.includes('t5')) // beyond 3 omitted
  assert.ok(line.includes('(+2 more task(s) omitted)'))
  assert.equal(r.status, 'TRUNCATED')
})

test('builder: STATEMENT never truncated — whole record omitted when it cannot fit, TRUNCATED', () => {
  const huge = 'X'.repeat(900) // statement alone pushes mandatory > perRecordCap 700
  const r = buildDecisionRecallContext(fns([dec('keep'), dec('drop', { statement: huge })], []))
  assert.ok(r.block.includes('statement keep')) // normal record kept
  assert.ok(!r.block.includes(huge)) // over-long record omitted whole (never partial statement)
  assert.equal(r.status, 'TRUNCATED')
})

test('builder: RATIONALE is the only truncatable field (ellipsis, record stays ≤ perRecordCap)', () => {
  const r = buildDecisionRecallContext(fns([dec('d1', { rationale: 'R'.repeat(2000) })], []))
  const rec = r.block.split(OPEN + '\n' + SAFETY_HEADER + '\n')[1].split('\n' + CLOSE)[0]
  assert.ok(rec.includes('…')) // rationale truncated with ellipsis
  assert.ok(rec.length <= 700)
  assert.ok(rec.includes('statement d1')) // statement intact
})

test('builder: charCap on the FULL serialized block; whole-record boundary; TRUNCATED', () => {
  const decisions = ['1', '2', '3', '4', '5'].map((n) => dec('d' + n, { provenance: { proposed_by: 'x', source: 's', approved_by: null, decided_at: '2026-07-2' + n + 'T00:00:00Z' } }))
  const cap = SAFETY_HEADER.length + 200 // enough for header+tags but not all records
  const r = buildDecisionRecallContext(Object.assign(fns(decisions, []), { charCap: cap }))
  assert.ok(r.block.length <= cap)
  assert.ok(r.block.endsWith(CLOSE)) // complete boundary, never a half record
  assert.ok([...r.block.matchAll(/Decision /g)].length < 5)
  assert.equal(r.status, 'TRUNCATED')
})
// charCap passed via a merged object above; confirm builder honors an explicit charCap arg:
test('builder: explicit small charCap forces TRUNCATED', () => {
  const r = buildDecisionRecallContext({ listDecisionsFn: () => [dec('d1'), dec('d2', { provenance: { proposed_by: 'x', source: 's', approved_by: null, decided_at: '2026-07-19T00:00:00Z' } })], listTasksFn: () => [], charCap: SAFETY_HEADER.length + 120 })
  assert.equal(r.status, 'TRUNCATED')
  assert.ok(r.block.length <= SAFETY_HEADER.length + 120)
})

test('builder: provenance real fields (no actor) + approval qualifier; approved_by never phrased as approved', () => {
  const { block } = buildDecisionRecallContext(fns([dec('d1', { provenance: { proposed_by: 'louie', source: 'homepage-intake', approved_by: 'someone', decided_at: '2026-07-20T00:00:00Z' } })], []))
  assert.ok(block.includes('proposed_by=louie'))
  assert.ok(block.includes('source=homepage-intake'))
  assert.ok(block.includes('approved_by=someone (recorded field value only — NOT a verification of formal approval)'))
  assert.ok(!block.includes('actor'))
  assert.ok(!/Louie approved/i.test(block))
})

test('builder: proposalId → "linked to a Proposal" only; never a lifecycle string', () => {
  const { block } = buildDecisionRecallContext(fns([dec('d1')], [task('t1', 'd1', { proposalId: 'p_x' })]))
  assert.ok(block.includes('t1 (state=待派工) [linked to a Proposal]'))
  assert.ok(!block.includes('confirmed') && !block.includes('dispatched'))
  assert.ok(!/proposal.*(pending|approved|confirmed)/i.test(block))
})

test('builder: NO conflict resolution / dedup / supersession — duplicate statements both kept', () => {
  const { block } = buildDecisionRecallContext(fns([dec('a', { statement: 'same' }), dec('b', { statement: 'same' })], []))
  assert.equal([...block.matchAll(/Decision /g)].length, 2)
})

/* ==================== 7 CAPTURED-ADAPTER-INPUT proofs ===================== */

function recAdapter (text) {
  const calls = []
  return { calls, async complete (prompt, o) { calls.push({ prompt, system: o && o.system }); return { text, model: 'rec', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } } }
}
const CHAT = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'ok' })
const COMMIT = JSON.stringify({ intent: 'task', mode: 'commit', reply: 'r', decision: { statement: 's', rationale: 'r' }, tasks: [{ title: 't', note: '', capability: 'coding' }], risks: [], next_step: '' })
const flagOn = () => { process.env.DECISION_RECALL = 'on' }
const flagOff = () => { delete process.env.DECISION_RECALL }
const spyPromote = () => { const calls = []; const f = async (id) => { calls.push(id); return { ok: true, proposal: { id: 'p1', status: 'pending' } } }; f.calls = calls; return f }

test('PROOF 1 — chat + flag ON → adapter input contains EXACTLY ONE recall block', async () => {
  const a = recAdapter(CHAT)
  flagOn()
  await processIntake('hi', a, [], { demo: true, interactionMode: 'chat', decisionRecallDeps: fns([dec('d1')], [task('t1', 'd1', { proposalId: 'p1' })]) })
  flagOff()
  const input = a.calls[0].prompt
  assert.equal((input.match(/<decision_recall_context>/g) || []).length, 1)
  assert.equal((input.match(/<\/decision_recall_context>/g) || []).length, 1)
  assert.ok(input.includes(SAFETY_HEADER))
})

test('PROOF 2 — chat + flag OFF → adapter input BYTE-IDENTICAL to baseline (no recall)', async () => {
  const aOff = recAdapter(CHAT); flagOff()
  await processIntake('hi', aOff, [], { demo: true, interactionMode: 'chat', decisionRecallDeps: fns([dec('d1')], []) })
  const aBase = recAdapter(CHAT)
  await processIntake('hi', aBase, [], { demo: true, interactionMode: 'chat' })
  assert.equal(aOff.calls[0].prompt, aBase.calls[0].prompt)
  assert.equal(aOff.calls[0].system, aBase.calls[0].system)
  assert.ok(!aOff.calls[0].prompt.includes(OPEN))
})

test('PROOF 3 — proposal + flag ON → BYTE-IDENTICAL to proposal baseline (builder never called)', async () => {
  const promote = spyPromote()
  const spy = fns([dec('d1')], [])
  const aOn = recAdapter(COMMIT); flagOn()
  await processIntake('do X', aOn, [], { demo: true, interactionMode: 'proposal', promoteToProposal: promote, decisionRecallDeps: spy })
  flagOff()
  const aOff = recAdapter(COMMIT)
  await processIntake('do X', aOff, [], { demo: true, interactionMode: 'proposal', promoteToProposal: spyPromote() })
  assert.equal(aOn.calls[0].prompt, aOff.calls[0].prompt)
  assert.equal(aOn.calls[0].system, aOff.calls[0].system)
  assert.ok(!aOn.calls[0].prompt.includes(OPEN))
  assert.equal(spy.c.dc, 0) // recall builder deps NEVER read on the proposal path
})

test('PROOF 4 — proposal + flag OFF → no recall block', async () => {
  const a = recAdapter(COMMIT); flagOff()
  await processIntake('do X', a, [], { demo: true, interactionMode: 'proposal', promoteToProposal: spyPromote() })
  assert.ok(!a.calls[0].prompt.includes(OPEN))
})

test('PROOF 5 — missing interactionMode + flag ON and OFF → BYTE-IDENTICAL to legacy baseline', async () => {
  const spy = fns([dec('d1')], [])
  const aOn = recAdapter(CHAT); flagOn()
  await processIntake('hi', aOn, [], { demo: true, decisionRecallDeps: spy }) // NO interactionMode
  flagOff()
  const aOff = recAdapter(CHAT)
  await processIntake('hi', aOff, [], { demo: true })
  assert.equal(aOn.calls[0].prompt, aOff.calls[0].prompt)
  assert.ok(!aOn.calls[0].prompt.includes(OPEN))
  assert.equal(spy.c.dc, 0) // missing interactionMode is NOT treated as chat
})

test('PROOF 6 — U1 + flag ON and OFF → recall builder NEVER called; path unchanged (SHADOW_ONLY)', async () => {
  const spy = fns([dec('d1')], [])
  flagOn()
  const resOn = await processIntake('mail rob', new MockAdapter(), [], { u1DraftShadow: true, decisionRecallDeps: spy })
  flagOff()
  const resOff = await processIntake('mail rob', new MockAdapter(), [], { u1DraftShadow: true, decisionRecallDeps: spy })
  assert.equal(spy.c.dc, 0) // builder deps never read on the U1 early-return path
  assert.equal(resOn.stage, 'SHADOW_ONLY')
  assert.equal(resOff.stage, 'SHADOW_ONLY')
  assert.equal(resOn.gmailDraftCreated, false)
  assert.equal(resOn.persistentMemoryWritten, false)
})

test('PROOF 7 — B2 chat gate stays talk-only (flag ON): chat+commit → no proposal produced', async () => {
  const promote = spyPromote()
  const a = recAdapter(COMMIT); flagOn()
  const res = await processIntake('do it', a, [], { demo: true, interactionMode: 'chat', promoteToProposal: promote, decisionRecallDeps: fns([dec('d1')], []) })
  flagOff()
  assert.equal(res.talkOnly, true)
  assert.equal('proposals' in res, false)
  assert.equal(promote.calls.length, 0) // chat never promotes a Proposal
})
