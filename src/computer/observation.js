'use strict'

/**
 * observation.js — Computer Operator v0, Phase 3b. THE OBSERVATION BOUNDARY.
 *
 * STAGE 1: SCAFFOLD ONLY. Every capability here is false and every request is refused.
 * The structure exists so that Lock 1 can be proven against the real module graph before
 * any capability is written — proving containment after building the thing being contained
 * is how you end up arguing instead of measuring.
 *
 * ── WHY OBSERVATION LIVES HERE AND NOT IN THE COMPANION ───────────────────────
 * The Companion's guarantee in 3a was "it cannot observe and it cannot act", asserted by
 * reading its source for banned tokens. 3b necessarily breaks the first half. Rather than
 * weaken that test into something vaguer, observation is moved behind this one module:
 *
 *   . the Companion keeps EVERY action assertion unchanged — no input synthesis, no file
 *     system, no process spawning, no app launch. Those are still proven by source scan.
 *   . observation tokens move here, where this file's own guard test governs them.
 *
 * The Companion goes from "can do nothing" to "can look, and still can do nothing". The
 * strength of the cannot-act proof is unchanged; see GOV-001 for the line-by-line record.
 *
 * ── LOCK 1: RAW CONTENT STRUCTURALLY CANNOT REACH A MODEL ─────────────────────
 * Not a rule, a shape. Nothing that could carry pixels or UI text is ever RETURNED:
 *
 *   . screenshot bytes    -> written to the evidence store, only a SHA-256 comes back
 *   . UIA node text       -> counted and shaped, never returned as text
 *   . other-session data  -> must not exist at all; if it appears that is a containment
 *                            failure, not a redaction problem
 *
 * A caller therefore cannot put raw observation into a prompt even by mistake, because it
 * never holds any. This module requires ONE local sibling — sealedOrderGate, which computes and
 * compares and cannot act — and nothing else: no LLM surface, no adapter, no context assembly.
 * Lock 1's require-graph proof asserts that the transitive walk still reaches no model surface.
 */

const gate = require('./sealedOrderGate')

/**
 * THE CLOSED SET. Observation only. Adding to this list is a capability change and an
 * Owner GO, not an edit — the same shape as the work-order enum.
 */
const OBSERVATION_ACTIONS = Object.freeze(['list_windows', 'read_uia_tree', 'capture_screen'])

/**
 * ── THE BOUNDARY MOVED ON 2026-07-31, AND THIS IS EXACTLY HOW FAR ─────────────
 * This list used to be one flat set described as "must NEVER appear however the module grows".
 * The Owner has ruled that four of them — open_app, type_text, send_keys, launch_app — become
 * DEFAULT DENY WITH ONE UNLOCK CONDITION rather than absolute, so the split is now explicit
 * and lives in sealedOrderGate.js, which is the only file that decides.
 *
 * Two things are worth being precise about, because they are easy to blur:
 *
 *   . NEVER_ACTIONS did not move. No order unlocks them, and the gate decides them before it
 *     reads an order at all.
 *   . The restricted four are still NEVER OBSERVATION ACTIONS. Nothing here performs them,
 *     with or without an order — observation is reading, and this module has no way to act.
 *     Their unlock path is the Companion, under a verified seal, and this module's refusal is
 *     unchanged in behaviour. What changed is that the refusal is no longer described as
 *     absolute, because system-wide it no longer is.
 */
const NEVER_ACTIONS = gate.NEVER_ACTIONS
const SEALED_ORDER_ACTIONS = gate.RESTRICTED_ACTIONS

/** Never an observation action — the union, which is what this module's own guard asserts. */
const FORBIDDEN_ACTIONS = Object.freeze([...NEVER_ACTIONS, ...SEALED_ORDER_ACTIONS])

/**
 * Stage 1 capability register: all false. Kept as data, like the Companion's, so the tests,
 * the report and the process answer from one object and cannot drift.
 */
