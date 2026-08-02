'use strict'

/**
 * tool-start-companion.js — the Companion, started by hand, in the operator's own session.
 *
 * ── IT TRUSTS NOTHING THAT CAME BEFORE IT ──────────────────────────────────
 * The Owner may have run the other two tools a minute ago and seen green. This re-runs all of
 * it: identity, machine, approved program. Not because the earlier answers were wrong, but
 * because they were answers about an earlier moment, and the gap between the two is exactly
 * where a folder gets written to, a Notepad gets opened, or a file gets edited.
 *
 *   identity  ->  machine  ->  approved program  ->  READY  ->  wait for a request
 *
 * ── THE SWITCH IS OFF WHILE IT WAITS ───────────────────────────────────────
 * COMPUTER_OPERATOR stays unset for the whole waiting period. It is set in the Process scope of
 * THIS process only, immediately before one verified request is handed to the runner, and
 * restored in a `finally` that runs on success, on failure and on a thrown error. The User and
 * Machine scopes are never written — not by this file, not by anything it calls.
 *
 * If the restore does not put it back exactly as it was, that is a containment incident: the
 * process reports it and exits. It does not retry, and it does not keep waiting.
 *
 * ── WHAT A REQUEST IS NOT ──────────────────────────────────────────────────
 * A request is a pointer with an expiry. It carries no text, no filename and no command. What
 * gets typed and where it gets saved comes from the receipt this process verifies for itself.
 */

const fs = require('node:fs')
const path = require('node:path')

const T = require('./operatorToolsCommon')

const POLL_MS = 1000

const store = require('../../src/computer/executeRequestStore')
const { runCanaryAsCompanion } = require('../../src/computer/companionCanaryRunner')
const { buildCompanionExecution } = require('../../src/computer/companionProductionFactory')
const { createArtifactStore } = require('../../src/store/artifactStore')
const { resolveArtifactDir } = require('../../src/runtime/artifactDir')

/* ── 1-3. the three checks, every time ────────────────────────────────────── */

T.title('START AROMA COMPANION')
T.out('  Checking everything again from the beginning.')
T.out('')

const who = T.checkIdentity()
T.renderIdentity(who)
if (!who.ok) { T.out('  The Companion was NOT started.'); T.out(''); process.exit(1) }

const runner = T.buildRunner()
const machineRes = T.checkMachine({ runner })
T.renderMachine(machineRes)
if (!machineRes.ok) { T.out('  The Companion was NOT started.'); T.out(''); process.exit(1) }

const pkgRes = T.checkPackage()
T.renderPackage(pkgRes)
if (!pkgRes.ok) { T.out('  The Companion was NOT started.'); T.out(''); process.exit(1) }

/* ── the pieces, assembled once ───────────────────────────────────────────── */

if (!T.ensureRequestDir()) {
  T.out('  The place where requests arrive could not be opened.')
  T.out('  The Companion was NOT started.')
  T.out('')
  process.exit(1)
}

// NOT <stage>.aroma. The operator has ReadAndExecute on the staged tree by design, so the
// artifact store could not have written a single record there — and it would have failed late,
// inside the executor's first admission write, with the flag already on and every check passed.
const artifactStore = createArtifactStore({ baseDir: resolveArtifactDir(process.env, T.AUDIT_DIR).dir })
const built = buildCompanionExecution({ artifactStore, runner })
if (!built.ok) {
  T.out('  The Companion could not be assembled: ' + built.reason)
  T.out('')
  process.exit(1)
}
const ledger = store.createRequestStore({ dir: T.REQUEST_DIR })

/* ── READY ────────────────────────────────────────────────────────────────── */

T.out('')
T.out('  READY.')
T.out('')
T.out('  This window is the Companion. Leave it open.')
T.out('  Waiting for the Owner to send one task. Nothing will happen until then.')
T.out('')
T.out('  To stop waiting, close this window.')
T.out('')

/**
 * The one request this process will ever handle. After it, the Companion stops.
 *
 * WHICH one is decided by the store — see selectPending(). It used to be decided here, by
 * `readdirSync(...).sort()[0]`, which sorted filenames whose distinguishing part is random hex.
 * That is not "the oldest" and not "the newest"; it is whichever random id sorts first, and a
 * single expired file from the previous day won it every time and shadowed every fresh approval.
 *
 * The rule now lives with the naming convention it depends on, in one place, and it is: retire
 * anything expired, then take the NEWEST live request by request.createdAt.
 */
function selectPending () {
  const rs = store.createRequestStore({ dir: T.REQUEST_DIR })
  try { return rs.selectPending() } catch (e) {
    return { ok: false, reason: 'select_failed', detail: (e && e.message) || String(e), candidates: 0, expiredRetired: 0, retireFailures: 0 }
  }
}

/**
 * WHAT CLEANUP MEASURED — printed on BOTH outcomes, and never replaced by a sentence.
 *
 * The executor now measures the close: whether the process really exited, how many Notepad
 * windows and processes are left, whether it had to force it, and by which method. Those numbers
 * existed only in the audit file; the person watching the window saw nothing.
 */
function reportCleanup (res) {
  const d = res && res.result ? res.result.cleanupDetail : null
  if (!d) {
    T.out('  Cleanup: no measurement was reported. That is a fault in this program.')
    T.out('')
    return
  }
  // Nulls are shown as "not measured", never as 0 or false. "I could not look" and "I looked
  // and there was nothing" are different facts and the screen must not merge them.
  const show = (v) => (v === null || v === undefined ? 'not measured' : String(v))
  T.out('  Cleanup, measured:')
  T.out('    Notepad process ended  : ' + show(d.processExited))
  T.out('    Notepad windows left   : ' + show(d.notepadWindowsAfter))
  T.out('    Notepad processes left : ' + show(d.notepadProcessesAfter))
  T.out('    had to force it        : ' + show(d.forced))
  T.out('    how                    : ' + show(d.method))
  if (d.cleanupOk !== true) {
    T.out('  THE CLEANUP DID NOT FINISH: ' + (d.reason || 'no reason given'))
    T.out('  The steps still ran and are recorded; the desktop may need closing by hand.')
  }
  T.out('')
}

