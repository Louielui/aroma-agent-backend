'use strict'

/**
 * behavioralMapping.js — M3a Behavioral Mapping Contract (read-only; no store, no
 * seed, no runtime coupling).
 *
 * The legacy "behavioral middle section" of PERSONA_IDENTITY (between the Identity
 * prefix and the Stable Business Context) is NOT a single authority domain. This
 * module holds the OWNER-APPROVED ordered-fragment mapping that assigns every
 * code-unit of that section to exactly one authority domain:
 *   - operating-principles
 *   - personality
 * and provides a verifier that proves the mapping still matches the live constant.
 *
 * Authority is proven by exact source range + exact per-fragment UTF-8 SHA-256 +
 * the Owner classification — NOT by keyword/heading guessing. Equality is exact
 * string equality; SHA-256 is integrity evidence only. Fragments must be ordered,
 * contiguous, gapless, non-overlapping, and reconstitute PERSONA_IDENTITY exactly.
 * JavaScript string offsets are UTF-16 CODE UNITS (startCodeUnit/endCodeUnit);
 * fragment hashes are over the UTF-8 bytes of that range.
 */

const crypto = require('crypto')

const SOURCE_SYMBOL = 'PERSONA_IDENTITY'
const SOURCE_COMMIT = 'e90cb5bbf73203053b1f67c4a6d1468db67edbff'
const CLASSIFICATION_REF = 'OWNER-M3-BEHAVIORAL-CLASSIFICATION-2026-07-16'
const START_MARKER = '\n\n1. 思考順序:' // Personality/OP section start (= end of Identity prefix)
const END_MARKER = '\n\n1. Aroma 是' // Stable Business Context start (= end of behavioral section)
const AUTHORITY_DOMAINS = Object.freeze(['operating-principles', 'personality'])

// OWNER-APPROVED MAPPING (2026-07-16). One personality fragment (item 2 tone/style);
// item 2's honesty/completion-status sentence and items 1,3-8 are operating-principles.
const MAPPING = Object.freeze([
  frag(1, 807, 886, 'operating-principles', 'c5082d43c4cbf9d6889ebe3cc068bf77b64d01dfc725cb352345135d180c4b9d', 'item-1-thinking-order'),
  frag(2, 886, 952, 'personality', '03a3b8625081ce859d49a80e59ed60bfe61da16e037bd01bdab3f86bd06468a5', 'item-2-expression-style-tone'),
  frag(3, 952, 1008, 'operating-principles', '67fd738db3c44e0c4cda364b98a339566c42bc01912f4daa2387011fe54ae614', 'item-2-completion-status-honesty'),
  frag(4, 1008, 1080, 'operating-principles', '022230a19144d04424fd83bd9b49828035c6f1ea8968505ad3fd1ab2ac6bdc88', 'item-3-direct-advice'),
  frag(5, 1080, 1168, 'operating-principles', '977c92ac6b9e3872d501d24d65245df92c6b39615255eb472e22f3de2137279d', 'item-4-precise-clarification'),
  frag(6, 1168, 1318, 'operating-principles', '36fed1d1f2a9007a0ce6550d02a1161f508871dd9dfab4470be4219ab6f7db93', 'item-5-approval-execution-boundary'),
  frag(7, 1318, 1398, 'operating-principles', '40abdd01ca0392df53ae9232ea11b17febaa5417793a084b3b492cdc1f348e8b', 'item-6-independent-judgment'),
  frag(8, 1398, 1502, 'operating-principles', '9028d643b1dfcb073e8dee8342cef10d909e9dad538ef02cb06a63de8b34a05a', 'item-7-respect-facts-governance'),
  frag(9, 1502, 1586, 'operating-principles', 'b91c040d33448f9e099bb4cd9234102964a2fdfee16e7b5f6913f5dfc47f96c0', 'item-8-protect-and-drive')
])

function frag (sequence, startCodeUnit, endCodeUnit, authorityDomain, sha256Utf8, classificationRef) {
  return Object.freeze({ sequence, sourceSymbol: SOURCE_SYMBOL, sourceCommit: SOURCE_COMMIT, startCodeUnit, endCodeUnit, sha256Utf8, authorityDomain, classificationRef })
}
function sha256Utf8 (str) { return crypto.createHash('sha256').update(Buffer.from(str, 'utf8')).digest('hex') }

const REASON = Object.freeze({ PASS: 'PASS', FAILED: 'MAPPING_VERIFICATION_FAILED' })
function fail (detail, extra) { return Object.assign({ status: REASON.FAILED, reason: detail }, extra || {}) }

