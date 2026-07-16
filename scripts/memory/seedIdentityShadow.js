'use strict'

/**
 * seedIdentityShadow — one-time governed seeding CLI for the Identity shadow.
 *
 * IMPORTANT: This CLI does NOT verify anyone's cryptographic identity. The
 * approval metadata it records (approvedBy="Louie", approvalSource=
 * "owner-authorized-migration") is a GOVERNANCE AUDIT record only. Real
 * authorization is Louie's explicit, out-of-band GO. Running this command does
 * NOT constitute approval, and completing M2 coding does NOT mean it may be run.
 *
 * Safety: without --confirm this is a DRY RUN (no writes). Multi-step append-only
 * writes are NOT a transaction — on failure it stops, does not roll back, and
 * leaves auditable partial artifacts; a partial migration is never ACTIVE and
 * re-seed is refused while any revision exists (recovery is a separate slice).
 *
 *   AROMA_CORE_DIR=<abs> node scripts/memory/seedIdentityShadow.js \
 *     --approval-ref <ref> --rationale "<why>" --source-commit <sha> --confirm
 */

const { resolveCoreDir } = require('../../src/core/memory/store')
const { seedIdentity, splitIdentity, IDENTITY_RECORD_ID } = require('../../src/core/memory/shadow/identityShadow')

function parseArgs (argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--confirm') a.confirm = true
    else if (k === '--approval-ref') a.approvalRef = argv[++i]
    else if (k === '--rationale') a.rationale = argv[++i]
    else if (k === '--source-commit') a.sourceCommit = argv[++i]
  }
  return a
}

function main (argv) {
  const args = parseArgs(argv || process.argv.slice(2))
  let baseDir
  try { baseDir = resolveCoreDir() } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: 'CONFIG_ERROR', detail: e.detail || null })); return 3
  }
  const personaIdentity = require('../../src/persona/xiangxiang').PERSONA_IDENTITY // read-only

  // Validate the split contract up front (safe, no writes)
  try { splitIdentity(personaIdentity) } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: e.code || 'IDENTITY_SPLIT_CONTRACT_ERROR', detail: e.detail || null })); return 3
  }

  if (!args.confirm) {
    console.log(JSON.stringify({
      ok: true, dryRun: true, recordId: IDENTITY_RECORD_ID,
      note: 'DRY RUN — no writes. This does NOT verify identity; real authorization is Louie\'s explicit out-of-band GO. Re-run with --confirm ONLY after that GO.',
      requires: ['--approval-ref', '--rationale', '--source-commit', '--confirm'],
      willRecord: { approvedBy: 'Louie', approvalSource: 'owner-authorized-migration' }
    }, null, 2))
    return 0
  }

  try {
    const r = seedIdentity(baseDir, { personaIdentity, approvalRef: args.approvalRef, rationale: args.rationale, sourceCommit: args.sourceCommit })
    console.log(JSON.stringify({ ok: true, seeded: true, recordId: IDENTITY_RECORD_ID, revisionId: r.revisionId, verify: r.verify.status }, null, 2))
    return 0
  } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: e.code || 'TOOL_ERROR', detail: e.detail || e.message })); return 3
  }
}

if (require.main === module) process.exit(main())
module.exports = { main, parseArgs }
