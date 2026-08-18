'use strict'

/**
 * declaredCapabilityEvidence.js — POSITIVE EVIDENCE from the declarations that already exist.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS DECIDES NOTHING. Not availability, not the route, not the world, not ask-vs-act,
 * not read eligibility. It reports what the catalogue says and stops.
 *
 * `no_positive_match` means EXACTLY one thing: 「the deterministic matcher found no positive
 * evidence in the declarations」. It does NOT mean the capability is absent, and there is
 * deliberately no enum value in this file that could be read that way.
 *
 * ⛔ WHY THAT DISTINCTION IS THE WHOLE POINT — Q8, 2026-08-17.
 * 「邊啲貨低過 PAR？」 got a clarification and zero reads. The capability was present all
 * along: `aroma_system.inventory` declares `currentStock` and `parLevel`, plus a derivation
 * 缺口 = parLevel − currentStock. The LEXICAL ROUTER missed it. A field called
 * `capabilityAvailable` would have recorded that miss as fact.
 *
 * ── WHERE EVERY TOKEN COMES FROM ───────────────────────────────────────────
 *   AROMA_INTENTS      the router's own declared cjk/latin vocabulary   → kind `intent`
 *   METRICS_OF         declared numeric FIELD NAMES and their labels    → `field_name`,`metric`
 *   FIELD_LABELS_OF    declared field labels and aliases                → `field_label`
 *   DERIVATIONS_OF     declared derivation names (缺口)                  → `derivation`
 *   ENTITY_OF          declared entity type per endpoint                → `entity`
 *
 * ⛔ NOT ONE SYNONYM IS ADDED HERE. No 「PAR」, no 「人工成本」, no 「事實」, no 「推斷」. If a case
 * needs a word added to pass, the case is right and the word is a lie.
 *
 * ⛔ THE ONLY NORMALISATION IS IDENTIFIER SPLITTING, and it reads the schema's own name:
 * `parLevel` → par, level · `par_level` → par, level. That is how Q8 connects — the declared
 * field is literally called par-something. Justified by test, not asserted here.
 *
 * ⛔ NO FUZZY MATCHING. No embeddings, no edit distance, no external dictionary, no model.
 * Latin tokens match on a word boundary; CJK matches as an exact substring, because CJK has
 * no word boundary to match on.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { METRICS_OF, DERIVATIONS_OF, FIELD_LABELS_OF, ENTITY_OF, ENDPOINT_OF_METHOD } = require('./adapters/aromaSystemRead')
const { operationForAromaMethod } = require('./readOperations')
const { AROMA_INTENTS } = require('./readContext')

/** Closed. A consumer may compare against these and against nothing else. */
const EVIDENCE_STATUS = Object.freeze({
  POSITIVE: 'positive_match',
  NONE: 'no_positive_match'
})

/** Closed. Which DECLARATION supplied the evidence — never what it matched. */
const EVIDENCE_KIND = Object.freeze({
  INTENT: 'intent',
  FIELD_NAME: 'field_name',
  FIELD_LABEL: 'field_label',
  METRIC: 'metric',
  DERIVATION: 'derivation',
  ENTITY: 'entity'
})

/**
 * ⛔ THREE CHARACTERS, MEASURED NOT PICKED. Declared latin tokens include `id`, `qty`, `po`.
 * At 2 the token `id` matches the word 「id」 inside ordinary English and every latin identifier
 * becomes noise; at 3 the shortest real token (`qty`) still counts and `id` stops firing.
 * Raising it to 4 would drop `qty` and `par` — and `par` is the token Q8 turns on.
 */
const MIN_LATIN_TOKEN = 3

