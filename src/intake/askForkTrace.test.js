'use strict'

/**
 * askForkTrace.test.js — the fork trace must SEE the turn and never TOUCH it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE TWO WAYS OBSERVABILITY GOES WRONG, AND BOTH ARE PINNED HERE:
 *
 *   1. It changes what it observes. A logger whose return value is read, or whose failure
 *      propagates, is no longer a witness — it is a participant.
 *   2. It records the thing it was supposed to be a safe summary OF. The existing fence
 *      (`src/governance/logContent.test.js`) catches known content FIELD NAMES; it cannot
 *      catch a new field with a new name. So these lines exclude content by VALUE.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { STAGE, BRANCH, ASK_ORIGIN, forkLine, logAskFork, sourceClassOf } = require('./askForkTrace')
const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

/** The Owner's actual sentence from the 2026-08-12 A/B pair. If this appears in a log, we failed. */
const OWNER_MESSAGE = '現在缺貨最嚴重的是什麼？'
const OWNER_REPLY = '你想問我哋目前邊款貨品缺貨最嚴重，定係市場上邊類貨品最缺？'
const FAKE_SECRET = 'sk-ant-NOT-A-REAL-KEY-0000'

/* ═══ 1. THE LINE CANNOT CARRY CONTENT ═══════════════════════════════════ */

test('*** ⛔ NO FIELD CAN CARRY THE MESSAGE, THE REPLY, OR A SECRET ***', () => {
  // Every field is handed content. Not one of them may keep it.
  const line = forkLine({
    requestId: OWNER_MESSAGE,
    stage: OWNER_MESSAGE,
    branch: OWNER_REPLY,
    askOrigin: OWNER_REPLY,
    route: FAKE_SECRET,
    intent: OWNER_MESSAGE,
    sourceClass: FAKE_SECRET,
    reasoningEntered: OWNER_MESSAGE,
    shortCircuit: OWNER_REPLY
  })
  const json = JSON.stringify(line)
  for (const banned of [OWNER_MESSAGE, OWNER_REPLY, FAKE_SECRET]) {
    assert.ok(!json.includes(banned), '⛔ content survived into the log line: ' + json)
  }
  // And it degraded to the honest value rather than silently dropping the field.
  assert.equal(line.stage, 'other')
  assert.equal(line.branch, 'other')
  assert.equal(line.route, 'other')
  assert.equal(line.requestId, null, 'a non-id requestId is dropped, not printed')
  // ⛔ A coerced boolean must be a boolean, not a truthy string.
  assert.equal(line.reasoningEntered, false)
  assert.equal(line.shortCircuit, false)
})

test('*** ⛔ THE ENUMS ARE CLOSED — an unrecognised value is never echoed ***', () => {
  assert.equal(forkLine({ stage: STAGE.WORLD_ASK }).stage, 'world_ask', 'a known value passes through')
  assert.equal(forkLine({ stage: 'world_ask_v2' }).stage, 'other', '⛔ a near-miss must not pass')
  assert.equal(forkLine({ branch: BRANCH.VERDICT_CLARIFY }).branch, 'verdict_clarify')
  assert.equal(forkLine({ intent: 'internal' }).intent, 'internal')
  assert.equal(forkLine({ intent: 'internal-ish' }).intent, 'other')
  // Absent is null, which is different from unrecognised. The log must distinguish them.
  assert.equal(forkLine({}).route, null)
  assert.equal(forkLine({ route: '' }).route, 'other')
})

test('*** a real requestId survives, because correlation is the point ***', () => {
  const id = '068bd217-3908-4d86-b883-46c8bd714138'
  assert.equal(forkLine({ requestId: id }).requestId, id)
})

test('*** sourceClass is a class, never the source list ***', () => {
  assert.equal(sourceClassOf(['aroma_system']), 'internal_only')
  assert.equal(sourceClassOf(['public_knowledge']), 'public_only')
  assert.equal(sourceClassOf(['aroma_system', 'public_knowledge']), 'both')
  assert.equal(sourceClassOf([]), 'none')
  assert.equal(sourceClassOf(null), null)
})