const OBSERVATION_CAPABILITIES = Object.freeze({
  list_windows: false,
  read_uia_tree: false,
  capture_screen: false
})

const NO_CAPABILITY = 'no_capability_enabled'
const OUT_OF_SCOPE = 'action_not_in_observation_set'
const NOT_OBSERVATION = 'not_an_observation_action'

/**
 * Fields an observation result may ever expose. Anything not named here cannot be returned,
 * which is what keeps "no raw content" from depending on someone remembering it.
 *
 * ⛔ `titles` IS EPHEMERAL AND ONLY EPHEMERAL. It is returned to an authorised caller and is
 * never written: `AUDIT_FIELDS` below excludes it and `buildAuditRecord` refuses it by name.
 *
 * The earlier comment here said own-session titles were permitted IN THE AUDIT, by a ruling of
 * 2026-07-31. That was SUPERSEDED on 2026-08-05 — 「a window title can carry a customer name or
 * an email subject, and once it is in an offsite backup it is out」 — and `.aroma/computer-audit/`
 * mirrors to Backblaze nightly. Removing the capability entirely would leave `list_windows`
 * with no output, so the split is the fix: the caller may see them, nothing may keep them.
 *
 * Other-session titles remain a CONTAINMENT FAILURE rather than a redaction case — their
 * presence means isolation failed, and scrubbing them would destroy the only trace.
 */
const RESULT_FIELDS = Object.freeze([
  'ok', 'action', 'refusal', 'capability',
  'sessionId', 'windowStation', 'desktop', 'sessionState',
  'evidenceSha256', 'evidenceBytes', 'imageWidth', 'imageHeight',
  'windowCount', 'nodeCount', 'nodeReadFailures', 'titles', 'at',
  // DPI travels WITH each capture. Per-monitor awareness means it varies by screen, so a
  // capture recorded without it cannot be reasoned about after the fact — which is exactly
  // what made the earlier 1664x1109 numbers unusable.
  'dpiAwareness', 'dpiX', 'scalingFactor',
  'logicalWidth', 'logicalHeight', 'physicalWidth', 'physicalHeight',
  'primaryScreen', 'sentinelScreen', 'elapsedMs'
])

/**
 * Create an observer. Stage 1 takes no dependencies it could observe through: there is no
 * capture backend, no UIA binding, no window enumerator. Refusal is the only path.
 *
 * @param {{ now?: Function, capabilities?: object }} deps
 */
function createObserver (deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()

  // Capabilities may be narrowed by a caller but never widened beyond the stage-1 register.
  // A harness cannot turn something on that this build does not implement.
  const caps = Object.freeze(Object.assign({}, OBSERVATION_CAPABILITIES))

  /** Answer one observation request. Always a value, never a throw. */
  function observe (request) {
    const action = (request && typeof request.action === 'string') ? request.action : null
    const at = now()

    // A gated action reaching the OBSERVER is a routing mistake, not a permission question,
    // so it is named as one. Observation never performs these however well sealed the order.
    if (SEALED_ORDER_ACTIONS.includes(action)) {
      return { ok: false, action, refusal: NOT_OBSERVATION, capability: action, at }
    }
    if (!action || !OBSERVATION_ACTIONS.includes(action)) {
      return { ok: false, action, refusal: OUT_OF_SCOPE, at }
    }
    if (!caps[action]) {
      return { ok: false, action, refusal: NO_CAPABILITY, capability: action, at }
    }
    // Unreachable in stage 1 by construction: no capability is true. Left explicit rather
    // than absent so the refusal path is the default and an implementation has to be added
    // deliberately rather than fallen into.
    return { ok: false, action, refusal: NO_CAPABILITY, capability: action, at }
  }

  return {
    observe,
    capabilities: caps,
    actions: OBSERVATION_ACTIONS
  }
}

/** Is any observation capability enabled in this build? Stage 1: must be false. */
function anyObservationEnabled () {
  return Object.values(OBSERVATION_CAPABILITIES).some(Boolean)
}

