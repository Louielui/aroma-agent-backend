'use strict'

/**
 * CAPABILITY AWARENESS — 「I have not looked」 IS NOT 「I cannot look」.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE CONFUSION THIS EXISTS TO MEASURE, and it is written into the guard today.
 *
 *   readStateGuard.js:344
 *     if (live.length === 0) return { violated: false }  // nothing was read; the claim is true
 *
 * 「Nothing was read」 is not 「the claim is true」. If Aroma System is switched on, credentialled
 * and registered, and this turn simply did not consult it, then 「我睇唔到餐廳系統」 is FALSE — and
 * that line lets it stand. `enforceNoReadClaim` catches the neighbouring case and says so in its
 * own comment: it 「cannot tell a capability claim from an honest 我沒有去看」.
 *
 * P1-A1 supplies the half that was missing — whether the source could have been attempted at
 * all. This module joins it to the turn record and DECIDES NOTHING.
 *
 * ⛔ TWO ORTHOGONAL ENUMS, NOT ONE FLATTENED ONE. Availability is about the world; turnState is
 * about this turn. Flattening them would invent combinations that cannot occur and hide ones
 * that can — a source can be perfectly available and simply unread, which is the entire point.
 *
 * ⛔ AND registered IS NOT healthy. P1-A1 reports health 'unknown' for every source because
 * nothing probes one. Awareness may never upgrade that: 「an object was constructed」 is not
 * 「the far end is well」.
 *
 * ⛔ IT IS PURE. It receives already-derived truth and returns records. It never builds a
 * connector, never reads env or credential files, never authenticates, never calls a model.
 * Obtaining connection truth is the caller's job; deciding what it MEANS for this turn is this
 * module's, and keeping those apart is why this file has no imports that can reach the world.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { deriveCapabilityAwareness, AVAILABILITY, TURN_STATE } = require('./capabilityAwareness')

const AROMA = 'aroma_system'
const INV = 'aroma_system.inventory'
const REPL = 'aroma_system.replenishment'

/** A ConnectionState as P1-A1 emits it. */
const conn = (key, over = {}) => Object.assign({
  key,
  kind: 'data_source',
  label: key,
  local: false,
  egress: false,
  enabled: true,
  credentialState: 'present',
  registered: true,
  health: 'unknown',
  reason: 'none',
  lastSuccessAt: null,
  lastCheckedAt: 'T'
}, over)

/** A turn read record, in the shape buildReadContext already produces. */
const row = (source, trust, over = {}) => Object.assign({ source, trust, count: 1, usedFallback: false, error: null }, over)

const derive = (connections, rows, authorised) => deriveCapabilityAwareness({
  connections,
  turnPerSource: rows,
  authorisedSources: authorised
})

const by = (out, key) => out.find((a) => a.source === key)

/* ═══ A-C — the turn axis ═══════════════════════════════════════════════════ */

test('*** ⛔ A — AVAILABLE AND SIMPLY NOT LOOKED AT — the case the guard calls "true" ***', () => {
  const out = derive([conn(AROMA)], [], [AROMA])
  const a = by(out, AROMA)
  assert.equal(a.availability, AVAILABILITY.AVAILABLE_TO_ATTEMPT)
  assert.equal(a.turnState, TURN_STATE.NOT_READ)
  assert.equal(a.routeAuthorised, true)
  assert.equal(a.unavailableReason, null)
})

test('*** B — a live row is a successful read, even with zero matching rows ***', () => {
  const a = by(derive([conn(AROMA)], [row(AROMA, 'live', { count: 0 })], [AROMA]), AROMA)
  assert.equal(a.turnState, TURN_STATE.READ_SUCCEEDED, 'zero MATCHING rows is still a successful read')
  assert.equal(a.availability, AVAILABILITY.AVAILABLE_TO_ATTEMPT)
})

test('*** ⛔ C — an attempted read that failed is NOT the same as never trying ***', () => {
  const a = by(derive([conn(AROMA)], [row(AROMA, 'unavailable')], [AROMA]), AROMA)
  assert.equal(a.turnState, TURN_STATE.READ_FAILED)
  assert.notEqual(a.turnState, TURN_STATE.NOT_READ)
  assert.equal(a.availability, AVAILABILITY.AVAILABLE_TO_ATTEMPT, 'the source is still attemptable')
})

