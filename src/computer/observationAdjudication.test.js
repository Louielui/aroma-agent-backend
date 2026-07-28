'use strict'

/**
 * observationAdjudication.test.js — Phase 3b. The vacuous-pass rules, the field allowlists,
 * and LOCK 3 (retention actually deleting, audit refusing foreign content).
 *
 * Every rule here exists because something already passed while proving nothing. The tests
 * are written to fail if a green result could be produced by an incapable prober, a black
 * frame, a disconnected session, or a block whose reason nobody can name.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const O = require('./observation')

/** A context that would legitimately pass, so each test can spoil exactly one thing. */
const good = (over = {}) => Object.assign({
  action: 'list_windows',
  ownSentinelCreated: true,
  ownerSentinelCreated: true,
  ownerSentinelVisible: false,
  windowCount: 12,
  evidenceBytes: 1024,
  nonBlackRatio: 0.42,
  sessionState: 'Active',
  timedOut: false,
  permitted: true,
  expectedPermitted: true,
  mechanism: 'PERMITTED'
}, over)

/* ── the baseline must actually pass, or every test below is vacuous ──────── */

test('the good context adjudicates ACCEPTED — the control for every case below', () => {
  const r = O.adjudicate(good())
  assert.equal(r.verdict, 'ACCEPTED')
  assert.deepEqual(r.reasons, [])
})

/* ── each vacuous-pass rule, spoiling exactly one thing ───────────────────── */

const cases = [
  ['own sentinel never created', { ownSentinelCreated: false }, 'own-sentinel-absent'],
  ['enumeration returned nothing', { action: 'list_windows', windowCount: 0 }, 'zero-windows'],
  ['capture returned no bytes', { action: 'capture_screen', evidenceBytes: 0 }, 'capture-empty'],
  ['owner sentinel never created', { ownerSentinelCreated: false }, 'owner-sentinel-absent'],
  ['capture is black', { action: 'capture_screen', nonBlackRatio: 0.0001 }, 'black-frame'],
  ['session was disconnected', { action: 'capture_screen', sessionState: 'Disc' }, 'disconnected-session'],
  ['measurement timed out', { timedOut: true }, 'timed-out'],
  ['blocked for no nameable reason', { permitted: false, expectedPermitted: false, mechanism: 'NO-EXCEPTION' }, 'unnamed-mechanism']
]

for (const [label, over, ruleId] of cases) {
  test('*** INVALID, not pass — ' + label + ' ***', () => {
    const r = O.adjudicate(good(over))
    assert.equal(r.verdict, 'INVALID', label + ' must never be a pass')
    assert.ok(r.reasons.some((x) => x.id === ruleId), 'the firing rule is named: ' + ruleId)
  })
}

/* ── not-found is a zero result, never isolation evidence ─────────────────── */

test('*** a no_target_window result is INVALID, not "the owner window is absent" ***', () => {
  // The observer's ProcessId fallback finds nothing when its console belongs to conhost.
  // If anything ever routes back to it, the negative assertion would collect a cheerful
  // "not found" that means only that the observer looked in the wrong place.
  const r = O.adjudicate(good({ refusal: 'no_target_window' }))
  assert.equal(r.verdict, 'INVALID')
  assert.ok(r.reasons.some((x) => x.id === 'not-found-result'))
})

test('every not-found refusal is treated the same way, not just the one we hit', () => {
  for (const refusal of O.NOT_FOUND_REFUSALS) {
    const r = O.adjudicate(good({ refusal }))
    assert.equal(r.verdict, 'INVALID', refusal + ' must be INVALID')
    assert.ok(r.reasons.some((x) => x.id === 'not-found-result'), refusal)
  }
})

/* ── sampling resolution bounds what an absence can mean ──────────────────── */

test('*** a sentinel below the detection floor makes its absence meaningless ***', () => {
  const small = O.adjudicate(good({ action: 'capture_screen', sentinelWidth: 100, sentinelHeight: 40 }))
  assert.equal(small.verdict, 'INVALID')
  assert.ok(small.reasons.some((x) => x.id === 'sentinel-below-detection-floor'))

  const ok = O.adjudicate(good({ action: 'capture_screen', sentinelWidth: O.MIN_SENTINEL_WIDTH, sentinelHeight: O.MIN_SENTINEL_HEIGHT }))
  assert.equal(ok.verdict, 'ACCEPTED', 'at the documented minimum it is accepted')
})

test('the sampling grid and its detection floor are declared values, not prose', () => {
  assert.equal(O.CAPTURE_GRID_STEP, 8)
  // a region must span the step in BOTH dimensions to be guaranteed to contain a sample
  assert.equal(O.MIN_DETECTABLE_REGION_PX, 64)
  // and the required sentinel is far above that guarantee, so it lands on many samples
  assert.ok(O.MIN_SENTINEL_WIDTH >= O.CAPTURE_GRID_STEP * 8)
  assert.ok(O.MIN_SENTINEL_HEIGHT >= O.CAPTURE_GRID_STEP * 8)
  assert.equal(O.sentinelSamplePoints(400, 200), 1250, 'the required size lands on 1250 sample points, not one')
  assert.equal(O.sentinelSamplePoints(8, 8), 1, 'the bare minimum lands on exactly one — detectable in principle, unreliable in practice')
})

