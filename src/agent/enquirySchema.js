'use strict'

/**
 * enquirySchema.js — the result CONTRACT for a read-only enquiry, and the local re-check.
 *
 * ── WHY A SCHEMA AND A VALIDATOR, WHEN THE CLI ALREADY VALIDATES ─────────────
 * Claude Code's `--json-schema` returns "validated JSON output matching a JSON Schema after the
 * agent completes its workflow". We hand it THIS schema, so the CLI does the shaping. We then
 * check the shape AGAIN here, because the two are not the same claim:
 *
 *   the CLI's check says  "the model's answer matched the schema I was given"
 *   this check says       "the bytes that reached us are a complete, terminal, in-bounds result"
 *
 * A truncated stream, a crashed child, a wrong `--json-schema` that an older build ignored, or
 * an error object printed instead of a result all produce output the first check never saw.
 *
 * ⛔ WHAT IS NOT CLAIMED. Passing this validator does not mean the answer is true. It means the
 * envelope is well formed and its citations were checkable. `verifyCitations` reports which
 * citations it could confirm and which it could not; an unverified citation is reported as
 * unverified, never dropped and never counted as support.
 *
 * ⛔ AND A CITATION IS A SAMPLE, NOT A SURVEY. (Correction, 2026-09-05.)
 * The first version emitted evidence rows carrying `completeness: 'whole'` with `matchingTotal`
 * set to the number of lines cited. Read against evidenceGate's actual contract that says "we
 * looked at everything and everything matched" — which is exactly the
 * complete-within-a-slice-is-not-complete defect that file was written to refuse. Rows are now
 * emitted as samples with an unknown source total, so a universal claim built on citations is
 * refused by the existing gate rather than waved through by this one.
 */

const fs = require('node:fs')
const path = require('node:path')

/* ══════════════ bounds ══════════════ */

const MAX_ANSWER_CHARS = 20000
const MAX_CITATIONS = 100
const MAX_QUOTE_CHARS = 400
const MAX_PATH_CHARS = 400
const MAX_NOT_ESTABLISHED = 50
const MAX_ITEM_CHARS = 500

/**
 * ⛔ FROZEN ALL THE WAY DOWN, NOT ONLY AT THE TOP.
 * `Object.freeze` on the outer object leaves every nested object writable, so an exported
 * schema could be edited by anything that can require this module — and the argv built from it
 * would change without a single line of this file changing. Deep freeze closes that, and a test
 * mutates the export to prove the argv does not move.
 */
function deepFreeze (value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const k of Object.keys(value)) deepFreeze(value[k])
  return value
}

/**
 * The schema handed to `--json-schema`. Deliberately small: every field is something the
 * enquiry must produce in order to be checkable, and nothing is here for decoration.
 *
 * `citations` is the load-bearing one. A finding without a file, a line range and the exact
 * quoted text cannot be confirmed by anyone later, and an unconfirmable finding is the failure
 * mode this whole path exists to avoid. `quote` has minLength 1 for the same reason the local
 * validator rejects a blank one: an empty quote confirms nothing while looking like a citation.
 */
const ENQUIRY_JSON_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'citations', 'notEstablished'],
  properties: {
    answer: { type: 'string', maxLength: MAX_ANSWER_CHARS },
    citations: {
      type: 'array',
      maxItems: MAX_CITATIONS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'startLine', 'endLine', 'quote'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARS },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
          quote: { type: 'string', minLength: 1, maxLength: MAX_QUOTE_CHARS }
        }
      }
    },
    notEstablished: {
      type: 'array',
      maxItems: MAX_NOT_ESTABLISHED,
      items: { type: 'string', maxLength: MAX_ITEM_CHARS }
    }
  }
})

const REASON = Object.freeze({
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  MISSING_FIELD: 'MISSING_FIELD',
  WRONG_TYPE: 'WRONG_TYPE',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  BAD_LINE_RANGE: 'BAD_LINE_RANGE',
  EMPTY_QUOTE: 'EMPTY_QUOTE',
  NOT_VALIDATED: 'NOT_VALIDATED'
})

const bad = (reason, detail) => ({ ok: false, reason, detail })

/** Own-property only: an inherited `answer` is not an answer this object supplied. */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * Re-validate the parsed payload against the same contract, locally.
 *
 * ⛔ Structure only, and every branch is a refusal rather than a repair. Nothing here trims,
 * coerces, defaults or "fixes" a field: a result that needed fixing was not the result.
 */
