'use strict'
/**
 * o1LivePipeline.test.js — DRIVE THE REAL ENTRYPOINT, NOT THE MODULE.
 *
 * ⛔ THIS FILE EXISTS BECAUSE THE PREVIOUS ACCEPTANCE SUITE WAS BLIND. It called
 * resolveSemanticFallback directly, so it went green while nothing in the pipeline called the
 * thing at all. A module can be perfect and still be dead code; only the real entrypoint can
 * tell you which one you have.
 *
 * System under test: processIntake(). The classifier, the connectors and the stores are fake.
 * No network, no provider, no production HTTP, no writes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')

/** Counts what the turn actually did. */
function harness (scriptedPairs) {
  const seen = { semanticCalls: 0, connectorReads: 0, preConsensusReads: 0, consensusReached: false }
  let n = 0
  const semanticCallModel = async () => {
    // A read here would mean the pipeline read BEFORE the classifier had agreed.
    if (!seen.consensusReached) seen.preConsensusReads += seen.connectorReads
    const reply = scriptedPairs[Math.min(n++, scriptedPairs.length - 1)]
    seen.semanticCalls++
    return JSON.stringify(reply)
  }
  const connector = {
    read: async () => { seen.connectorReads++; return { ok: true, rows: [] } },
    listOrderPlanning: async () => { seen.connectorReads++; return { ok: true, rows: [] } },
    listPurchaseOrders: async () => { seen.connectorReads++; return { ok: true, rows: [] } },
    listInventory: async () => { seen.connectorReads++; return { ok: true, rows: [] } }
  }
  return { seen, semanticCallModel, connector }
}

/** A model that never answers with a plan — we are measuring routing, not prose. */
/**
 * ⛔ THE ADAPTER ASKS FOR A READ ON PURPOSE.
 *
 * With nextRead null the A3 loop never runs, nothing is ever read, and every "which source was
 * touched" assertion passes because no source was touched at all. That is a vacuous green, and
 * it is what let two source-mapping mutations survive the first pass.
 */
const flatAdapter = {
  complete: async () => ({
    text: JSON.stringify({ mode: 'chat', intent: 'question', reply: 'ok',
      nextRead: { capability: 'aroma_system.purchasing' } })
  })
}

async function turn (message, scriptedPairs, extra) {
  const h = harness(scriptedPairs || [])
  const opts = Object.assign({
    requestId: 'test-' + Math.abs(message.length),
    interactionMode: 'chat',
    semanticCallModel: h.semanticCallModel,
    readContextDeps: { sources: ['aroma_system'], connector: h.connector }
  }, extra || {})
  let result = null
  try { result = await processIntake(message, flatAdapter, [], opts) } catch (e) { result = { error: e && e.message } }
  return { result, seen: h.seen }
}

const HI = (i) => ({ intent: i, confidence: 'HIGH' })
const LOWNONE = { intent: 'NONE', confidence: 'LOW' }

test('*** A — deterministic BUSINESS_QUERY never reaches the classifier ***', async () => {
  const { seen } = await turn('今日邊啲貨要補？', [HI('order_planning')])
  assert.equal(seen.semanticCalls, 0, '⛔ the classifier ran on a turn the deterministic router won')
})

test('*** B — THE LIVE CALL SITE: a deterministic miss reaches the classifier, twice ***', async () => {
  // If the intakeService call site is deleted, this is the assertion that fails.
  const { seen } = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')])
  assert.equal(seen.semanticCalls, 2, '⛔ the live call site is gone, or is not asking twice')
  assert.equal(seen.preConsensusReads, 0, '⛔ something read before consensus')
})

test('*** C — ambiguous wording clarifies, and reads nothing ***', async () => {
  const { seen } = await turn('有咩貨唔夠要入返？', [HI('order_planning'), HI('order_planning')])
  assert.equal(seen.semanticCalls, 2)
  assert.equal(seen.connectorReads, 0, '⛔ an ambiguous turn performed a business read')
})

test('*** D — NONE / LOW keeps today CONVERSATION behaviour and reads nothing ***', async () => {
  const { seen } = await turn('聽日搞乜？', [LOWNONE, LOWNONE])
  assert.equal(seen.semanticCalls, 2)
  assert.equal(seen.connectorReads, 0, '⛔ an abstention performed a business read')
})

test('*** E — HIGH/HIGH disagreement clarifies, and reads nothing ***', async () => {
  const { seen } = await turn('有咩仲未到？', [HI('purchase_order'), HI('inventory')])
  assert.equal(seen.semanticCalls, 2)
  assert.equal(seen.connectorReads, 0, '⛔ a disagreement produced a read')
})

test('*** the classifier never runs outside the chat lane ***', async () => {
  const { seen } = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')], { interactionMode: 'proposal' })
  assert.equal(seen.semanticCalls, 0, '⛔ the classifier ran on a non-chat lane')
})

/* ═══ THE GAPS THE CALL-SITE MUTATIONS EXPOSED ═════════════════════════════ */

/** Capture the allowlisted per-source read line, so we can assert WHICH source was read. */
function captureStdout () {
  const lines = []
  const orig = console.log
  console.log = (...a) => { lines.push(a.map(String).join(' ')) }
  return { lines, restore: () => { console.log = orig } }
}

