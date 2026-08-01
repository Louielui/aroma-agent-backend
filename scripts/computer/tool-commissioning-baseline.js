'use strict'

/**
 * tool-commissioning-baseline.js — measure the machine, judge nothing, write it down.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Three operator logins were spent discovering that a list of expectations, written without
 * ever having run in an operator session, did not match the machine. Each login found exactly
 * one wrong expectation, because the preflight stops at the first problem — so three real
 * sessions bought three facts.
 *
 * The expectations were authored, not measured. That is the whole defect: `C:\Windows\Temp is
 * not writable by this account` was a guess about someone else's system, and it was wrong in a
 * way no amount of reading our own source could reveal.
 *
 * This tool inverts the order. It runs every probe, judges NOTHING, and prints and records what
 * it found. The record is the baseline that expectations should be derived from — and a baseline
 * taken from the real session is worth more than any number of careful assumptions.
 *
 * ── IT CANNOT REFUSE ANYTHING ──────────────────────────────────────────────
 * There is no verdict, no exit code that means "stop", and no path from here to an executor. It
 * is a measurement instrument. If it found something alarming, a person reads it and decides.
 *
 * ── WHY THE THREE FAILED ATTEMPTS ARE NOT A BASELINE ───────────────────────
 * They measured a real session, so they are real facts — but they are PARTIAL. The preflight
 * short-circuits, so attempt one learned nothing past identity, attempt two nothing past the
 * folder contents, attempt three nothing past the writable probe. Everything after the first
 * failure in each run is still unmeasured, including every check this round just changed.
 *
 * So they are worth recording as history and are not a baseline. This is the run that produces
 * one, and it produces the whole of it, because nothing here stops early.
 */

const fs = require('node:fs')
const path = require('node:path')

const T = require('./operatorToolsCommon')

const AT = new Date().toISOString()

T.title('COMMISSIONING BASELINE')
T.out('  Measuring this machine. NOTHING is judged and nothing can be refused.')
T.out('')

const record = { measuredAt: AT, session: {}, machine: {}, notes: [] }

/* ── who ──────────────────────────────────────────────────────────────────── */

const who = T.checkIdentity()
record.session = {
  measured: !!who.snapshot,
  account: who.snapshot ? who.snapshot.account : null,
  sid: who.snapshot ? who.snapshot.sid : null,
  sessionId: who.snapshot ? who.snapshot.sessionId : null,
  desktop: who.snapshot ? who.snapshot.desktop : null,
  isElevated: who.snapshot ? who.snapshot.isElevated : null,
  isInteractive: who.snapshot ? who.snapshot.isInteractive : null,
  integrityLevel: who.snapshot ? who.snapshot.integrityLevel : null,
  administratorsPresent: who.snapshot ? who.snapshot.administratorsPresent : null,
  administratorsEnabled: who.snapshot ? who.snapshot.administratorsEnabled : null,
  judgeSaid: who.ok ? 'ok' : who.refusal
}
T.out('  SESSION')
for (const [k, v] of Object.entries(record.session)) {
  T.out('    ' + String(k).padEnd(24) + (v === null ? '(not measured)' : String(v)))
}
T.out('')

/* ── the machine, every probe, none of them fatal ─────────────────────────── */

const { createMachineProbe } = require('../../src/computer/machineProbe')
const { ALLOWED_DIR, REQUEST_DIR } = require('../../src/computer/companionCanaryRunner')
const machine = createMachineProbe({ runner: T.buildRunner() })

const safely = (label, fn) => {
  try { return fn() } catch (e) { record.notes.push(label + ': threw ' + e.message); return { error: e.message } }
}

record.machine.canaryFolderAcl = safely('acl', () => machine.readAcl(ALLOWED_DIR))
record.machine.canaryFolderEntries = safely('listdir', () => machine.listDir(ALLOWED_DIR))
record.machine.requestFolderAcl = safely('requestAcl', () => machine.readAcl(REQUEST_DIR))
record.machine.writable = safely('writable', () => machine.probeWritable())
record.machine.stagedClosure = safely('staging', () => machine.stagedClosure())
record.machine.notepadCount = safely('notepads', () => machine.notepadCount())
record.machine.auditWritable = safely('auditwritable', () => machine.auditWritable())

T.out('  MACHINE')
const w = record.machine.writable
if (w && w.ok && Array.isArray(w.paths)) {
  for (const p of w.paths) {
    // The class is printed, because "we set this and it must hold" and "we looked and this is
    // what we saw" are different claims and must not read the same on a page.
    T.out('    ' + String(p.class || 'observed').padEnd(10) + String(p.writable ? 'writable    ' : 'not writable') + '  ' + p.path)
  }
  for (const n of (w.notProbed || [])) T.out('    ' + 'skipped'.padEnd(10) + String(n.reason).padEnd(12) + '  ' + n.path)
} else {
  T.out('    writable probe: ' + (w && w.reason ? w.reason : 'not measured'))
}
T.out('    ' + 'folder'.padEnd(10) + 'entries     ' + '  ' + JSON.stringify(record.machine.canaryFolderEntries))
T.out('    ' + 'notepad'.padEnd(10) + 'count       ' + '  ' + record.machine.notepadCount)
T.out('    ' + 'audit'.padEnd(10) + 'writable    ' + '  ' + record.machine.auditWritable)
T.out('    ' + 'staged'.padEnd(10) + 'closure     ' + '  ' + JSON.stringify(record.machine.stagedClosure))
T.out('')

/* ── write it where the Owner can read it ─────────────────────────────────── */

let wrote = null
try {
  fs.mkdirSync(T.AUDIT_DIR, { recursive: true })
  wrote = path.join(T.AUDIT_DIR, 'commissioning-baseline-' + AT.replace(/[:.]/g, '-') + '.json')
  fs.writeFileSync(wrote, JSON.stringify(record, null, 2) + '\n', 'utf8')
} catch (e) {
  wrote = null
  T.out('  The baseline could not be written: ' + e.message)
  T.out('  (The measurements above are still valid — they are just not on disk.)')
}

if (wrote) {
  T.out('  Baseline written to:')
  T.out('    ' + wrote)
}
T.out('')
T.out('  Nothing was judged, nothing was started, and nothing was refused.')
T.out('  Show this to the Owner before the first canary run.')
T.out('')

// Exit 0 whatever was found. A measurement tool that can fail teaches people to read its exit
// code instead of its output.
process.exit(0)
