'use strict'

/**
 * repositoryIdentity.js — WHICH REPOSITORY DOES THIS PIECE OF WORK BELONG TO?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE GAP THIS EXISTS TO CLOSE. Before RB1 the only question asked before a Proposal
 * was 「does this relative path exist in the repository this process happens to live in?」
 * Measured 2026-08-20 against the real production tree: README.md, package.json,
 * CLAUDE.md, docs/HOUSE-RULES.md and .gitignore all answer YES in the backend AND exist
 * in Aroma System. So 「改 aroma-system 個 README.md」 passed the gate, sealed against the
 * BACKEND file, and the Owner's card never named a repository at all — there was no line
 * on it that could have shown him the mistake.
 *
 * Existence is not identity. This module answers identity, and it answers it BEFORE
 * anything touches a filesystem.
 *
 * ⛔ NO ROOT LIVES HERE. Not a repoRoot, not a Windows path, not a checkout location.
 * A machine-local binding is RB2 and belongs in the tranche that actually widens
 * execution, where it can be reviewed as what it is. Everything here is portable
 * identity: a projectId and an owner/name repoFullName.
 *
 * ⛔ CLOSED. No register(), no add(), no mutable state. Owner text, browser JSON and model
 * output can name an identity that already exists; they can never create one.
 *
 * ⛔ IDENTITY IS NOT PERMISSION. identityForProject answers for BOTH registered projects,
 * including the one that cannot be executed. Execution is a separate question with a
 * separate function, so 「I know exactly which repository you mean, and I still cannot
 * change it」 stays sayable.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { getProject, listProjects } = require('./projectRegistry')
const { EXECUTABLE_PROJECT_ID } = require('./targetResolution')

/** Closed refusal reasons. Bounded enum — never a path, never a machine detail. */
const IDENTITY_REFUSED = Object.freeze({
  UNKNOWN_PROJECT: 'unknown_project',
  AMBIGUOUS_PROJECT: 'ambiguous_project',
  IDENTITY_CONFLICT: 'project_identity_conflict',
  NOT_EXECUTABLE: 'project_not_executable'
})

/**
 * A projectId is an exact registered id. Shape is checked too, so a value that never
 * reaches the registry still cannot be a path or a sentence.
 */
function isValidProjectId (v) {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v)
}

/**
 * owner/name and nothing else.
 *
 * ⛔ THE POINT OF THE SHAPE TEST IS TO REJECT A LOCAL PATH. A Windows drive path and a
 * posix absolute path are the values this field must never hold, because a machine root
 * inside a Work Order is a machine root inside the hash, the audit and the Owner's card.
 * Backslash, drive letter, leading slash and dot-dot are all refused.
 */
function isValidRepoFullName (v) {
  if (typeof v !== 'string' || v === '') return false
  if (v.includes('\\') || v.startsWith('/') || /^[A-Za-z]:/.test(v)) return false
  if (v.includes('..')) return false
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v)
}

/** True only for a fully-formed identity pair whose two halves are both well-shaped. */
function isValidIdentity (identity) {
  return !!identity && isValidProjectId(identity.projectId) && isValidRepoFullName(identity.repoFullName)
}

/**
 * The identity of a REGISTERED project, derived from the registry and nothing else.
 * Unknown is null — never a fallback, never the first entry.
 */
function identityForProject (projectId) {
  const p = getProject(projectId)
  if (!p || !isValidRepoFullName(p.repoFullName)) return null
  return Object.freeze({ projectId: p.projectId, repoFullName: p.repoFullName })
}

/**
 * ⛔ THE ONE REPOSITORY THIS BUILD CAN EXECUTE AGAINST. Derived from the registry, so it
 * cannot drift from the recorded truth, and pinned to the same id targetResolution already
 * uses — one fact, not two that must agree.
 */
const EXECUTABLE_IDENTITY = identityForProject(EXECUTABLE_PROJECT_ID)
if (!EXECUTABLE_IDENTITY) throw new Error('repositoryIdentity: the executable project is not registered')

