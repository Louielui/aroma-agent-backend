'use strict'

/**
 * targetResolution.js — DID THE OWNER NAME A TARGET WE ACTUALLY KNOW?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ IT ANSWERS, IT DOES NOT AUTHORISE. This returns identifiers and display facts. It creates
 * no Proposal, mints no id, reaches no store, no runner and no repository. A target being
 * recognised here does not make it changeable — that is decided far downstream, by the
 * server, against the one repository this build can actually work on.
 *
 * ⛔ EXACT OR NOTHING. No fuzzy matching, no synonyms, no case folding, no edit distance, no
 * model. The catalogue exists precisely because guessing which page the Owner meant is what
 * must stop: a wrong guess does not stay a lookup, it becomes an allowedFiles entry inside a
 * sealed Work Order that he then approves.
 *
 * ⛔ AND A LONGER NAME IS A DIFFERENT NAME. 「Order Planning v2」 must NOT resolve to
 * 「Order Planning」 just because the known label is a prefix of what he wrote. That is the
 * single most dangerous near-miss available here — the repository really does contain a
 * second, different ordering page — so a label followed by more Latin/digit text is treated
 * as no match at all rather than truncated to something known.
 *
 * ⛔ NEVER FROM A FILENAME OR A COMPONENT NAME. Replenishment.tsx is the file behind
 * 「Order Planning」, and OrderPlanning.tsx is a DIFFERENT page. Resolving from file basenames,
 * component names or route words would confidently pick the wrong one; only the labels and
 * routes recorded in the catalogue count.
 *
 * ⛔ MULTIPLE IS AN ANSWER. Two distinct known targets return MULTIPLE with both ids. Silently
 * returning the first would be selection wearing the costume of a lookup.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const catalogue = require('./targetCatalogue')

/** Closed. What the message turned out to say about targets. */
const STATUS = Object.freeze({
  /** Not a question about a target at all — no message, nothing to read. */
  NOT_APPLICABLE: 'not_applicable',
  EXACT: 'exact',
  MULTIPLE: 'multiple',
  NO_MATCH: 'no_match'
})

/** Closed. Which kind of evidence produced the match. */
const SOURCE = Object.freeze({
  CANONICAL_LABEL: 'canonical_label',
  ROUTE: 'route'
})

/**
 * ⛔ THE BOUNDARY THAT STOPS 「Order Planning v2」.
 *
 * A known label counts only when the surrounding text does not extend it into a different
 * identifier. Latin letters and digits extend a Latin name; CJK, punctuation and end-of-string
 * do not. So 「改 Order Planning 個 Submit button」 matches and 「改 Order Planning v2」 does not
 * — the second names something this catalogue has never heard of, and saying so is the honest
 * answer.
 */
const EXTENDS = /[A-Za-z0-9]/

/**
 * ⛔ AND A FILENAME IS NOT A LABEL, WHICH THIS FILE LEARNED THE HARD WAY.
 *
 * 「Replenishment」 is a real owner-facing label — for /branches/replenishment, which renders
 * TransferOrders. So 「改 Replenishment.tsx」 matched it, and the resolver confidently pointed at
 * TransferOrders.tsx while the Owner was naming Replenishment.tsx: a DIFFERENT page, in a
 * request that mentioned neither. That is precisely the filename-shaped resolution this module
 * is built to refuse, so a label glued to a path or an extension is not the label.
 */
const PATH_GLUE = /^[./][A-Za-z0-9]/

function labelMentioned (message, label) {
  let from = 0
  for (;;) {
    const at = message.indexOf(label, from)
    if (at === -1) return false
    const before = at > 0 ? message[at - 1] : ''
    const rest = message.slice(at + label.length)
    // Immediately-adjacent Latin/digit text on either side means a different identifier —
    // and so does a path separator or a dot, which makes it part of a file or path token.
    const extendedLeft = before !== '' && (EXTENDS.test(before) || before === '/' || before === '.')
    // ...and a following Latin/digit token, with or without one separating space.
    const extendedRight = /^\s?[A-Za-z0-9]/.test(rest) || PATH_GLUE.test(rest)
    if (!extendedLeft && !extendedRight) return true
    from = at + 1
  }
}

