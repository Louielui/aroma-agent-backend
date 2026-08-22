'use strict'
/**
 * sectionAttribution.js — X4.2. A heading may not name a source its rows do not come from.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PRODUCTION TURN: 866e77d9.
 *
 * Calendar returned 2 rows. Drive returned 4. All six appeared under one model-authored heading
 * — 「日曆：讀到，但沒有一項落在下星期」 — so four Drive documents were presented to the Owner as
 * his calendar, and the two real appointments were buried among them.
 *
 * ⛔ NOTHING WAS ACTUALLY MIXED. The forensic proved every row kept its correct server-resolved
 * identity the whole way: connector → readContext → turnItems (keyed by read, so drive could not
 * overwrite calendar) → the evidence index → the validated plan, where each item still carries
 * its `readKey`. The data was right. The label on top of it was the model's, and nothing ever
 * compared the two.
 *
 * ⛔ AND THE ONE CHECK THAT LOOKED LIKE IT MIGHT HAVE CAUGHT IT NEVER RAN. `proseIsGrounded`
 * iterates LATIN tokens; the heading is entirely CJK, so the loop body executed zero times and
 * it returned `true`. The heading was not judged and found acceptable — it was never examined.
 *
 * ⛔ WHAT THIS FILE DOES, AND THE ONE THING IT MUST NEVER DO.
 *
 * It answers two questions and nothing else: does this heading CLAIM a source, and which sources
 * do these rows ACTUALLY come from. When those disagree, the claim does not render.
 *
 * It never rewrites the model's words, never guesses a better heading, and never infers a source
 * from a title or a filename. 「Gluten-Free Birthday Dinner Menu.pdf」 looks like a document and
 * 「Wedding Catering」 looks like an appointment — both intuitions are worthless, and one of them
 * is wrong. Provenance comes from the server's own resolution or it does not come at all.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { LABELS } = require('./readStateGuard')
const { AROMA_OPERATIONS, SOURCE_LEVEL_OPERATIONS } = require('../context/readOperations')

/**
 * ⛔ readKey → source, FROM THE CANONICAL TABLES, NOT BY STRING SURGERY.
 *
 * ⛔ AND aroma_system IS DELIBERATELY MANY-TO-ONE (Blocker-8). `aroma_system.invoices` and
 * `aroma_system.inventory` are two DIFFERENT reads that share one source. Collapsing the source
 * is correct here — they really are both the restaurant system — but the OPERATION identity must
 * survive for the label, which is why this returns the source only and the caller keeps the
 * readKey for naming. Splitting on `.` would work today and would silently invent a source the
 * day an operation name gains a dot for another reason.
 */
const READ_KEY_TO_SOURCE = new Map()
for (const e of SOURCE_LEVEL_OPERATIONS || []) READ_KEY_TO_SOURCE.set(e.operation, e.source)
for (const e of AROMA_OPERATIONS || []) READ_KEY_TO_SOURCE.set(e.operation, e.source)
READ_KEY_TO_SOURCE.set('public_knowledge.search', 'public_knowledge')

/** @returns {string|null} null when the key is unknown — never a guess. */
function sourceOfReadKey (readKey) {
  const k = typeof readKey === 'string' ? readKey.trim() : ''
  if (!k) return null
  if (READ_KEY_TO_SOURCE.has(k)) return READ_KEY_TO_SOURCE.get(k)
  // A bare source name is itself a valid read key for the source-level reads.
  if (Object.prototype.hasOwnProperty.call(LABELS, k)) return k
  return null
}

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s:：、,，.。·・\-_/()（）[\]]+/g, '')

/**
 * ⛔ THE CLOSED ALIAS SET. Every entry is a name the SERVER already uses for a source — the
 * `LABELS` map that readStateGuard derives from ALL_SOURCES, plus the English/Chinese pair each
 * one is actually written as. It is a fixed list, not a matcher: adding a source means adding a
 * line here, and a name that is not on it makes no source claim at all.
 *
 * ⛔ THIS IS NOT A CHINESE GROUNDING ENGINE, and must never grow into one. It recognises SOURCE
 * NAMES. 「主要風險」 is not on the list and never will be, which is exactly why a semantic
 * heading survives untouched.
 */
const ALIASES = new Map()
const alias = (text, source) => { const n = norm(text); if (n) ALIASES.set(n, source) }
for (const [source, label] of Object.entries(LABELS)) alias(label, source)
/**
 * ⛔ ONLY WHAT `LABELS` DOES NOT ALREADY GIVE. The first version repeated 日曆, Drive, Gmail,
 * GitHub and 餐廳系統 here as well, and a mutation removing EITHER registration then changed
 * nothing — two independent paths to the same entry meant neither was load-bearing and the
 * fence could not fail. One entry point, so breaking it breaks visibly.
 */
alias('calendar', 'calendar'); alias('日历', 'calendar'); alias('行事曆', 'calendar')
alias('google drive', 'drive'); alias('雲端硬碟', 'drive')
alias('電郵', 'gmail'); alias('郵件', 'gmail')
alias('aroma system', 'aroma_system'); alias('aromasystem', 'aroma_system')
alias('the restaurant system', 'aroma_system')
alias('public knowledge', 'public_knowledge'); alias('公開資料', 'public_knowledge')
for (const e of AROMA_OPERATIONS || []) alias(e.label, e.source) // 發票 / 倉存 … all claim aroma_system

