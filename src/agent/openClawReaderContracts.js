'use strict'

/**
 * openClawReaderContracts.js — THE ONE PLACE RAW EXTERNAL EVIDENCE IS PARSED. INERT.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * The retirement verifier reads facts about the world through injected readers. It used to
 * interpret their raw result objects field by field, and four consecutive review rounds found
 * the same class of defect in that pattern:
 *
 *   X3-C2  a cgroup result of `{}` or `{exists:null}` fell through to "the cgroup is absent",
 *          because only `exists === true` was tested.
 *   X3-C3  `{ gone:true, ok:true, uid:1000 }` classified as GONE, because `gone` was asked
 *          first and won — skipping a LIVE executor process.
 *   X3-C4  `{ gone:true, ok:'true', uid:1000 }` classified as GONE, because a non-boolean tag
 *          was INVISIBLE rather than invalid. That produced ok:true / RETIRED with a real
 *          executor process still alive.
 *   X3-D2  Object.prototype pollution supplied an INHERITED variant tag, so a payload-only
 *          object classified as OK.
 *
 * ── AND THE ONE THIS ROUND (X3-D3) ──────────────────────────────────────────
 * ⛔ EVIDENCE MUST BE STABLE DATA, NOT EXECUTABLE PROPERTY ACCESS.
 *
 * Even with every rule above, a reader could return an object whose own properties are
 * GETTERS. Each `raw.foo` was a function call, so a value could be valid when validated and
 * different when used:
 *
 *   { exists:false } + an `unreadable` getter returning true then false
 *       -> validated as "not unreadable", canonicalised as "cgroup absent"
 *   { ok:true } + a `marker` getter returning the approvalId twice then null
 *       -> validated as a string, canonicalised as null, hiding the instance marker
 *   a `unit.exists` getter returning true then false, with restart:'always'
 *       -> canonicalised as absent, discarding the restart authority
 *
 * All three were reproduced, and together they produced ok:true / RETIRED with a live
 * same-UID process. The fix is not another check: it is to stop reading raw objects more than
 * once. Every parser takes ONE snapshot of own DATA properties, refuses any own accessor
 * outright, validates the snapshot, and returns values from that same snapshot.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * ⛔ AN UNPARSEABLE ANSWER IS NOT AN ANSWER.
 * Every parser returns either a canonical value or null. null always means UNKNOWN at the call
 * site, which fails closed and keeps the global lock. No coercion, no salvage, no field read
 * that is not an own data property, and no field read twice.
 */

/**
 * ⛔ A DATA OBJECT, NOT MERELY AN OBJECT.
 *
 * Arrays, null and primitives are refused, and so is anything with a custom prototype: an
 * object built on a prototype carrying `ok:true` would otherwise let INHERITED properties
 * become authority. Only a plain object literal (or a deliberately null-prototype object,
 * which carries nothing at all) can speak this contract.
 */
function isDataObject (value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * ⛔ ONE READ, EVER — THE ANTI-TOCTOU SNAPSHOT.
 *
 * Returns a null-prototype copy of the object's own DATA properties, or null if it is not a
 * data object or carries ANY own accessor. Descriptors are inspected rather than properties
 * read, so a getter is detected without ever being invoked: an accessor on an evidence object
 * is malformed evidence, not a value to sample.
 *
 * The copy has a null prototype, so nothing downstream can inherit anything either.
 */
function stableOwnData (raw) {
  if (!isDataObject(raw)) return null
  const out = Object.create(null)
  for (const key of Object.getOwnPropertyNames(raw)) {
    const d = Object.getOwnPropertyDescriptor(raw, key)
    if (!d || typeof d.get === 'function' || typeof d.set === 'function') return null
    out[key] = d.value
  }
  // symbols carry no authority here, but an accessor among them is still a malformed object
  for (const sym of Object.getOwnPropertySymbols(raw)) {
    const d = Object.getOwnPropertyDescriptor(raw, sym)
    if (!d || typeof d.get === 'function' || typeof d.set === 'function') return null
  }
  return out
}

/**
 * The same rule for arrays: each element is read exactly once, through its descriptor, and the
 * returned array IS the snapshot that was validated. Validating one view and copying another
 * is the array form of the same defect.
 *
 * ⛔ ELEMENTS ARE DEFINED, NEVER ASSIGNED.
 * `out.push(v)` and `out[i] = v` are ordinary assignments, so an inherited numeric SETTER on
 * Array.prototype swallows them: the write goes to the setter, the element is never stored, and
 * what comes back is an array of the right LENGTH with no own elements at all. Under
 * `Array.prototype[0] = { set() {} }` every reader array came back holed. defineProperty
 * creates an own data property and cannot be intercepted.
 */
function defineElement (out, i, value) {
  Object.defineProperty(out, i, { value, writable: true, enumerable: true, configurable: true })
}

function stableArray (value) {
  if (!Array.isArray(value)) return null
  const length = value.length
  const out = []
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i)
    if (!d || typeof d.get === 'function' || typeof d.set === 'function') return null
    defineElement(out, i, d.value)
  }
  if (out.length !== length) return null
  return out
}