/* ── TIMEOUTS ──────────────────────────────────────────────────────────────
 * A hung call is not a failure, it is an unbounded wait — and during Part B the Owner is
 * unreachable, so an unbounded wait is indistinguishable from success, from a crash, and
 * from a machine that needs rebooting. Both bounds are enforced, independently, so a run
 * of near-misses cannot accumulate past the wall clock.
 */
const PER_MEASUREMENT_TIMEOUT_MS = 20 * 1000
const WALL_CLOCK_TIMEOUT_MS = 5 * 60 * 1000

/**
 * A frame this dark is not evidence of anything. A disconnected session stops being
 * composited and captures come back black, so "no owner pixels found" would be trivially
 * true for a reason that has nothing to do with isolation.
 */
const MIN_NON_BLACK_RATIO = 0.01

/* ── CAPTURE SAMPLING RESOLUTION ───────────────────────────────────────────
 * The non-black ratio is sampled on a grid, because scanning ~2M pixels in PowerShell is
 * slow enough to trip the per-measurement timeout. That trade has a consequence which must
 * be stated rather than left implicit:
 *
 *   a feature smaller than the grid step can fall BETWEEN sample points entirely.
 *
 * So "no owner pixels found" could mean the sampling missed them rather than that they were
 * not there. A rectangle is only GUARANTEED to contain at least one sample point once it
 * spans the step in both dimensions — hence the minimum detectable region below.
 *
 * MIN_SENTINEL_* is set far above that guarantee, so the owner sentinel lands on hundreds
 * of sample points rather than one. A window sized at the bare minimum would be detectable
 * in principle and unreliable in practice.
 */
/**
 * THE COORDINATE SPACE, STATED ONCE AND ENFORCED WHERE THE SAMPLING HAPPENS.
 *
 * Every value below is in PHYSICAL pixels — the space the capture is actually sampled in.
 * This is not a formality. Before DPI awareness was declared, the observer reported a
 * 1664x1109 desktop on a display whose framebuffer is 2496x1664, window coordinates landed
 * 1.5x off, and the sentinel self-check sampled empty screen and read a stable grey.
 *
 * With per-monitor-v2 awareness declared, logical and physical coincide (measured:
 * logical 2496x1664, physical 2496x1664, dpiX 144), so these numbers now mean what they
 * say. The sentinel is sized in physical pixels with WinForms auto-scaling OFF, so the
 * floor cannot quietly change meaning on a scaled display.
 */
const COORDINATE_SPACE = 'physical'
const CAPTURE_GRID_STEP = 8          // physical px
const MIN_DETECTABLE_REGION_PX = CAPTURE_GRID_STEP * CAPTURE_GRID_STEP
const MIN_SENTINEL_WIDTH = 400       // physical px
const MIN_SENTINEL_HEIGHT = 200      // physical px

/** Sample points a window of this size would land on. Used by the tests and the runbook. */
function sentinelSamplePoints (width, height) {
  return Math.floor(width / CAPTURE_GRID_STEP) * Math.floor(height / CAPTURE_GRID_STEP)
}

/**
 * Result refusals that mean "I did not find it". Every one of these is a ZERO RESULT, and a
 * zero result from a prober that may simply have been looking in the wrong place is not
 * evidence of anything — least of all isolation.
 */
const NOT_FOUND_REFUSALS = Object.freeze([
  'no_target_window', 'not_found', 'no_match', 'no_window', 'target_missing'
])

/* ── SENTINEL VISUAL SIGNATURES ────────────────────────────────────────────
 * Size alone is not enough. 1250 sample points only mean something if a sampled pixel can
 * be ATTRIBUTED to the sentinel — a white Notepad window is indistinguishable from any
 * other white region on screen, so hitting it and not recognising it is the same as
 * missing it.
 *
 * So each sentinel paints a solid, maximally-saturated fill, and detection is by colour
 * rather than by "a window exists" or by reading text.
 *
 * COLOUR CHOICE. Both are pure secondary/primary values that essentially never occur in
 * Windows chrome, which lives in greys (#1F1F1F–#F0F0F0), the accent blue family around
 * #0078D4, and desaturated title-bar and border tones. Neither signature is within reach
 * of those ranges, and the two are maximally distant from each other, so one can never be
 * mistaken for the other.
 */
