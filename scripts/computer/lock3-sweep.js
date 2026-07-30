'use strict'
// lock3-sweep.js — run the Lock 3 retention sweep against a real evidence directory.
//
// A THIN WRAPPER, deliberately. The classification and the retention rule live in
// src/computer/evidenceStore.js and are exercised by its tests. Re-implementing either here —
// or worse, in PowerShell so the launcher could call it directly — would create a second
// classifier that drifts from the tested one, which is the same defect as the assertion-id
// drift and the stale SHA pin. So the launcher shells out to node and this file adds nothing
// but a command line and a result file.
//
//   node lock3-sweep.js --evidence-dir <dir> --result <file.json> [--dry-run]
//
// --dry-run reports exactly what WOULD be removed and removes nothing. It is what should be
// run first against a store that has never been swept.
//
// Exit 0 = the sweep ran and the result was written. Non-zero = it did not, and the result
// file is the place to look. A sweep whose outcome cannot be recorded is treated as a failure
// even if the deletions themselves succeeded: an unrecorded deletion is not auditable.

const fs = require('node:fs')
const path = require('node:path')
const { createEvidenceStore, classify, RETENTION_DAYS } = require('../../src/computer/evidenceStore')

const argv = process.argv.slice(2)
const arg = (name, def = null) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def
}
const has = (name) => argv.includes(name)

const evidenceDir = arg('--evidence-dir')
const resultPath = arg('--result')
// --dry-run and --WhatIf both accepted: the launcher speaks PowerShell and would otherwise
// have to translate, and a flag that is silently ignored would DELETE on a run meant to be safe.
const dryRun = has('--dry-run') || has('--WhatIf') || has('-WhatIf')

function fail (code, message, extra = {}) {
  const rec = { ok: false, error: message, dryRun, retentionDays: RETENTION_DAYS, at: new Date().toISOString(), ...extra }
  if (resultPath) {
    try { fs.writeFileSync(resultPath, JSON.stringify(rec, null, 2)) } catch (_) {}
  }
  process.stderr.write(message + '\n')
  process.exit(code)
}

if (!evidenceDir) fail(2, 'missing --evidence-dir')
if (!resultPath) fail(2, 'missing --result')
if (!fs.existsSync(evidenceDir)) fail(3, 'evidence directory does not exist: ' + evidenceDir)

let names = []
try {
  names = fs.readdirSync(evidenceDir).filter((n) => {
    try { return fs.statSync(path.join(evidenceDir, n)).isFile() } catch (_) { return false }
  })
} catch (e) {
  fail(4, 'cannot read the evidence directory: ' + e.message)
}

// Classify everything BEFORE touching anything, so the report describes the store as it was
// found rather than as it was left.
const before = { raw: [], record: [], unclassified: [] }
for (const n of names) {
  const k = classify(n).kind
  if (k === 'raw') before.raw.push(n)
  else if (k === 'record') before.record.push(n)
  else before.unclassified.push(n)
}

let result
try {
  const store = createEvidenceStore({ baseDir: evidenceDir })
  if (dryRun) {
    // What the sweep WOULD do: raw files past the retention. Computed the same way the sweep
    // computes it, from mtime, so the preview cannot disagree with the action.
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    const wouldDelete = []
    let wouldKeep = 0
    for (const n of before.raw) {
      let st
      try { st = fs.statSync(path.join(evidenceDir, n)) } catch (_) { continue }
      if (st.mtimeMs <= cutoff) wouldDelete.push(n)
      else wouldKeep++
    }
    result = { deleted: wouldDelete, kept: wouldKeep, retained: before.record, unclassified: before.unclassified, retentionDays: RETENTION_DAYS }
  } else {
    result = store.sweep()
  }
} catch (e) {
  fail(5, 'the sweep threw: ' + e.message)
}

const rec = {
  ok: true,
  dryRun,
  evidenceDir,
  retentionDays: result.retentionDays,
  examined: names.length,
  // `deleted` is what WOULD be deleted under --dry-run; `dryRun` says which, and the launcher
  // shows it, so the number can never be read as a completed deletion.
  deleted: result.deleted.length,
  deletedNames: result.deleted,
  kept: result.kept,
  retained: result.retained.length,
  retainedNames: result.retained,
  // Never deleted, always reported: an undeclared name is a gap in the classifier, and
  // deleting something nobody declared is how a control becomes an incident.
  unclassified: result.unclassified.length,
  unclassifiedNames: result.unclassified,
  at: new Date().toISOString()
}

try {
  fs.writeFileSync(resultPath, JSON.stringify(rec, null, 2))
} catch (e) {
  fail(6, 'the sweep ran but its result could not be written: ' + e.message)
}

process.stdout.write(
  `lock3 sweep ${dryRun ? '(DRY RUN — nothing deleted)' : ''}\n` +
  `  examined     : ${rec.examined}\n` +
  `  ${dryRun ? 'would delete' : 'deleted     '} : ${rec.deleted}\n` +
  `  kept (raw)   : ${rec.kept}\n` +
  `  retained     : ${rec.retained}\n` +
  `  unclassified : ${rec.unclassified}\n`)
process.exit(0)