/* ═══ D-H — the availability axis, every closed reason ══════════════════════ */

test('*** D-G — every unregistered reason is CURRENTLY_UNAVAILABLE and keeps its reason ***', () => {
  for (const reason of ['credential_missing', 'source_disabled', 'governance_disabled', 'registration_failed', 'master_disabled']) {
    const c = conn(AROMA, { registered: false, reason, enabled: reason !== 'source_disabled' && reason !== 'master_disabled' })
    const a = by(derive([c], [], [AROMA]), AROMA)
    assert.equal(a.availability, AVAILABILITY.CURRENTLY_UNAVAILABLE, reason)
    assert.equal(a.unavailableReason, reason, 'the closed reason must survive: ' + reason)
    assert.equal(a.turnState, TURN_STATE.NOT_READ, reason)
  }
})

test('*** ⛔ H — not_implemented is its own answer, not an unavailability ***', () => {
  const c = conn('development_record', { registered: false, reason: 'not_implemented', local: true, credentialState: 'not_required' })
  const a = by(derive([c], [], ['development_record']), 'development_record')
  assert.equal(a.availability, AVAILABILITY.NOT_IMPLEMENTED)
  assert.notEqual(a.availability, AVAILABILITY.CURRENTLY_UNAVAILABLE,
    '⛔ 「we never built it」 and 「it is switched off」 are different truths')
})

/* ═══ I — health may never be upgraded ═════════════════════════════════════ */

test('*** ⛔ I — registered=true NEVER becomes healthy/up ***', () => {
  const a = by(derive([conn(AROMA)], [row(AROMA, 'live')], [AROMA]), AROMA)
  const blob = JSON.stringify(a)
  for (const banned of ['"up"', 'healthy', 'degraded', '"down"']) {
    assert.equal(blob.includes(banned), false, '⛔ awareness claimed a health it cannot know: ' + banned)
  }
  assert.equal('health' in a, false, 'awareness does not restate health at all — P1-A1 owns it')
})

/* ═══ J — awareness may not widen entitlement ══════════════════════════════ */

test('*** ⛔ J — REGISTERED IS NOT AUTHORISED. Awareness may never widen the route ***', () => {
  /**
   * ⛔ THE BOUNDARY THIS WHOLE TRANCHE MUST NOT CROSS. gmail can be perfectly registered while
   * this turn's route granted only aroma_system. Reporting it as attemptable would be awareness
   * quietly becoming a second entitlement system.
   */
  const out = derive([conn(AROMA), conn('gmail')], [], [AROMA])
  assert.equal(by(out, AROMA).availability, AVAILABILITY.AVAILABLE_TO_ATTEMPT)

  const gmail = by(out, 'gmail')
  assert.equal(gmail.registered !== false, true, 'gmail really is registered')
  assert.equal(gmail.routeAuthorised, false)
  assert.equal(gmail.availability, AVAILABILITY.NOT_AUTHORISED_THIS_TURN,
    '⛔ a registered source became attemptable without the route granting it')
  assert.notEqual(gmail.availability, AVAILABILITY.AVAILABLE_TO_ATTEMPT)
})

/* ═══ K — operation grain must not be flattened away ═══════════════════════ */

test('*** ⛔ K — TWO AROMA OPERATIONS, ONE LIVE ONE FAILED, IS NOT "SUCCEEDED" ***', () => {
  /**
   * ⛔ MEASURED HISTORY: one source runs several operations in a turn, and the turn record is
   * keyed by the READ GRAIN precisely so purchasing cannot erase replenishment. Collapsing them
   * to a single source-level 「succeeded」 would delete the failure — the same class of loss.
   */
  const rows = [
    row(AROMA, 'live', { operation: INV, readKey: INV }),
    row(AROMA, 'unavailable', { operation: REPL, readKey: REPL })
  ]
  const a = by(derive([conn(AROMA)], rows, [AROMA]), AROMA)
  assert.equal(a.turnState, TURN_STATE.READ_MIXED, '⛔ a failed operation was hidden by a successful one')
  assert.equal(a.readCount, 2)
  assert.deepEqual(a.operations, [
    { operation: INV, turnState: TURN_STATE.READ_SUCCEEDED },
    { operation: REPL, turnState: TURN_STATE.READ_FAILED }
  ])
})

