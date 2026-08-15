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
  mechanism: 'PERMITTED',
  // M3: the same-round baseline, taken by the harness before any sentinel is opened
  sameRoundBaseline: true,
  baselineOwnHits: 0,
  baselineOwnerHits: 0,
  baselineDpiMatchesGate: true
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

/* ── read_uia_tree had NO vacuous-pass rule at all ────────────────────────── */

/** A UIA context that would legitimately pass, so each case below spoils exactly one thing. */
const goodUia = (over = {}) => good(Object.assign({
  action: 'read_uia_tree', nodeCount: 37, nodeReadFailures: 0, evidenceBytes: 1_842
}, over))

test('the good UIA context adjudicates ACCEPTED — the control for the three cases below', () => {
  assert.equal(O.adjudicate(goodUia()).verdict, 'ACCEPTED')
})

test('*** a zero-node UIA read is INVALID, and once was not ***', () => {
  // MEASURED, not hypothetical. The stored artefact for POS-read_uia_tree-own is 0 bytes.
  // list_windows had zero-windows and capture_screen had capture-empty; read_uia_tree had
  // nothing, so the observer's `ok = true` carried the row straight to ACCEPTED. A positive
  // control exists for exactly one reason — to show the observer is not blind — so a
  // control that read nothing is not a weak control, it is NO control, and every negative
  // resting on it was unsupported.
  for (const over of [{ nodeCount: 0 }, { nodeCount: null }, { nodeCount: undefined }]) {
    const r = O.adjudicate(goodUia(over))
    assert.equal(r.verdict, 'INVALID', JSON.stringify(over))
    assert.ok(r.reasons.some((x) => x.id === 'uia-zero-nodes'))
  }
})

test('*** an empty UIA artefact is INVALID even if a node count is reported ***', () => {
  // Both directions matter: nodes counted but nothing stored is the shape the 0-byte file
  // would take if the per-node reads had failed rather than the tree being empty.
  const r = O.adjudicate(goodUia({ nodeCount: 12, evidenceBytes: 0 }))
  assert.equal(r.verdict, 'INVALID')
  assert.ok(r.reasons.some((x) => x.id === 'uia-empty-evidence'))
})

test('*** swallowed per-node failures make the node count meaningless ***', () => {
  // observer.ps1 caught and DISCARDED each node's property read failure, so N nodes could
  // yield zero text while still reporting N. Refuse, do not trim: the failures are counted
  // and the row is INVALID rather than tidied into a pass.
  const r = O.adjudicate(goodUia({ nodeReadFailures: 3 }))
  assert.equal(r.verdict, 'INVALID')
  assert.ok(r.reasons.some((x) => x.id === 'uia-node-read-failures'))
})

test('the UIA rules do not fire on the other two actions', () => {
  // A rule that fires everywhere would make every capture and every enumeration INVALID,
  // which is a different way of proving nothing.
  assert.equal(O.adjudicate(good({ action: 'list_windows', nodeCount: 0 })).verdict, 'ACCEPTED')
  assert.equal(O.adjudicate(good({
    action: 'capture_screen', sentinelWidth: 400, sentinelHeight: 200,
    ownSignatureSamples: 900, ownerSignatureSamples: 0, nodeCount: 0
  })).verdict, 'ACCEPTED')
})

test('nodeReadFailures is a COUNT and travels on both the result and the audit', () => {
  assert.ok(O.RESULT_FIELDS.includes('nodeReadFailures'))
  assert.ok(O.AUDIT_FIELDS.includes('nodeReadFailures'))
  // and it is a count, never text — the shape is the guarantee
  for (const banned of ['uiaText', 'nodes', 'nodeText']) {
    assert.equal(O.RESULT_FIELDS.includes(banned), false)
  }
})

/**
 * ⛔ ONE CASE DISABLED IN COMMIT A, AND NAMED RATHER THAN DROPPED.
 * It reads `scripts/computer/observer.ps1` to prove the PowerShell observer names a refusal
 * for every zero case. No PowerShell path is ported in this tranche, so the file is absent and
 * the case would assert against nothing. It travels with the observer script when that is
 * approved — it is not superseded, only out of scope here.
 */
test.skip('*** the observer names a refusal for each zero case, so no block is unexplained ***', () => {
  // Read from the script, because the observer is what actually produces the artefact and a
  // rule the producer does not honour is a rule in prose.
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'computer', 'observer.ps1'), 'utf8')
  for (const refusal of ['uia_zero_nodes', 'uia_empty_evidence', 'uia_node_read_failures']) {
    assert.ok(src.includes(refusal), 'observer.ps1 names the refusal ' + refusal)
  }
  assert.ok(src.includes('$failures++'), 'per-node failures are counted, not swallowed')
  assert.equal(/catch \{ \}\s*\r?\n\s*\}\s*\r?\n\s*\$bytes = \[Text\.Encoding\]/.test(src), false,
    'the empty catch before the byte join is gone')
})

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