function markerCount (p, m) { let n = 0; let i = p.indexOf(m); while (i !== -1) { n++; i = p.indexOf(m, i + 1) } return n }

// Locate the behavioral section by the two markers. Returns boundaries or a failure.
function locateSection (personaIdentity) {
  const sc = markerCount(personaIdentity, START_MARKER)
  const ec = markerCount(personaIdentity, END_MARKER)
  if (sc !== 1) return { err: fail('START_MARKER_NOT_ONCE', { startMarkerCount: sc }) }
  if (ec !== 1) return { err: fail('END_MARKER_NOT_ONCE', { endMarkerCount: ec }) }
  const midStart = personaIdentity.indexOf(START_MARKER)
  const midEnd = personaIdentity.indexOf(END_MARKER)
  if (!(midStart < midEnd)) return { err: fail('MARKER_ORDER_INVALID') }
  return { midStart, midEnd }
}

/**
 * Verify the Owner-approved mapping against a live PERSONA_IDENTITY. Read-only.
 * Returns SAFE metadata only (no persona/fragment text).
 */
function verifyBehavioralMapping (personaIdentity, mapping) {
  const map = mapping || MAPPING
  if (typeof personaIdentity !== 'string' || personaIdentity.length === 0) return fail('PERSONA_UNAVAILABLE')

  const loc = locateSection(personaIdentity)
  if (loc.err) return loc.err
  const { midStart, midEnd } = loc

  // ordered by sequence 1..n
  const frags = map.slice().sort((a, b) => a.sequence - b.sequence)
  for (let i = 0; i < frags.length; i++) if (frags[i].sequence !== i + 1) return fail('SEQUENCE_NOT_CONTIGUOUS')

  // per-fragment structural + authority + hash checks; contiguity/gapless/non-overlap
  let cursor = midStart
  for (const f of frags) {
    if (!AUTHORITY_DOMAINS.includes(f.authorityDomain)) return fail('UNKNOWN_AUTHORITY_DOMAIN', { sequence: f.sequence })
    if (f.sourceCommit !== SOURCE_COMMIT) return fail('SOURCE_COMMIT_MISMATCH', { sequence: f.sequence })
    if (f.sourceSymbol !== SOURCE_SYMBOL) return fail('SOURCE_SYMBOL_MISMATCH', { sequence: f.sequence })
    if (!Number.isInteger(f.startCodeUnit) || !Number.isInteger(f.endCodeUnit) || f.endCodeUnit <= f.startCodeUnit) return fail('FRAGMENT_RANGE_INVALID', { sequence: f.sequence })
    if (f.startCodeUnit !== cursor) return fail(cursor === midStart ? 'SECTION_START_MISMATCH' : 'FRAGMENT_GAP_OR_OVERLAP', { sequence: f.sequence })
    const text = personaIdentity.slice(f.startCodeUnit, f.endCodeUnit)
    if (sha256Utf8(text) !== f.sha256Utf8) return fail('FRAGMENT_HASH_MISMATCH', { sequence: f.sequence })
    cursor = f.endCodeUnit
  }
  if (cursor !== midEnd) return fail('SECTION_END_MISMATCH')

  // exact reconstitution
  const identityPrefix = personaIdentity.slice(0, midStart)
  const remainderAfter = personaIdentity.slice(midEnd)
  const assembled = identityPrefix + frags.map((f) => personaIdentity.slice(f.startCodeUnit, f.endCodeUnit)).join('') + remainderAfter
  if (assembled !== personaIdentity) return fail('RECONSTITUTION_MISMATCH')

  const domainCounts = frags.reduce((a, f) => { a[f.authorityDomain] = (a[f.authorityDomain] || 0) + 1; return a }, {})
  return {
    status: REASON.PASS,
    sourceCommit: SOURCE_COMMIT,
    startMarkerCount: 1,
    endMarkerCount: 1,
    fragmentCount: frags.length,
    domainCounts,
    behavioralSectionSha256: sha256Utf8(personaIdentity.slice(midStart, midEnd)),
    reconstituteOk: true
  }
}

function exitCodeFor (status) { return status === REASON.PASS ? 0 : 2 } // 3 (config/tool) handled by the CLI

module.exports = { MAPPING, SOURCE_SYMBOL, SOURCE_COMMIT, CLASSIFICATION_REF, START_MARKER, END_MARKER, AUTHORITY_DOMAINS, REASON, sha256Utf8, verifyBehavioralMapping, locateSection, exitCodeFor }
