'use strict'

/**
 * personaCanary.js — R4b isolated persona-canary startup entrypoint.
 *
 * A SEPARATE entrypoint from src/index.js (the primary). It does NOT change the
 * primary's startup semantics. Boundaries:
 *   - binds ONLY to 127.0.0.1 (localhost-only — non-negotiable), default port 8082;
 *   - declares AROMA_PROCESS_ROLE=persona-canary for THIS process (rejects an
 *     explicit non-canary role); never touches the primary's env;
 *   - defaults PERSONA_SOURCE to `shadow` INSIDE this entrypoint only when unset
 *     (does not change any global/primary default);
 *   - requires a SEPARATE canary service token AROMA_CANARY_TOKEN — missing/empty
 *     fails closed BEFORE listen (the primary's HUB_TOKEN is never used here);
 *   - fails closed (exit non-zero, no listener) on invalid role/mode, missing token,
 *     port-in-use, or any listen error;
 *   - performs NO model call and NO Memory/truth write during startup (the persona
 *     source composes lazily on the first request, and in shadow mode the model
 *     always receives the legacy persona).
 *
 * Run: AROMA_CANARY_TOKEN=<token> node src/personaCanary.js
 */

const { evaluateStartupConfig } = require('./persona/processRole')

const CANARY_HOST = '127.0.0.1' // localhost-only, non-negotiable
const CANARY_PORT = process.env.AROMA_CANARY_PORT || 8082

function fail (code, msg) {
  console.error('[AROMA-CANARY] FATAL: ' + msg + ' (' + code + '). Refusing to start.')
  process.exit(1)
}

function main () {
  // 1. Enforce/declare the canary role for THIS process only.
  const role = process.env.AROMA_PROCESS_ROLE
  if (role != null && role !== '' && role !== 'persona-canary') {
    return fail('PROCESS_ROLE_CONFIG_ERROR', 'canary entrypoint requires AROMA_PROCESS_ROLE=persona-canary')
  }
  process.env.AROMA_PROCESS_ROLE = 'persona-canary'

  // 2. Default PERSONA_SOURCE to shadow INSIDE this entrypoint only (unset -> shadow).
  if (process.env.PERSONA_SOURCE == null || process.env.PERSONA_SOURCE === '') {
    process.env.PERSONA_SOURCE = 'shadow'
  }

  // 3. Role × mode matrix (R4a guard; env-only, no Memory read).
  const cfg = evaluateStartupConfig(process.env)
  if (!cfg.valid) return fail(cfg.status, 'invalid persona canary configuration')

  // 4. Separate canary service token — required, fail closed BEFORE listen.
  const canaryToken = process.env.AROMA_CANARY_TOKEN
  if (typeof canaryToken !== 'string' || canaryToken.length === 0) {
    return fail('CANARY_TOKEN_MISSING', 'AROMA_CANARY_TOKEN is required (separate from the primary HUB_TOKEN)')
  }

  // 5. Build the canary app with its OWN token (never the primary HUB_TOKEN).
  // Canary-only health/readiness routes are mounted via the createApp OPT-IN
  // pre-terminal hook, so they sit BEFORE the terminal 404 (R4c-F1). They exist
  // only on this canary app instance — the primary never passes this hook. The R2
  // persona source is reused read-only (composes lazily on first readiness request;
  // no model, no writes).
  const createApp = require('./app').createApp
  const { mountCanaryHealth } = require('./persona/personaCanaryHealth')
  const { getPersonaSource } = require('./persona/personaSource')
  const app = createApp({
    serviceToken: canaryToken,
    mountExtraRoutes: (a) => mountCanaryHealth(a, { processRole: cfg.processRole, personaSourceMode: cfg.personaSourceMode, getSource: () => getPersonaSource() })
  })

  // 6. Bind localhost-only; fail closed on port-in-use / any listen error.
  const server = app.listen(CANARY_PORT, CANARY_HOST, () => {
    console.log('[AROMA-CANARY] persona-canary listening on ' + CANARY_HOST + ':' + CANARY_PORT +
      ' | process role: ' + cfg.processRole + ' | persona source: ' + cfg.personaSourceMode)
    // NEVER log the token
  })
  server.on('error', (err) => {
    const code = (err && err.code) || 'LISTEN_ERROR'
    console.error('[AROMA-CANARY] FATAL: cannot bind ' + CANARY_HOST + ':' + CANARY_PORT + ' (' + code + '). Refusing to start.')
    process.exit(1)
  })
  return server
}

if (require.main === module) main()
module.exports = { main, CANARY_HOST, CANARY_PORT }