/** camelCase / snake_case / kebab → lowercase tokens. Deterministic, no dictionary. */
function tokensOfIdentifier (name) {
  if (typeof name !== 'string' || name === '') return []
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

const RE_SAFE = /[.*+?^${}()|[\]\\]/g
const isLatin = (t) => /^[a-z0-9]+$/.test(t)

/** A declared token matches, or it does not. No scoring, no partial credit. */
function tokenHits (token, lowered, original) {
  if (typeof token !== 'string' || token === '') return false
  if (isLatin(token)) {
    if (token.length < MIN_LATIN_TOKEN) return false
    return new RegExp('\\b' + token.replace(RE_SAFE, '\\$&') + '\\b').test(lowered)
  }
  // CJK and mixed strings: exact substring, because there is no boundary to anchor to.
  return original.includes(token)
}

/**
 * THE CATALOGUE, FLATTENED ONCE — declared tokens per endpoint key, with the kind that
 * supplied each. Built at require time from the frozen declarations; never mutated.
 */
function buildCatalogue () {
  const byEndpoint = new Map()
  const add = (endpointKey, kind, token) => {
    if (!endpointKey || typeof token !== 'string' || token === '') return
    if (!byEndpoint.has(endpointKey)) byEndpoint.set(endpointKey, [])
    byEndpoint.get(endpointKey).push({ kind, token })
  }

  for (const [ep, fields] of Object.entries(METRICS_OF || {})) {
    for (const [fieldName, meta] of Object.entries(fields || {})) {
      for (const t of tokensOfIdentifier(fieldName)) add(ep, EVIDENCE_KIND.FIELD_NAME, t)
      if (meta && typeof meta.label === 'string') add(ep, EVIDENCE_KIND.METRIC, meta.label)
    }
  }
  for (const [ep, fields] of Object.entries(FIELD_LABELS_OF || {})) {
    for (const [fieldName, meta] of Object.entries(fields || {})) {
      for (const t of tokensOfIdentifier(fieldName)) add(ep, EVIDENCE_KIND.FIELD_NAME, t)
      if (meta && typeof meta.label === 'string') add(ep, EVIDENCE_KIND.FIELD_LABEL, meta.label)
      for (const a of (meta && Array.isArray(meta.aliases)) ? meta.aliases : []) add(ep, EVIDENCE_KIND.FIELD_LABEL, a)
    }
  }
  for (const [ep, derivations] of Object.entries(DERIVATIONS_OF || {})) {
    for (const name of Object.keys(derivations || {})) add(ep, EVIDENCE_KIND.DERIVATION, name)
  }
  for (const [ep, entity] of Object.entries(ENTITY_OF || {})) {
    for (const t of tokensOfIdentifier(entity)) add(ep, EVIDENCE_KIND.ENTITY, t)
  }
  return byEndpoint
}

const CATALOGUE = buildCatalogue()

/** endpoint key → operation enum, through the one declared bridge. */
const OPERATION_OF_ENDPOINT = (() => {
  const out = new Map()
  for (const [method, endpointKey] of Object.entries(ENDPOINT_OF_METHOD || {})) {
    const op = operationForAromaMethod(method)
    if (op) out.set(endpointKey, op)
  }
  return out
})()

/** The closed, empty result. Every failure path returns exactly this shape. */
const none = () => ({
  status: EVIDENCE_STATUS.NONE,
  operations: [],
  evidenceKinds: [],
  matchCount: 0
})

/**
 * @param {string} message the Owner's turn — read, never emitted
 * @returns {{status:string, operations:string[], evidenceKinds:string[], matchCount:number}}
 */
function evidenceFor (message) {
  // ⛔ NO COERCION. An object with a toString would otherwise have its text read and matched;
  //    only an actual string is a message.
  if (typeof message !== 'string') return none()
  const original = message.trim()
  if (original === '') return none()
  const lowered = original.toLowerCase()

  /** Distinct (operation, kind) pairs — that is what matchCount counts, and nothing else. */
  const pairs = new Set()

  for (const intent of Array.isArray(AROMA_INTENTS) ? AROMA_INTENTS : []) {
    const op = operationForAromaMethod(intent && intent.method)
    if (!op) continue
    const declared = [].concat(intent.cjk || [], intent.latin || [])
    if (declared.some((t) => tokenHits(t, lowered, original))) pairs.add(op + '\u0000' + EVIDENCE_KIND.INTENT)
  }

  for (const [endpointKey, tokens] of CATALOGUE) {
    const op = OPERATION_OF_ENDPOINT.get(endpointKey)
    if (!op) continue
    for (const { kind, token } of tokens) {
      if (tokenHits(token, lowered, original)) pairs.add(op + '\u0000' + kind)
    }
  }

  if (pairs.size === 0) return none()

  const operations = new Set()
  const evidenceKinds = new Set()
  for (const pair of pairs) {
    const [op, kind] = pair.split('\u0000')
    operations.add(op)
    evidenceKinds.add(kind)
  }

  return {
    status: EVIDENCE_STATUS.POSITIVE,
    // Sorted so the log is comparable turn to turn; both sets are closed vocabularies.
    operations: [...operations].sort(),
    evidenceKinds: [...evidenceKinds].sort(),
    matchCount: pairs.size
  }
}

module.exports = { evidenceFor, tokensOfIdentifier, EVIDENCE_STATUS, EVIDENCE_KIND, MIN_LATIN_TOKEN }
