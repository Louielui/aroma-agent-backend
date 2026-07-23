'use strict'

/**
 * personaCanaryHealth — R4c canary-only health/readiness surface.
 *
 * Mounted ONLY on the persona-canary app instance (from personaCanary.js), never on
 * the primary app (app.js is untouched), so these routes exist solely on the
 * localhost-bound canary process:
 *   GET /persona-canary/health     — confirms process/config identity only.
 *   GET /persona-canary/readiness  — read-only validation of the persona state
 *                                    required by the configured mode.
 *
 * Responses are a fixed SAFE allowlist: { endpoint, processRole, personaSourceMode,
 * status, ready, reason, hybridComposerReady? }. NEVER token values/fingerprints,
 * env dumps, headers, persona/fragment text, identity/OP/personality content,
 * revision payloads, filesystem paths, stack traces, model/provider config, or
 * sensitive Memory metadata.
 *
 * Semantics:
 *   - Health success = the canary is running with a valid role/mode config.
 *   - Readiness reuses the EXISTING R1/R2 rules (no competing definition): shadow is
 *     ready whenever legacy can serve (it always can — shadow never activates hybrid
 *     output into the request path); hybrid readiness = the composer is READY and the
 *     pin is current (via the R2 source). Any not-ready/malformed/unusable state
 *     returns a safe non-ready result; unexpected internal errors fail closed with a
 *     generic status and no detail. Readiness invokes NO model and writes NO Memory.
 */

// Only known status/reason CODES are ever echoed (uppercase enum-like), so no
// persona/user text can leak through the reason field.
function safeReason (r) {
  return (typeof r === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(r)) ? r : 'NOT_READY'
}

function buildHealth (cfg) {
  return {
    endpoint: 'health',
    processRole: cfg.processRole,
    personaSourceMode: cfg.personaSourceMode,
    status: 'CANARY_ALIVE',
    ready: true
  }
}

/**
 * @param {object} cfg { processRole, personaSourceMode }
 * @param {function} getSource () => a persona source (R2 createPersonaSource/getPersonaSource result)
 */
function buildReadiness (cfg, getSource) {
  const base = { endpoint: 'readiness', processRole: cfg.processRole, personaSourceMode: cfg.personaSourceMode }
  try {
    const mode = cfg.personaSourceMode
    if (mode === 'legacy') return Object.assign(base, { status: 'LEGACY_READY', ready: true, reason: null })
    const source = getSource()
    const meta = source.safeMetadata() // { mode, ready, initStatus, pinned* } — revision ids only, no text
    if (mode === 'shadow') {
      // Shadow serves the legacy persona to the model regardless — ready is not gated
      // on hybrid composition. The composer's readiness is reported informationally.
      return Object.assign(base, { status: 'SHADOW_READY', ready: true, hybridComposerReady: !!meta.ready, reason: meta.ready ? null : safeReason(meta.initStatus) })
    }
    // hybrid: reuse the R2 runtime rule. runtimePersona() throws when not READY / pin
    // drift. We use ONLY the throw/no-throw signal and NEVER expose the returned persona.
    try {
      source.runtimePersona()
      return Object.assign(base, { status: 'HYBRID_READY', ready: true, reason: null })
    } catch (e) {
      return Object.assign(base, { status: 'HYBRID_NOT_READY', ready: false, reason: safeReason(e && e.reason) })
    }
  } catch (e) {
    // Unexpected internal error → fail closed, generic status, no stack/detail.
    return Object.assign(base, { status: 'READINESS_ERROR', ready: false, reason: 'READINESS_ERROR' })
  }
}

// Mount the two GET routes on the given (canary) app. Open GETs (localhost-only is
// the access boundary); they return safe metadata only.
function mountCanaryHealth (app, opts) {
  const cfg = { processRole: opts.processRole, personaSourceMode: opts.personaSourceMode }
  const getSource = opts.getSource
  app.get('/persona-canary/health', (req, res) => { res.json(buildHealth(cfg)) })
  app.get('/persona-canary/readiness', (req, res) => { res.json(buildReadiness(cfg, getSource)) })
}

module.exports = { mountCanaryHealth, buildHealth, buildReadiness, safeReason }
