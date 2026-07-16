'use strict'

/**
 * verifyBehavioralMapping — standalone read-only CLI / CI preflight for M3a.
 *
 * Verifies the Owner-approved behavioral fragment mapping against the live frozen
 * PERSONA_IDENTITY. NOT wired into prestart/start/boot. No store, no seed, no
 * runtime coupling. Prints SAFE metadata only (no persona/fragment text).
 *
 * Exit codes: 0 PASS · 2 MAPPING_VERIFICATION_FAILED · 3 CONFIG_OR_TOOL_ERROR.
 *
 *   node scripts/memory/verifyBehavioralMapping.js
 */

const { verifyBehavioralMapping, exitCodeFor } = require('../../src/core/memory/shadow/behavioralMapping')

function main () {
  let personaIdentity
  try {
    personaIdentity = require('../../src/persona/xiangxiang').PERSONA_IDENTITY // read-only
  } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: 'persona constant unavailable' }))
    return 3
  }
  let result
  try {
    result = verifyBehavioralMapping(personaIdentity)
  } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: 'verifier error' }))
    return 3
  }
  console.log(JSON.stringify({ ok: result.status === 'PASS', ...result })) // safe metadata only
  return exitCodeFor(result.status)
}

if (require.main === module) process.exit(main())
module.exports = { main }
