'use strict'

/**
 * activatePersonalityShadow — M3c-4 governed activation CLI.
 *
 * Records an explicit out-of-band Owner activation GO as exactly one ACTIVATED
 * event on the single `approved` personality revision → derived state `active`
 * (resolver ACTIVE) in the Memory truth layer only. Runtime (PERSONA_IDENTITY /
 * buildPersonaSystem) is untouched — "active in Memory" is NOT "live in the prompt".
 *
 * `actor`/`activatedBy`/`activationSource` are FIXED (Louie / owner-authorized-
 * activation) and cannot be caller-supplied. `ACTIVATED.rationale` is a canonical
 * JSON string {activatedBy, activationRef, activationSource, reason}.
 *
 * Safety: without --confirm this is a DRY RUN (no writes). For --confirm ALL of
 * --activation-ref, --rationale, --expect-revision-id, --expect-source-commit are
 * REQUIRED. `sourceCommit` truth is the M3a anchor. No --resume.
 *
 * Exit codes: 0 success (activated/already-active/dry-run) · 2 governance refusal /
 *             write failure · 3 config-tool / validation.
 *
 *   AROMA_CORE_DIR=<abs> node scripts/memory/activatePersonalityShadow.js \
 *     --activation-ref <ref> --rationale "<why>" \
 *     --expect-revision-id <id> --expect-source-commit <40hex> --confirm
 */

const { resolveCoreDir } = require('../../src/core/memory/store')
const activate = require('../../src/core/memory/shadow/personalityActivate')

const SAFE_FIELDS = ['status', 'reason', 'recordId', 'revisionId', 'plan', 'sourceCommit', 'compat', 'derivedState', 'detail', 'dryRun']

function parseArgs (argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--confirm') a.confirm = true
    else if (k === '--activation-ref') a.activationRef = argv[++i]
    else if (k === '--rationale') a.rationale = argv[++i]
    else if (k === '--expect-revision-id') a.expectRevisionId = argv[++i]
    else if (k === '--expect-source-commit') a.expectSourceCommit = argv[++i]
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
    result = activate.activatePersonality(baseDir, { personaIdentity, activationRef: args.activationRef, rationale: args.rationale, confirm: !!args.confirm, expectRevisionId: args.expectRevisionId, expectSourceCommit: args.expectSourceCommit })
  } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: e.code || 'tool error' })); return 3 }
  const code = activate.exitCodeFor(result.status)
  const dryRun = result.status === activate.REASON.DRY_RUN
  console.log(JSON.stringify(Object.assign({ ok: code === 0, dryRun }, safe(result))))
  return code
}

if (require.main === module) process.exit(main())
module.exports = { main, parseArgs }