/** Every authoritative field is read as an OWN property. Inheritance is never authority. */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** Canonical unsigned decimal strings, matching the instance manager's representation. */
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/
const isCanonicalUint = (v) => typeof v === 'string' && CANONICAL_UINT.test(v)

const isPositiveInt = (v) => Number.isInteger(v) && v > 0

/**
 * ⛔ VALIDATE OWN DESCRIPTORS, NOT `every`.
 *
 * Array.prototype.every SKIPS holes, so a holed snapshot would validate vacuously — and with an
 * inherited numeric property installed it does not skip, it reads the INHERITED value instead.
 * Either way the answer is about the prototype, not about the measurement. Every index in range
 * must be an own data property, and it must be the right kind of value.
 */
function everyOwnElement (snap, ok) {
  if (snap === null) return null
  for (let i = 0; i < snap.length; i++) {
    const d = Object.getOwnPropertyDescriptor(snap, i)
    if (!d || typeof d.get === 'function' || typeof d.set === 'function') return null
    if (!ok(d.value)) return null
  }
  return snap
}

/** Snapshot an array and require every element to be a positive integer. */
function stablePidArray (value) {
  return everyOwnElement(stableArray(value), isPositiveInt)
}

/** Snapshot an array and require every element to be a string. */
function stableStringArray (value) {
  return everyOwnElement(stableArray(value), (x) => typeof x === 'string')
}

/* ══════════════ the three-variant proc union ══════════════ */

const VARIANT_TAGS = Object.freeze(['ok', 'gone', 'unreadable'])

/**
 * Classify a SNAPSHOT into exactly one variant.
 *
 * ⛔ A PRESENT TAG MUST BE A BOOLEAN, CHECKED BEFORE ANYTHING IS COUNTED, AND OWN.
 * Counting only `=== true` made a non-boolean tag invisible rather than invalid (X3-C4), and
 * counting `raw[tag]` let an inherited tag claim a variant (X3-D2). Exactly one tag must be
 * true: no variant outranks another, so a result claiming two things at once is broken.
 *
 * Takes a snapshot, never a raw reader object. Returns 'ok' | 'gone' | 'unreadable', or null.
 */
function classifySnapshot (snap) {
  if (snap === null) return null
  for (const tag of VARIANT_TAGS) {
    if (own(snap, tag) && typeof snap[tag] !== 'boolean') return null
  }
  const claimed = VARIANT_TAGS.filter((tag) => own(snap, tag) && snap[tag] === true)
  if (claimed.length !== 1) return null
  return claimed[0]
}

/** Kept for callers that classify a raw facet result directly; snapshots first. */
function classifyFacet (raw) {
  return classifySnapshot(stableOwnData(raw))
}

/**
 * The single-tag contracts (control group, pid list, stat, unit) have no `gone`: they are
 * either unreadable, or they answer. `unreadable:true` is EXCLUSIVE — a result that claims to
 * be unreadable while also carrying a payload is contradicting itself, not being generous.
 *
 * Returns 'unreadable' | 'ok' | null.
 */
function classifyReadableSnapshot (snap, payloadKeys) {
  if (snap === null) return null
  if (own(snap, 'unreadable')) {
    if (typeof snap.unreadable !== 'boolean') return null
    if (snap.unreadable === true) {
      for (const k of payloadKeys) if (own(snap, k)) return null
      return 'unreadable'
    }
  }
  return 'ok'
}

/** Kept for callers that classify a raw single-tag result directly; snapshots first. */
function classifyReadable (raw, payloadKeys) {
  return classifyReadableSnapshot(stableOwnData(raw), payloadKeys)
}

const UNREADABLE = Object.freeze({ kind: 'unreadable' })
const GONE = Object.freeze({ kind: 'gone' })

/* ══════════════ proc facets ══════════════ */

function parseStatusResult (raw) {
  const snap = stableOwnData(raw)
  const kind = classifySnapshot(snap)
  if (kind === null) return null
  if (kind === 'gone') return GONE
  if (kind === 'unreadable') return UNREADABLE
  // a uid is a real uid: an integer, and never negative
  if (!own(snap, 'uid') || !Number.isInteger(snap.uid) || snap.uid < 0) return null
  return { kind: 'ok', uid: snap.uid }
}

function parseEnvironResult (raw) {
  const snap = stableOwnData(raw)
  const kind = classifySnapshot(snap)
  if (kind === null) return null
  if (kind === 'gone') return GONE
  if (kind === 'unreadable') return UNREADABLE
  // marker null means "this process carries no marker" — a real answer, not a missing one
  if (!own(snap, 'marker')) return null
  if (snap.marker !== null && typeof snap.marker !== 'string') return null
  return { kind: 'ok', marker: snap.marker }
}

function parseCwdResult (raw) {
  const snap = stableOwnData(raw)
  const kind = classifySnapshot(snap)
  if (kind === null) return null
  if (kind === 'gone') return GONE
  if (kind === 'unreadable') return UNREADABLE
  if (!own(snap, 'cwd') || typeof snap.cwd !== 'string') return null
  return { kind: 'ok', cwd: snap.cwd }
}

