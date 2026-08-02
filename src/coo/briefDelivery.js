'use strict'

/**
 * briefDelivery.js — THE ONE GATE, immediately before the response and before the hash.
 *
 * ── WHAT WENT WRONG WITHOUT IT ────────────────────────────────────────────
 * v0.1 set `outcome: 'operational_claim_blocked'` and then returned the offending text
 * anyway. Nothing was blocked. An audit field had been mistaken for a control, and the
 * name made the audit read as though the danger had been handled.
 *
 * A control REMOVES. This function is the only thing in the system that decides what
 * reaches the Owner, it runs after every item is assembled, and what it removes is gone
 * from the payload — not flagged, not hidden by CSS, not present with a warning. The
 * Owner is told a COUNT ("2 items withheld — insufficient evidence") and never the
 * content, because a withheld item's text is exactly what must not be shown.
 *
 * It also runs before contentHash is computed, so the hash attests to what was actually
 * delivered rather than to a draft that no one saw.
 *
 * FAIL CLOSED. If this function throws, the caller must send nothing. An unvalidated
 * payload has no safe rendering, and "the validator broke so we showed it anyway" is the
 * failure mode this whole file exists to prevent.
 */

const { scopeForSource, mayAssertBusinessState, narrativeAssertsBusinessState, SCOPES } = require('./statementScope')

const ITEM_SECTIONS = Object.freeze(['today', 'recentActivity', 'risks', 'topPriorities', 'decisionsNeeded'])
const KINDS = Object.freeze(['fact', 'inference', 'recommendation'])
const COVERAGE_STATES = Object.freeze(['live', 'live_zero', 'unavailable'])

const OUTCOME = Object.freeze({
  OK: 'ok',
  REMOVED: 'items_removed_before_delivery',
  FAILED: 'delivery_validation_failed'
})

