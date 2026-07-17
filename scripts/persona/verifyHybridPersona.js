'use strict'

/**
 * verifyHybridPersona — standalone read-only CLI / CI preflight (R1).
 *
 * Composes the Hybrid Persona (active identity + active OP/Personality behavioral
 * reconstitution + frozen legacy tail) and proves it is byte-identical to the frozen
 * PERSONA_IDENTITY. Reads the M3a mapping + frozen PERSONA_IDENTITY (read-only) as
 * the trust anchor. Never writes to Memory. Never sends the persona to any model.
 *
 * Prints SAFE metadata only — NEVER the persona / tail / behavioral / fragment /
 * system-prompt / user text.
 *
 * Exit codes: 0 READY · 2 VERIFICATION_FAILED · 3 CONFIG_OR_TOOL_ERROR · 4 NOT_READY.
 * Production is expected to be HYBRID_PERSONA_NOT_READY (OP review_ready, personality absent).
 *
 *   AROMA_CORE_DIR=<abs> node scripts/persona/verifyHybridPersona.js
 */

const { resolveCoreDir } = require('../../src/core/memory/store')
const { composeHybridPersona, exitCodeFor } = require('../../src/persona/hybridPersonaComposer')

const SAFE_FIELDS = ['identityRevisionId', 'operatingPrinciplesRevisionId', 'personalityRevisionId', 'mappingSourceCommit', 'identityStatus', 'opStatus', 'personalityStatus', 'behavioralStatus', 'tailSource', 'tailStartCodeUnit', 'legacySha256', 'hybridSha256', 'byteIdentical']

function safe (result) {
  const out = { status: result.status, reason: result.reason || result.status, ready: !!result.ready }
  const src = result.safeMetadata || result
  for (const k of SAFE_FIELDS) if (src[k] !== undefined) out[k] = src[k]
  return out
}

function main () {
  let baseDir
  try { baseDir = resolveCoreDir() } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_ERROR', detail: e.detail || null })); return 3 }
  let personaIdentity
  try { personaIdentity = require('../../src/persona/xiangxiang').PERSONA_IDENTITY } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: 'persona constant unavailable' })); return 3 }
  let result
  try { result = composeHybridPersona(baseDir, { personaIdentity }) } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: e.code || 'tool error' })); return 3 }
  const code = exitCodeFor(result.status)
  // NOTE: result.personaText is intentionally never read/printed here.
  console.log(JSON.stringify(Object.assign({ ok: result.status === 'HYBRID_PERSONA_READY' }, safe(result))))
  return code
}

if (require.main === module) process.exit(main())
module.exports = { main }