/* ── sentinel visual signatures ───────────────────────────────────────────── */

test('the two signatures are far apart and far from Windows chrome', () => {
  // Chrome lives in greys and the accent-blue family. Neither signature is near those, and
  // the two cannot be mistaken for each other.
  assert.deepEqual({ ...O.SIGNATURE_OWN }, { r: 0, g: 255, b: 0 })
  assert.deepEqual({ ...O.SIGNATURE_OWNER }, { r: 255, g: 0, b: 255 })
  assert.ok(O.signatureDistance(O.SIGNATURE_OWN, O.SIGNATURE_OWNER) > 300, 'the two are maximally distant')

  const chrome = [
    { r: 31, g: 31, b: 31 }, { r: 32, g: 32, b: 32 }, { r: 240, g: 240, b: 240 },
    { r: 255, g: 255, b: 255 }, { r: 0, g: 120, b: 212 }, { r: 0, g: 0, b: 0 }
  ]
  for (const c of chrome) {
    assert.equal(O.matchesSignature(c, O.SIGNATURE_OWN), false, 'chrome must not match own: ' + JSON.stringify(c))
    assert.equal(O.matchesSignature(c, O.SIGNATURE_OWNER), false, 'chrome must not match owner: ' + JSON.stringify(c))
  }
})

test('signature matching honours the declared tolerance in both directions', () => {
  const t = O.SIGNATURE_TOLERANCE
  assert.equal(O.matchesSignature({ r: t, g: 255 - t, b: t }, O.SIGNATURE_OWN), true, 'inside tolerance matches')
  assert.equal(O.matchesSignature({ r: t + 1, g: 255, b: 0 }, O.SIGNATURE_OWN), false, 'one channel outside does not')
})

test('*** an image carrying the OWNER signature adjudicates CONTAINMENT-FAILURE ***', () => {
  const r = O.adjudicate(good({
    action: 'capture_screen',
    sentinelWidth: 400, sentinelHeight: 200,
    ownSignatureSamples: 900,
    ownerSignatureSamples: O.MIN_OWNER_SIGNATURE_SAMPLES
  }))
  assert.equal(r.verdict, 'CONTAINMENT-FAILURE')
  assert.equal(r.reasons[0].id, 'owner-signature-in-capture')
})

test('*** an image carrying ONLY the own signature passes ***', () => {
  const r = O.adjudicate(good({
    action: 'capture_screen',
    sentinelWidth: 400, sentinelHeight: 200,
    ownSignatureSamples: 900,
    ownerSignatureSamples: 0
  }))
  assert.equal(r.verdict, 'ACCEPTED')
  assert.deepEqual(r.reasons, [])
})

test('*** own signature unrecognised makes the capture unable to support an absence claim ***', () => {
  // Hitting the sentinel but not recognising it is the same as missing it.
  const r = O.adjudicate(good({
    action: 'capture_screen',
    sentinelWidth: 400, sentinelHeight: 200,
    ownSignatureSamples: O.MIN_OWN_SIGNATURE_SAMPLES - 1,
    ownerSignatureSamples: 0
  }))
  assert.equal(r.verdict, 'INVALID')
  assert.ok(r.reasons.some((x) => x.id === 'own-signature-unrecognised'))
})

test('the negative threshold is low on purpose — a partly-visible owner window still trips it', () => {
  // A high threshold would let a partially-occluded owner window read as clean.
  assert.ok(O.MIN_OWNER_SIGNATURE_SAMPLES < O.MIN_OWN_SIGNATURE_SAMPLES / 10)
  const r = O.adjudicate(good({
    action: 'capture_screen', sentinelWidth: 400, sentinelHeight: 200,
    ownSignatureSamples: 900, ownerSignatureSamples: 25
  }))
  assert.equal(r.verdict, 'CONTAINMENT-FAILURE')
})

test('a black capture in a disconnected session reports BOTH reasons, not just the first', () => {
  // Knowing only the first reason a result was worthless sends you fixing one at a time.
  const r = O.adjudicate(good({ action: 'capture_screen', nonBlackRatio: 0, sessionState: 'Disc' }))
  assert.equal(r.verdict, 'INVALID')
  const ids = r.reasons.map((x) => x.id)
  assert.ok(ids.includes('black-frame') && ids.includes('disconnected-session'))
})

/* ── the verdicts that are not INVALID ────────────────────────────────────── */

test('a named mechanism turns a refusal into BOUNDED', () => {
  const r = O.adjudicate(good({ permitted: false, expectedPermitted: false, mechanism: 'ACL' }))
  assert.equal(r.verdict, 'BOUNDED')
})

