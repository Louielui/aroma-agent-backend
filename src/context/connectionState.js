'use strict'

/**
 * connectionState.js — a READ-ONLY projection of what is true about each data source RIGHT NOW.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ IT DECIDES NOTHING. It is not an entitlement, not a gate, not a router input. Reads are
 * still governed by `flags.js` and `liveClients.js` exactly as before; this only joins truths
 * those modules already produce and hands them to a human or an API in one shape.
 *
 * ⛔ AND IT IS COMPUTED ON EVERY CALL, NEVER CACHED. Owner Settings applies a source switch by
 * writing `process.env`, and every flag reader looks at `process.env` at call time — which is
 * why a switch takes effect on the NEXT TURN with no restart. A startup snapshot here would
 * break that promise silently: the page would report 「off」 for a source the Owner had just
 * switched on, and nothing else in the suite would notice. `connectionState.test.js` mutates a
 * flag between two projections precisely to keep that impossible.
 *
 * ⛔ THERE IS NO `connected` BOOLEAN, AND THE REPOSITORY IS THE REASON. Every one of these is a
 * state this build can really be in:
 *
 *   enabled, no credential          github / aroma_system with the env var unset
 *   credential present, unproven     the Google files exist; the refresh token may be dead
 *   credential + flag, still off     public_knowledge while A4_KNOWLEDGE_ROUTING is off
 *   in the catalogue, no builder     development_record (measured — see NOT_IMPLEMENTED)
 *
 * One boolean would have to lie about one of them, so the four facts stay separate and a
 * future UI derives its wording from them.
 *
 * ⛔ `health` IS ALWAYS 'unknown' HERE, ON PURPOSE. Nothing in this build probes a data source
 * for liveness. Deriving it from `registered` would mean 「an object was constructed, therefore
 * the far end is well」 — the class of claim this project keeps removing. When a real probe
 * exists it can set this; until then the honest value is unknown.
 *
 * ⛔ REASONS ARE COMPUTED FROM FIRST PRINCIPLES, NOT PARSED FROM ERRORS. `liveClients` reports
 * skips as human sentences ('GITHUB_READ_TOKEN not set', and for development_record the raw
 * TypeError 'builders[source] is not a function'). Matching on those strings would make a
 * JavaScript message part of the contract. So the reason is derived from the same inputs the
 * builders use, and the error text is never read and never emitted.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { ALL_SOURCES, PUBLIC_KEY_ENV, createLiveReadConnector } = require('./liveClients')
const { SOURCE_FLAG, resolveFlag, readAccessEnabled } = require('./flags')
const { KEY_ENV: AROMA_KEY_ENV } = require('./adapters/aromaSystemRead')
const { a4SemanticRoutingEnabled } = require('../intake/a4Contract')

/** Closed. A consumer may compare against these and nothing else. */
const REASON = Object.freeze({
  /** READ_ACCESS is not 'on'. Nothing is built at all. */
  MASTER_DISABLED: 'master_disabled',
  /** This source's own switch is off. */
  SOURCE_DISABLED: 'source_disabled',
  /** The required credential MATERIAL is absent. Says nothing about validity. */
  CREDENTIAL_MISSING: 'credential_missing',
  /** Credential and switch are fine; a governance rule holds it back (A4 for egress). */
  GOVERNANCE_DISABLED: 'governance_disabled',
  /** In the catalogue with no builder — a known implementation gap, not a failure. */
  NOT_IMPLEMENTED: 'not_implemented',
  /** Everything looked satisfiable and construction still did not happen. */
  REGISTRATION_FAILED: 'registration_failed',
  /** Registered. */
  NONE: 'none'
})

/**
 * Closed. Three states, because a boolean could only ever tell two of them.
 *
 * ⛔ `development_record` IS WHY THIS IS AN ENUM. It is derived from this build's own docs/ —
 * no token, no OAuth, no network. `credentialPresent: true` would read as 「its credential is
 * in place」 and `false` as 「its credential is missing」, and both are claims about a credential
 * that does not exist. 'not_required' is the only honest third answer.
 *
 * ⛔ 'present' IS PRESENCE OF MATERIAL AND NOTHING MORE. Not valid, not authenticated, not
 * authorised now, not reachable, not healthy. The Google files can sit on disk holding a dead
 * refresh token and this still reads 'present' — which is why `health` stays 'unknown'.
 */
const CREDENTIAL = Object.freeze({
  PRESENT: 'present',
  MISSING: 'missing',
  NOT_REQUIRED: 'not_required'
})

/** Closed. Only 'unknown' is reachable today; the rest exist for a future real probe. */
const HEALTH = Object.freeze({
  UNKNOWN: 'unknown',
  UP: 'up',
  DEGRADED: 'degraded',
  DOWN: 'down'
})

/**
 * ⛔ THE ONE HAND-NAMED SUBSET IN THIS FILE, AND IT IS FENCED BY MEASUREMENT.
 *
 * `liveClients` defines its builders inside a closure, so the set cannot be imported. A copy
 * is exactly how two lists drift, so `connectionState.test.js` runs the REAL
 * `createLiveReadConnector` with every flag on and every credential present and asserts that
 * what it actually registers equals this list. Add a builder there without adding it here, or
 * the reverse, and that test turns red.
 */
