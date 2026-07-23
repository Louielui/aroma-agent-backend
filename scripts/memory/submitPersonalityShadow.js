'use strict'

/**
 * submitPersonalityShadow — M3c-2 governed submission CLI.
 *
 * Builds the canonical single-fragment personality payload, creates exactly one
 * append-only revision, and emits exactly one SUBMITTED_FOR_REVIEW event —
 * stopping in derived state `review_ready`. Does NOT approve or activate.
 * `--submission-ref` / `--rationale` are provenance/audit only. `sourceCommit` is
 * derived from the verified M3a anchor; `--expect-source-commit` is a MANDATORY
 * equality guard for --confirm. A pre-existing matching event-less revision
 * requires an EXACT --resume <id> acknowledgement; no second revision is ever made.
 *
 * Exit codes: 0 success (submitted/resumed/already-matching/dry-run) ·
 *             2 governance refusal / write failure · 3 config-tool / validation.
 *
 *   AROMA_CORE_DIR=<abs> node scripts/memory/submitPersonalityShadow.js \
 *     --submission-ref <ref> --rationale "<why>" --expect-source-commit <40hex> \
 *     [--resume <revisionId>] --confirm
 */

const { resolveCoreDir } = require('../../src/core/memory/store')
const submit = require('../../src/core/memory/shadow/personalitySubmit')

const SAFE_FIELDS = ['status', 'reason', 'recordId', 'revisionId', 'plan', 'sourceCommit', 'compat', 'derivedState', 'detail', 'dryRun']

function parseArgs (argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--confirm') a.confirm = true
    else if (k === '--submission-ref') a.submissionRef = argv[++i]
    else if (k === '--rationale') a.rationale = argv[++i]
    else if (k === '--resume') a.resumeRevisionId = argv[++i]
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
    result = submit.submitPersonality(baseDir, {
      personaIdentity,
      submissionRef: args.submissionRef,
      rationale: args.rationale,
      confirm: !!args.confirm,
      resumeRevisionId: args.resumeRevisionId,
      expectSourceCommit: args.expectSourceCommit
    })
  } catch (e) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_OR_TOOL_ERROR', detail: e.code || 'tool error' })); return 3 }
  const code = submit.exitCodeFor(result.status)
  const dryRun = result.status === submit.REASON.DRY_RUN
  console.log(JSON.stringify(Object.assign({ ok: code === 0, dryRun }, safe(result))))
  return code
}

if (require.main === module) process.exit(main())
module.exports = { main, parseArgs }