test('*** the sampling arithmetic is stated in PHYSICAL pixels and still holds after DPI ***', () => {
  // Recomputed in the post-DPI-fix space rather than carried over. Measured: the capture is
  // 2496x1664 physical (it was reported as 1664x1109 while the process was DPI-unaware).
  assert.equal(O.COORDINATE_SPACE, 'physical')
  const capW = 2496, capH = 1664
  const totalSamples = Math.floor(capW / O.CAPTURE_GRID_STEP) * Math.floor(capH / O.CAPTURE_GRID_STEP)
  assert.equal(totalSamples, 64896, 'whole-screen sample count in the physical space')

  // The sentinel is specified in physical px with auto-scaling off, so its sample count is
  // unchanged by the fix - which is the point of specifying it there.
  assert.equal(O.sentinelSamplePoints(O.MIN_SENTINEL_WIDTH, O.MIN_SENTINEL_HEIGHT), 1250)

  // Both thresholds re-checked against the new numbers rather than assumed to survive.
  assert.ok(O.MIN_OWN_SIGNATURE_SAMPLES <= 1250 * 0.4, 'positive needs at most 40% of the sentinel')
  const negAreaPx = O.MIN_OWNER_SIGNATURE_SAMPLES * O.MIN_DETECTABLE_REGION_PX
  assert.equal(negAreaPx, 1280, 'negative trips on ~1280 physical px of owner colour, a ~36x36 patch')
  assert.ok(negAreaPx < O.MIN_SENTINEL_WIDTH * O.MIN_SENTINEL_HEIGHT * 0.02,
    'and that is under 2% of a sentinel, so a partly-visible owner window still trips it')
})

test('DPI is carried on both the result and the audit, not recorded once per machine', () => {
  for (const f of ['dpiAwareness', 'dpiX', 'scalingFactor', 'logicalWidth', 'physicalWidth', 'primaryScreen', 'sentinelScreen']) {
    assert.ok(O.RESULT_FIELDS.includes(f), 'result carries ' + f)
    assert.ok(O.AUDIT_FIELDS.includes(f), 'audit carries ' + f)
  }
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
  assert.deepEqual({ ...O.SIGNATURE_OWN }, { r: 32, g: 208, b: 64 })
  assert.deepEqual({ ...O.SIGNATURE_OWNER }, { r: 208, g: 32, b: 144 })
  assert.ok(O.signatureDistance(O.SIGNATURE_OWN, O.SIGNATURE_OWNER) > 250, 'the two are far apart')

  const chrome = [
    { r: 31, g: 31, b: 31 }, { r: 32, g: 32, b: 32 }, { r: 240, g: 240, b: 240 },
    { r: 255, g: 255, b: 255 }, { r: 0, g: 120, b: 212 }, { r: 0, g: 0, b: 0 }
  ]
  for (const c of chrome) {
    assert.equal(O.matchesSignature(c, O.SIGNATURE_OWN), false, 'chrome must not match own: ' + JSON.stringify(c))
    assert.equal(O.matchesSignature(c, O.SIGNATURE_OWNER), false, 'chrome must not match owner: ' + JSON.stringify(c))
  }
})

/* ── M3: the baseline must be from THIS round ─────────────────────────────── */

test('*** no same-round baseline makes every zero result meaningless ***', () => {
  // The Part A gate baseline is stale by the time Part B runs: a notification, a pop-up or
  // a stray window in between would invalidate it silently. A zero needs something from
  // this round to be zero against.
  const r = O.adjudicate(good({ sameRoundBaseline: false }))
  assert.equal(r.verdict, 'INVALID')
  assert.ok(r.reasons.some((x) => x.id === 'baseline-not-same-round'))
})

test('*** a contaminated baseline makes later hits unattributable ***', () => {
  for (const over of [{ baselineOwnHits: 1 }, { baselineOwnerHits: 1 }]) {
    const r = O.adjudicate(good(over))
    assert.equal(r.verdict, 'INVALID', JSON.stringify(over))
    assert.ok(r.reasons.some((x) => x.id === 'baseline-contaminated'))
  }
})

