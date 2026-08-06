'use strict'

/**
 * recordRead.js — the development record as a read source.
 *
 * ── IT IS AN INDEX, NOT THE DOCUMENTS ────────────────────────────────────────
 * docs/ is 42 files and ~410,000 characters. The WHOLE context block, shared across every
 * source, is 6,000. HOUSE-RULES.md alone is 19,130 — three times the entire budget. Handing
 * her a document would be truncated by the provider, and a truncated rules file is one
 * silently missing its later rules.
 *
 * So this returns one short citation per ruling/defect/design, and the document itself stays
 * a deliberate follow-up read — never an automatic one.
 *
 * ── NO NEW SCOPE, NO NEW CREDENTIAL ──────────────────────────────────────────
 * The record is read from THIS BUILD's own docs/ directory, the same way demoHtml reads its
 * assets. It therefore describes exactly the commit the process is running, and it cannot be
 * unavailable because a token expired or a repo moved. The GitHub connector remains what it
 * already was — and `getFileAtRef` is how a full document would be fetched if the Owner ever
 * asks for one.
 *
 * ── THE RECORD IS HISTORY, NEVER PERMISSION ──────────────────────────────────
 * No row carries an approval or authorisation field. A document that says 「approved」 records
 * that something WAS approved once; the only live authorisation in this system is a sealed
 * order with an unconsumed nonce. This is recall-is-not-evidence one layer up.
 */

const { makeContextResult, ENTITY_TYPES } = require('../contextResult')
const { buildIndex, citationFor } = require('../developmentRecord')

/** Enough to answer, few enough that four sources still fit beside it. */
const MAX_ENTRIES = 6

function tokens (q) {
  return String(q || '')
    .split(/[\s,、。；;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

/**
 * Scored, not filtered-to-everything. A miss returns NOTHING — returning the whole index
 * would flood a 6,000-char block and bury the other four sources, which is the same failure
 * as an unbounded read anywhere else.
 */
function match (entry, terms) {
  if (!terms.length) return 0
  const hay = (entry.id + ' ' + entry.title + ' ' + entry.sourceFile).toLowerCase()
  let score = 0
  for (const t of terms) {
    const s = t.toLowerCase()
    if (entry.id.toLowerCase() === s) score += 10
    else if (hay.includes(s)) score += 2
  }
  return score
}

function createRecordReadAdapter (options = {}) {
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const index = typeof options.index === 'function' ? options.index : () => buildIndex({})

  const methods = {
    async listRecordEntries ({ q, pageSize = MAX_ENTRIES } = {}) {
      const terms = tokens(q)
      const retrievedAt = now()
      const scored = index()
        .map((e) => ({ e, s: match(e, terms) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, Math.min(pageSize, MAX_ENTRIES))

      return scored.map(({ e }) => makeContextResult({
        source: 'development_record',
        sourceId: e.id,
        title: e.id + ' — ' + e.title,
        // THE CITATION IS BUILT HERE, server-side, and always carries status and date.
        // She names the rule; she never composes the stamp — the same discipline as
        // server-supplied metric values.
        content: citationFor(e),
        // A document status is not a date the record happened on. Claiming otherwise would
        // date a ruling to when someone last annotated it.
        originalDate: null,
        link: null,
        retrievedAt,
        entityType: ENTITY_TYPES.DOCUMENT || null,
        // Deliberately no `approved` / `authorised` field. See the header.
        fields: { status: e.status, declaredAt: e.declaredAt, sourceFile: e.sourceFile }
      }))
    }
  }

  return { source: 'development_record', methods, ready: () => true }
}

module.exports = { createRecordReadAdapter, MAX_ENTRIES }