function parseFdsResult (raw) {
  const snap = stableOwnData(raw)
  const kind = classifySnapshot(snap)
  if (kind === null) return null
  if (kind === 'gone') return GONE
  if (kind === 'unreadable') return UNREADABLE
  if (!own(snap, 'fds')) return null
  const fds = stableStringArray(snap.fds)
  if (fds === null) return null
  return { kind: 'ok', fds }
}

/* ══════════════ control group ══════════════ */

function parseControlGroupResult (raw) {
  const snap = stableOwnData(raw)
  const kind = classifyReadableSnapshot(snap, ['exists', 'procs'])
  if (kind === null) return null
  if (kind === 'unreadable') return UNREADABLE
  // ⛔ THE READER MUST SAY WHICH IT IS. `{}` and `{exists:null}` are not "absent".
  if (!own(snap, 'exists') || typeof snap.exists !== 'boolean') return null
  if (snap.exists === false) {
    // a control group that does not exist cannot have members
    if (own(snap, 'procs')) return null
    return { kind: 'ok', exists: false }
  }
  if (!own(snap, 'procs')) return null
  const procs = stablePidArray(snap.procs)
  if (procs === null) return null
  return { kind: 'ok', exists: true, procs }
}

/* ══════════════ pid list ══════════════ */

function parsePidListResult (raw) {
  const snap = stableOwnData(raw)
  const kind = classifyReadableSnapshot(snap, ['pids'])
  if (kind === null) return null
  if (kind === 'unreadable') return UNREADABLE
  // ⛔ NO PARTIAL FILTERING. A list with one bad entry is a list we cannot trust, and the
  // entry we would have dropped is exactly where a survivor hides.
  if (!own(snap, 'pids')) return null
  const pids = stablePidArray(snap.pids)
  if (pids === null) return null
  return { kind: 'ok', pids }
}

/* ══════════════ stat ══════════════ */

function parseStatResult (raw) {
  const snap = stableOwnData(raw)
  const kind = classifyReadableSnapshot(snap, ['exists', 'dev', 'ino'])
  if (kind === null) return null
  if (kind === 'unreadable') return UNREADABLE
  if (!own(snap, 'exists') || typeof snap.exists !== 'boolean') return null
  if (snap.exists === false) {
    if (own(snap, 'dev') || own(snap, 'ino')) return null
    return { kind: 'ok', exists: false }
  }
  // ⛔ NEVER COERCED THROUGH Number: 64-bit inodes above 2^53 would collapse onto one value,
  // on the one check whose entire purpose is exactness.
  if (!own(snap, 'dev') || !isCanonicalUint(snap.dev)) return null
  if (!own(snap, 'ino') || !isCanonicalUint(snap.ino)) return null
  return { kind: 'ok', exists: true, dev: snap.dev, ino: snap.ino }
}

/* ══════════════ unit ══════════════ */

function parseUnitResult (raw) {
  const snap = stableOwnData(raw)
  const kind = classifyReadableSnapshot(snap, ['exists', 'successor', 'restart'])
  if (kind === null) return null
  if (kind === 'unreadable') return UNREADABLE
  // "no successor field" is not "no successor", and "no exists field" is not "the unit is gone".
  if (!own(snap, 'exists') || typeof snap.exists !== 'boolean') return null
  if (!own(snap, 'successor') || typeof snap.successor !== 'boolean') return null

  let restart = null
  if (snap.exists === true) {
    // a unit that still exists must tell us its restart policy
    if (!own(snap, 'restart') || typeof snap.restart !== 'string' || snap.restart === '') return null
    restart = snap.restart
  }
  // activeState / subState / result are DIAGNOSTIC ONLY — carried through untouched, never
  // validated into authority, and never compared anywhere.
  return {
    kind: 'ok',
    exists: snap.exists,
    successor: snap.successor,
    restart,
    activeState: own(snap, 'activeState') ? snap.activeState : null,
    subState: own(snap, 'subState') ? snap.subState : null,
    result: own(snap, 'result') ? snap.result : null
  }
}

/* ══════════════ protected-instance gate ══════════════ */

/**
 * ⛔ A LITERAL BOOLEAN, AND NOTHING ELSE.
 * Truthiness is not consent: `'false'`, `1` and `{}` are all truthy, and any of them silently
 * passing this gate would mean an unrelated executor was never really checked.
 */
function parseProtectedResult (raw) {
  if (raw === true) return { kind: 'ok', clean: true }
  if (raw === false) return { kind: 'ok', clean: false }
  return null
}

module.exports = {
  isDataObject,
  stableOwnData,
  stableArray,
  isCanonicalUint,
  classifyFacet,
  classifyReadable,
  parseStatusResult,
  parseEnvironResult,
  parseCwdResult,
  parseFdsResult,
  parseControlGroupResult,
  parsePidListResult,
  parseStatResult,
  parseUnitResult,
  parseProtectedResult,
  VARIANT_TAGS
}