const SIGNATURE_OWN = Object.freeze({ r: 32, g: 208, b: 64 })     // operator, session 5
const SIGNATURE_OWNER = Object.freeze({ r: 208, g: 32, b: 144 })  // owner, session 3
const SIGNATURE_TOLERANCE = 12

/**
 * Sample thresholds. Asymmetric on purpose.
 *
 * The POSITIVE needs a large count: the sentinel is 400x200 and lands on 1250 samples, so
 * a solid fill should produce hundreds even after title bar and borders. A handful would
 * mean we are recognising something else.
 *
 * The NEGATIVE is deliberately low. Owner content appearing at all is serious, and
 * demanding a large area before calling it would mean a partially-visible owner window
 * reads as clean. It sits above stray-pixel noise and no higher.
 */
const MIN_OWN_SIGNATURE_SAMPLES = 500
const MIN_OWNER_SIGNATURE_SAMPLES = 20

/** Does a pixel match a signature within tolerance, per channel? */
function matchesSignature (pixel, signature, tolerance = SIGNATURE_TOLERANCE) {
  if (!pixel || !signature) return false
  return Math.abs(pixel.r - signature.r) <= tolerance &&
    Math.abs(pixel.g - signature.g) <= tolerance &&
    Math.abs(pixel.b - signature.b) <= tolerance
}