test('*** operation is null when the record carries none — never invented ***', () => {
  const a = by(derive([conn('gmail')], [row('gmail', 'live')], ['gmail']), 'gmail')
  assert.deepEqual(a.operations, [{ operation: null, turnState: TURN_STATE.READ_SUCCEEDED }])
})

/* ═══ purity and shape ═════════════════════════════════════════════════════ */

test('*** ⛔ THE MODULE IS PURE — it cannot reach the world ***', () => {
  /**
   * Asserted structurally rather than promised: a module that imports the connector, the flags
   * or googleAuth could build clients or read credential files during a turn. Its only inputs
   * are the arguments it is given.
   */
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'capabilityAwareness.js'), 'utf8')
  const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(requires, [], '⛔ the pure module gained an import: ' + JSON.stringify(requires))
  for (const banned of ['process.env', 'projectConnections', 'createLiveReadConnector', 'credsPresent', 'fetch(']) {
    assert.equal(src.includes(banned), false, '⛔ the pure module reached the world via: ' + banned)
  }
})

test('*** THE RECORD IS CLOSED, AND EVERY ENUM IS FROM ITS VOCABULARY ***', () => {
  const rows = [row(AROMA, 'live', { operation: INV })]
  const out = derive([conn(AROMA), conn('gmail', { registered: false, reason: 'credential_missing' })], rows, [AROMA])
  for (const a of out) {
    assert.deepEqual(Object.keys(a).sort(),
      ['availability', 'operations', 'readCount', 'routeAuthorised', 'source', 'turnState', 'unavailableReason'].sort(),
      '⛔ a key appeared on Awareness: ' + JSON.stringify(Object.keys(a)))
    assert.ok(Object.values(AVAILABILITY).includes(a.availability))
    assert.ok(Object.values(TURN_STATE).includes(a.turnState))
    assert.equal(typeof a.routeAuthorised, 'boolean')
    assert.ok(Number.isInteger(a.readCount))
  }
})

test('*** ⛔ NO SECRET, ROW CONTENT OR ERROR TEXT MAY APPEAR ***', () => {
  const rows = [row(AROMA, 'unavailable', {
    operation: INV,
    error: 'AROMA_SYSTEM_KEY=sk-SECRET_MUST_NOT_APPEAR rejected by https://internal/host',
    items: [{ title: 'Napa Cabbage', supplier: 'Costco' }]
  })]
  const blob = JSON.stringify(derive([conn(AROMA)], rows, [AROMA]))
  for (const banned of ['sk-SECRET_MUST_NOT_APPEAR', 'Napa Cabbage', 'Costco', 'internal/host', 'AROMA_SYSTEM_KEY', 'rejected by']) {
    assert.equal(blob.includes(banned), false, '⛔ content reached awareness: ' + banned)
  }
})

test('*** MALFORMED INPUT FAILS CLOSED, NEVER OPEN ***', () => {
  assert.deepEqual(deriveCapabilityAwareness(), [])
  assert.deepEqual(deriveCapabilityAwareness({}), [])
  assert.deepEqual(deriveCapabilityAwareness({ connections: null, turnPerSource: null, authorisedSources: null }), [])
  // A connection with no authorised list may never be attemptable.
  const a = by(deriveCapabilityAwareness({ connections: [conn(AROMA)], turnPerSource: [], authorisedSources: undefined }), AROMA)
  assert.equal(a.availability, AVAILABILITY.NOT_AUTHORISED_THIS_TURN, '⛔ absent authorisation defaulted to permitted')
})

