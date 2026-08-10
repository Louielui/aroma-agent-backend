'use strict'

/**
 * wisdomContract.js — WHAT A LESSON IS, AND WHAT IT IS NOT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WISDOM IS NOT CURRENT FACT.
 *
 * A lesson is a heuristic distilled from what already happened. It is never a current
 * price, a stock level, a status, an approval, an authorization, or an instruction the
 * Owner is giving now. The intended precedence, once anything reads this store, is:
 *
 *     Owner's current instruction
 *   > governance / authorization
 *   > current live evidence
 *   > validated wisdom heuristic
 *   > conversation recall
 *
 * ⛔ THAT PRECEDENCE IS DOCUMENTED HERE AND WIRED NOWHERE. W0 builds the container; a
 * later tranche earns the right to put it in front of the model. See docs/WISDOM-MEMORY-V1.md.
 *
 * ⛔ AND A MODEL CANNOT VALIDATE ITSELF. `createdBy` is provenance and confers no authority
 * whatsoever: in W0 only the Owner moves a lesson out of `candidate`. A system that can both
 * write a belief and bless it has no memory, only an echo.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const crypto = require('node:crypto')
const { redact } = require('../lab/redaction')

const SCHEMA_VERSION = 1

/**
 * ⛔ THE FOUR STATES, AND THEY ARE CLOSED.
 * A lesson is a proposal, a belief, a discarded belief, or a replaced belief. There is no
 * fifth thing, and no free-text state that could be invented later to mean 「sort of valid」.
 */
const STATE = Object.freeze({
  CANDIDATE: 'candidate',
  VALIDATED: 'validated',
  REJECTED: 'rejected',
  SUPERSEDED: 'superseded'
})
const STATES = new Set(Object.values(STATE))

/**
 * ⛔ ONLY THE OWNER MAY CHANGE WHAT IS BELIEVED — the single most important line in W0.
 * `aroma`, `model`, `claude`, `openai`, `system` are all absent on purpose, and the check is
 * an allowlist rather than a denylist so a new actor name cannot arrive already trusted.
 */
const AUTHORITY = Object.freeze({ OWNER: 'owner' })
const AUTHORITIES = new Set(Object.values(AUTHORITY))

/** Provenance only. Says who wrote it down; says NOTHING about whether it is true. */
const CREATED_BY = Object.freeze({ OWNER: 'owner', AROMA: 'aroma', SYSTEM: 'system' })
const CREATED_BYS = new Set(Object.values(CREATED_BY))

const SOURCE_TYPE = Object.freeze({
  OWNER_FEEDBACK: 'owner_feedback',
  TASK_RESULT: 'task_result',
  CONVERSATION: 'conversation',
  MANUAL: 'manual',
  SYSTEM_OBSERVATION: 'system_observation'
})
const SOURCE_TYPES = new Set(Object.values(SOURCE_TYPE))

/**
 * ⛔ EVIDENCE IS REFERENCED, NEVER COPIED. A ref is a kind and an id — enough to go and look,
 * and not enough to be a second copy of somebody's mailbox. There is deliberately no `text`,
 * `content`, `body` or `excerpt` field anywhere in this contract.
 */
const REF_KIND = Object.freeze({
  DECISION: 'decision',
  TASK: 'task',
  DISPATCH: 'dispatch',
  CONVERSATION: 'conversation',
  REQUEST: 'request',
  APPROVAL: 'approval',
  MANUAL: 'manual'
})
const REF_KINDS = new Set(Object.values(REF_KIND))

/**
 * ⛔ `null` MEANS NOT ESTABLISHED, AND STAYS null.
 * The tempting default is 0.5 — 「we don't know, so call it a coin flip」. That is a number
 * nobody measured, and once written it is indistinguishable from a number somebody did.
 */
