'use strict'

/**
 * verifyBehavioralReconstitution — standalone read-only CLI / CI preflight.
 *
 * Proves the dual-store behavioral reconstitution: when BOTH the operating-
 * principles store and the personality store are ACTIVE, their stored fragments
 * reassemble in source sequence order 1..9 into the exact frozen behavioral section
 * of PERSONA_IDENTITY, and the full persona reconstructs byte-identically. Reads the
 * M3a mapping + frozen PERSONA_IDENTITY (read-only) as the sole trust anchor. Never
 * writes to Memory. Prints SAFE metadata only (no fragment/section/persona text).
 *
 * Exit codes: 0 PASS · 2 VERIFICATION_FAILED · 3 CONFIG_OR_TOOL_ERROR · 4 NOT_READY.
 * Production is expected to be NOT_READY (OP review_ready, personality absent).
 *
 *   AROMA_CORE_DIR=<abs> node scripts/memory/verifyBehavioralReconstitution.js
 */

const { resolveCoreDir } = require('../../src/core/memory/store')
const { verifyBehavioralReconstitution, exitCodeFor } = require('../../src/core/memory/shadow/behavioralReconstitution')

const SAFE_FIELDS = ['status', 'reason', 'subReason', 'operatingPrinciplesStatus', 'personalityStatus', 'fragmentCount', 'sequenceSet', 'behavioralStartCodeUnit', 'behavioralEndCodeUnit', 'expectedSectionSha256', 'actualSectionSha256', 'sectionByteIdentical', 'fullPersonaByteIdentical', 'runtimeReachability']

function safe (result) {
  const out = {}
  for (const k of SAFE_FIELDS) if (result[k] !== undefined) out[k] = result[k]
  if (out.reason === undefined) out.reason = result.status
  return out
}

function main () {
  let baseDir
  try { baseDir = resolveCoreDir() } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_ERROR', detail: e.detail || null })); return 3 }
  let personaIdentity
  try { personaIdentity = require('../../src/persona/xiangxiang').PERSONA_IDENTITY } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: 'persona constant unavailable' })); return 3 }
  let result
  try { result = verifyBehavioralReconstitution(baseDir, personaIdentity) } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: e.code || 'tool error' })); return 3 }
  const code = exitCodeFor(result.status)
  console.log(JSON.stringify(Object.assign({ ok: result.status === 'PASS' }, safe(result))))
  return code
}

if (require.main === module) process.exit(main())
module.exports = { main }
