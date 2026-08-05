'use strict'

/**
 * classificationVisibility.test.js — the six-step chain, and why only step 1 was visible.
 *
 * 「幫我改 docs/canary/agent-canary.md，第二行改成 line 3」 — exact path, exact line, exact
 * replacement — produced 「這看起來不是一個可執行的任務」 and no work-order card.
 *
 * The card needs six links in order:
 *
 *   1. the router says ACTION                     ← the ONLY one with a log line
 *   2. the model returns mode === 'commit'        ← where it actually broke
 *   3. exactly one task
 *   4. the task persists
 *   5. promoteToProposal yields one proposal
 *   6. carriesProposal → `inferred` rides → the UI offers 產生工作單
 *
 * Steps 2–5 emitted nothing. Diagnosing this meant inferring the model's verdict from a
 * reply string and an output-token count. THAT is the defect this file closes: the
 * classification failure is downstream of the instrumentation gap, not the other way round.
 *
 * ── WHAT A MOCK CANNOT DO ────────────────────────────────────────────────────
 * The tests below use a fake adapter, so they prove the PLUMBING: that a commit envelope
 * reaches a proposal, that a non-commit envelope is recorded with its reason, and that a
 * coerced mode is distinguishable. **They cannot prove what the real model decides** —
 * which is the step that actually broke. Every pre-existing test in this repo hands the
 * pipeline a pre-built `mode:'commit'` envelope, which is exactly why the one broken link
 * had no coverage. A mock cannot close that; only a live call can, and that is a separate,
 * Owner-approved experiment.
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-classvis-'))

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { parseDistillResponse } = require('./distillPrompt')
const { logIntakeOutcome, FIELDS } = require('../utils/intakeOutcomeLog')
const { processIntake } = require('./intakeService')

/* ═══ 1. AN UNRECOGNISED MODE IS DISTINGUISHABLE FROM A GENUINE 'chat' ════ */

const envelope = (mode) => JSON.stringify({ intent: 'task', mode, reply: 'r' })

// The fact travels OUT OF BAND, in a diag out-parameter. The returned envelope is a CLOSED
// projection whose key set distillEnvelopeBaseline freezes on purpose — my first draft put
// modeCoerced inside it and turned four of those baseline tests red. They were right and I
// was wrong: coercion is a fact about how the envelope was produced, not envelope content.
test('*** a coerced mode is marked; behaviour is UNCHANGED ***', () => {
  const diag = {}
  const p = parseDistillResponse(envelope('proposal'), diag)
  assert.equal(p.mode, 'chat', 'the coercion itself is NOT changed in this round')
  assert.equal(diag.modeCoerced, true, 'but it must no longer be invisible')
  assert.equal('modeCoerced' in p, false, 'and the closed envelope stays closed')
})

test('*** a genuine chat is NOT marked — the two cases must not look alike ***', () => {
  for (const m of ['chat', 'commit', 'ask', 'recommend']) {
    const diag = {}
    parseDistillResponse(envelope(m), diag)
    assert.equal(diag.modeCoerced, false, m)
  }
})

test('a missing mode is coercion too — absent and unrecognised both end as chat', () => {
  const diag = {}
  const p = parseDistillResponse(JSON.stringify({ intent: 'task', reply: 'r' }), diag)
  assert.equal(p.mode, 'chat')
  assert.equal(diag.modeCoerced, true, 'absent must be as visible as wrong')
})

test('*** coercion also warns, naming the field ***', () => {
  const warned = []
  const orig = console.warn
  console.warn = (...a) => warned.push(a.join(' '))
  try {
    parseDistillResponse(envelope('ACTION'))
    parseDistillResponse(envelope('chat'))
  } finally { console.warn = orig }
  assert.equal(warned.length, 1, 'exactly the coerced one: ' + JSON.stringify(warned))
  assert.ok(/mode/i.test(warned[0]), warned[0])
})

/* ═══ 2. THE OUTCOME LINE CARRIES THE CLASSIFICATION ═════════════════════ */