/** Exact pair equality. No case folding, no trimming, no partial match. */
function sameIdentity (a, b) {
  return isValidIdentity(a) && isValidIdentity(b) &&
    a.projectId === b.projectId && a.repoFullName === b.repoFullName
}

/** True only for the single executable repository. Everything else is false. */
function isExecutableIdentity (identity) {
  return sameIdentity(identity, EXECUTABLE_IDENTITY)
}

/**
 * ⛔ EXACT MENTIONS ONLY. A registered project is 「named」 when its id, its label or its
 * repoFullName appears as a whole token in the Owner's own words. No fuzzy distance, no
 * nearest match, no prefix truncation — 「aroma」 names nothing, because two registered
 * projects begin with it and guessing between them is exactly the failure this closes.
 */
function projectsNamedIn (message) {
  const text = typeof message === 'string' ? message.toLowerCase() : ''
  if (text === '') return []
  const found = []
  const wordish = /[a-z0-9_-]/
  for (const p of listProjects()) {
    const needles = [p.projectId, p.repoFullName]
    if (typeof p.label === 'string' && p.label !== '') needles.push(p.label)
    for (const n of needles) {
      const needle = String(n).toLowerCase()
      const at = text.indexOf(needle)
      if (at < 0) continue
      // Whole-token: the characters either side must not extend the name.
      const before = at > 0 ? text[at - 1] : ''
      const after = text[at + needle.length] || ''
      if ((before === '' || !wordish.test(before)) && (after === '' || !wordish.test(after))) {
        found.push(p.projectId)
        break
      }
    }
  }
  return found
}

/**
 * ⛔ WHICH REPOSITORY IS THIS REQUEST ABOUT? Server-derived, from two kinds of evidence
 * only: an EXACT resolved target's projectId, and exact project names in the Owner's own
 * words. Never a body field, never model output.
 *
 * The rules, in order, all fail-closed:
 *   two different projects named          -> ambiguous, refuse
 *   named project disagrees with target   -> conflict, refuse
 *   either kind of evidence present       -> that identity
 *   no evidence at all                    -> the one executable repository, EXPLICITLY
 *
 * ⛔ THE DEFAULT IS A DECISION, NOT A SHRUG. It applies ONLY to the total absence of
 * evidence, it resolves to a real identity that goes on the Owner's card and into the
 * hash, and a KNOWN non-backend identity never reaches it.
 *
 * @param {{message?:string, targetProjectId?:string|null}} input
 * @returns {{ok:true, identity, source}|{ok:false, reason}}
 */
function identifyProject (input = {}) {
  const named = projectsNamedIn(input.message)
  const unique = [...new Set(named)]
  if (unique.length > 1) return { ok: false, reason: IDENTITY_REFUSED.AMBIGUOUS_PROJECT }

  const fromTarget = typeof input.targetProjectId === 'string' && input.targetProjectId !== ''
    ? input.targetProjectId
    : null
  if (fromTarget !== null && !isValidProjectId(fromTarget)) return { ok: false, reason: IDENTITY_REFUSED.UNKNOWN_PROJECT }

  const fromText = unique.length === 1 ? unique[0] : null
  if (fromTarget && fromText && fromTarget !== fromText) {
    return { ok: false, reason: IDENTITY_REFUSED.IDENTITY_CONFLICT }
  }

  const chosen = fromTarget || fromText
  if (chosen === null) {
    return { ok: true, identity: EXECUTABLE_IDENTITY, source: 'backend_default' }
  }
  const identity = identityForProject(chosen)
  if (!identity) return { ok: false, reason: IDENTITY_REFUSED.UNKNOWN_PROJECT }
  return { ok: true, identity, source: fromTarget ? 'resolved_target' : 'owner_named_project' }
}

module.exports = {
  EXECUTABLE_IDENTITY,
  IDENTITY_REFUSED,
  identifyProject,
  identityForProject,
  isExecutableIdentity,
  isValidIdentity,
  isValidProjectId,
  isValidRepoFullName,
  sameIdentity,
  projectsNamedIn
}
