'use strict'

/**
 * contextCard.js — B2-2 Context Card hook (Slice 2).
 *
 * The Context Card is UNTRUSTED, per-turn, caller-supplied, UPDATABLE, session-
 * only project-status data (e.g. a runtime "project status card" carrying
 * branch/commit/status). It is NOT persisted here and NOT stored — the caller
 * supplies a fresh card each turn. Persona holds NO such state.
 *
 * Defences (structural — deterministically testable):
 *   - WHITE-LIST schema only: keys outside ALLOWED_FIELDS are dropped (observable).
 *   - Per-field MAX length: over-length values are truncated (observable).
 *   - Delimiter escaping: angle brackets are stripped so card data can never close
 *     the block or forge a new one (anti-breakout) (observable when it happens).
 *   - Explicit data block: values are wrapped in <context_card>…</context_card>,
 *     which the trusted persona guard (xiangxiang.js) frames as data, not
 *     instructions.
 *
 * Truncation/drop/strip are NEVER silent — every transformation is reported in
 * `warnings` so the caller/UI can observe it.
 *
 * The real MODEL's resistance to prompt injection is a residual risk (cannot be
 * proven by a unit test); these structural defences are what we prove here.
 */

const OPEN = '<context_card>'
const CLOSE = '</context_card>'
const MAX_FIELD_LEN = 300

// White-listed schema. Shape is Owner-refined (B5); this is a sensible starter set
// for a project-status card. Anything not listed is dropped (with a warning).
const ALLOWED_FIELDS = Object.freeze(['project', 'branch', 'commit', 'status', 'note'])

/**
 * Turn an untrusted context-card object into a sanitized prompt preamble plus
 * observable validation warnings.
 *
 * @param {object|null} contextCard
 * @returns {{ preamble: string, warnings: Array<{field: string, code: string}> }}
 */
function buildContextPreamble (contextCard) {
  if (!contextCard || typeof contextCard !== 'object' || Array.isArray(contextCard)) {
    return { preamble: '', warnings: [] }
  }
  const lines = []
  const warnings = []
  for (const key of Object.keys(contextCard)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      warnings.push({ field: key, code: 'dropped_not_in_whitelist' })
      continue
    }
    const raw = String(contextCard[key] == null ? '' : contextCard[key])
    const stripped = raw.replace(/[<>]/g, '') // anti-breakout: neutralize the delimiter
    if (stripped !== raw) warnings.push({ field: key, code: 'delimiter_stripped' })
    let value = stripped
    if (value.length > MAX_FIELD_LEN) {
      value = value.slice(0, MAX_FIELD_LEN)
      warnings.push({ field: key, code: 'truncated' })
    }
    lines.push(`${key}: ${value}`)
  }
  const preamble = lines.length ? `${OPEN}\n${lines.join('\n')}\n${CLOSE}\n\n` : ''
  return { preamble, warnings }
}

module.exports = { buildContextPreamble, ALLOWED_FIELDS, MAX_FIELD_LEN, OPEN, CLOSE }