test('*** mode, clarificationReason and modeCoerced reach the outcome line ***', () => {
  for (const f of ['mode', 'clarificationReason', 'modeCoerced']) {
    assert.ok(FIELDS.includes(f), 'not in the allowlist: ' + f)
  }
  const seen = []
  logIntakeOutcome({ mode: 'chat', clarificationReason: 'not_a_commit_intent', modeCoerced: true }, { sink: (e) => seen.push(e) })
  assert.equal(seen[0].mode, 'chat')
  assert.equal(seen[0].clarificationReason, 'not_a_commit_intent')
  assert.equal(seen[0].modeCoerced, true)
})

test('*** the RAW model string never reaches the log — only the boolean ***', () => {
  // The file's own discipline: this line can never contain the model's output. A raw mode
  // value IS model output, so what travels is whether it was recognised, not what it said.
  // The raw value goes to console.warn, which is a developer warning and not this record.
  const seen = []
  logIntakeOutcome({ mode: 'chat', modeRaw: 'something the model invented' }, { sink: (e) => seen.push(e) })
  assert.equal('modeRaw' in seen[0], false)
})

/* ═══ 3. THE STEP NOTHING COVERED — plumbing only; see the header ════════ */

const adapterReturning = (canned) => ({
  async complete () {
    return { text: JSON.stringify(canned), model: 'fake', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
  }
})

const COMMIT = {
  intent: 'task',
  mode: 'commit',
  reply: '我已把它整理成一項待批准的執行提案。',
  decision: { statement: '改 docs/canary/agent-canary.md 第二行', rationale: 'Owner 要求' },
  tasks: [{ title: '改 docs/canary/agent-canary.md 第二行為 line 3', note: '', capability: 'coding' }],
  risks: [],
  next_step: ''
}
const MSG = '幫我改 docs/canary/agent-canary.md，第二行改成 line 3'

test('*** mode=commit + one task reaches a PROPOSAL — steps 3 to 5 ***', async () => {
  const promoted = []
  const res = await processIntake(MSG, adapterReturning(COMMIT), [], {
    interactionMode: 'proposal',
    demo: true,
    requestId: 'r1',
    promoteToProposal: async (taskId) => {
      promoted.push(taskId)
      return { ok: true, proposal: { id: 'p1', status: 'pending' } }
    }
  })
  assert.equal(promoted.length, 1, 'the task never reached the promotion seam')
  assert.equal(Array.isArray(res.proposals) && res.proposals.length, 1, 'no proposal: ' + JSON.stringify(res.proposals))
  // Step 6's gate reads exactly this — demoRouter's carriesProposal.
  assert.ok(res.proposals.length > 0, 'carriesProposal would be false and the card unreachable')
})

test('*** a NON-commit turn records WHY, instead of leaving a bare sentence ***', async () => {
  // The live failure, reproduced through the plumbing. Before this round the reason existed
  // on the response and was never logged, so the turn was undiagnosable after the fact.
  const seen = []
  const res = await processIntake(MSG, adapterReturning({ intent: 'task', mode: 'chat', reply: 'x' }), [], {
    interactionMode: 'proposal',
    demo: true,
    requestId: 'r2',
    telemetry: {},
    promoteToProposal: async () => ({ ok: true, proposal: { id: 'p', status: 'pending' } })
  })
  assert.equal(res.clarificationReason, 'not_a_commit_intent')
  assert.equal(res.proposals.length, 0)
  logIntakeOutcome({ mode: res.mode, clarificationReason: res.clarificationReason }, { sink: (e) => seen.push(e) })
  assert.equal(seen[0].clarificationReason, 'not_a_commit_intent', 'the reason must be loggable')
})

test('*** the service HANDS the classification to telemetry — not just to the response ***', async () => {
  const tel = {}
  await processIntake(MSG, adapterReturning({ intent: 'task', mode: 'chat', reply: 'x' }), [], {
    interactionMode: 'proposal', demo: true, requestId: 'r3', telemetry: tel,
    promoteToProposal: async () => ({ ok: true, proposal: { id: 'p', status: 'pending' } })
  })
  assert.equal(tel.mode, 'chat', 'the router logs its verdict; the classifier must log its own')
  assert.equal(tel.clarificationReason, 'not_a_commit_intent')
})
