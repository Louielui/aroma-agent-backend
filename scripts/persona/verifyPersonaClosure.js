'use strict'

/**
 * verifyPersonaClosure — thin CLI over src/persona/personaClosure.verifyPersonaClosure.
 *
 * Usage:
 *   AROMA_CORE_DIR=<coreDir> node scripts/persona/verifyPersonaClosure.js <path/to/PERSONA-CLOSURE.json>
 *
 * Independent verifier: re-reads + re-verifies the three domains and the hybrid from
 * scratch using native functions (verifyRevision / verifyEvent / getStoreManifest /
 * composeHybridPersona), recomputes closurePayloadHash, and does NOT trust the
 * closure's stored results. READ-ONLY. Exit 0 = ok, 1 = mismatch, 3 = config error.
 */

const fs = require('fs')
const path = require('path')
const { verifyPersonaClosure } = require('../../src/persona/personaClosure')

function main () {
  const closurePath = process.argv[2]
  const coreDir = process.env.AROMA_CORE_DIR
  if (!closurePath) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_ERROR', detail: 'usage: <path/to/PERSONA-CLOSURE.json>' })); return 3 }
  if (typeof coreDir !== 'string' || !path.isAbsolute(coreDir)) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_ERROR', detail: 'AROMA_CORE_DIR absolute required' })); return 3 }
  let closure
  try { closure = JSON.parse(fs.readFileSync(closurePath, 'utf8')) } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CLOSURE_UNREADABLE', detail: e.message })); return 3 }
  let result
  try { result = verifyPersonaClosure(closure, { coreDir }) } catch (e) { console.error(JSON.stringify({ ok: false, reason: e.code || 'VERIFY_ERROR', detail: e.detail || e.message })); return 3 }
  console.log(JSON.stringify({ ok: result.ok, payloadHashMatch: result.payloadHashMatch, mismatches: result.mismatches }))
  return result.ok ? 0 : 1
}

if (require.main === module) process.exit(main())
module.exports = { main }
