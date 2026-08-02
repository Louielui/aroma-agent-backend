'use strict'

/**
 * statementScope.js — WHAT KIND OF CLAIM an item is allowed to make, decided by WHERE
 * IT CAME FROM and never by what it says.
 *
 * ── WHY SCOPE IS STRUCTURAL, NOT TEXTUAL ──────────────────────────────────
 * The first version scanned item text for words like "stock" and "sales" and marked the
 * brief when it found them. That was wrong twice over. It could not stop the text
 * reaching the Owner (it only set an audit field), and as a semantic model it was
 * nonsense: an email whose SUBJECT is "sales up 12%" is a real, citable fact about an
 * email — it is simply not a fact about the restaurant. Hiding it loses information the
 * Owner wants; presenting it as operational truth is the actual danger.
 *
 * So the scope of a statement is derived from its SOURCE, by table lookup:
 *
 *   drive / gmail / calendar / github / github:aroma-system → source_record
 *   proposals / decision-recall                            → owner_work_item
 *   coverage:<source>                                      → coverage_state
 *   aroma-system                                           → business_state
 *
 * A `business_state` item can therefore only exist if it came from Aroma System — which
 * has no connector — so v0.1 cannot produce one at all. That is an invariant enforced by
 * the delivery validator, not a hope.
 *
 * ── THE WORDING FOLLOWS THE SCOPE ─────────────────────────────────────────
 * A source_record is rendered as CONTAINMENT: "gmail contains a record: …". It says what
 * the source holds, never what is true of the business. The external title is placed
 * inside quotation marks, which is also what makes the vocabulary backstop precise: it
 * scans only the NARRATIVE — the words this system wrote — and ignores quoted material,
 * so a quoted subject line can say anything without tripping it.
 *
 * The vocabulary scan is DEFENCE IN DEPTH. It is not the semantic model, it cannot hide
 * a source_record, and nothing depends on it being complete.
 */

const SCOPES = Object.freeze(['source_record', 'owner_work_item', 'coverage_state', 'business_state'])

/** Source → the ONE scope it may produce. Exhaustive; an unknown source has no scope. */
const SCOPE_BY_SOURCE = Object.freeze({
  drive: 'source_record',
  gmail: 'source_record',
  calendar: 'source_record',
  github: 'source_record',
  'github:aroma-system': 'source_record',
  proposals: 'owner_work_item',
  'decision-recall': 'owner_work_item',
  'aroma-system': 'business_state'
})

/** Coverage items are minted about a source's availability, never about its content. */
const COVERAGE_PREFIX = 'coverage:'

/**
 * The scope a source is permitted to produce, or null if the source is unknown.
 * Unknown → null → the validator removes the item. Closed, not open.
 */
function scopeForSource (source) {
  const s = String(source == null ? '' : source)
  if (s.startsWith(COVERAGE_PREFIX)) return 'coverage_state'
  return Object.prototype.hasOwnProperty.call(SCOPE_BY_SOURCE, s) ? SCOPE_BY_SOURCE[s] : null
}

/** True when this source is allowed to assert the state of the business itself. */
function mayAssertBusinessState (source) { return scopeForSource(source) === 'business_state' }

/**
 * Containment wording for an external record. The title is quoted verbatim — it is the
 * source's words, not ours — and the sentence around it says only that the source holds it.
 */
function sourceRecordText (source, title, whenDisplay) {
  const t = (title && String(title).trim()) || '(untitled)'
  const when = whenDisplay ? ' — dated ' + whenDisplay : ''
  return String(source) + ' contains a record: "' + t + '"' + when
}

/** Same shape for an Owner work item: it is a record of something the Owner must act on. */
function ownerWorkItemText (label, whenDisplay) {
  const when = whenDisplay ? ' — raised ' + whenDisplay : ''
  return 'Awaiting your decision: "' + String(label) + '"' + when
}

/**
 * Operational vocabulary. ONLY a backstop, and only ever applied to narrative text.
 * If one of these appears in a sentence THIS SYSTEM composed — outside any quotation —
 * about a source that cannot know it, something has gone wrong upstream.
 */
const OPERATIONAL_TERMS = Object.freeze([
  'sales', 'revenue', 'turnover', 'stock level', 'inventory', 'on hand', 'in stock',
  'production', 'covers', 'food cost', 'purchasing', 'purchase order', 'attendance',
  'headcount', 'payroll', 'wastage', 'margin'
])

/** Remove every double-quoted span — those are other people's words, not our claims. */
function narrativeOnly (text) {
  return String(text == null ? '' : text).replace(/"[^"]*"/g, ' ')
}

/**
 * Does the NARRATIVE (our own words) assert operational fact? Returns the matched term
 * or null. Quoted external content is invisible to this by construction.
 */
function narrativeAssertsBusinessState (text) {
  const low = narrativeOnly(text).toLowerCase()
  for (const term of OPERATIONAL_TERMS) if (low.includes(term)) return term
  return null
}

module.exports = {
  SCOPES,
  SCOPE_BY_SOURCE,
  COVERAGE_PREFIX,
  OPERATIONAL_TERMS,
  scopeForSource,
  mayAssertBusinessState,
  sourceRecordText,
  ownerWorkItemText,
  narrativeOnly,
  narrativeAssertsBusinessState
}
