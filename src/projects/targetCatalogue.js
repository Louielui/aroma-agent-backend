'use strict'

/**
 * targetCatalogue.js — OWNER-FACING TARGETS, LOOKED UP EXACTLY OR NOT AT ALL.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ TRUTH, NOT AUTHORITY. This returns identifiers. It never returns a repoRoot, a shell
 * command, or anything shaped like a Work Order; it creates no Proposal, reaches no executor,
 * and imports nothing that can. A target existing here does not make it changeable.
 *
 * ⛔ EXACT OR NOTHING. There is no fuzzy matching, no substring, no edit distance, no
 * 「closest」, no model. The whole reason a catalogue exists is that guessing which page the
 * Owner meant is precisely what must stop — a wrong guess here would end up inside a sealed
 * Work Order that he then approves.
 *
 * ⛔ AND MULTIPLE IS AN ANSWER, NOT A PROBLEM TO SOLVE. Two exact matches return MULTIPLE with
 * both ids. Returning the first would be silent selection wearing the costume of a lookup —
 * the same defect as fuzzy matching, just harder to see in a diff.
 *
 * ⛔ LABEL LOOKUP SEES ONLY OWNER-FACING LABELS. A route-only target has canonicalLabel null
 * and can never be reached by name, because it has no name anybody wrote down. Inventing one
 * from its filename is the failure this module is built to refuse.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { isKnownProject } = require('./projectRegistry')
const aromaSystem = require('./catalogues/aromaSystem')

/** Closed. What a lookup can say — never a bare id that hides how sure it was. */
const RESULT = Object.freeze({
  EXACT: 'exact',
  MULTIPLE: 'multiple',
  NO_MATCH: 'no_match'
})

const DISCOVERABILITY = aromaSystem.DISCOVERABILITY
const CATALOGUES = Object.freeze([aromaSystem])

/**
 * ⛔ VALIDATED AT LOAD, SO A BAD RECORD CANNOT BE SERVED EVEN ONCE. A catalogue is data a
 * human wrote, and every rule below is a way that data could be wrong in a manner nothing
 * downstream would notice: a target pointing at a project that does not exist, an absolute
 * path, a traversal, two targets sharing an id, or a label attached to something that has no
 * evidence of one. Throwing at require time makes the whole process refuse to start rather
 * than quietly answer with a broken record.
 */
function validate (targets) {
  const seen = new Set()
  for (const t of targets) {
    const at = 'target ' + (t && t.targetId ? t.targetId : '(no id)')
    if (typeof t.targetId !== 'string' || t.targetId === '') throw new Error(at + ': targetId must be a non-empty string')
    if (seen.has(t.targetId)) throw new Error(at + ': duplicate targetId')
    seen.add(t.targetId)

    if (!isKnownProject(t.projectId)) throw new Error(at + ': unknown projectId ' + JSON.stringify(t.projectId))

    if (!Array.isArray(t.files) || t.files.length === 0) throw new Error(at + ': files must be a non-empty array')
    for (const f of t.files) {
      if (typeof f !== 'string' || f === '') throw new Error(at + ': file must be a non-empty string')
      // Repo-relative only. An absolute path is a different repository's business, and `..`
      // is a way to leave the project without ever naming it.
      if (f.startsWith('/') || f.startsWith('\\') || /^[A-Za-z]:/.test(f)) throw new Error(at + ': file must be repo-relative, not absolute: ' + f)
      if (f.split(/[\\/]/).includes('..')) throw new Error(at + ": file must not contain '..': " + f)
    }

    if (!Array.isArray(t.routes) || t.routes.length === 0) throw new Error(at + ': routes must be a non-empty array')
    if (typeof t.component !== 'string' || t.component === '') throw new Error(at + ': component must be a non-empty string')

    if (t.discoverability === DISCOVERABILITY.OWNER_LABEL) {
      if (typeof t.canonicalLabel !== 'string' || t.canonicalLabel === '') {
        throw new Error(at + ': an owner_label target must carry the label a human can actually see')
      }
      if (!t.evidence || typeof t.evidence.label !== 'string' || t.evidence.label === '') {
        throw new Error(at + ': an owner_label target must say WHERE that label came from')
      }
    } else if (t.discoverability === DISCOVERABILITY.ROUTE_ONLY) {
      // ⛔ Null, not a plausible substitute. See the header.
      if (t.canonicalLabel !== null) throw new Error(at + ': a route_only target must have canonicalLabel null')
    } else {
      throw new Error(at + ': unknown discoverability ' + JSON.stringify(t.discoverability))
    }
  }
  return targets
}

const ALL = Object.freeze(CATALOGUES.flatMap((c) => validate(c.TARGETS)))
const BY_ID = new Map(ALL.map((t) => [t.targetId, t]))

/** A closed result. `targetIds` is always an array, empty on no_match. */
const result = (ids) => Object.freeze({
  status: ids.length === 0 ? RESULT.NO_MATCH : (ids.length === 1 ? RESULT.EXACT : RESULT.MULTIPLE),
  targetIds: Object.freeze(ids.slice())
})

/** @returns {object|null} the frozen record, or null. Never a near miss. */
function getTarget (targetId) {
  if (typeof targetId !== 'string' || targetId === '') return null
  return BY_ID.get(targetId) || null
}

/** Every target of one project. An unknown project has none — it does not throw and does not guess. */
function listTargets (projectId) {
  if (!isKnownProject(projectId)) return []
  return ALL.filter((t) => t.projectId === projectId)
}

/**
 * EXACT route string. Not a prefix, not activePrefixes, not startsWith: two pages can share a
 * prefix and mean entirely different things, which is true in this very catalogue.
 */
function findByRoute (route) {
  if (typeof route !== 'string' || route === '') return result([])
  return result(ALL.filter((t) => t.routes.includes(route)).map((t) => t.targetId))
}

/**
 * EXACT owner-facing label, case-sensitive, and only over targets that HAVE one.
 * ⛔ Case-sensitive on purpose: the label is copied verbatim from source, and folding case
 * would be the first small step toward folding everything else.
 */
function findByCanonicalLabel (label) {
  if (typeof label !== 'string' || label === '') return result([])
  return result(ALL
    .filter((t) => t.discoverability === DISCOVERABILITY.OWNER_LABEL && t.canonicalLabel === label)
    .map((t) => t.targetId))
}

/** Provenance for every catalogue held here — so staleness is inspectable, not assumed. */
function listSources () {
  return Object.freeze(CATALOGUES.map((c) => c.SOURCE))
}

module.exports = {
  getTarget,
  listTargets,
  findByRoute,
  findByCanonicalLabel,
  listSources,
  RESULT,
  DISCOVERABILITY
}
