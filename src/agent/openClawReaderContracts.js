'use strict'

/**
 * openClawReaderContracts.js — THE ONE PLACE RAW EXTERNAL EVIDENCE IS PARSED. INERT.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * The retirement verifier reads facts about the world through injected readers. It used to
 * interpret their raw result objects field by field, and three consecutive review rounds each
 * found the same class of defect in that pattern:
 *
 *   X3-C2  a cgroup result of `{}` or `{exists:null}` fell through to "the cgroup is absent",
 *          because only `exists === true` was tested.
 *   X3-C3  `{ gone:true, ok:true, uid:1000 }` classified as GONE, because `gone` was asked
 *          first and won — skipping a LIVE executor process.
 *   X3-C4  `{ gone:true, ok:'true', uid:1000 }` classified as GONE, because a non-boolean tag
 *          was INVISIBLE rather than invalid. That one produced ok:true / RETIRED with a real
 *          executor process still alive. Fail-open, on the one path that must never be.
 *
 * Each was fixed where it was found. The pattern is the defect: every call site that touches a
 * raw object is another chance for malformed evidence to disappear into a plausible reading.
 * So parsing happens ONCE, here, and the verifier never sees a raw reader object again.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * ⛔ AN UNPARSEABLE ANSWER IS NOT AN ANSWER.
 * Every parser returns either a canonical value or null. null always means UNKNOWN at the call
 * site, which fails closed and keeps the global lock. There is no "mostly fine" branch, no
 * coercion, no salvage, and no field read that is not an OWN property.
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

/** Every authoritative field is read as an OWN property. Inheritance is never authority. */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** Canonical unsigned decimal strings, matching the instance manager's representation. */
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/
const isCanonicalUint = (v) => typeof v === 'string' && CANONICAL_UINT.test(v)

const isPositiveInt = (v) => Number.isInteger(v) && v > 0
const isPidArray = (v) => Array.isArray(v) && v.every(isPositiveInt)
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

/* ══════════════ the three-variant proc union ══════════════ */

const VARIANT_TAGS = Object.freeze(['ok', 'gone', 'unreadable'])

/**
 * Classify a proc-facet result into exactly one variant.
 *
 * ⛔ A PRESENT TAG MUST BE A BOOLEAN, CHECKED BEFORE ANYTHING IS COUNTED.
 * Counting only `=== true` made a non-boolean tag invisible rather than invalid — the X3-C4
 * fail-open. And exactly one tag must be true: no variant outranks another, so a result
 * claiming two things at once is broken rather than ambiguous.
 *
 * Returns 'ok' | 'gone' | 'unreadable', or null.
 */
function classifyFacet (raw) {
  if (!isDataObject(raw)) return null
  for (const tag of VARIANT_TAGS) {
    if (own(raw, tag) && typeof raw[tag] !== 'boolean') return null
  }
  // ⛔ AN INHERITED TAG IS NOT A CLAIM.
  // The type check above looked only at OWN tags, but the count read raw[tag] — so with
  // Object.prototype.ok = true, a payload-only object like { uid: 1000 } counted one true
  // and classified as OK. Object.prototype is an ALLOWED prototype, so the prototype rule
  // cannot catch this: authority must be an own property at the moment it is counted, not
  // merely at the moment it is type-checked.
  const claimed = VARIANT_TAGS.filter((tag) => own(raw, tag) && raw[tag] === true)
  if (claimed.length !== 1) return null
  return claimed[0]
}

/**
 * The single-tag contracts (control group, pid list, stat, unit) have no `gone`: they are
 * either unreadable, or they answer. `unreadable:true` is EXCLUSIVE — a result that claims to
 * be unreadable while also carrying a payload is contradicting itself, not being generous.
 *
 * Returns 'unreadable' | 'ok' | null.
 */
function classifyReadable (raw, payloadKeys) {
  if (!isDataObject(raw)) return null
  if (own(raw, 'unreadable')) {
    if (typeof raw.unreadable !== 'boolean') return null
    if (raw.unreadable === true) {
      for (const k of payloadKeys) if (own(raw, k)) return null
      return 'unreadable'
    }
  }
  return 'ok'
}

const UNREADABLE = Object.freeze({ kind: 'unreadable' })
const GONE = Object.freeze({ kind: 'gone' })

/* ══════════════ proc facets ══════════════ */

function parseStatusResult (raw) {
  const kind = classifyFacet(raw)
  if (kind === null) return null
  if (kind === 'gone') return GONE
  if (kind === 'unreadable') return UNREADABLE
  // a uid is a real uid: an integer, and never negative
  if (!own(raw, 'uid') || !Number.isInteger(raw.uid) || raw.uid < 0) return null
  return { kind: 'ok', uid: raw.uid }
}

