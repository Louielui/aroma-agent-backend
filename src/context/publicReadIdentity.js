'use strict'

/**
 * publicReadIdentity.js — one public SEARCH is not one public OPERATION.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY A PUBLIC READ NEEDS AN INSTANCE KEY AND AN INTERNAL ONE DOES NOT.
 *
 * `aroma_system.invoices` is a whole answer: the operation IS the query, it can be asked once
 * per turn, and its readKey is the operation name. A public search is the opposite — the
 * operation is a verb and the QUERY is the question, so one turn can legitimately run several,
 * and they are different reads of different things.
 *
 * Keyed by operation alone, the second search would overwrite the first exactly as
 * aroma_system.purchasing once overwrote aroma_system.replenishment — the defect that cost the
 * A3 identity round. The fix is the same shape, applied one level deeper: the read grain is
 * the operation PLUS the arguments that made it a different read.
 *
 * ⛔ THE RAW QUERY NEVER APPEARS IN THE KEY. A readKey is rendered into the model's prompt as
 * `ref=` and into telemetry as a source label. A query can carry a supplier name, a price or
 * anything else the Owner typed, and neither of those places may receive content. So the key
 * carries a HASH of the canonical arguments and nothing readable.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const crypto = require('node:crypto')

/** Short, stable, and long enough that two real queries will not collide in one turn. */
const HASH_CHARS = 10

/**
 * Canonicalise the closed args so equivalent requests produce one key.
 *
 * Deliberately narrow: trim, lowercase and collapse internal whitespace. It does NOT stem,
 * translate or reorder words — 「beef price」 and 「price beef」 are different questions and a
 * key that merged them would silently answer one with the other's evidence.
 */
function canonicalArgs (args) {
  const a = args && typeof args === 'object' ? args : {}
  const norm = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : null)
  return {
    query: norm(a.query),
    freshness: typeof a.freshness === 'string' ? a.freshness : null,
    location: norm(a.location)
  }
}

/**
 * The read instance key: `<operation>@<hash>`.
 *
 * Same canonical arguments → same key, so a duplicate request inside one turn is detectable
 * and need not be executed twice. Different query, freshness or location → different key, so
 * two searches keep two identities, two EvidenceSets and two sets of canonical row refs.
 *
 * With no arguments at all the key is the bare operation — there is nothing to distinguish.
 */
function publicReadKey (operation, args) {
  const c = canonicalArgs(args)
  if (c.query === null && c.freshness === null && c.location === null) return String(operation)
  const material = JSON.stringify([c.query, c.freshness, c.location])
  const hash = crypto.createHash('sha256').update(material, 'utf8').digest('hex').slice(0, HASH_CHARS)
  return String(operation) + '@' + hash
}

/** Is this readKey a public search instance? Used to keep the operation re-offerable. */
function isPublicReadKey (readKey) {
  return typeof readKey === 'string' && readKey.startsWith('public_knowledge.search')
}

module.exports = { publicReadKey, canonicalArgs, isPublicReadKey, HASH_CHARS }