const BUILDABLE_SOURCES = Object.freeze(['drive', 'gmail', 'calendar', 'github', 'aroma_system', 'public_knowledge'])

/** Sources that need no credential because they never leave this machine. */
const LOCAL_SOURCES = Object.freeze(['development_record'])

/** The only source with an egress side: reading it sends the Owner's words outward. */
const EGRESS_SOURCES = Object.freeze(['public_knowledge'])

const GOOGLE_SOURCES = Object.freeze(['drive', 'gmail', 'calendar'])

/** Which env var holds the credential material, for the sources that need one. */
const CREDENTIAL_ENV = Object.freeze({
  github: 'GITHUB_READ_TOKEN',
  aroma_system: AROMA_KEY_ENV,
  public_knowledge: PUBLIC_KEY_ENV
})

/**
 * PRESENCE, NOT VALIDITY — and 「not required」 is its own answer, never a true or a false.
 * This says only 「is there credential material to try with, and is any needed at all」.
 */
function credentialStateFor (source, env, credsPresent) {
  // Local: there is no credential to have or to lack. Saying either would be a claim about
  // something that does not exist.
  if (LOCAL_SOURCES.includes(source)) return CREDENTIAL.NOT_REQUIRED
  if (GOOGLE_SOURCES.includes(source)) {
    return credsPresent() === true ? CREDENTIAL.PRESENT : CREDENTIAL.MISSING
  }
  const name = CREDENTIAL_ENV[source]
  if (!name) return CREDENTIAL.NOT_REQUIRED
  const v = env[name]
  return (typeof v === 'string' && v !== '') ? CREDENTIAL.PRESENT : CREDENTIAL.MISSING
}

/** The Owner-facing name, from the one label table that is already derived from ALL_SOURCES. */
function labelFor (source) {
  const { LABELS } = require('../intake/readStateGuard')
  return LABELS[source] || source
}

/**
 * @param {object} env                 read at CALL TIME — never captured
 * @param {object} [deps]              injection seam for tests; production passes nothing
 * @returns {Array<object>} one ConnectionState per ALL_SOURCES entry, in catalogue order
 */
function projectConnections (env = process.env, deps = {}) {
  const e = env || process.env
  const credsPresent = deps.credsPresent || (() => require('./googleAuth').credsPresent())
  const now = deps.now || (() => new Date().toISOString())
  const checkedAt = now()

  const masterOn = resolveFlag(e, 'READ_ACCESS') === 'on'

  /**
   * The registration fact comes from the REAL builder path, so it cannot drift from what a
   * turn would get. It is only consulted when everything else already permits construction —
   * which also means the Google client is not built merely to render a page for a source the
   * Owner has switched off.
   */
  let registeredSet = null
  const registeredNow = () => {
    if (registeredSet === null) {
      const built = (deps.buildConnector || createLiveReadConnector)({
        env: e,
        googleServiceFn: deps.googleServiceFn
      })
      registeredSet = new Set(Array.isArray(built.registered) ? built.registered : [])
    }
    return registeredSet
  }

  return ALL_SOURCES.map((key) => {
    const local = LOCAL_SOURCES.includes(key)
    const base = {
      key,
      kind: 'data_source',
      label: labelFor(key),
      local,
      egress: EGRESS_SOURCES.includes(key),
      enabled: false,
      credentialState: credentialStateFor(key, e, credsPresent),
      registered: false,
      // Never inferred. See the header.
      health: HEALTH.UNKNOWN,
      reason: REASON.MASTER_DISABLED,
      // P1-A1 records no last success: nothing authoritative writes one today, and inventing
      // cross-turn mutable state to fill a field would be the opposite of a projection.
      lastSuccessAt: null,
      lastCheckedAt: checkedAt
    }

    if (!masterOn) return base
    if (!SOURCE_FLAG[key] || !readAccessEnabled(e, key)) {
      return Object.assign(base, { reason: REASON.SOURCE_DISABLED })
    }

    base.enabled = true

    // Only MISSING blocks. `not_required` is a satisfied state, not an absent one, and a
    // governance stop below is deliberately reported separately from a credential fault.
    if (base.credentialState === CREDENTIAL.MISSING) return Object.assign(base, { reason: REASON.CREDENTIAL_MISSING })
    // Egress governance: the key exists and the switch is on, and A4 still holds it back.
    if (base.egress && !a4SemanticRoutingEnabled(e)) {
      return Object.assign(base, { reason: REASON.GOVERNANCE_DISABLED })
    }
    if (!BUILDABLE_SOURCES.includes(key)) {
      return Object.assign(base, { reason: REASON.NOT_IMPLEMENTED })
    }

    const registered = registeredNow().has(key)
    return Object.assign(base, {
      registered,
      reason: registered ? REASON.NONE : REASON.REGISTRATION_FAILED
    })
  })
}

module.exports = { projectConnections, REASON, HEALTH, CREDENTIAL, BUILDABLE_SOURCES }
