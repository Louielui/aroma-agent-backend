'use strict'

/**
 * verifyIdentityShadow — standalone read-only CLI / CI preflight.
 *
 * NOT wired into prestart/start/Express boot. Reads the frozen PERSONA_IDENTITY
 * (read-only) and the Identity Memory shadow, verifies exact-string equality, and
 * prints SAFE metadata only (no Identity text). Never writes to Memory.
 *
 * Exit codes: 0 PASS · 2 SHADOW_VERIFICATION_FAILED · 3 CONFIG_OR_TOOL_ERROR.
 *
 *   AROMA_CORE_DIR=<abs> node scripts/memory/verifyIdentityShadow.js
 */

const { resolveCoreDir } = require('../../src/core/memory/store')
const { verifyIdentityShadow, exitCodeFor } = require('../../src/core/memory/shadow/identityShadow')

function main () {
  let baseDir
  try {
    baseDir = resolveCoreDir()
  } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: 'CONFIG_ERROR', detail: e.detail || null }))
    return 3
  }
  let personaIdentity
  try {
    personaIdentity = require('../../src/persona/xiangxiang').PERSONA_IDENTITY // read-only
  } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: 'persona constant unavailable' }))
    return 3
  }
  let result
  try {
    result = verifyIdentityShadow(baseDir, personaIdentity)
  } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: e.code || 'tool error' }))
    return 3
  }
  const code = exitCodeFor(result.status)
  // SAFE metadata only — never the Identity text
  console.log(JSON.stringify({ ok: result.status === 'PASS', ...result }))
  return code
}

if (require.main === module) process.exit(main())
module.exports = { main }