function isPlainObject (v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

/**
 * Why an item may be removed. Recorded per item as { id, section, reason } — the reason
 * is a fixed enum, never the item's text, so the removal record is itself safe to store.
 */
const REASON = Object.freeze({
  SHAPE: 'illegal_item_shape',
  DUP_ID: 'duplicate_item_id',
  NO_PROVENANCE: 'fact_without_provenance',
  UNKNOWN_SOURCE: 'unknown_source',
  SCOPE_MISMATCH: 'scope_does_not_match_source',
  BUSINESS_STATE: 'business_state_from_non_aroma_system_source',
  NARRATIVE_CLAIM: 'narrative_asserts_business_state',
  DANGLING_CITATION: 'cites_a_fact_that_is_not_present'
})

/** One item's legality, independent of the rest of the brief. */
function checkItemShape (it) {
  if (!isPlainObject(it)) return REASON.SHAPE
  if (typeof it.id !== 'string' || it.id === '') return REASON.SHAPE
  if (!KINDS.includes(it.kind)) return REASON.SHAPE
  if (typeof it.text !== 'string' || it.text.trim() === '') return REASON.SHAPE
  if (!Array.isArray(it.basedOnFactIds)) return REASON.SHAPE
  if (!SCOPES.includes(it.scope)) return REASON.SHAPE
  if (it.provenance !== null && !isPlainObject(it.provenance)) return REASON.SHAPE

  if (it.kind === 'fact') {
    if (!it.provenance || typeof it.provenance.source !== 'string' || it.provenance.source === '') return REASON.NO_PROVENANCE

    // SCOPE IS THE SOURCE'S, NOT THE ITEM'S CLAIM ABOUT ITSELF.
    const allowed = scopeForSource(it.provenance.source)
    if (allowed === null) return REASON.UNKNOWN_SOURCE
    if (it.scope !== allowed) return REASON.SCOPE_MISMATCH

    // The invariant: only Aroma System may state the state of the business. It has no
    // connector, so in v0.1 this can never legitimately be reached.
    if (it.scope === 'business_state' && !mayAssertBusinessState(it.provenance.source)) return REASON.BUSINESS_STATE
  }

  // Backstop, narrative only — quoted external text is invisible to it by construction.
  if (it.scope !== 'business_state' && narrativeAssertsBusinessState(it.text)) return REASON.NARRATIVE_CLAIM

  return null
}

/**
 * Validate and CLEAN. Returns { ok, brief, removed, withheldCounts, outcome }.
 * Throws only on input that is not a brief at all — the caller treats a throw as
 * fail-closed and sends nothing.
 */
function validateBriefForDelivery (brief) {
  if (!isPlainObject(brief) || !isPlainObject(brief.sections)) {
    throw new Error('not_a_brief')
  }
  for (const s of ITEM_SECTIONS) {
    if (!Array.isArray(brief.sections[s])) throw new Error('missing_section:' + s)
  }
  if (!Array.isArray(brief.sections.dataCoverage)) throw new Error('missing_section:dataCoverage')

  const removed = []
  const seenIds = new Set()
  const kept = {}

  // ── pass 1: shape, scope, source, duplicate ids ─────────────────────────
  for (const section of ITEM_SECTIONS) {
    kept[section] = []
    for (const it of brief.sections[section]) {
      const bad = checkItemShape(it)
      if (bad) { removed.push({ id: (it && it.id) || null, section, reason: bad }); continue }
      if (seenIds.has(it.id)) { removed.push({ id: it.id, section, reason: REASON.DUP_ID }); continue }
      seenIds.add(it.id)
      kept[section].push(it)
    }
  }

  // ── pass 2: citations, to a FIXPOINT ────────────────────────────────────
  // Removing a fact orphans anything derived from it, and removing THAT can orphan
  // something derived from it in turn. One pass would leave a recommendation standing on
  // a fact the Owner cannot see — which is precisely the appearance of evidence without
  // the evidence. So it repeats until nothing more falls.
  let changed = true
  while (changed) {
    changed = false
    const factIds = new Set()
    for (const section of ITEM_SECTIONS) {
      for (const it of kept[section]) if (it.kind === 'fact') factIds.add(it.id)
    }
    for (const section of ITEM_SECTIONS) {
      const survivors = []
      for (const it of kept[section]) {
        if (it.kind === 'fact') { survivors.push(it); continue }
        const dangling = it.basedOnFactIds.filter((f) => !factIds.has(f))
        // A derived item must cite at least one fact, and every fact it cites must be present.
        if (it.basedOnFactIds.length === 0 || dangling.length > 0) {
          removed.push({ id: it.id, section, reason: REASON.DANGLING_CITATION })
          changed = true
          continue
        }
        survivors.push(it)
      }
      kept[section] = survivors
    }
  }

  // ── pass 3: coverage tri-state ──────────────────────────────────────────
  const coverage = []
  for (const row of brief.sections.dataCoverage) {
    if (!isPlainObject(row) || typeof row.source !== 'string' || !COVERAGE_STATES.includes(row.state)) {
      removed.push({ id: 'coverage:' + ((row && row.source) || '?'), section: 'dataCoverage', reason: REASON.SHAPE })
      continue
    }
    if (!Number.isFinite(row.count)) {
      removed.push({ id: 'coverage:' + row.source, section: 'dataCoverage', reason: REASON.SHAPE })
      continue
    }
    coverage.push(row)
  }

  // ── the cleaned brief ───────────────────────────────────────────────────
  const withheldCounts = {}
  for (const section of ITEM_SECTIONS) {
    withheldCounts[section] = removed.filter((r) => r.section === section).length
  }
  withheldCounts.dataCoverage = removed.filter((r) => r.section === 'dataCoverage').length

  const cleaned = Object.assign({}, brief, {
    sections: Object.assign({}, kept, { dataCoverage: coverage }),
    withheldCounts
  })
  // The draft-time bookkeeping does not travel: `rejectedItems` and the old violation
  // list described items that never existed for the Owner, and one of them was a field
  // that pretended to be a control.
  delete cleaned.rejectedItems
  delete cleaned.operationalClaimViolations

  return {
    ok: true,
    brief: cleaned,
    removed,
    withheldCounts,
    outcome: removed.length > 0 ? OUTCOME.REMOVED : OUTCOME.OK
  }
}

module.exports = { validateBriefForDelivery, checkItemShape, ITEM_SECTIONS, KINDS, COVERAGE_STATES, OUTCOME, REASON }
