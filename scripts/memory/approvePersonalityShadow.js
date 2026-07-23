'use strict'

/**
 * approvePersonalityShadow — M3c-3 governed approval CLI.
 *
 * Records an explicit out-of-band Owner approval GO as exactly one APPROVED event
 * on the single `review_ready` personality revision → derived state `approved`.
 * Does NOT activate. `approvedBy`/`approvalSource`/`decision`/`actor` are FIXED
 * (Louie / owner-authorized-approval / approved) and cannot be caller-supplied.
 * `--approval-ref` is the Owner GO reference. The target revision's payload is
 * re-proven against the M3a canonical truth before approving.
 *
 * Safety: without --confirm this is a DRY RUN (no writes). `--expect-revision-id`
 * is REQUIRED for --confirm. No --resume.
 *
 * Exit codes: 0 success (approved/already-matching/dry-run) · 2 governance refusal /
 *             write failure · 3 config-tool / validation.
 *
 *   AROMA_CORE_DIR=<abs> node scripts/memory/approvePersonalityShadow.js \
 *     --approval-ref <ref> --rationale "<why>" --expect-revision-id <id> --confirm
 */

const { resolveCoreDir } = require('../../src/core/memory/store')
const approve = require('../../src/core/memory/shadow/personalityApprove')

const SAFE_FIELDS = ['status', 'reason', 'recordId', 'revisionId', 'plan', 'compat', 'derivedState', 'detail', 'dryRun']

function parseArgs (argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--confirm') a.confirm = true
    else if (k === '--approval-ref') a.approvalRef = argv[++i]
    else if (k === '--rationale') a.rationale = argv[++i]
    else if (k === '--expect-revision-id') a.expectRevisionId = argv[++i]
  }
  return a
}

function safe (result) {
  const out = {}
  for (const k of SAFE_FIELDS) if (result[k] !== undefined) out[k] = result[k]
  if (out.reason === undefined) out.reason = result.status
  return out
}

function main (argv) {
  const args = parseArgs(argv || process.argv.slice(2))
  let baseDir
  try { baseDir = resolveCoreDir() } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_ERROR', detail: e.detail || null })); return 3 }
  let personaIdentity
  try { personaIdentity = require('../../src/persona/xiangxiang').PERSONA_IDENTITY } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: 'persona constant unavailable' })); return 3 }
  let result
  try {
    result = approve.approvePersonality(baseDir, { personaIdentity, approvalRef: args.approvalRef, rationale: args.rationale, confirm: !!args.confirm, expectRevisionId: args.expectRevisionId })
  } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: e.code || 'tool error' })); return 3 }
  const code = approve.exitCodeFor(result.status)
  const dryRun = result.status === approve.REASON.DRY_RUN
  console.log(JSON.stringify(Object.assign({ ok: code === 0, dryRun }, safe(result))))
  return code
}

if (require.main === module) process.exit(main())
module.exports = { main, parseArgs }