function validateEnquiryPayload (payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return bad(REASON.NOT_AN_OBJECT, 'the result envelope is not a JSON object')
  }
  for (const k of Object.keys(payload)) {
    if (!['answer', 'citations', 'notEstablished'].includes(k)) {
      return bad(REASON.UNKNOWN_FIELD, `unexpected field '${String(k).slice(0, 40)}'`)
    }
  }
  for (const k of ['answer', 'citations', 'notEstablished']) {
    if (!own(payload, k)) return bad(REASON.MISSING_FIELD, `missing field '${k}'`)
  }
  if (typeof payload.answer !== 'string') return bad(REASON.WRONG_TYPE, 'answer must be a string')
  if (payload.answer.length > MAX_ANSWER_CHARS) return bad(REASON.OUT_OF_BOUNDS, 'answer exceeds ' + MAX_ANSWER_CHARS + ' chars')

  if (!Array.isArray(payload.citations)) return bad(REASON.WRONG_TYPE, 'citations must be an array')
  if (payload.citations.length > MAX_CITATIONS) return bad(REASON.OUT_OF_BOUNDS, 'too many citations')
  for (const c of payload.citations) {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) return bad(REASON.WRONG_TYPE, 'a citation is not an object')
    for (const k of Object.keys(c)) {
      if (!['path', 'startLine', 'endLine', 'quote'].includes(k)) {
        return bad(REASON.UNKNOWN_FIELD, `unexpected citation field '${String(k).slice(0, 40)}'`)
      }
    }
    for (const k of ['path', 'startLine', 'endLine', 'quote']) {
      if (!own(c, k)) return bad(REASON.MISSING_FIELD, `citation is missing '${k}'`)
    }
    if (typeof c.path !== 'string' || c.path === '') return bad(REASON.WRONG_TYPE, 'citation.path must be a non-empty string')
    if (c.path.length > MAX_PATH_CHARS) return bad(REASON.OUT_OF_BOUNDS, 'citation.path too long')
    if (typeof c.quote !== 'string') return bad(REASON.WRONG_TYPE, 'citation.quote must be a string')
    // ⛔ A BLANK QUOTE IS NOT A CITATION. '' and '   ' would both "match" any line under a
    // containment test, so they would come back CONFIRMED while confirming nothing.
    if (c.quote.trim() === '') return bad(REASON.EMPTY_QUOTE, 'citation.quote is empty or whitespace only')
    if (c.quote.length > MAX_QUOTE_CHARS) return bad(REASON.OUT_OF_BOUNDS, 'citation.quote too long')
    if (!Number.isInteger(c.startLine) || !Number.isInteger(c.endLine)) {
      return bad(REASON.WRONG_TYPE, 'citation line numbers must be integers')
    }
    if (c.startLine < 1 || c.endLine < c.startLine) return bad(REASON.BAD_LINE_RANGE, 'citation line range is not ascending from 1')
  }

  if (!Array.isArray(payload.notEstablished)) return bad(REASON.WRONG_TYPE, 'notEstablished must be an array')
  if (payload.notEstablished.length > MAX_NOT_ESTABLISHED) return bad(REASON.OUT_OF_BOUNDS, 'too many notEstablished items')
  for (const s of payload.notEstablished) {
    if (typeof s !== 'string') return bad(REASON.WRONG_TYPE, 'notEstablished items must be strings')
    if (s.length > MAX_ITEM_CHARS) return bad(REASON.OUT_OF_BOUNDS, 'a notEstablished item is too long')
  }
  return { ok: true }
}

/* ══════════════ citation verification ══════════════ */

const CITATION = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  OUTSIDE_COPY: 'OUTSIDE_COPY',
  UNREADABLE: 'UNREADABLE',
  LINE_RANGE_ABSENT: 'LINE_RANGE_ABSENT',
  QUOTE_MISMATCH: 'QUOTE_MISMATCH'
})

/**
 * Is `candidate` the same path as, or inside, `root`?
 *
 * ⛔ NOT A STRING PREFIX TEST. `/tmp/aroma-x` starts with `/tmp/aroma`, and on Windows
 * `C:\Temp\X` and `c:\temp\x` are the same directory while comparing differently. Both are real
 * defects, and both are why this resolves BOTH paths through realpath first — which also
 * collapses junctions and symlinks to the object they actually point at — and then compares
 * with path.relative, so containment is decided by path segments rather than characters.
 *
 * ⛔ ONLY ENOENT MAY CLIMB. A path that does not exist still has a location, so the deepest
 * existing ancestor is resolved and the remainder re-joined. But a realpath that failed for any
 * OTHER reason — EACCES above all — tells us we could not see the path, and treating that as
 * "merely absent" would let an unreadable directory be reasoned about from a computed string.
 * Every non-ENOENT failure refuses.
 */