test('*** DPI drifting since the gate invalidates the coordinate arithmetic ***', () => {
  const r = O.adjudicate(good({ baselineDpiMatchesGate: false }))
  assert.equal(r.verdict, 'INVALID')
  assert.ok(r.reasons.some((x) => x.id === 'baseline-dpi-mismatch'))
})

test('the gate baseline and the same-round baseline are different obligations', () => {
  // Both must hold. Passing the Part A gate does not excuse the harness from re-measuring,
  // and a clean same-round baseline does not excuse skipping the gate.
  const gateOnly = O.adjudicate(good({ sameRoundBaseline: false, baselineOwnerHits: 0 }))
  assert.equal(gateOnly.verdict, 'INVALID')
  const sameRoundContaminated = O.adjudicate(good({ sameRoundBaseline: true, baselineOwnerHits: 3 }))
  assert.equal(sameRoundContaminated.verdict, 'INVALID')
})

test('*** wallpaper colour gamut must not trip either signature ***', () => {
  // The chrome test above covers window furniture. It does NOT cover the desktop, and
  // AromaOperator is a fresh profile carrying the Windows 11 default wallpaper, which is
  // full of purples and pink-magentas. The negative threshold is only 20 samples, so a
  // false CONTAINMENT-FAILURE is a live risk - and a false positive is worse than a miss,
  // because it stops everything to investigate something that did not happen.
  const wallpaper = [
    { r: 120, g: 80, b: 180 },   // mid purple
    { r: 200, g: 120, b: 220 },  // light purple
    { r: 230, g: 150, b: 240 },  // pink-magenta highlight
    { r: 100, g: 60, b: 140 },   // deep purple
    { r: 180, g: 100, b: 200 },
    { r: 240, g: 200, b: 250 },  // near-white pink
    { r: 60, g: 40, b: 90 },
    { r: 250, g: 180, b: 250 },  // brightest plausible pink
    { r: 0, g: 120, b: 215 },    // solid accent-blue desktop
    { r: 16, g: 124, b: 16 }     // Windows green, the closest common colour to the own signature
  ]
  for (const c of wallpaper) {
    assert.equal(O.matchesSignature(c, O.SIGNATURE_OWNER), false, 'wallpaper must not read as owner: ' + JSON.stringify(c))
    assert.equal(O.matchesSignature(c, O.SIGNATURE_OWN), false, 'wallpaper must not read as own: ' + JSON.stringify(c))
  }

  // WHY it holds, so the margin is understood rather than lucky: the owner signature needs
  // the GREEN channel at or below 12 while red and blue are at or above 243. Natural and
  // photographic imagery essentially never produces a bright magenta with no green in it -
  // purples carry substantial green. That is the discriminator, and it is why a measured
  // clean-desktop baseline of zero is still required before trusting it on this machine.
  const brightestPurple = { r: 250, g: 180, b: 250 }
  assert.ok(Math.abs(brightestPurple.g - O.SIGNATURE_OWNER.g) > O.SIGNATURE_TOLERANCE,
    'the green channel is what separates a real magenta signature from wallpaper purple')
})

test('*** neither signature may sit on the Windows console palette ***', () => {
  // THIS IS WHY THE COLOURS CHANGED. The first pair were pure green (0,255,0) and pure
  // magenta (255,0,255) - which are EXACTLY console Green and console Magenta. A single
  // line of magenta console text put 18 owner-signature hits into a clean-desktop baseline
  // and halted a real Part B run. The harness prints to that same console, so it could
  // have contaminated its own baseline with its own error message.
  //
  // Every channel must clear the tolerance against every palette entry, so no single
  // coincidence of two channels can bring one within range.
  const PALETTE = [
    [0, 0, 0], [0, 0, 128], [0, 128, 0], [0, 128, 128], [128, 0, 0], [128, 0, 128],
    [128, 128, 0], [192, 192, 192], [128, 128, 128], [0, 0, 255], [0, 255, 0],
    [0, 255, 255], [255, 0, 0], [255, 0, 255], [255, 255, 0], [255, 255, 255]
  ]
  for (const sig of [O.SIGNATURE_OWN, O.SIGNATURE_OWNER]) {
    for (const p of PALETTE) {
      const c = { r: p[0], g: p[1], b: p[2] }
      assert.equal(O.matchesSignature(c, sig), false,
        'console palette entry rgb(' + p.join(',') + ') must not match ' + JSON.stringify(sig))
      const minGap = Math.min(Math.abs(p[0] - sig.r), Math.abs(p[1] - sig.g), Math.abs(p[2] - sig.b))
      assert.ok(minGap > O.SIGNATURE_TOLERANCE,
        'every channel must clear tolerance against rgb(' + p.join(',') + '); closest was ' + minGap)
    }
  }
})

