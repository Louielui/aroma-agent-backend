'use strict'

/**
 * readContextLog.js — ONE line per SOURCE per turn.
 *
 * WHY THIS EXISTS. The read path logged nothing at all, and a per-source failure was
 * swallowed by a bare `catch (_) {}`. So when the Owner asked 「呢個星期有咩安排？」 and
 * 心燈 answered 「讀唔到」, there was no way to tell whether the calendar had returned
 * UNAVAILABLE or had returned results that 心燈 then mis-reported. A whole round was
 * spent unable to answer that. This closes it.
 *
 * SAFETY — ALLOWLIST BY CONSTRUCTION, same discipline as the intake outcome line. The
 * entry is built field by field from a fixed list; anything not on it cannot appear.
 * NEVER logged: fetched content, item titles, prompts, queries, credentials, file paths,
 * URLs, ids. The whole point of the read block is that it holds the Owner's private
 * material — a diagnostic that leaked it would be worse than no diagnostic.
 *
 * `error` is the one free-text field, so it is scrubbed HARD before it is allowed
 * through: URLs, paths, emails and long opaque tokens are removed, and what remains is
 * capped. A reason too long to be a reason is dropped, never truncated — truncated
 * content is still content.
 */

const FIELDS = Object.freeze([
  'source', // 'drive' | 'gmail' | 'calendar' | 'github'
  'trust', // 'live' | 'unavailable' | 'not_asked' (no business intent — the source was never queried)
  'count', // number of items KEPT (never the items)
  'usedFallback', // boolean — keyword miss fell back to recent/next items
  'error', // scrubbed short reason, or null
  'durationMs' // number
])

const NUMERIC = new Set(['count', 'durationMs'])
const BOOLEAN = new Set(['usedFallback'])
const MAX_ENUM_CHARS = 64
const MAX_REASON_CHARS = 80

/**
 * Strip anything that could carry content out of a failure reason. A provider error
 * message is written for developers and cheerfully includes URLs, ids and sometimes the
 * query — none of which belongs in a log that exists to be readable at a glance.
 */
function scrubReason (raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let s = raw
    .replace(/https?:\/\/\S+/gi, '<url>') // endpoints
    .replace(/[A-Za-z]:\\[^\s,;]+/g, '<path>') // windows paths
    .replace(/(?:\/[A-Za-z0-9_.-]+){2,}/g, '<path>') // posix paths
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>') // addresses
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<token>') // ids, keys, opaque handles
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > MAX_REASON_CHARS) s = s.slice(0, MAX_REASON_CHARS) + '…'
  return s || null
}

function project (input) {
  const src = (input && typeof input === 'object') ? input : {}
  const out = { event: 'READ_SOURCE', timestamp: new Date().toISOString() }
  for (const key of FIELDS) {
    const v = src[key]
    if (key === 'error') { out.error = scrubReason(v); continue }
    if (v === undefined || v === null) { out[key] = null; continue }
    if (NUMERIC.has(key)) { out[key] = Number.isFinite(v) ? v : null; continue }
    if (BOOLEAN.has(key)) { out[key] = (v === true); continue }
    out[key] = (typeof v === 'string' && v.length > 0 && v.length <= MAX_ENUM_CHARS) ? v : null
  }
  return out
}

function defaultSink (entry) {
  try { console.log('[AROMA-READ-SOURCE]', JSON.stringify(entry)) } catch (_) {}
}

/** Log one source's outcome. Never throws — a diagnostic must not break a turn. */
function logReadSource (input, sink = defaultSink) {
  try { sink(project(input)) } catch (_) {}
}

module.exports = { logReadSource, project, scrubReason, FIELDS }