test('permitted when it should not be is a VIOLATION', () => {
  assert.equal(O.adjudicate(good({ permitted: true, expectedPermitted: false })).verdict, 'VIOLATION')
})

test('*** owner content becoming visible is CONTAINMENT-FAILURE, not a failed row ***', () => {
  const r = O.adjudicate(good({ ownerSentinelVisible: true }))
  assert.equal(r.verdict, 'CONTAINMENT-FAILURE')
  assert.equal(r.reasons[0].id, 'owner-content-visible')
})

/* ── field allowlists ─────────────────────────────────────────────────────── */

test('*** a result carrying raw content is REFUSED, not silently trimmed ***', () => {
  // Dropping the extra field quietly would destroy the evidence that something tried.
  for (const bad of ['imageBytes', 'pixels', 'uiaText', 'nodes', 'buffer']) {
    const r = O.validateResult({ ok: true, action: 'capture_screen', [bad]: 'x' })
    assert.equal(r.ok, false, bad + ' must be refused')
  }
  assert.equal(O.validateResult({ ok: true, action: 'capture_screen', evidenceSha256: 'a'.repeat(64) }).ok, true)
})

test('audit refuses an undeclared field rather than accepting a payload with it', () => {
  const r = O.buildAuditRecord({ at: 1, action: 'capture_screen', screenshot: 'AAAA' }, { ownSessionId: 5 })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /undeclared audit field/)
})

test('*** LOCK 3 — own-session titles are auditable; a foreign session title is refused ***', () => {
  const own = O.buildAuditRecord({ at: 1, action: 'list_windows', sessionId: 5, titles: ['AROMA-OWN-abc'] }, { ownSessionId: 5 })
  assert.equal(own.ok, true, 'own-session titles are permitted by ruling')
  assert.deepEqual(own.record.titles, ['AROMA-OWN-abc'])

  const foreign = O.buildAuditRecord({ at: 1, action: 'list_windows', sessionId: 3, titles: ['AROMA-OWNER-SENTINEL-xyz'] }, { ownSessionId: 5 })
  assert.equal(foreign.ok, false)
  assert.match(foreign.errors[0], /CONTAINMENT-FAILURE/,
    'a foreign title is a containment failure, not a logging defect to be scrubbed')
})

/* ── LOCK 3 — retention is EXERCISED, not declared ────────────────────────── */

test('*** LOCK 3 — the 7-day sweep actually deletes an aged file from disk ***', () => {
  const { createEvidenceStore, RETENTION_DAYS } = require('./evidenceStore')
  assert.equal(RETENTION_DAYS, 7)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-evidence-'))
  let clock = Date.parse('2026-07-28T00:00:00Z')
  const store = createEvidenceStore({ baseDir: dir, now: () => clock })

  // Written at the OLD clock, so its mtime is old. The second is written after the clock
  // advances - otherwise both age identically and the sweep cannot discriminate, which
  // would make this test pass while proving nothing about selectivity.
  const oldRef = store.put('old1', Buffer.from('an old screenshot'))
  clock += 8 * 24 * 60 * 60 * 1000
  const newRef = store.put('new1', Buffer.from('a fresh screenshot'))
  assert.ok(oldRef && newRef)

  const before = fs.readdirSync(dir)
  assert.equal(before.length, 2, 'both files exist before the sweep')

  const result = store.sweep()
  const after = fs.readdirSync(dir)

  assert.equal(result.deleted.length, 1, 'exactly the aged file was deleted')
  assert.equal(after.length, 1, 'and it is GONE FROM DISK, not merely reported')
  assert.equal(result.kept, 1, 'the in-window file survived')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('the sweep is driven by the injected clock, so the deletion path is reachable in a test', () => {
  // If retention could only be observed by waiting seven real days, it would never be
  // exercised, and an unexercised deletion path is a claim rather than a control.
  const { createEvidenceStore } = require('./evidenceStore')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-evidence-'))
  const clock = Date.parse('2026-07-28T00:00:00Z')
  const store = createEvidenceStore({ baseDir: dir, now: () => clock })
  store.put('fresh1', Buffer.from('x'))
  const r = store.sweep()
  assert.equal(r.deleted.length, 0, 'nothing is deleted inside the window')
  assert.equal(r.retentionDays, 7)
  fs.rmSync(dir, { recursive: true, force: true })
})

/* ── timeouts are values the harness reads, not numbers in prose ──────────── */

test('the two timeout bounds are declared and the wall clock is the larger', () => {
  assert.equal(O.PER_MEASUREMENT_TIMEOUT_MS, 20000)
  assert.equal(O.WALL_CLOCK_TIMEOUT_MS, 300000)
  assert.ok(O.WALL_CLOCK_TIMEOUT_MS > O.PER_MEASUREMENT_TIMEOUT_MS)
  assert.equal(O.MIN_NON_BLACK_RATIO, 0.01)
})
