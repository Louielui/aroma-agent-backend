'use strict'

/**
 * briefSerializer.js — the deterministic Task → worker-brief serializer (B2-7).
 *
 * PURE and LLM-FREE by design. It maps a Task's own fields to the exact string a
 * worker would receive, with NO expansion, NO added steps, NO substitution of a
 * Decision statement or a chat reply, and NO model call. The bridge stamps the
 * output with briefSerializationVersion so a future v2 can change the shape
 * without silently rewriting v1 briefs.
 *
 * v1 shape:
 *   title + note  -> "Title: <title>\n\nDetails: <note>"
 *   title only    -> "Title: <title>"        (blank/whitespace/missing note)
 *
 * A blank/invalid title is NOT handled here — the promote endpoint rejects it
 * (422) before serialization, so this function is only ever called with a title.
 */

const BRIEF_SERIALIZATION_VERSION = 'v1'

/**
 * Serialize a Task to a v1 worker brief. Deterministic: same task in → same
 * string out, every time, with no external input.
 * @param {{ title?: string, note?: string }} task
 * @returns {string}
 */
function serializeBriefV1 (task = {}) {
  const src = task || {}
  const title = typeof src.title === 'string' ? src.title.trim() : ''
  const note = typeof src.note === 'string' ? src.note.trim() : ''
  if (note) return `Title: ${title}\n\nDetails: ${note}`
  return `Title: ${title}`
}

module.exports = { serializeBriefV1, BRIEF_SERIALIZATION_VERSION }