test('signature matching honours the declared tolerance in both directions', () => {
  // Written RELATIVE to the signature, not against hardcoded values. The first version
  // baked in the old pure-green numbers and broke the moment the colours moved off the
  // console palette - a test that has to be edited whenever the thing it guards changes is
  // not guarding it.
  const t = O.SIGNATURE_TOLERANCE
  const s = O.SIGNATURE_OWN
  assert.equal(O.matchesSignature({ r: s.r + t, g: s.g - t, b: s.b + t }, s), true, 'inside tolerance on every channel matches')
  assert.equal(O.matchesSignature({ r: s.r + t + 1, g: s.g, b: s.b }, s), false, 'one channel outside does not')
  assert.equal(O.matchesSignature({ r: s.r, g: s.g - t - 1, b: s.b }, s), false, 'and it is checked in both directions')
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
  // ⛔ FIXTURE MODERNISED, NOT WEAKENED. This positive control is here to prove a legitimate
  //    result still passes while raw content is refused. A successful capture must now carry its
  //    measurement, so the control carries one — the assertion is still that a valid result is
  //    accepted, and it would still fail if the allowlist started refusing declared fields.
  assert.equal(O.validateResult({ ok: true, action: 'capture_screen', evidenceSha256: 'a'.repeat(64), nonBlackRatio: 0.42 }).ok, true)
})

test('audit refuses an undeclared field rather than accepting a payload with it', () => {
  const r = O.buildAuditRecord({ at: 1, action: 'capture_screen', screenshot: 'AAAA' }, { ownSessionId: 5 })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /undeclared audit field/)
})

