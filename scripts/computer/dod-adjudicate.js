'use strict'
// dod-adjudicate.js — decide whether the three stages may be combined into one acceptance.
//
// Thin wrapper, same reasoning as lock3-sweep.js: the rule lives in
// src/computer/measurementContext.js and is covered by its tests. This adds a command line and
// a result file, nothing else.
//
//   node dod-adjudicate.js --round-dir <dir> --result <file.json> [--verdicts <json>]
//
// It reads CONTEXT-part-b.json, CONTEXT-lock3.json and CONTEXT-dod.json from the round
// directory. A MISSING context file is not skipped — it fails closed as INCOMPLETE_CONTEXT,
// because "we could not find the record of how this was measured" and "it was measured
// correctly" must never produce the same verdict.

const fs = require('node:fs')
const path = require('node:path')
const { STAGES, VERDICT, adjudicate } = require('../../src/computer/measurementContext')

const argv = process.argv.slice(2)
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }

const roundDir = arg('--round-dir')
const resultPath = arg('--result')
const verdictsRaw = arg('--verdicts')

function write (rec, code) {
  if (resultPath) { try { fs.writeFileSync(resultPath, JSON.stringify(rec, null, 2)) } catch (_) {} }
  process.stdout.write(`DoD: ${rec.verdict}\n`)
  for (const p of rec.problems || []) process.stdout.write('  - ' + p + '\n')
  process.exit(code)
}

if (!roundDir || !resultPath) {
  write({ verdict: VERDICT.INCOMPLETE, problems: ['missing --round-dir or --result'], at: new Date().toISOString() }, 2)
}

// ── VERDICTS COME FROM A FILE, NOT THE COMMAND LINE ────────────────────────
// MEASURED 2026-07-31: launcher 4 passed --verdicts with ConvertTo-Json -Compress, and the
// quoting did not survive the crossing into node. It arrived as {part-b:PASS,...}, failed to
// parse, and the run reported INCOMPLETE_CONTEXT — which names the wrong thing entirely and
// sent the reader looking at context files that were fine. A file has no quoting to lose.
//
// --verdicts is still accepted so an operator can pass one by hand, but the launchers use the
// file, and a malformed input is now its OWN verdict rather than masquerading as a missing
// context.
const verdictsFile = arg('--verdicts-file')
let stageVerdicts = {}
if (verdictsFile) {
  try {
    stageVerdicts = JSON.parse(fs.readFileSync(verdictsFile, 'utf8'))
  } catch (e) {
    write({ verdict: VERDICT.BAD_INPUT, problems: ['--verdicts-file could not be read as JSON: ' + e.message], at: new Date().toISOString() }, 2)
  }
} else if (verdictsRaw) {
  try { stageVerdicts = JSON.parse(verdictsRaw) } catch (e) {
    write({ verdict: VERDICT.BAD_INPUT, problems: ['--verdicts was not valid JSON: ' + e.message], at: new Date().toISOString() }, 2)
  }
}

const contexts = []
const problems = []
for (const s of STAGES) {
  const f = path.join(roundDir, `CONTEXT-${s}.json`)
  if (!fs.existsSync(f)) { problems.push(`no context recorded for stage ${s} (${path.basename(f)})`); continue }
  try {
    contexts.push(JSON.parse(fs.readFileSync(f, 'utf8')))
  } catch (e) {
    problems.push(`context for stage ${s} could not be read: ${e.message}`)
  }
}

// An unreadable context is reported as its own problem and then still adjudicated, so the
// report names every defect rather than stopping at the first.
const result = adjudicate(contexts, stageVerdicts)
const rec = {
  verdict: problems.length ? VERDICT.INCOMPLETE : result.verdict,
  problems: problems.concat(result.problems || []),
  subject: result.subject || null,
  stageVerdicts,
  roundDir,
  at: new Date().toISOString()
}
write(rec, rec.verdict === VERDICT.PASS ? 0 : 1)