/**
 * Does this heading CLAIM a source?
 *
 * ⛔ A CLAIM IS A NAME AT THE FRONT, NOT A NAME ANYWHERE. 「日曆：讀到，但沒有一項落在下星期」
 * claims Calendar. 「下星期同 Drive 上份合約有關嘅風險」 mentions Drive while being about risk,
 * and treating that as a claim would delete a perfectly good semantic heading. So only the
 * segment before the first separator is tested, and only against the closed list.
 *
 * @returns {string|null} the claimed source key, or null for no claim.
 */
function sourceClaimOf (heading) {
  const raw = String(heading == null ? '' : heading)
  if (!raw.trim()) return null
  const head = raw.split(/[:：\-—|｜(（]/)[0]
  const n = norm(head)
  if (!n) return null
  if (ALIASES.has(n)) return ALIASES.get(n)
  // A claim may lead the segment: 「日曆讀到但…」 with no separator at all.
  for (const [a, source] of ALIASES) {
    if (a.length >= 2 && n.startsWith(a)) return source
  }
  return null
}

/**
 * The sources a section's validated rows actually came from.
 *
 * ⛔ `readKey` ONLY. Not the title, not the filename, not the canonical string, not the model's
 * `sourceId` — the server resolved this already and its answer is the only one that counts.
 * `unknown` is returned as a distinct fact rather than being dropped, because a row whose
 * provenance cannot be established must be able to REFUSE a heading, not quietly permit one.
 */
function itemSources (items) {
  const sources = new Set()
  const readKeys = new Set()
  let unknown = 0
  for (const it of Array.isArray(items) ? items : []) {
    const s = sourceOfReadKey(it && it.readKey)
    if (s) { sources.add(s); readKeys.add(String(it.readKey)) } else unknown += 1
  }
  return { sources, readKeys, unknown }
}

const VERDICT = Object.freeze({
  ALLOW: 'allow',
  REJECT_SOURCE_CONFLICT: 'reject_source_conflict',
  REJECT_UNPROVABLE: 'reject_unprovable'
})

/**
 * Judge one section's heading against its own rows.
 *
 * ⛔ ONLY A SOURCE CLAIM CAN BE REFUSED. A heading making no claim is returned ALLOW without
 * being looked at further — X4.2 has no opinion about semantic headings and no licence to form
 * one.
 *
 * ⛔ AND AN UNPROVABLE CLAIM IS REFUSED, NOT ASSUMED. A row with no resolvable `readKey` cannot
 * support 「these are all from Calendar」, so the claim goes. The safe direction is losing a
 * heading, never keeping a false one.
 */
function judgeSectionHeading ({ heading, items } = {}) {
  const claimedSource = sourceClaimOf(heading)
  const { sources, readKeys, unknown } = itemSources(items)
  /**
   * ⛔ DISTINCT READS, NOT DISTINCT SOURCES — AND THAT IS THE Blocker-8 LINE.
   *
   * `aroma_system.invoices` and `aroma_system.inventory` share a source, so a 餐廳系統 heading
   * over both is TRUE and keeps its place. But 發票 and 倉存 are still two different reads, and
   * a list that silently merges them is the same defect one level down. Labelling turns on the
   * number of READS, so operation identity survives inside a correct source heading.
   */
  const multiRead = readKeys.size + (unknown > 0 ? 1 : 0) > 1
  if (!claimedSource) return { verdict: VERDICT.ALLOW, claimedSource: null, sources, unknown, multiRead }
  if (unknown > 0) return { verdict: VERDICT.REJECT_UNPROVABLE, claimedSource, sources, unknown, multiRead }
  if (sources.size === 1 && sources.has(claimedSource)) {
    return { verdict: VERDICT.ALLOW, claimedSource, sources, unknown, multiRead }
  }
  return { verdict: VERDICT.REJECT_SOURCE_CONFLICT, claimedSource, sources, unknown, multiRead }
}

/**
 * ⛔ WHEN A CLAIM IS REFUSED, SOMETHING TRUE MUST TAKE ITS PLACE. Deleting the heading alone
 * would leave six rows under nothing at all, and the Owner would still have no way to tell the
 * two appointments from the four documents. So each row is labelled with its own source.
 *
 * The label comes from the caller's existing `labelFor(operation, readKey, source)` — the same
 * resolver the non-plan renderer has always used, which is documented never to emit an unvetted
 * string. No second label table is introduced, and `readKey` is passed as the operation so
 * 發票 and 倉存 stay distinguishable inside 餐廳系統 (Blocker-8).
 */
function itemSourceLabel (readKey, labelFor) {
  const source = sourceOfReadKey(readKey)
  if (!source) return null // fail soft: no provenance, no invented label
  const label = labelFor(readKey, readKey, source)
  return label || LABELS[source] || null
}

module.exports = {
  VERDICT,
  sourceOfReadKey,
  sourceClaimOf,
  itemSources,
  judgeSectionHeading,
  itemSourceLabel,
  READ_KEY_TO_SOURCE,
  SOURCE_ALIASES: ALIASES
}