test('*** ⛔ THE SHADOW MAY NEVER TOUCH THE OWNER-VISIBLE REPLY ***', () => {
  /**
   * ⛔ PROVEN ONCE BY HAND IS NOT PROVEN. The byte-identical acceptance was run by physically
   * removing the block from intakeService.js and re-running four real turns through
   * processIntake — same digests. That proof cannot re-run itself, so the property it
   * established is pinned here: the block contains NO assignment and NO reply read, and it is
   * wrapped so that a measurement can never break a turn.
   *
   * `enforceNoReadClaim`, three lines above, DOES assign to `guarded.reply`. That is exactly
   * why the distinction has to be defended rather than assumed.
   */
  const fs = require('node:fs')
  const path = require('node:path')
  const svc = fs.readFileSync(path.join(__dirname, 'intakeService.js'), 'utf8')

  const sig = 'function emitCapabilityAwarenessShadow ('
  const start = svc.indexOf(sig)
  assert.notEqual(start, -1, 'the P1-A2 shadow helper is missing from intakeService.js')
  const tail = svc.indexOf('catch (_)', start)
  assert.notEqual(tail, -1, '⛔ the shadow is not wrapped — a measurement could break a turn')
  /**
   * ⛔ CODE ONLY. An earlier version of this test sliced from the comment marker and scanned the
   * prose with it — so it went red on the very sentence explaining that the block does not touch
   * the reply. A check that measures prose instead of behaviour is the failure mode this
   * repository keeps finding; it was fixed rather than loosened.
   */
  const body = svc.slice(start, tail)
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.ok(body.includes('deriveCapabilityAwareness('), 'the slice must contain the real call')
  assert.ok(/\btry\s*\{/.test(body), 'the helper body must be inside a try')
  for (const forbidden of ['guarded.reply', 'distilled.reply', 'reply =', '.reply']) {
    assert.equal(body.includes(forbidden), false,
      '⛔ the helper touches the reply — it is no longer shadow-only: ' + forbidden)
  }
  // It is never even PASSED the reply: the parameter list is the whole contract.
  const params = svc.slice(start + sig.length, svc.indexOf(')', start))
  assert.deepEqual(params.replace(/[{}\s]/g, '').split(',').sort(),
    ['authorisedSources', 'path', 'requestId', 'route', 'turnPerSource'],
    '⛔ the helper signature changed — it must never receive the reply')
})

test('*** A Map IS ACCEPTED AS WELL AS AN ARRAY — the turn record is a Map today ***', () => {
  // intakeService holds turnPerSource as a Map whose KEYS are mixed grain (source or readKey);
  // the row's own `source` is the authority, which is why only values are read.
  const m = new Map([['aroma_system.inventory', row(AROMA, 'live', { operation: INV })]])
  const a = by(deriveCapabilityAwareness({ connections: [conn(AROMA)], turnPerSource: m, authorisedSources: [AROMA] }), AROMA)
  assert.equal(a.turnState, TURN_STATE.READ_SUCCEEDED, '⛔ a Map keyed by read grain was misread')
})

/* ═══ REACHABILITY — REAL TURNS THROUGH processIntake ══════════════════════ */

/**
 * ⛔ THESE DRIVE THE REAL PIPELINE, NOT THE HELPER, AND THAT IS THE WHOLE POINT.
 *
 * The defect this amendment fixes was invisible to every direct-invocation test: the derivation
 * was correct and simply was never reached on ordinary traffic, because the anchor beside
 * `enforceNoReadClaim` only ever runs on commit interception. Running a turn found it; only
 * running a turn can defend it. `logNoEvidenceShadow` made the identical mistake first.
 *
 * The fakes are the shapes src/intake/a4E2eMatrix.test.js already uses.
 */
const { processIntake } = require('./intakeService')
const connectionState = require('../context/connectionState')
const awarenessModule = require('./capabilityAwareness')

const NOW = '2026-08-09T00:00:00.000Z'
const MARK = '[AROMA-CAPABILITY-AWARENESS]'

function fakeConnector () {
  const reads = []
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push(method)
        const rows = [{ source, sourceId: '7', title: 'Beef Brisket', entityType: 'purchase_order', content: 'supplier=Gordon', fields: { id: '7', supplier: 'Gordon' }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
        return { asOf: NOW, source, count: 1, results: rows, evidence: { source, endpoint: method, entityType: 'purchase_order', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'FAKE INTERNAL' } }
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
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error('adapter called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'claude', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const CHAT_FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const COMMIT_FINAL = (reply) => ({ intent: 'instruction', mode: 'commit', reply, nextRead: null, answerPlan: null, tasks: [] })

const ENV = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }

async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/** Runs one real turn, capturing every awareness record it emits. */
async function runTurn (message, envelope) {
  const c = fakeConnector()
  const a = scriptedAdapter([envelope])
  const records = []
  const realLog = console.log
  console.log = (...args) => {
    if (args[0] === MARK) { try { records.push(JSON.parse(args[1])) } catch (_) { records.push({ unparseable: true }) } }
  }
  let out
  try {
    out = await withEnv(() => processIntake(message, a, [], {
      demo: true,
      interactionMode: 'chat',
      providerHint: 'claude',
      requestId: '11111111-2222-4333-8444-555555555555',
      readContextDeps: { connector: c.connector, sources: ['aroma_system'], sourceIntentResolver: async () => ({ intent: 'internal' }) }
    }))
  } finally { console.log = realLog }
  return { out, records, reads: c.reads, adapterCalls: a.calls.length }
}

const sha = (s) => require('node:crypto').createHash('sha256').update(String(s), 'utf8').digest('hex')

test('*** ⛔ A + G — ORDINARY CHAT REACHES THE SHADOW (the defect this amendment fixes) ***', async () => {
  /**
   * ⛔ THE HISTORICAL SHAPE: the Owner asks about a readable internal source, NO read happens,
   * and the turn goes down the ordinary chat path. That is the 2026-08-08 turn. Before this
   * amendment the shadow emitted NOTHING here.
   *
   * Reachability only. The ANSWER is deliberately not corrected — P1-A2 measures first.
   */
  /**
   * ⛔ THE MESSAGE NAMES THE SOURCE AND NO BUSINESS ENTITY, WHICH IS WHY NOTHING IS READ. That
   * is the recorded shape of the incident: the turn routed CONVERSATION with sourcesRead: [],
   * and the reply then denied a capability that was actually present. A message like
   * 「我哋而家啲庫存點呀？」 would trigger the automatic read and stop being this case.
   */
  const t = await runTurn('你而家連唔連到 Aroma System？', CHAT_FINAL('我暫時未睇到，你想我睇邊方面？'))
  assert.equal(t.reads.length, 0, 'the fixture must be the no-read shape')
  assert.equal(t.records.length, 1, '⛔ ordinary chat emitted no awareness record — the shadow is blind to real traffic')
  assert.equal(t.records[0].path, awarenessModule.AWARENESS_PATH.CHAT)
  assert.ok(Array.isArray(t.records[0].sources) && t.records[0].sources.length > 0)
})

test('*** B — COMMIT INTERCEPTION STILL REACHES THE SHADOW ***', async () => {
  const t = await runTurn('幫我記低：聽日要叫牛胸肉。', COMMIT_FINAL('收到，我記低咗。'))
  assert.equal(t.records.length, 1, '⛔ commit interception lost its record while the chat path was added')
  assert.equal(t.records[0].path, awarenessModule.AWARENESS_PATH.COMMIT_INTERCEPT)
})

test('*** ⛔ C + D — EXACTLY ONE RECORD PER TURN, CARRYING ITS OWN CLOSED PATH ***', async () => {
  /**
   * The two branches are mutually exclusive (`mode === 'commit'` against `mode !== 'commit'`),
   * so 2 would double-count every measurement and 0 would mean a blind path. Both look like
   * working telemetry from outside, which is why this is asserted rather than reasoned about.
   */
  const chat = await runTurn('今日點呀？', CHAT_FINAL('幾好呀。'))
  const commit = await runTurn('幫我記低：聽日叫貨。', COMMIT_FINAL('收到。'))

  assert.equal(chat.records.length, 1, 'ordinary chat: exactly one')
  assert.equal(commit.records.length, 1, 'commit interception: exactly one')
  assert.equal(chat.records[0].path, 'chat')
  assert.equal(commit.records[0].path, 'commit_intercept')
  assert.notEqual(chat.records[0].path, commit.records[0].path, 'the two paths must be distinguishable')
  for (const r of [chat.records[0], commit.records[0]]) {
    assert.ok(Object.values(awarenessModule.AWARENESS_PATH).includes(r.path),
      '⛔ a free-text path escaped the closed vocabulary: ' + r.path)
  }
})

/**
 * Disables the shadow at its outermost step, so the helper produces nothing at all. This is both
 * the 「removed」 arm of the byte-identical proof and the forced failure for containment. It is
 * possible only because intakeService holds the MODULE rather than a destructured binding.
 */
async function withShadowBroken (fn) {
  const real = connectionState.projectConnections
  let called = 0
  connectionState.projectConnections = () => {
    called++
    throw new Error('FORCED SHADOW FAILURE at https://internal.example/h token=SHOULD_NOT_APPEAR')
  }
  try { return Object.assign(await fn(), { brokenCalls: () => called }) } finally { connectionState.projectConnections = real }
}

test('*** ⛔ E — OWNER REPLY BYTES IDENTICAL WITH THE SHADOW ON AND OFF — BOTH PATHS ***', async () => {
  const cases = [
    ['chat', '我哋而家啲庫存點呀？', CHAT_FINAL('我暫時未睇到。')],
    ['commit_intercept', '幫我記低：聽日叫貨。', COMMIT_FINAL('收到。')]
  ]
  for (const [label, msg, envelope] of cases) {
    const on = await runTurn(msg, envelope)
    const off = await withShadowBroken(() => runTurn(msg, envelope))
    assert.equal(on.records.length, 1, label + ': the ON arm must actually have emitted')
    assert.equal(off.records.length, 0, label + ': the OFF arm must actually have been disabled')
    assert.ok(off.brokenCalls() > 0, label + ': the seam must really have been exercised')
    assert.equal(sha(on.out.reply), sha(off.out.reply), '⛔ ' + label + ': the shadow changed the Owner-visible reply')
    assert.equal(on.out.reply, off.out.reply)
  }
})

test('*** ⛔ F — A BROKEN SHADOW MAY NOT BREAK, REROUTE, RE-READ OR RE-PROMPT A TURN ***', async () => {
  const msg = '我哋而家啲庫存點呀？'
  const envelope = CHAT_FINAL('我暫時未睇到。')
  const ok = await runTurn(msg, envelope)
  const broken = await withShadowBroken(() => runTurn(msg, envelope))

  assert.equal(broken.out.blocked, ok.out.blocked, 'the turn still completes')
  assert.equal(broken.out.reply, ok.out.reply, 'byte-identical reply')
  assert.equal(broken.out.mode, ok.out.mode, '⛔ routing changed')
  assert.equal(broken.reads.length, ok.reads.length, '⛔ read execution changed')
  assert.equal(broken.adapterCalls, ok.adapterCalls, '⛔ an extra model call was made')
  assert.equal(broken.adapterCalls, 1, 'one scripted completion, no retry')
})

test('*** ⛔ TELEMETRY CARRIES NO CONTENT, AND NO FIELD BEYOND THE STRUCTURAL SET ***', async () => {
  const t = await runTurn('Gordon 嘅牛胸肉幾多錢？', CHAT_FINAL('我未睇到 Gordon 嘅牛胸肉價錢。'))
  assert.equal(t.records.length, 1)
  const blob = JSON.stringify(t.records[0])
  for (const banned of ['Gordon', '牛胸肉', '我未睇到', 'Beef Brisket', 'FORCED SHADOW FAILURE', 'internal.example']) {
    assert.equal(blob.includes(banned), false, '⛔ content reached telemetry: ' + banned)
  }
  assert.deepEqual(Object.keys(t.records[0]).sort(),
    ['availableNotRead', 'path', 'requestId', 'route', 'sources'],
    '⛔ a field appeared on the awareness record: ' + JSON.stringify(Object.keys(t.records[0])))
})

test('*** THE PATH VOCABULARY IS CLOSED AND FROZEN ***', () => {
  assert.deepEqual(awarenessModule.AWARENESS_PATH, { CHAT: 'chat', COMMIT_INTERCEPT: 'commit_intercept' })
  assert.equal(Object.isFrozen(awarenessModule.AWARENESS_PATH), true)
})