const CONFIDENCE_BASIS = Object.freeze({
  OWNER_JUDGEMENT: 'owner_judgement',
  OBSERVED_OUTCOMES: 'observed_outcomes',
  /**
   * ⛔ PERMITTED AS CANDIDATE METADATA ONLY. A model's own estimate of how right it is can
   * describe a proposal; it can never be the reason a proposal becomes a belief. The store
   * enforces this at the validation boundary, not here.
   */
  MODEL_ESTIMATE: 'model_estimate'
})
const CONFIDENCE_BASES = new Set(Object.values(CONFIDENCE_BASIS))

/** The outcome of having USED a lesson. `unknown` is a real answer, not a placeholder. */
const APPLICATION_OUTCOME = Object.freeze({
  HELPED: 'helped', NEUTRAL: 'neutral', HURT: 'hurt', UNKNOWN: 'unknown'
})
const APPLICATION_OUTCOMES = new Set(Object.values(APPLICATION_OUTCOME))

const EVENT = Object.freeze({
  CANDIDATE_CREATED: 'lesson.candidate_created',
  VALIDATED: 'lesson.validated',
  REJECTED: 'lesson.rejected',
  SUPERSEDED: 'lesson.superseded',
  APPLIED: 'lesson.applied',
  APPLICATION_OUTCOME: 'lesson.application_outcome'
})

/** Generous, because a lesson that cannot be stated is not a lesson. Bounded, because a store is not a transcript. */
const MAX_SEMANTIC_CHARS = 1200
const MAX_REASON_CHARS = 600
const MAX_NOTE_CHARS = 600
const MAX_ID_CHARS = 128
const MAX_DOMAIN_CHARS = 64
const MAX_TAG_CHARS = 48
const MAX_TAGS = 8
const MAX_REFS = 12

class WisdomContractError extends Error {
  constructor (message, code) { super(message); this.name = 'WisdomContractError'; this.code = code || 'WISDOM_CONTRACT' }
}
const fail = (msg, code) => { throw new WisdomContractError(msg, code) }

/* ── primitives ──────────────────────────────────────────────────────── */

function boundedText (value, max, field, { required = true } = {}) {
  if (value == null) {
    if (required) fail(field + ' is required', 'MISSING_FIELD')
    return null
  }
  if (typeof value !== 'string') fail(field + ' must be a string', 'BAD_TYPE')
  const trimmed = value.trim()
  if (required && trimmed === '') fail(field + ' must not be empty', 'EMPTY_FIELD')
  // ⛔ REJECTED, NOT TRUNCATED. Silently cutting a lesson in half stores a sentence the Owner
  // never wrote and may invert its meaning — 「never order before checking stock」 truncated is
  // 「never order」.
  if (trimmed.length > max) fail(field + ' exceeds ' + max + ' characters (' + trimmed.length + ')', 'TOO_LONG')
  return trimmed === '' ? null : trimmed
}

function boundedId (value, field, { required = true } = {}) {
  if (value == null) { if (required) fail(field + ' is required', 'MISSING_FIELD'); return null }
  if (typeof value !== 'string') fail(field + ' must be a string', 'BAD_TYPE')
  const t = value.trim()
  if (t === '') { if (required) fail(field + ' must not be empty', 'EMPTY_FIELD'); return null }
  if (t.length > MAX_ID_CHARS) fail(field + ' exceeds ' + MAX_ID_CHARS + ' characters', 'TOO_LONG')
  return t
}

function fromEnum (value, allowed, field, { required = true, nullable = false } = {}) {
  if (value == null) {
    if (nullable) return null
    if (required) fail(field + ' is required', 'MISSING_FIELD')
    return null
  }
  if (typeof value !== 'string' || !allowed.has(value)) {
    fail(field + ' must be one of: ' + [...allowed].sort().join(', '), 'BAD_ENUM')
  }
  return value
}

