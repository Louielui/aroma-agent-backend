'use strict'

/**
 * projectRegistry.js — WHICH DEVELOPMENT PROJECTS EXIST, AND NOTHING MORE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS IS TRUTH, NOT AUTHORITY. Nothing here selects a repoRoot, creates a
 * workspace, seals a Work Order, or reaches an executor. The Agent Bridge is still bound to
 * exactly one repository by `app.js`, decided once at construction, and this file is not
 * imported by it. A project appearing here does NOT make it writable — that is a separate,
 * later, explicitly-approved change.
 *
 * ⛔ AND THERE IS NO LOCAL PATH IN IT, ON PURPOSE. A checked-in
 * `C:\Users\louis\Projects\aroma-system` would be one refactor away from becoming an
 * execution root: something would read it 「just for diagnostics」, then something else would
 * pass it to a workspace. The machine-specific binding belongs to the tranche that actually
 * widens execution, where it can be reviewed as what it is. Production must also never
 * depend on a developer checkout existing.
 *
 * ⛔ CLOSED, AND NOT EXTENSIBLE AT RUNTIME. There is no register()/add(). Owner text, browser
 * JSON and model output can never become a project identity — an unknown projectId is not a
 * new project, it is a mistake, and it fails closed.
 *
 * ⛔ IT IS NOT `targetProject`. The existing Lane-1 `targetProject: 'backend'|'frontend'`
 * selects a develop SCRIPT inside one project; it is a different concept on a different
 * authority path and is deliberately not reused here.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Closed. Registration state says whether the project is KNOWN — never whether anything may
 * be executed against it. There is deliberately no 'executable' member: b2a cannot express
 * that idea, so it cannot accidentally grant it.
 */
const REGISTRATION = Object.freeze({
  REGISTERED: 'registered'
})

/**
 * The whole registry, frozen. Each record is reviewable in a diff, which is the point:
 * project identity should change by a commit somebody read, not by a runtime call.
 *
 * `defaultBranch` is the project's own default — NOT the branch any executor would run
 * against, and NOT the branch a catalogue snapshot was taken from. Those are separate
 * concepts and the catalogue records its own provenance.
 */
const PROJECTS = Object.freeze([
  Object.freeze({
    projectId: 'aroma-agent-backend',
    label: 'Aroma Agent Backend',
    repoFullName: 'Louielui/aroma-agent-backend',
    defaultBranch: 'main',
    status: REGISTRATION.REGISTERED
  }),
  Object.freeze({
    projectId: 'aroma-system',
    label: 'Aroma System',
    repoFullName: 'Louielui/aroma-system',
    defaultBranch: 'main',
    status: REGISTRATION.REGISTERED
  })
])

const BY_ID = new Map(PROJECTS.map((p) => [p.projectId, p]))

/**
 * @param {string} projectId
 * @returns {object|null} the frozen record, or null. Unknown is null — never a fallback,
 *          never the first entry, never a synthesised project.
 */
function getProject (projectId) {
  if (typeof projectId !== 'string' || projectId === '') return null
  return BY_ID.get(projectId) || null
}

/** True only for an id this file already knows. */
function isKnownProject (projectId) {
  return getProject(projectId) !== null
}

/** Every registered project, in declaration order. */
function listProjects () {
  return PROJECTS
}

module.exports = { getProject, isKnownProject, listProjects, REGISTRATION }