test('*** LOCK 3 — titles are EPHEMERAL ONLY; a durable record refuses them ***', () => {
  /**
   * ⛔ REWRITTEN, NOT DELETED — the ruling this test defended was withdrawn.
   *
   * It asserted own-session titles ARE auditable, per the ruling of 2026-07-31. On 2026-08-05
   * the Owner ruled the other way for anything durable — 「a window title can carry a customer
   * name or an email subject, and once it is in an offsite backup it is out」 — and this audit
   * mirrors to Backblaze nightly. A test still defending the old line would have made the
   * regression look like a pass, which is worse than having no test at all.
   *
   * The CONTAINMENT half is unchanged and still proven: a foreign title is not a redaction
   * case, it is evidence isolation failed. It moved to validateResult, where titles now
   * legitimately live, so closing the durable path did not close the proof with it.
   */
  const own = O.buildAuditRecord({ at: 1, action: 'list_windows', sessionId: 5, titles: ['AROMA-OWN-abc'] }, { ownSessionId: 5 })
  assert.equal(own.ok, false, '⛔ own-session titles reached a durable record')
  assert.match(own.errors[0], /EPHEMERAL/, 'the refusal explains itself: ' + JSON.stringify(own.errors))

  // the counts the record actually exists for are unaffected
  const counts = O.buildAuditRecord({ at: 1, action: 'list_windows', sessionId: 5, windowCount: 11 }, { ownSessionId: 5 })
  assert.equal(counts.ok, true, JSON.stringify(counts.errors))
  assert.equal('titles' in counts.record, false)

  // and a foreign session title is still a containment failure, on the ephemeral shape
  const foreign = O.validateResult({ ok: true, action: 'list_windows', sessionId: 3, titles: ['AROMA-OWNER-SENTINEL-xyz'], at: 1 }, { ownSessionId: 5 })
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

test('*** LOCK 3 — the sweep deletes the names that actually hold raw content ***', () => {
  // THE DEFECT THIS REPLACES: the sweep matched `ev_*.png` and nothing else, so every
  // artefact that actually holds pixels or UI text — stage3-capture-*, obs-*, obs-*.uia.txt
  // — was never swept, in any run, ever. The old test passed and was honest about what it
  // tested; it just did not test the files being produced. Exercised here against the REAL
  // names, with the deletion observed on disk.
  const { createEvidenceStore } = require('./evidenceStore')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-evidence-'))
  let clock = Date.parse('2026-07-20T00:00:00Z')
  const store = createEvidenceStore({ baseDir: dir, now: () => clock })

  const aged = [
    'ev_abc.png',
    'stage3-capture-005713.png',
    'stage3-owner-reference-32f6763b0bb5.png',
    'stage3-sentinel-own-deadbeef.png',
    'obs-20260728-120000.png',
    'obs-20260728-120000.uia.txt',
    // ⛔ RECLASSIFIED FOR E0-W1: it may carry window titles, so it ages out rather than
    // being the one artefact exempt from deletion. See evidenceStore.js.
    'observer-result.json'
  ]
  const records = [
    'stage3-manifest.json',
    'stage3-results.json',
    'stage3-STARTED-abc123.json',
    'stage3-COMPLETED-abc123.json',
    'stage3-topup-results-def456.json',
    'stage3-sentinel-owner-792a95043e4f.json',
    'stage3-clip-owner-abc.json',
    'stage3-uia.json',
    'sessiongate-backup-0123abcd.xml',
    'tierA-probe.out',
    // both of these were falling through as `unclassified` until 2026-07-29
    'observer-task-baseline.xml',
    'observer-task-baseline-pre-uiafix-20260729.xml'
    // ⛔ `observer-result.json` MOVED OUT OF THIS LIST FOR E0-W1. It was a never-swept record
    // on the rationale that it carries 「counts and own-session titles」 — the ruling withdrawn
    // on 2026-08-05. It is now aged raw content; see the `aged` list above.
  ]
  for (const n of aged.concat(records)) {
    fs.writeFileSync(path.join(dir, n), 'x')
    fs.utimesSync(path.join(dir, n), new Date(clock), new Date(clock))
  }
  // one raw artefact written INSIDE the window, so the sweep has to discriminate by age too
  clock += 8 * 24 * 60 * 60 * 1000
  fs.writeFileSync(path.join(dir, 'stage3-capture-235959.png'), 'x')
  fs.utimesSync(path.join(dir, 'stage3-capture-235959.png'), new Date(clock), new Date(clock))
  // and one nobody declared
  fs.writeFileSync(path.join(dir, 'something-nobody-declared.bin'), 'x')

  const r = store.sweep()

  assert.deepEqual(r.deleted.sort(), aged.slice().sort(), 'every aged raw artefact was deleted')
  for (const n of aged) {
    assert.equal(fs.existsSync(path.join(dir, n)), false, n + ' is GONE FROM DISK, not merely reported')
  }
  assert.equal(r.kept, 1, 'the in-window capture survived')
  assert.equal(fs.existsSync(path.join(dir, 'stage3-capture-235959.png')), true)

  // and the audit trail is untouched — deleting it would destroy the record of what the
  // pixels once showed, which is the opposite of what Lock 3 is for
  assert.deepEqual(r.retained.sort(), records.slice().sort())
  for (const n of records) assert.equal(fs.existsSync(path.join(dir, n)), true, n + ' must survive')

  // an artefact nobody declared is REPORTED, never deleted and never silently kept forever
  assert.deepEqual(r.unclassified, ['something-nobody-declared.bin'])
  assert.equal(fs.existsSync(path.join(dir, 'something-nobody-declared.bin')), true)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('*** the 0-byte UIA artefact that started this is swept like any other ***', () => {
  // obs-...uia.txt at 0 bytes was the artefact nobody could explain. Whatever its size, it
  // holds UI node text and it is on the deletion path.
  const { classify } = require('./evidenceStore')
  assert.equal(classify('obs-20260728-005713.uia.txt').kind, 'raw')
  assert.equal(classify('obs-20260728-005713.uia.txt').rule, 'observer-uia-text')
})

test('every raw-content and record rule is reachable and none overlaps', () => {
  // A rule that can never fire is decoration, and a name matching both sets would make the
  // outcome depend on evaluation order rather than on a decision.
  const E = require('./evidenceStore')
  const samples = {
    'ev_x.png': 'store-own',
    'stage3-capture-1.png': 'stage3-capture',
    'stage3-owner-reference-1.png': 'stage3-owner-reference',
    'stage3-sentinel-own-1.png': 'stage3-sentinel-shot',
    'obs-1.png': 'observer-capture',
    'obs-1.uia.txt': 'observer-uia-text',
    'observer-result.json': 'observer-result'
  }
  for (const [name, rule] of Object.entries(samples)) {
    const c = E.classify(name)
    assert.equal(c.kind, 'raw', name)
    assert.equal(c.rule, rule, name)
  }
  assert.deepEqual(E.RAW_CONTENT_PATTERNS.map((r) => r.id).sort(), Object.values(samples).sort(),
    'every raw rule has a sample above — an unreachable rule is decoration')
  for (const r of E.RECORD_PATTERNS) assert.ok(r.why && r.why.length > 10, r.id + ' says why it is retained')

  // the sentinel PNG and the sentinel ATTESTATION are different things and must not collide
  assert.equal(E.classify('stage3-sentinel-owner-792a.json').kind, 'record')
  assert.equal(E.classify('stage3-sentinel-own-792a.png').kind, 'raw')
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