/** Refs are identifiers. There is no branch here that could accept prose. */
function normaliseRefs (input, field) {
  if (input == null) return []
  if (!Array.isArray(input)) fail(field + ' must be an array', 'BAD_TYPE')
  if (input.length > MAX_REFS) fail(field + ' exceeds ' + MAX_REFS + ' entries', 'TOO_MANY')
  return input.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail(field + '[' + i + '] must be an object', 'BAD_TYPE')
    const extra = Object.keys(r).filter((k) => k !== 'kind' && k !== 'id')
    // ⛔ NO EXTRA KEYS. This is where a `text:` or `snippet:` would otherwise arrive.
    if (extra.length) fail(field + '[' + i + '] may only carry {kind, id}; got: ' + extra.sort().join(', '), 'BAD_REF')
    return Object.freeze({ kind: fromEnum(r.kind, REF_KINDS, field + '[' + i + '].kind'), id: boundedId(r.id, field + '[' + i + '].id') })
  })
}

function normaliseConfidence (input, field) {
  const c = (input == null) ? {} : input
  if (typeof c !== 'object' || Array.isArray(c)) fail(field + ' must be an object', 'BAD_TYPE')
  let value = null
  if (c.value != null) {
    if (typeof c.value !== 'number' || !Number.isFinite(c.value)) fail(field + '.value must be a finite number or null', 'BAD_TYPE')
    if (c.value < 0 || c.value > 1) fail(field + '.value must be within 0..1', 'OUT_OF_RANGE')
    value = c.value
  }
  const basis = fromEnum(c.basis, CONFIDENCE_BASES, field + '.basis', { required: false, nullable: true })
  // ⛔ A NUMBER WITH NO BASIS IS A NUMBER NOBODY CAN ARGUE WITH. Where it came from is part of
  // what it means, so it travels with it or the record is malformed.
  if (value != null && basis == null) fail(field + '.basis is required when a value is given', 'MISSING_FIELD')
  return { value, basis }
}

function normaliseScope (input, field) {
  const s = (input == null) ? {} : input
  if (typeof s !== 'object' || Array.isArray(s)) fail(field + ' must be an object', 'BAD_TYPE')
  const domain = boundedText(s.domain, MAX_DOMAIN_CHARS, field + '.domain', { required: false })
  let tags = []
  if (s.tags != null) {
    if (!Array.isArray(s.tags)) fail(field + '.tags must be an array', 'BAD_TYPE')
    if (s.tags.length > MAX_TAGS) fail(field + '.tags exceeds ' + MAX_TAGS + ' entries', 'TOO_MANY')
    tags = s.tags.map((t, i) => boundedText(t, MAX_TAG_CHARS, field + '.tags[' + i + ']'))
  }
  return { domain, tags }
}

const newId = (prefix) => prefix + '_' + crypto.randomBytes(8).toString('hex')

/* ── the lesson ──────────────────────────────────────────────────────── */

/**
 * Validate and normalise a candidate, redacting the four semantic fields BEFORE they can be
 * persisted.
 *
 * ⛔ ONLY THE REDACTED TEXT EXISTS AFTERWARDS. The caller's original string is never returned
 * and never stored, so there is no second copy for a later bug to write out.
 *
 * ⛔ AND REDACTION IS BEST-EFFORT. It catches labelled secrets and known shapes; it does not
 * make this store safe to expose, and no document may claim it does.
 */