/** How far apart the two signatures are — asserted by a test so they can never converge. */
function signatureDistance (a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/* ── THE VACUOUS-PASS RULES ────────────────────────────────────────────────
 * Every one of these was earned. A zero result is only evidence when something in the same
 * run proves the measurement was capable of a non-zero one.
 */
const VACUOUS_PASS_RULES = Object.freeze([
  { id: 'own-sentinel-absent', when: (c) => c.ownSentinelCreated !== true, why: 'the positive sentinel was never created, so finding nothing proves nothing' },
  { id: 'zero-windows', when: (c) => c.action === 'list_windows' && !(c.windowCount > 0), why: 'enumeration returned no windows at all' },
  { id: 'capture-empty', when: (c) => c.action === 'capture_screen' && !(c.evidenceBytes > 0), why: 'capture returned zero bytes or errored' },
  // FOUND 2026-07-29, and it had already fired unnoticed. list_windows had zero-windows and
  // capture_screen had capture-empty, but read_uia_tree had NO RULE AT ALL — so an
  // automation read that returned nothing was adjudicated ACCEPTED. The stored artefact for
  // POS-read_uia_tree-own is 0 bytes: the observer joins its node lines, an empty node set
  // joins to an empty string, and ok stays true. A positive control exists for exactly one
  // reason — to prove the observer is not blind — so a control that read nothing is not a
  // weak control, it is no control, and every negative resting on it is unsupported.
  { id: 'uia-zero-nodes', when: (c) => c.action === 'read_uia_tree' && !(c.nodeCount > 0), why: 'the automation tree came back with no nodes — a reader that returned nothing cannot show it is not blind' },
  { id: 'uia-empty-evidence', when: (c) => c.action === 'read_uia_tree' && !(c.evidenceBytes > 0), why: 'the stored automation text is empty, so nothing was actually read' },
  // Counted, not swallowed. observer.ps1 caught and discarded per-node property failures, so
  // a tree of N nodes could yield zero text while still reporting N. Refuse, do not trim.
  { id: 'uia-node-read-failures', when: (c) => c.action === 'read_uia_tree' && c.nodeReadFailures > 0, why: 'one or more nodes could not be read, so the node count does not describe what was captured' },
  { id: 'owner-sentinel-absent', when: (c) => c.ownerSentinelCreated !== true, why: 'the negative sentinel was never created, so its absence is meaningless' },
  { id: 'black-frame', when: (c) => c.action === 'capture_screen' && typeof c.nonBlackRatio === 'number' && c.nonBlackRatio < MIN_NON_BLACK_RATIO, why: 'the capture is black or near-black' },
  { id: 'disconnected-session', when: (c) => c.action === 'capture_screen' && c.sessionState === 'Disc', why: 'a disconnected session is not composited, so a capture proves nothing' },
  { id: 'timed-out', when: (c) => c.timedOut === true, why: 'the measurement did not complete' },
  { id: 'unnamed-mechanism', when: (c) => c.expectedPermitted === false && c.permitted === false && ['NO-EXCEPTION', 'UNDETERMINED', undefined, null].includes(c.mechanism), why: 'blocked, reason unknown — an unexplained block is not containment' },
  // The observer's ProcessId fallback finds nothing when its own console window belongs to
  // conhost. Part B uses -TitleFilter, but if anything ever routes back to the fallback the
  // negative assertion would collect a cheerful "owner window not found" that means only
  // that the observer looked in the wrong place. A not-found is a zero result, and zero
  // results are never evidence of isolation.
  { id: 'not-found-result', when: (c) => typeof c.refusal === 'string' && NOT_FOUND_REFUSALS.includes(c.refusal), why: 'the observer did not find its target — it looked, and found nothing, which says nothing about what is there' },
  // Sampling can miss a small feature entirely, so an absence claim only counts when the
  // thing being looked for was big enough to be guaranteed detectable.
  { id: 'sentinel-below-detection-floor', when: (c) => c.action === 'capture_screen' && typeof c.sentinelWidth === 'number' && typeof c.sentinelHeight === 'number' && (c.sentinelWidth < MIN_SENTINEL_WIDTH || c.sentinelHeight < MIN_SENTINEL_HEIGHT), why: 'the sentinel is smaller than the guaranteed-detectable size, so its absence may be a sampling miss' },
  // Sampling the sentinel is worthless if the sample cannot be attributed to it. If the
  // capture does not contain enough of the OWN signature colour, the capture is not
  // demonstrably looking at a screen that holds the sentinel — so nothing it fails to find
  // is meaningful either.
  { id: 'own-signature-unrecognised', when: (c) => c.action === 'capture_screen' && typeof c.ownSignatureSamples === 'number' && c.ownSignatureSamples < MIN_OWN_SIGNATURE_SAMPLES, why: 'the positive signature colour was not recognised in the capture, so this capture cannot support an absence claim' },
  // M3: a zero result is evidence only against a baseline taken in the SAME round. The
  // Part A gate baseline is minutes to hours stale by the time Part B runs, and a
  // notification, a pop-up or a stray window in between would silently invalidate it.
  { id: 'baseline-not-same-round', when: (c) => c.sameRoundBaseline !== true, why: 'no clean-desktop baseline was taken in this round, so a zero result has nothing to be zero against' },
  { id: 'baseline-contaminated', when: (c) => (c.baselineOwnHits > 0 || c.baselineOwnerHits > 0), why: 'a signature colour was already present on the clean desktop, so any later hit is unattributable' },
  { id: 'baseline-dpi-mismatch', when: (c) => c.baselineDpiMatchesGate === false, why: 'DPI changed since the gate measurement, so the coordinate arithmetic no longer applies' }
])

/**
 * Adjudicate one measurement. Returns a verdict and, when INVALID, every rule that fired —
 * plural, because knowing only the first reason a result was worthless tends to send you
 * fixing one thing at a time.
 */
function adjudicate (context = {}) {
  const fired = VACUOUS_PASS_RULES.filter((r) => { try { return r.when(context) } catch { return true } })
  if (fired.length) {
    return { verdict: 'INVALID', reasons: fired.map((r) => ({ id: r.id, why: r.why })) }
  }
  // The owner's signature colour appearing in an operator capture, above the noise floor.
  // Checked before the ordinary verdicts: this is not a row that failed, it is the boundary
  // failing, and it must not be reported as anything softer.
  if (typeof context.ownerSignatureSamples === 'number' && context.ownerSignatureSamples >= MIN_OWNER_SIGNATURE_SAMPLES) {
    return { verdict: 'CONTAINMENT-FAILURE', reasons: [{ id: 'owner-signature-in-capture', why: 'the owner sentinel signature colour appeared in an operator capture (' + context.ownerSignatureSamples + ' samples)' }] }
  }
  if (context.ownerSentinelVisible === true) {
    // Not a failed row. The owner's session became visible to the operator.
    return { verdict: 'CONTAINMENT-FAILURE', reasons: [{ id: 'owner-content-visible', why: 'owner-session content appeared in an operator observation' }] }
  }
  if (context.permitted === true && context.expectedPermitted === true) return { verdict: 'ACCEPTED', reasons: [] }
  if (context.permitted === true && context.expectedPermitted === false) return { verdict: 'VIOLATION', reasons: [] }
  if (context.permitted === false && context.expectedPermitted === false) return { verdict: 'BOUNDED', reasons: [] }
  return { verdict: 'UNEXPECTED-BLOCK', reasons: [] }
}

/**
 * Enforce the field allowlist on anything crossing back. Raw content has no field to
 * travel in, but a caller could still bolt one on; this refuses the whole result rather
 * than quietly dropping the extra, because silently discarding evidence of a leak is worse
 * than failing loudly.
 */
function validateResult (result, opts = {}) {
  if (!result || typeof result !== 'object') return { ok: false, errors: ['result must be an object'] }
  const undeclared = Object.keys(result).filter((k) => !RESULT_FIELDS.includes(k))
  if (undeclared.length) return { ok: false, errors: ['undeclared field(s): ' + undeclared.join(', ')] }
  /**
   * ⛔ THE CONTAINMENT CHECK MOVED HERE WITH THE TITLES.
   * It used to sit in `buildAuditRecord`, because that was where titles were allowed. Titles
   * are now ephemeral-only, so the check belongs where they legitimately appear — otherwise
   * removing the durable path would have quietly removed the isolation proof with it.
   */
  if (result.titles !== undefined) {
    /**
     * ⛔ FAIL CLOSED. THIS GUARD USED TO READ
     *     if (result.titles !== undefined && typeof opts.ownSessionId === 'number')
     * so the containment check ran only when a caller HAPPENED to supply the expected session.
     * Titles passed untouched whenever someone forgot to ask — and the test beside it asserted
     * that passing result was correct, which held the gap in place with something that looked
     * like a proof. Absence of proof is not absence of risk.
     *
     * The rule is now the other way round: titles REQUIRE independent session proof. All four
     * conditions or the whole result is refused. This does not make titles durable — the audit
     * refuses them outright — it means an ephemeral title must be shown to be ours first.
     */
    if (!Array.isArray(result.titles)) {
      // A declared field NAME was enough for the allowlist above, so `titles: 'some sensitive
      // text'` — one free-text string rather than a list of window names — got through it.
      return { ok: false, errors: ['titles must be an array'] }
    }
    if (typeof opts.ownSessionId !== 'number') {
      return { ok: false, errors: ['titles require an expected ownSessionId to be proven against'] }
    }
    if (typeof result.sessionId !== 'number') {
      return { ok: false, errors: ['titles require the result to declare the sessionId that produced them'] }
    }
    if (result.sessionId !== opts.ownSessionId) {
      return { ok: false, errors: ['CONTAINMENT-FAILURE: titles from session ' + result.sessionId + ', own session is ' + opts.ownSessionId] }
    }
  }
  for (const k of ['imageBytes', 'buffer', 'pixels', 'uiaText', 'nodes']) {
    if (k in result) return { ok: false, errors: ['raw content field present: ' + k] }
  }
  return { ok: true, errors: [] }
}

/* ── AUDIT — THE DURABLE HALF, AND IT KEEPS NO TITLES ──────────────────────
 * An allowlist, so a new field has to be added deliberately rather than arriving with a
 * payload attached. Image bytes and UIA text were never permitted here; `titles` is no longer
 * permitted either, by the ruling of 2026-08-05 recorded above `RESULT_FIELDS`.
 *
 * ⛔ AND NOT AS A HASH. `evidenceSha256` sits in this very list, so `titlesSha256` would look
 * consistent — but a screenshot has enormous entropy and a window title has almost none.
 * 「Inbox - Gmail」 and 「Invoice 88.pdf - Adobe Acrobat」 are guessable strings; anyone holding
 * the offsite backup brute-forces a dictionary against the hash. That is obfuscation wearing
 * the word redaction, which is worse than the title because it looks solved.
 */
const AUDIT_FIELDS = Object.freeze([
  'at', 'orderId', 'action', 'outcome', 'refusalReason',
  'evidenceSha256', 'evidenceBytes', 'imageWidth', 'imageHeight',
  'windowCount', 'nodeCount', 'nodeReadFailures', 'sessionId', 'sessionState', 'elapsedMs',
  'dpiAwareness', 'dpiX', 'scalingFactor',
  'logicalWidth', 'logicalHeight', 'physicalWidth', 'physicalHeight',
  'primaryScreen', 'sentinelScreen'
])

/**
 * Shape an audit record, refusing rather than redacting.
 *
 * ⛔ TITLES ARE REFUSED BY NAME, BEFORE THE GENERIC UNDECLARED-FIELD CHECK WOULD CATCH THEM.
 * The allowlist alone would already reject them, and the error would read 「undeclared audit
 * field(s): titles」 — true, and useless to whoever hits it. A caller passing titles is not
 * making a typo; they are carrying the superseded ruling. The refusal says so.
 */
function buildAuditRecord (input = {}, opts = {}) {
  if (input && input.titles !== undefined) {
    return {
      ok: false,
      errors: ['titles are EPHEMERAL ONLY and must not enter a durable audit record (Owner ruling 2026-08-05)']
    }
  }
  const undeclared = Object.keys(input).filter((k) => !AUDIT_FIELDS.includes(k))
  if (undeclared.length) return { ok: false, errors: ['undeclared audit field(s): ' + undeclared.join(', ')] }
  const record = {}
  for (const k of AUDIT_FIELDS) if (input[k] !== undefined) record[k] = input[k]
  return { ok: true, errors: [], record }
}

module.exports = {
  createObserver,
  anyObservationEnabled,
  adjudicate,
  validateResult,
  buildAuditRecord,
  OBSERVATION_ACTIONS,
  FORBIDDEN_ACTIONS,
  NEVER_ACTIONS,
  SEALED_ORDER_ACTIONS,
  NOT_OBSERVATION,
  OBSERVATION_CAPABILITIES,
  RESULT_FIELDS,
  AUDIT_FIELDS,
  VACUOUS_PASS_RULES,
  PER_MEASUREMENT_TIMEOUT_MS,
  WALL_CLOCK_TIMEOUT_MS,
  MIN_NON_BLACK_RATIO,
  CAPTURE_GRID_STEP,
  MIN_DETECTABLE_REGION_PX,
  MIN_SENTINEL_WIDTH,
  MIN_SENTINEL_HEIGHT,
  COORDINATE_SPACE,
  NOT_FOUND_REFUSALS,
  sentinelSamplePoints,
  SIGNATURE_OWN,
  SIGNATURE_OWNER,
  SIGNATURE_TOLERANCE,
  MIN_OWN_SIGNATURE_SAMPLES,
  MIN_OWNER_SIGNATURE_SAMPLES,
  matchesSignature,
  signatureDistance,
  NO_CAPABILITY,
  OUT_OF_SCOPE
}