function isInside (root, candidate, realpathFn) {
  const real = typeof realpathFn === 'function' ? realpathFn : (p) => fs.realpathSync.native(p)
  let a, b
  try { a = real(root) } catch (_) { return false }
  try { b = real(candidate) } catch (e) {
    if (!e || e.code !== 'ENOENT') return false
    let dir = path.resolve(candidate)
    const rest = []
    for (;;) {
      const parent = path.dirname(dir)
      if (parent === dir) return false // reached a root that does not resolve
      rest.unshift(path.basename(dir))
      dir = parent
      try { b = path.join(real(dir), ...rest); break } catch (e2) {
        if (!e2 || e2.code !== 'ENOENT') return false
      }
    }
  }
  if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
  const rel = path.relative(a, b)
  if (rel === '') return true
  return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)
}

/**
 * Check every citation against the disposable copy.
 *
 * ⛔ VALIDATION FIRST, ALWAYS. A malformed citation must never reach a filesystem read: an
 * un-typed `path` or a non-integer line number would otherwise be handed to path.join and
 * readFile before anything had established what they were.
 *
 * Returns one row per citation plus an evidence array shaped for evidenceGate.checkEvidence, so
 * the existing gate does the reasoning about sampling and coverage rather than a second,
 * parallel evidence system being invented here.
 */
function verifyCitations (payload, opts = {}) {
  const valid = validateEnquiryPayload(payload)
  if (!valid.ok) {
    return { ok: false, reason: REASON.NOT_VALIDATED, detail: valid.detail, rows: [], evidence: [], confirmed: 0, unverified: 0, outside: 0, allConfirmed: false }
  }
  const cwd = opts.cwd
  const readFileFn = typeof opts.readFile === 'function' ? opts.readFile : (p) => fs.readFileSync(p, 'utf8')
  const realpathFn = opts.realpath
  const rows = []
  const evidence = []

  for (const c of payload.citations) {
    const abs = path.isAbsolute(c.path) ? c.path : path.join(cwd, c.path)
    if (!isInside(cwd, abs, realpathFn)) {
      rows.push({ path: c.path, status: CITATION.OUTSIDE_COPY, detail: 'the cited path is not inside the disposable copy' })
      continue
    }
    let text
    try { text = readFileFn(abs) } catch (_) {
      rows.push({ path: c.path, status: CITATION.UNREADABLE, detail: 'the cited file could not be read' })
      continue
    }
    const lines = String(text).split(/\r\n|\n/)
    if (c.endLine > lines.length) {
      rows.push({ path: c.path, status: CITATION.LINE_RANGE_ABSENT, detail: `lines ${c.startLine}-${c.endLine} do not exist (file has ${lines.length})` })
      continue
    }
    const slice = lines.slice(c.startLine - 1, c.endLine).join('\n')
    const needle = c.quote.trim()
    // Whitespace is normalised at the edges only: a quote differing in indentation is the same
    // text, while a quote differing in CONTENT is not and must not pass.
    if (!slice.includes(needle) && slice.trim() !== needle) {
      rows.push({ path: c.path, status: CITATION.QUOTE_MISMATCH, detail: 'the quoted text is not present at the cited lines' })
      continue
    }
    rows.push({ path: c.path, status: CITATION.CONFIRMED, startLine: c.startLine, endLine: c.endLine })
    evidence.push({
      source: 'disposable-copy:' + c.path,
      readState: 'OK',
      // ⛔ A CITATION IS A SAMPLE OF ONE FILE, and the wider source total is unknown. Stated
      // this way, evidenceGate refuses a universal claim built on citations — which is correct.
      completeness: 'sample',
      completeWithinScope: false,
      truncated: false,
      shownCount: c.endLine - c.startLine + 1,
      matchingTotal: lines.length,
      sourceTotal: null
    })
  }

  const confirmed = rows.filter((r) => r.status === CITATION.CONFIRMED).length
  const outside = rows.filter((r) => r.status === CITATION.OUTSIDE_COPY).length
  return {
    ok: true,
    rows,
    evidence,
    confirmed,
    unverified: rows.length - confirmed,
    outside,
    // ⛔ Stated rather than implied: this counts what we could check, and says nothing about
    // whether the answer is right. Zero citations is never "all confirmed".
    allConfirmed: rows.length > 0 && confirmed === rows.length
  }
}

module.exports = {
  ENQUIRY_JSON_SCHEMA,
  validateEnquiryPayload,
  verifyCitations,
  isInside,
  deepFreeze,
  REASON,
  CITATION,
  MAX_ANSWER_CHARS,
  MAX_CITATIONS,
  MAX_QUOTE_CHARS
}