/* ═══ 2. IT CANNOT PARTICIPATE IN THE TURN ═══════════════════════════════ */

test('*** ⛔ A LOGGER THAT THROWS DOES NOT FAIL THE TURN, AND RETURNS NOTHING ***', () => {
  let out
  assert.doesNotThrow(() => {
    out = logAskFork({ stage: STAGE.LOOP_ENTRY, branch: BRANCH.LOOP_SKIPPED }, () => { throw new Error('sink exploded') })
  })
  assert.equal(out, undefined, '⛔ a return value is something a caller can branch on')
  // A malformed input must not throw either — telemetry is never a new failure mode.
  assert.doesNotThrow(() => logAskFork(null, () => {}))
  assert.doesNotThrow(() => logAskFork(undefined, () => {}))
})

/**
 * ⛔ THE STRUCTURAL PROOF: EVERY CALL SITE IS A STATEMENT.
 *
 * The behavioural test below shows the decisions do not change TODAY. This shows they cannot
 * change tomorrow, because the value is never in a position where it could be read. A future
 * `if (forkTrace(...))` fails here rather than in production.
 */
test('*** ⛔ NO CALL SITE READS THE TRACER\'S VALUE — statements only ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'intakeService.js'), 'utf8')
  const offenders = []
  const lines = src.split('\n')
  lines.forEach((raw, idx) => {
    const line = raw.trim()
    if (!/\bforkTrace\s*\(/.test(line)) return
    if (/^const forkTrace =/.test(line)) return // the definition itself
    // A statement starts with the call. Anything else means its value is being used.
    if (!/^forkTrace\s*\(/.test(line)) offenders.push((idx + 1) + ': ' + line)
  })
  assert.deepEqual(offenders, [],
    '⛔ The fork tracer is a witness, not a participant. Its value must never be assigned, ' +
    'returned, awaited or tested — call it as a bare statement.')
})

/* ═══ 3. THE DECISIONS ARE IDENTICAL WITH AND WITHOUT THE LOGGING ════════ */

const NOW = '2026-08-09T00:00:00.000Z'
const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }

async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