/**
 * ⛔ A ROUTE IS A WHOLE TOKEN. `/inventory/order-planning` must not be found inside
 * `/inventory/order-planning-v2`, which would be a different page with a different file.
 */
const ROUTE_CHAR = /[A-Za-z0-9/_-]/

function routeMentioned (message, route) {
  let from = 0
  for (;;) {
    const at = message.indexOf(route, from)
    if (at === -1) return false
    const before = at > 0 ? message[at - 1] : ''
    const after = message[at + route.length] || ''
    if ((before === '' || !ROUTE_CHAR.test(before)) && (after === '' || !ROUTE_CHAR.test(after))) return true
    from = at + 1
  }
}

/** Bounded display facts. Identifiers and labels — never a root, a command or a hash. */
function displayOf (t) {
  return Object.freeze({
    projectId: t.projectId,
    targetId: t.targetId,
    canonicalLabel: t.canonicalLabel,
    component: t.component,
    routes: t.routes,
    files: t.files
  })
}

/**
 * @param {string} message the Owner's own words
 * @returns {{status:string, source:string|null, targetIds:string[], targets:object[]}}
 */
function resolveTargets (message) {
  const text = typeof message === 'string' ? message : ''
  if (text === '') return { status: STATUS.NOT_APPLICABLE, source: null, targetIds: [], targets: [] }

  // ⛔ DEDUPED BY TARGET ID. One target named by BOTH its label and one of its routes is one
  //    target, not two candidates — two pieces of evidence for the same page must never look
  //    like ambiguity the Owner has to resolve.
  const hits = new Map()
  let sawLabel = false
  let sawRoute = false

  for (const t of catalogue.listTargets('aroma-system').concat(catalogue.listTargets('aroma-agent-backend'))) {
    let matched = false
    if (t.discoverability === catalogue.DISCOVERABILITY.OWNER_LABEL &&
        typeof t.canonicalLabel === 'string' && t.canonicalLabel !== '' &&
        labelMentioned(text, t.canonicalLabel)) {
      matched = true
      sawLabel = true
    }
    if (!matched) {
      for (const r of t.routes) {
        if (routeMentioned(text, r)) { matched = true; sawRoute = true; break }
      }
    }
    if (matched && !hits.has(t.targetId)) hits.set(t.targetId, t)
  }

  const targets = [...hits.values()]
  if (targets.length === 0) return { status: STATUS.NO_MATCH, source: null, targetIds: [], targets: [] }

  // A label is the stronger evidence when both kinds appeared.
  const source = sawLabel ? SOURCE.CANONICAL_LABEL : (sawRoute ? SOURCE.ROUTE : null)
  return {
    status: targets.length === 1 ? STATUS.EXACT : STATUS.MULTIPLE,
    source,
    targetIds: targets.map((t) => t.targetId),
    targets: targets.map(displayOf)
  }
}

/**
 * ⛔ CAN THIS BUILD ACTUALLY CHANGE THAT PROJECT? Only the backend repository is bound to the
 * executor, and that binding lives in app.js, not in any registry. The Project Registry
 * deliberately encodes no authority, so availability is NOT derived from it — it is derived
 * from the one fact this tranche is allowed to know: nothing but this repository is reachable.
 *
 * Saying 「I know which page you mean, and I still cannot change it」 is the honest answer, and
 * it is the reason a resolved Aroma System target stops before a Proposal exists.
 */
const EXECUTABLE_PROJECT_ID = 'aroma-agent-backend'

function projectExecutionAvailable (projectId) {
  return projectId === EXECUTABLE_PROJECT_ID
}

module.exports = { resolveTargets, projectExecutionAvailable, STATUS, SOURCE, EXECUTABLE_PROJECT_ID }