test('*** AUTO_READ USES THE SERVER-RESOLVED SOURCE, NOT A WIDER SET ***', async () => {
  // Two sources enabled. A purchase_order consensus resolves to aroma_system ALONE through the
  // existing INTENTS table, so gmail must never be touched. A call site that substituted its own
  // source list would widen the read here and nowhere else visible.
  const cap = captureStdout()
  let seen
  try {
    const r = await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')],
      { readContextDeps: { sources: ['aroma_system', 'gmail'] } })
    seen = r.seen
  } finally { cap.restore() }
  const readLines = cap.lines.filter((l) => l.includes('[AROMA-READ-SOURCE]'))
  for (const l of readLines) {
    assert.equal(l.includes('gmail'), false, '⛔ a source outside the server mapping was read: ' + l)
  }
  assert.equal(seen.semanticCalls, 2)
})

test('*** ABSTAIN NEVER BECOMES A BUSINESS_QUERY ***', async () => {
  // The mutation that accepted anything that was not CLARIFY. An abstention carries no sources,
  // so it must stay CONVERSATION rather than becoming an empty-sourced read decision.
  const cap = captureStdout()
  try {
    await turn('聽日搞乜？', [LOWNONE, LOWNONE], { readContextDeps: { sources: ['aroma_system', 'gmail'] } })
  } finally { cap.restore() }
  const routeLines = cap.lines.filter((l) => l.includes('[AROMA-TURN-ROUTE]') || l.includes('[AROMA-O1-SEMANTIC]'))
  const sem = routeLines.find((l) => l.includes('[AROMA-O1-SEMANTIC]'))
  assert.ok(sem, 'the semantic telemetry line must exist for an eligible miss')
  assert.equal(/"consensus":true/.test(sem), false, '⛔ an abstention was recorded as consensus')
  const readLines = cap.lines.filter((l) => l.includes('[AROMA-READ-SOURCE]'))
  assert.equal(readLines.length, 0, '⛔ an abstention read a source')
})

test('*** THE CLARIFY QUESTION ACTUALLY REACHES THE OWNER ***', async () => {
  // Dropping the question silently still reads nothing, so a read-count assertion alone cannot
  // see it. The Owner would simply get the ordinary chat reply and never be asked.
  const { result, seen } = await turn('有咩貨唔夠要入返？', [HI('order_planning'), HI('order_planning')])
  assert.equal(seen.semanticCalls, 2)
  assert.equal(seen.connectorReads, 0)
  const reply = (result && (result.reply || result.replyForArchive)) || ''
  assert.ok(/定係|想睇/.test(reply), '⛔ the clarify question did not reach the Owner: ' + JSON.stringify(reply).slice(0, 160))
})

test('*** THE CLASSIFIER MODEL IS PINNED, NOT INHERITED FROM CHAT CONFIG ***', () => {
  // O1 was qualified on exactly one model. Deriving it from CLAUDE_CHAT_MODEL (opus, for the
  // answering lane) would ship a classifier whose precision was never measured.
  const src = require('fs').readFileSync(require('path').join(__dirname, 'intakeService.js'), 'utf8')
  const line = src.split(/\r?\n/).find((l) => l.startsWith('const SEMANTIC_MODEL'))
  assert.ok(line, 'the pinned model constant must exist')
  assert.equal(line.includes('claude-haiku-4-5-20251001'), true)
  assert.equal(/process\.env/.test(line), false, '⛔ the classifier model became configurable at runtime')
})

test('*** AN ABSTAIN TURN IS NEVER LOGGED AS BUSINESS_QUERY ***', () => {
  // The mutation accepted everything that was not CLARIFY, so an abstention became an
  // empty-sourced BUSINESS_QUERY. That reads nothing either way — the damage is to the Answer
  // Plan gate, which believes a business question was asked. The route telemetry is logged
  // downstream of the upgrade, so it is where the difference is visible.
  const src = require('fs').readFileSync(require('path').join(__dirname, 'intakeService.js'), 'utf8')
  const line = src.split(/\r?\n/).find((l) => l.includes('sem.decision === SEMANTIC.AUTO_READ'))
  assert.ok(line, 'the AUTO_READ acceptance condition must exist')
  assert.ok(/AUTO_READ/.test(line), 'acceptance must test for AUTO_READ explicitly')
  assert.ok(/sem\.sources\.length > 0/.test(line),
    '⛔ acceptance no longer requires server-resolved sources: ' + line.trim())
})

test('*** THE UPGRADED ROUTE CARRIES EXACTLY THE SERVER-RESOLVED SOURCES ***', async () => {
  // Two sources are enabled, but purchase_order resolves through the existing INTENTS table to
  // aroma_system ALONE. A call site that substituted its own source list would widen this, and
  // the widening is visible in the route telemetry whether or not a read ultimately executes —
  // which matters, because the plan layer may legitimately decide no read is needed.
  const cap = captureStdout()
  try {
    await turn('叫咗嘅貨到咗未？', [HI('purchase_order'), HI('purchase_order')],
      { readContextDeps: { sources: ['aroma_system', 'gmail'] } })
  } finally { cap.restore() }
  const tr = cap.lines.find((l) => l.includes('[AROMA-TURN-ROUTE]'))
  assert.ok(tr, 'the route telemetry line must exist')
  const parsed = JSON.parse(tr.slice(tr.indexOf('{')))
  assert.equal(parsed.route, 'BUSINESS_QUERY', 'consensus must upgrade the route')
  assert.equal(parsed.reason, 'semantic_purchase_order', 'the upgrade must be attributable to the semantic path')
  assert.deepEqual(parsed.routerSources, ['aroma_system'],
    '⛔ the route carried sources the server mapping did not authorise: ' + JSON.stringify(parsed.routerSources))
})
