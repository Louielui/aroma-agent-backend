'use strict'

/**
 * sectionAttachment.js — Round B. What travels when he types from inside a section.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「⛔ 附上咗乜要睇得見. Before I type anything I should be able to see what would
 * > travel. Not after sending, not in a log — on screen, before.」**
 *
 * ⛔ ONE FUNCTION PRODUCES THE LINES, AND BOTH PATHS CALL IT.
 *
 * The preview endpoint calls `attachmentFor`. The send path calls `attachmentFor`. The client
 * never composes a preview of its own — **it asks what would travel and displays that.** Two
 * renderings can disagree; one function cannot disagree with itself. That is what makes
 * 「what I see」 and 「what travels」 the same thing structurally rather than by care.
 *
 * ⛔ AND THE CONTEXT IS THE SECTION, NEVER THE TYPED TEXT.
 * There is no `message` parameter anywhere in this file, and a test greps for its absence. The
 * whole point of the card shape is that the context is WHICH DOOR HE OPENED.
 *
 * ── DATA, NOT INSTRUCTION ───────────────────────────────────────────────────
 * A conclusion line reading 「green onion 查唔到」 is a statement about a result. Three structural
 * defences, all borrowed from the proven `intake/contextCard.js` rather than invented here:
 *
 *   1. a field WHITELIST — anything else is dropped, and the drop is reported
 *   2. DELIMITER ESCAPING — angle brackets stripped, so content cannot close this block or
 *      forge another one
 *   3. an explicit ENVELOPE that says, in words, that its contents are a record and not a request
 *
 * ⚠ WHAT THIS DOES NOT CLAIM, stated the way `contextCard.js` states it: **the real model's
 * resistance to prompt injection is a residual risk that no unit test can settle.** What is
 * proven is that the content cannot escape the envelope — not that the model ignores it.
 *
 * A SECOND ENVELOPE, DELIBERATELY. This does not widen `contextCard.js`'s whitelist to fit a
 * different kind of payload; widening a whitelist that guards a boundary to admit a new shape
 * is how whitelists stop guarding. Two envelopes, two whitelists, one discipline.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { conclusionFor } = require('./errandConclusion')
// ⛔ THE ENVELOPE IS GOVERNANCE AND LIVES IN THE PROTECTED PATH. This file derives WHAT to
// attach (content — the Owner may change it); the envelope decides how it is framed so page
// text cannot become an instruction (a fence — he must not). See governance/sectionEnvelope.js.
const { buildSectionPreamble, OPEN, CLOSE, ALLOWED_FIELDS, MAX_LINE_LEN } = require('../governance/sectionEnvelope')

const MAX_LINES = 12

/**
 * What would travel, as a VALUE. Takes a section and its rows — never anything he typed.
 *
 * @param {object} kind a KINDS entry
 * @param {Array} rows every errand row
 * @param {number} now
 */
function attachmentFor (kind, rows, now) {
  const c = conclusionFor(kind, rows, now)
  const lines = []

  // ⛔ Each of the four conclusion fields travels SEPARATELY, for the same reason it renders
  // separately: a gap folded into a calm summary is the failure this whole week has been about.
  if (c.alert) lines.push(c.alert)
  if (c.gap) lines.push(c.gap)
  if (c.unknown) lines.push(c.unknown)
  if (c.calm) lines.push(c.calm)

  // ⛔ NEVER EMPTY. An attachment with no lines would look like no context was carried, and he
  // would be back to guessing what she knows — the thing this shape exists to remove.
  if (!lines.length) {
    lines.push(c.state === 'NEVER_RUN'
      ? kind.title + ':從來未行過。'
      : kind.title + ':今日冇可以講嘅結論。')
  }

  return {
    kind: kind.id,
    title: kind.title,
    state: c.state,
    lines: lines.slice(0, MAX_LINES),
    capturedAt: Number(now)
  }
}

module.exports = { attachmentFor, buildSectionPreamble, OPEN, CLOSE, ALLOWED_FIELDS, MAX_LINE_LEN }