function buildCandidate (input = {}, { clock, id } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input must be an object', 'BAD_TYPE')
  const now = typeof clock === 'function' ? clock() : new Date().toISOString()

  const raw = {
    situation: boundedText(input.situation, MAX_SEMANTIC_CHARS, 'situation'),
    action: boundedText(input.action, MAX_SEMANTIC_CHARS, 'action'),
    outcome: boundedText(input.outcome, MAX_SEMANTIC_CHARS, 'outcome'),
    lesson: boundedText(input.lesson, MAX_SEMANTIC_CHARS, 'lesson')
  }

  const kinds = new Set()
  const text = {}
  for (const [field, value] of Object.entries(raw)) {
    const r = redact(value)
    text[field] = r.text
    for (const h of r.hits) kinds.add(h)
  }

  const provenance = input.provenance == null ? {} : input.provenance
  if (typeof provenance !== 'object' || Array.isArray(provenance)) fail('provenance must be an object', 'BAD_TYPE')

  return {
    schemaVersion: SCHEMA_VERSION,
    id: id || newId('lsn'),
    situation: text.situation,
    action: text.action,
    outcome: text.outcome,
    lesson: text.lesson,
    confidence: normaliseConfidence(input.confidence, 'confidence'),
    validation: {
      // ⛔ ALWAYS `candidate`. There is no input path that creates a validated lesson; belief
      // is a separate, Owner-authorised transition with its own reason and its own event.
      state: STATE.CANDIDATE,
      authority: null,
      reason: null,
      evidenceRefs: [],
      validatedAt: null,
      supersededBy: null
    },
    scope: normaliseScope(input.scope, 'scope'),
    provenance: {
      sourceType: fromEnum(provenance.sourceType, SOURCE_TYPES, 'provenance.sourceType'),
      sourceRefs: normaliseRefs(provenance.sourceRefs, 'provenance.sourceRefs'),
      createdBy: fromEnum(provenance.createdBy, CREATED_BYS, 'provenance.createdBy'),
      createdAt: now
    },
    // What the redactor caught, as KINDS not values — enough to know something was removed.
    redactedKinds: [...kinds].sort()
  }
}

/**
 * ⛔ THE AUTHORITY GATE. Every lifecycle transition passes through here, so there is exactly
 * one place to read to know who may change what is believed.
 */
function assertOwnerAuthority (authority, action) {
  if (!AUTHORITIES.has(authority)) {
    fail('only the Owner may ' + action + ' a lesson (got authority: ' + JSON.stringify(authority) + ')', 'NOT_AUTHORISED')
  }
  return authority
}

/** Is this transition allowed at all? Closed table — anything absent is refused. */
const ALLOWED_TRANSITIONS = Object.freeze({
  [STATE.CANDIDATE]: Object.freeze([STATE.VALIDATED, STATE.REJECTED]),
  [STATE.VALIDATED]: Object.freeze([STATE.SUPERSEDED]),
  [STATE.REJECTED]: Object.freeze([]),
  [STATE.SUPERSEDED]: Object.freeze([])
})

function assertTransition (from, to) {
  if (!STATES.has(from)) fail('unknown current state: ' + JSON.stringify(from), 'BAD_STATE')
  if (!STATES.has(to)) fail('unknown target state: ' + JSON.stringify(to), 'BAD_STATE')
  const allowed = ALLOWED_TRANSITIONS[from] || []
  if (!allowed.includes(to)) fail('refusing transition ' + from + ' -> ' + to, 'BAD_TRANSITION')
}

/** A bounded, redacted reason. The Owner's words, kept short and scrubbed. */
function buildJudgement (input = {}, { field = 'reason', max = MAX_REASON_CHARS } = {}) {
  const r = redact(boundedText(input.reason, max, field))
  return {
    authority: assertOwnerAuthority(input.authority, 'judge'),
    reason: r.text,
    redactedKinds: [...new Set(r.hits)].sort(),
    evidenceRefs: normaliseRefs(input.evidenceRefs, 'evidenceRefs')
  }
}

module.exports = {
  SCHEMA_VERSION,
  STATE,
  STATES,
  AUTHORITY,
  AUTHORITIES,
  CREATED_BY,
  CREATED_BYS,
  SOURCE_TYPE,
  SOURCE_TYPES,
  REF_KIND,
  REF_KINDS,
  CONFIDENCE_BASIS,
  CONFIDENCE_BASES,
  APPLICATION_OUTCOME,
  APPLICATION_OUTCOMES,
  EVENT,
  ALLOWED_TRANSITIONS,
  MAX_SEMANTIC_CHARS,
  MAX_REASON_CHARS,
  MAX_NOTE_CHARS,
  MAX_ID_CHARS,
  MAX_REFS,
  MAX_TAGS,
  WisdomContractError,
  boundedText,
  boundedId,
  fromEnum,
  normaliseRefs,
  normaliseConfidence,
  normaliseScope,
  buildCandidate,
  buildJudgement,
  assertOwnerAuthority,
  assertTransition,
  newId
}