function parseEnvironResult (raw) {
  const kind = classifyFacet(raw)
  if (kind === null) return null
  if (kind === 'gone') return GONE
  if (kind === 'unreadable') return UNREADABLE
  // marker null means "this process carries no marker" — a real answer, not a missing one
  if (!own(raw, 'marker')) return null
  if (raw.marker !== null && typeof raw.marker !== 'string') return null
  return { kind: 'ok', marker: raw.marker }
}

function parseCwdResult (raw) {
  const kind = classifyFacet(raw)
  if (kind === null) return null
  if (kind === 'gone') return GONE
  if (kind === 'unreadable') return UNREADABLE
  if (!own(raw, 'cwd') || typeof raw.cwd !== 'string') return null
  return { kind: 'ok', cwd: raw.cwd }
}

function parseFdsResult (raw) {
  const kind = classifyFacet(raw)
  if (kind === null) return null
  if (kind === 'gone') return GONE
  if (kind === 'unreadable') return UNREADABLE
  if (!own(raw, 'fds') || !isStringArray(raw.fds)) return null
  return { kind: 'ok', fds: raw.fds.slice() }
}

/* ══════════════ control group ══════════════ */

function parseControlGroupResult (raw) {
  const kind = classifyReadable(raw, ['exists', 'procs'])
  if (kind === null) return null
  if (kind === 'unreadable') return UNREADABLE
  // ⛔ THE READER MUST SAY WHICH IT IS. `{}` and `{exists:null}` are not "absent".
  if (!own(raw, 'exists') || typeof raw.exists !== 'boolean') return null
  if (raw.exists === false) {
    // a control group that does not exist cannot have members
    if (own(raw, 'procs')) return null
    return { kind: 'ok', exists: false }
  }
  if (!own(raw, 'procs') || !isPidArray(raw.procs)) return null
  return { kind: 'ok', exists: true, procs: raw.procs.slice() }
}

/* ══════════════ pid list ══════════════ */

function parsePidListResult (raw) {
  const kind = classifyReadable(raw, ['pids'])
  if (kind === null) return null
  if (kind === 'unreadable') return UNREADABLE
  // ⛔ NO PARTIAL FILTERING. A list with one bad entry is a list we cannot trust, and the
  // entry we would have dropped is exactly where a survivor hides.
  if (!own(raw, 'pids') || !isPidArray(raw.pids)) return null
  return { kind: 'ok', pids: raw.pids.slice() }
}

/* ══════════════ stat ══════════════ */

function parseStatResult (raw) {
  const kind = classifyReadable(raw, ['exists', 'dev', 'ino'])
  if (kind === null) return null
  if (kind === 'unreadable') return UNREADABLE
  if (!own(raw, 'exists') || typeof raw.exists !== 'boolean') return null
  if (raw.exists === false) {
    if (own(raw, 'dev') || own(raw, 'ino')) return null
    return { kind: 'ok', exists: false }
  }
  // ⛔ NEVER COERCED THROUGH Number: 64-bit inodes above 2^53 would collapse onto one value,
  // on the one check whose entire purpose is exactness.
  if (!own(raw, 'dev') || !isCanonicalUint(raw.dev)) return null
  if (!own(raw, 'ino') || !isCanonicalUint(raw.ino)) return null
  return { kind: 'ok', exists: true, dev: raw.dev, ino: raw.ino }
}

/* ══════════════ unit ══════════════ */

function parseUnitResult (raw) {
  const kind = classifyReadable(raw, ['exists', 'successor', 'restart'])
  if (kind === null) return null
  if (kind === 'unreadable') return UNREADABLE
  // "no successor field" is not "no successor", and "no exists field" is not "the unit is gone".
  if (!own(raw, 'exists') || typeof raw.exists !== 'boolean') return null
  if (!own(raw, 'successor') || typeof raw.successor !== 'boolean') return null

  let restart = null
  if (raw.exists === true) {
    // a unit that still exists must tell us its restart policy
    if (!own(raw, 'restart') || typeof raw.restart !== 'string' || raw.restart === '') return null
    restart = raw.restart
  }
  // activeState / subState / result are DIAGNOSTIC ONLY — carried through untouched, never
  // validated into authority, and never compared anywhere.
  return {
    kind: 'ok',
    exists: raw.exists,
    successor: raw.successor,
    restart,
    activeState: own(raw, 'activeState') ? raw.activeState : null,
    subState: own(raw, 'subState') ? raw.subState : null,
    result: own(raw, 'result') ? raw.result : null
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