/** What is still on the machine, measured — on success as well as on failure. */
function reportLeftovers (res) {
  const left = T.leftovers({ cleanup: res && res.result ? res.result.cleanup : null })
  if (left.clean) {
    T.out('  Checked: no Notepad left open, and the folder is empty.')
  } else {
    T.out('  SOMETHING IS LEFT BEHIND:')
    for (const l of left.items) T.out('    - ' + l)
    T.out('')
    T.out('  Please close it / clear it before running again.')
  }
  T.out('')
}

function handle (file) {
  let rec = null
  try { rec = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { rec = null }
  if (!rec || !rec.request) {
    T.out('  A request arrived but could not be read. Nothing was done.')
    return 1
  }

  T.out('  A task has arrived from the Owner. Checking it...')
  T.out('')

  // THE FLAG. Process scope only, set here and nowhere else, restored in `finally`.
  const wasSet = Object.prototype.hasOwnProperty.call(process.env, 'COMPUTER_OPERATOR')
  const before = process.env.COMPUTER_OPERATOR
  let res
  try {
    process.env.COMPUTER_OPERATOR = 'on'
    res = runCanaryAsCompanion(rec.request, {
      snapshot: who.snapshot,
      machine: built.machine,
      executor: built.executor,
      ledger,
      artifactStore,
      receipt: pkgRes.receipt,
      receiptVerified: true,
      currentPackageHash: pkgRes.packageHash
    })
  } finally {
    if (wasSet) process.env.COMPUTER_OPERATOR = before
    else delete process.env.COMPUTER_OPERATOR
  }

  // Prove the restore rather than assume it.
  const after = Object.prototype.hasOwnProperty.call(process.env, 'COMPUTER_OPERATOR') ? process.env.COMPUTER_OPERATOR : undefined
  const restored = wasSet ? after === before : after === undefined
  if (!restored) {
    T.out('')
    T.out('  *** CONTAINMENT INCIDENT ***')
    T.out('  The computer operator switch did not return to how it was.')
    T.out('  Not retrying. Close this window and report it.')
    T.out('')
    return 9
  }

  T.out('')
  if (res && res.ok) {
    // ── WHAT THIS ORDER ACTUALLY DID ──────────────────────────────────────
    // It said "DONE. The file has been created. Please open it, check it, and delete it" —
    // left over from the three-step order. The canary shrank to open_app + type_text on
    // 2026-08-02 and creates no file, so the screen was sending the Owner to look for
    // something that does not exist.
    //
    // It survived that round because nothing pointed at it: it is a hardcoded string with no
    // test asserting its content, it reads no allowedPath so it did not start rendering
    // "undefined", and it lives on the COMPANION screen while the shrink was being done on the
    // two Owner screens. I fixed what the failing test and the undefined value pointed at, and
    // never asked where else the code promises a file. Hence the guard in
    // displayLayerHonesty.test.js.
    //
    // The step list is read from the RESULT, not written out here, so it cannot go stale again.
    const did = (res.result && Array.isArray(res.result.steps) ? res.result.steps : []).map((s) => s.action)
    T.out('  DONE. ' + (did.length ? did.join(' then ') : 'the approved steps') + ' completed.')
    T.out('  No file was created - this task does not save anything.')
    T.out('')

    // ── THE SAME MEASUREMENT THE FAILURE PATH GETS ────────────────────────
    // The leftovers check used to live only in the `else`. So a failure was told the truth
    // about the machine and a success was told nothing at all — the same backwards shape as
    // cleanup itself, which ran only when something went wrong.
    reportCleanup(res)
    reportLeftovers(res)
  } else {
    T.out('  IT DID NOT RUN.')
    // The reason, and never a blank. If the runner somehow returns neither, that absence is
    // itself reported — a silent failure screen is what sent the Owner back to the logs.
    if (res && res.human) T.out('  ' + res.human)
    if (res && res.detail) T.out('  ' + res.detail)
    if (res && !res.human && !res.detail) {
      T.out('  It gave no reason. That is a fault in this program, not in your machine.')
      T.out('  The audit record in ' + T.AUDIT_DIR + ' will say what happened.')
    }
    T.out('')

    reportCleanup(res)
    reportLeftovers(res)
    T.out('  The task has been used up either way - to try again, the Owner must approve again.')
  }
  T.out('')
  T.out('  The switch is off. This window can be closed.')
  T.out('')
  return res && res.ok ? 0 : 1
}

const timer = setInterval(() => {
  const sel = selectPending()

  // RETIREMENT IS REPORTED WHEN IT HAPPENS, not buried. A dead file being cleared away is the
  // difference between "nothing has arrived yet" and "something arrived and was too old", and
  // the Owner spent two account switches unable to tell those two apart.
  if (sel.expiredRetired > 0) {
    T.out('  Cleared ' + sel.expiredRetired + ' expired request(s) that were waiting here.')
  }
  if (sel.retireFailures > 0) {
    T.out('  ' + sel.retireFailures + ' expired request(s) could not be filed away; they are being ignored.')
  }
  if (sel.unreadable > 0) {
    T.out('  ' + sel.unreadable + ' request file(s) could not be read; they are being ignored.')
  }

  if (!sel.ok) return
  clearInterval(timer)
  process.exitCode = handle(sel.file)
}, POLL_MS)