function connector () {
  const internalReads = []
  return {
    internalReads,
    connector: {
      async read (source, method, params) {
        internalReads.push({ method })
        const rows = [{ source, sourceId: '7', title: 'Beef Brisket', entityType: 'purchase_order', content: 'supplier=Gordon', fields: { id: '7' }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE' } }
      }
    }
  }
}

function scriptedAdapter (envelopes) {
  const calls = []
  return {
    label: 'claude',
    calls,
    async complete (prompt) {
      calls.push(String(prompt))
      const e = envelopes[Math.min(calls.length - 1, envelopes.length - 1)]
      return { text: typeof e === 'string' ? e : JSON.stringify(e), usage: { inputTokens: 1, outputTokens: 1 } }
    }
  }
}

const FINAL = (reply) => ({ intent: 'answer', mode: 'chat', reply, nextRead: null, answerPlan: null })
const READ = (capability) => ({ intent: 'answer', mode: 'chat', reply: null, nextRead: { capability }, answerPlan: null })

const run = (msg, adapter, deps) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

/**
 * ⛔ THE HARSHEST FORM OF 「logging absent」 IS A LOGGER THAT EXPLODES.
 * If any decision depended on the trace, a console that throws would change the outcome.
 */
async function outcomeWith (breakLogging, scenario) {
  const realLog = console.log
  if (breakLogging) console.log = () => { throw new Error('console is gone') }
  try {
    return await scenario()
  } finally { console.log = realLog }
}

const CLARIFY_DEPS = (c) => ({
  connector: c.connector,
  sources: ['aroma_system', 'public_knowledge'],
  finalVerifier: async () => ({ decision: 'clarify', question: OWNER_REPLY }),
  sourceIntentResolver: async () => ({ intent: 'internal' })
})

const REQUIRE_DEPS = (c) => ({
  connector: c.connector,
  sources: ['aroma_system', 'public_knowledge'],
  finalVerifier: async () => ({ decision: 'require_internal', question: null }),
  sourceIntentResolver: async () => ({ intent: 'internal' })
})

test('*** ⛔ THE CLARIFY TURN DECIDES THE SAME WITH LOGGING AND WITHOUT ***', async () => {
  await withEnv({}, async () => {
    const results = []
    for (const broken of [false, true]) {
      const c = connector()
      const a = scriptedAdapter([FINAL('我估係牛肉。')])
      const out = await outcomeWith(broken, () => run(OWNER_MESSAGE, a, CLARIFY_DEPS(c)))
      results.push({ mode: out.mode, reply: out.reply, reads: c.internalReads.length, calls: a.calls.length })
    }
    assert.deepEqual(results[0], results[1],
      '⛔ the trace changed the turn: ' + JSON.stringify(results))
    // And it is still the shape the A/B evidence recorded: an ASK with zero reads.
    assert.equal(results[0].mode, 'ask')
    assert.equal(results[0].reads, 0)
  })
})

test('*** ⛔ THE READING TURN DECIDES THE SAME WITH LOGGING AND WITHOUT ***', async () => {
  await withEnv({}, async () => {
    const results = []
    for (const broken of [false, true]) {
      const c = connector()
      const a = scriptedAdapter([FINAL('直接答。'), READ('aroma_system.invoices'), FINAL('讀完再答。')])
      const out = await outcomeWith(broken, () => run(OWNER_MESSAGE, a, REQUIRE_DEPS(c)))
      results.push({ mode: out.mode, reads: c.internalReads.length, calls: a.calls.length })
    }
    assert.deepEqual(results[0], results[1],
      '⛔ the trace changed the turn: ' + JSON.stringify(results))
    assert.ok(results[0].reads >= 1, 'this path is the one that actually reads')
  })
})

test('*** ⛔ AND THE TRACE ITSELF NEVER PRINTS THE TURN ***', async () => {
  await withEnv({}, async () => {
    const captured = []
    const realLog = console.log
    console.log = (...args) => { captured.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) }
    try {
      const c = connector()
      await run(OWNER_MESSAGE, scriptedAdapter([FINAL('我估係牛肉。')]), CLARIFY_DEPS(c))
    } finally { console.log = realLog }
    const forkLines = captured.filter((l) => l.includes('[AROMA-ASK-FORK]'))
    assert.ok(forkLines.length > 0, 'the fork was actually traced — otherwise this proves nothing')
    for (const l of forkLines) {
      assert.ok(!l.includes(OWNER_MESSAGE), '⛔ the Owner\'s message reached a fork line: ' + l)
      assert.ok(!l.includes(OWNER_REPLY), '⛔ the reply reached a fork line: ' + l)
    }
  })
})

test('*** the clarify exit is recorded as the exit it is ***', async () => {
  await withEnv({}, async () => {
    const captured = []
    const realLog = console.log
    console.log = (...args) => { captured.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) }
    try {
      const c = connector()
      await run(OWNER_MESSAGE, scriptedAdapter([FINAL('我估係牛肉。')]), CLARIFY_DEPS(c))
    } finally { console.log = realLog }
    const fork = captured.filter((l) => l.includes('[AROMA-ASK-FORK]')).join('\n')
    assert.ok(fork.includes('"branch":"verdict_clarify"'), '⛔ the 19:28 exit is unlabelled: ' + fork)
    assert.ok(fork.includes('"askOrigin":"final_obligation_clarify"'), '⛔ the ask origin is unrecorded')
    assert.ok(fork.includes('"branch":"loop_skipped"'), '⛔ the skipped loop is unrecorded')
    assert.ok(fork.includes('"reasoningEntered":false'), '⛔ reasoningEntered is unrecorded')
  })
})
