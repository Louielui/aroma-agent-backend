'use strict'

/**
 * verifyOperatingPrinciplesShadow — standalone read-only CLI / CI preflight.
 *
 * NOT wired into prestart/start/Express boot. Reads the frozen PERSONA_IDENTITY
 * (read-only) + the M3a mapping trust anchor + the Operating Principles Memory
 * shadow, cross-verifies, and prints SAFE metadata only (no fragment/persona text).
 * Never writes to Memory (no revision/event/index, no rebuildIndex).
 *
 * Exit codes: 0 PASS · 2 SHADOW_VERIFICATION_FAILED · 3 CONFIG_OR_TOOL_ERROR · 4 NOT_READY.
 *
 *   AROMA_CORE_DIR=<abs> node scripts/memory/verifyOperatingPrinciplesShadow.js
 */

const { resolveCoreDir } = require('../../src/core/memory/store')
const { verifyOperatingPrinciplesShadow, exitCodeFor } = require('../../src/core/memory/shadow/operatingPrinciplesShadow')

// Whitelist the safe fields we are willing to print (never fragment/persona text).
const SAFE_FIELDS = ['status', 'reason', 'recordId', 'activeRevisionId', 'fragmentCount', 'aggregateSha256', 'behavioralSectionSha256', 'personalitySource', 'behavioralReconstituteOk', 'fullReconstituteOk', 'subReason']

function safe (result) {
  const out = {}
  for (const k of SAFE_FIELDS) if (result[k] !== undefined) out[k] = result[k]
  if (out.reason === undefined) out.reason = result.status
  return out
}

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
    result = verifyOperatingPrinciplesShadow(baseDir, personaIdentity)
  } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: e.code || 'tool error' }))
    return 3
  }
  const code = exitCodeFor(result.status)
  console.log(JSON.stringify(Object.assign({ ok: result.status === 'PASS' }, safe(result))))
  return code
}

if (require.main === module) process.exit(main())
module.exports = { main }
