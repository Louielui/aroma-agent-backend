'use strict'

/**
 * observerKill.test.js — E0-W1 COMMITS B and E. The stop control the three bindings miss.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE GAP, STATED IN CODE ON THE 3b BRANCH AND CORRECT.
 *
 * The Observer is NOT the Companion. It is a separate process started by a fixed scheduled
 * task, so the Companion can neither start it nor stop it. All three bindings demonstrated
 * in 3a miss it: serviceGate stops the NEXT dispatch, companionAbort stops a process that is
 * not its parent, and osBackstop destroys a channel the Observer does not use to do its work.
 *
 * > **「It will stop by itself shortly」 is not a kill switch.** A bound is not a control.
 *
 * ⛔ COMMIT E — RESEMBLANCE WAS BEING TREATED AS OWNERSHIP.
 *
 * The first cut identified its target by three things: an interpreter name, the fixed script
 * path in the command line, and a valid `-Action`. All three are things anything can WRITE.
 * `TASK_NAME` took no part in establishing that the PID came from the task — it was used
 * afterwards, only to stop it. So any process running the same script with a similar command
 * line became a kill target, whether or not the fixed task started it. And `pwsh.exe` was
 * accepted although the fixed task can never launch it.
 *
 * The old K3 cases missed it: a wrong script path, an ordinary PowerShell, Node, and a
 * caller-supplied pid or path. None of them wrote the EXACT observer command line while
 * belonging to something else — which is the case that matters.
 *
 * This is the fourth time this week that appearance stood in for proof, after access-denied
 * read as zero, a whole-file diff read as divergence, and missing session proof read as safe.
 *
 * ⛔ AND STILL NOT DEMONSTRATED. Every test here runs against a fake adapter; not one real
 * task or process is touched. K8 exists so no test can quietly flip that bit.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const K = require('./observerKill')
const { KILL_SWITCH_BINDINGS } = require('./killSwitch')

/** The fixed task's own identity, as the adapter must report it. */
const OWNER = 'AROMABRAIN\\AromaOperator'
const SESSION = 5
const EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const CMD = EXE + ' -NoProfile -ExecutionPolicy Bypass -File C:\\AromaOperator-Probe\\observer.ps1' +
  ' -Action list_windows -OutJson C:\\Aroma\\ComputerOperator-Evidence\\observer-result.json'

/**
 * ⛔ COMMIT F — `incarnation` IS WHAT MAKES A PID AN IDENTITY.
 *
 * A PID is a slot, not a thing: Windows hands it to something else the moment the process
 * ends. The token is whatever a real adapter derives from the OS — creation time, a stable
 * handle identity — and, like task ownership in Commit E, it is NOT something the process
 * can author about itself.
 */
const INC = 'inc-2026-08-14T18:52:05.707Z-4242'

/** The genuine article: started by the fixed task, in its account and session. */
const REAL = { pid: 4242, incarnation: INC, name: 'powershell.exe', executablePath: EXE, account: OWNER, sessionId: SESSION, commandLine: CMD }

/**
 * A deterministic fake OS. `taskInstance` is the evidence that did not exist before Commit E:
 * it answers 「which PIDs did the fixed task start」 rather than 「which look right」.
 */
function fakeOs (over = {}) {
  const calls = { stopTask: [], terminate: [], listed: 0, taskAsked: [] }
  let procs = over.procs || []
  // What the task says it started: {pid, incarnation} pairs, never bare pids.
  const owned = (over.owned === undefined ? [{ pid: REAL.pid, incarnation: INC }] : over.owned)
    .map((o) => (typeof o === 'number' ? { pid: o, incarnation: INC } : o))
  // A run may replace the process list AFTER stopTask — this is how PID reuse is exercised.
  const afterStop = over.afterStop
  return {
    calls,
    listProcesses () { calls.listed++; return procs.slice() },
    taskInstance (name) {
      calls.taskAsked.push(name)
      if (over.noTaskEvidence) return null
      if (over.taskLookupFails) return { ok: false, reason: 'task_not_found' }
      // ⛔ The pre-Commit-F answer shape: PIDs, and no way to tell one incarnation of a PID
      //    from the next. An adapter that still answers this way is missing evidence.
      if (over.legacyEvidence) return { ok: true, pids: owned.map((o) => o.pid), processes: owned.map((o) => ({ pid: o.pid })), account: OWNER, sessionId: SESSION }
      return { ok: true, processes: owned.slice(), account: over.account || OWNER, sessionId: over.sessionId === undefined ? SESSION : over.sessionId }
    },
    stopTask (name) {
      calls.stopTask.push(name)
      if (over.stopTaskFails) return { ok: false, error: 'access denied' }
      if (afterStop) { procs = afterStop.slice(); return { ok: true } }
      if (over.stopTaskLeavesAlive !== true) procs = []
      return { ok: true }
    },
    terminate (pid) {
      calls.terminate.push(pid)
      if (over.terminateFails) return { ok: false, error: 'no such process' }
      if (over.terminateLeavesAlive !== true) procs = procs.filter((p) => p.pid !== pid)
      return { ok: true }
    }
  }
}

/* ═══ E1–E4 — ownership, not resemblance ════════════════════════════════════ */

test('*** E1. ⛔ pwsh.exe WITH THE EXACT OBSERVER COMMAND LINE IS REFUSED ***', () => {
  // The fixed task launches the absolute Windows PowerShell path. It can never start pwsh,
  // so a pwsh process writing the same command line is something else wearing the costume.
  const impostor = Object.assign({}, REAL, { name: 'pwsh.exe', executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' })
  const os = fakeOs({ procs: [impostor], owned: [] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false, '⛔ pwsh was accepted as the Observer')
  assert.equal(r.outcome, 'no_target')
  assert.deepEqual(os.calls.terminate, [], '⛔ it terminated a process it did not own')
})

test('*** E2. ⛔ THE EXACT COMMAND LINE, NOT STARTED BY THE FIXED TASK, IS REFUSED ***', () => {
  /**
   * ⛔ THE CASE THE FIRST CUT COULD NOT SEE. Byte-identical executable, byte-identical command
   * line, right account, right session — and the fixed task did not start it. Every visible
   * attribute agrees, because every visible attribute is something a caller can WRITE. Only the
   * task association distinguishes them, which is why it is now the requirement rather than a
   * step performed afterwards.
   */
  const twin = Object.assign({}, REAL, { pid: 9999 })
  const os = fakeOs({ procs: [twin], owned: [4242] }) // the task owns a DIFFERENT pid
  const r = K.killObserver({ os })
  assert.equal(r.ok, false, '⛔ a look-alike was accepted as the Observer')
  assert.equal(r.outcome, 'no_target')
  assert.deepEqual(os.calls.terminate, [], '⛔ it killed a process the task never started')
  assert.deepEqual(os.calls.taskAsked, ['AromaComputerOperator-Observer'], 'it asked about the fixed task by name')
})

test('*** E3. ⛔ THE WRONG ACCOUNT OR SESSION IS REFUSED, EVEN WHEN THE TASK CLAIMS THE PID ***', () => {
  // Belt and braces: if the task association and the account ever disagree, that disagreement
  // is itself the finding. Refuse and report rather than trust the more convenient half.
  const wrongAccount = fakeOs({ procs: [Object.assign({}, REAL, { account: 'AROMABRAIN\\louis' })] })
  assert.equal(K.killObserver({ os: wrongAccount }).outcome, 'no_target', '⛔ another account was accepted')
  const wrongSession = fakeOs({ procs: [Object.assign({}, REAL, { sessionId: 1 })] })
  assert.equal(K.killObserver({ os: wrongSession }).outcome, 'no_target', '⛔ another session was accepted')
})

test('*** E4. THE GENUINE FIXED-TASK PROCESS IS ACCEPTED, AND IS THE SOLE TARGET ***', () => {
  const os = fakeOs({ procs: [REAL] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.pid, 4242)
  assert.equal(r.matched, 1)
})

test('*** E5. ⛔ NO TASK EVIDENCE AT ALL IS A REFUSAL, NEVER A FALL-BACK ***', () => {
  /**
   * ⛔ THE MUTATION THIS EXISTS TO STOP. An adapter that cannot answer 「did the fixed task
   * start this PID」 must not cause the control to resume matching on command lines. Missing
   * evidence is missing evidence — the same rule Commit D applied to session proof.
   */
  const noMethod = fakeOs({ procs: [REAL], noTaskEvidence: true })
  const a = K.killObserver({ os: noMethod })
  assert.equal(a.ok, false)
  assert.equal(a.outcome, 'no_task_ownership_evidence')
  assert.deepEqual(noMethod.calls.terminate, [])

  const lookupFails = fakeOs({ procs: [REAL], taskLookupFails: true })
  const b = K.killObserver({ os: lookupFails })
  assert.equal(b.ok, false)
  assert.equal(b.outcome, 'no_task_ownership_evidence')
  assert.deepEqual(lookupFails.calls.terminate, [])

  // an adapter with no taskInstance function at all is the same answer
  const legacy = fakeOs({ procs: [REAL] })
  delete legacy.taskInstance
  assert.equal(K.killObserver({ os: legacy }).outcome, 'no_os_adapter')
})

/* ═══ K1 / K6 — success needs BOTH halves ═══════════════════════════════════ */

test('*** K1. ⛔ SUCCESS REQUIRES ALIVE-BEFORE AND ABSENT-AFTER ***', () => {
  const os = fakeOs({ procs: [REAL] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.aliveBefore, true, 'it proved the target was running')
  assert.equal(r.aliveAfter, false, 'and proved it is gone')
  assert.deepEqual(os.calls.stopTask, ['AromaComputerOperator-Observer'])
})

test('*** K6. ⛔ aliveAfter TRUE IS ALWAYS A FAILURE, WHATEVER ELSE SUCCEEDED ***', () => {
  const os = fakeOs({ procs: [REAL], stopTaskLeavesAlive: true, terminateLeavesAlive: true })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false, '⛔ a survivor was reported as killed')
  assert.equal(r.aliveAfter, true)
  assert.equal(r.outcome, 'still_alive')
})

/* ═══ K2 — a zero result is not a kill ══════════════════════════════════════ */

test('*** K2. ⛔ NOTHING TO KILL IS A NAMED NON-SUCCESS, NOT A KILL CLAIM ***', () => {
  /**
   * ⛔ THE VACUOUS PASS THIS PROJECT KEEPS FINDING. 「I looked, found nothing, therefore it is
   * stopped」 is the same shape as an assertion that cannot fail. If the Observer was never
   * running, the honest answer is that no kill happened — not that one succeeded.
   */
  const os = fakeOs({ procs: [], owned: [] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false, '⛔ an empty search reported success')
  assert.equal(r.outcome, 'no_target')
  assert.equal(r.aliveBefore, false)
  assert.deepEqual(os.calls.stopTask, [], 'nothing was stopped')
  assert.deepEqual(os.calls.terminate, [], 'nothing was terminated')
})

/* ═══ K3 / E6 — ambiguity, and strangers ════════════════════════════════════ */

test('*** K3. ⛔ MORE THAN ONE TASK-OWNED MATCH KILLS NOTHING ***', () => {
  const twin = Object.assign({}, REAL, { pid: 4243 })
  const os = fakeOs({ procs: [REAL, twin], owned: [4242, 4243] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, 'target_ambiguous')
  assert.equal(r.matched, 2)
  assert.deepEqual(os.calls.terminate, [], '⛔ it killed something while unsure which')
  assert.deepEqual(os.calls.stopTask, [], '⛔ it acted while unsure')
})

test('*** K3b. ⛔ AND IT NEVER KILLS AN ARBITRARY powershell.exe ***', () => {
  const strangers = [
    { pid: 1, name: 'powershell.exe', executablePath: EXE, account: OWNER, sessionId: SESSION, commandLine: EXE + ' -NoProfile -File C:\\Users\\louis\\something-else.ps1' },
    { pid: 2, name: 'powershell.exe', executablePath: EXE, account: OWNER, sessionId: SESSION, commandLine: EXE + ' -Command Get-Process' },
    { pid: 3, name: 'node.exe', executablePath: 'C:\\Program Files\\nodejs\\node.exe', account: OWNER, sessionId: SESSION, commandLine: 'node.exe C:\\AromaOperator-Probe\\observer.ps1 -Action list_windows' },
    { pid: 4, name: 'powershell.exe', executablePath: EXE, account: OWNER, sessionId: SESSION, commandLine: EXE + ' -File C:\\Elsewhere\\observer.ps1 -Action list_windows' }
  ]
  const os = fakeOs({ procs: strangers, owned: [1, 2, 3, 4] }) // even if the task claimed them all
  const r = K.killObserver({ os })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, 'no_target', '⛔ a stranger matched: ' + JSON.stringify(r))
  assert.deepEqual(os.calls.terminate, [], '⛔ it terminated a process it did not identify')
})

test('*** K3c. ⛔ NO CALLER-SUPPLIED PID, PATH, TASK OR ACCOUNT IS HONOURED ***', () => {
  const evil = { pid: 99, name: 'powershell.exe', executablePath: EXE, account: OWNER, sessionId: SESSION, commandLine: EXE + ' -File C:\\Anything\\evil.ps1' }
  const os = fakeOs({ procs: [evil], owned: [99] })
  const r = K.killObserver({ os, pid: 99, scriptPath: 'C:\\Anything\\evil.ps1', taskName: 'SomethingElse', account: 'AROMABRAIN\\louis' })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, 'no_target', '⛔ a caller redirected the kill: ' + JSON.stringify(r))
  assert.deepEqual(os.calls.stopTask, [], '⛔ a caller-named task was stopped')
  assert.deepEqual(os.calls.taskAsked, ['AromaComputerOperator-Observer'], '⛔ a caller-named task was queried')
  assert.deepEqual(os.calls.terminate, [])
})

/* ═══ K4 / K5 — a failed step cannot become a success ═══════════════════════ */

test('*** K4. ⛔ A FAILED TASK STOP CANNOT BECOME A SUCCESS ***', () => {
  const os = fakeOs({ procs: [REAL], stopTaskFails: true })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, 'task_stop_failed')
  assert.equal(r.aliveAfter, true, 'the target is still there and that is reported')
})

test('*** K5. ⛔ A FAILED TERMINATE CANNOT BECOME A SUCCESS ***', () => {
  const os = fakeOs({ procs: [REAL], stopTaskLeavesAlive: true, terminateFails: true })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, 'terminate_failed')
  assert.equal(r.aliveAfter, true)
})

test('*** K5b. STOPPING THE TASK IS ENOUGH WHEN IT REALLY STOPS THE PROCESS ***', () => {
  // ⛔ And then terminate is NOT called. A control that always escalates would be
  // indistinguishable from one that never checked.
  const os = fakeOs({ procs: [REAL] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, true)
  assert.deepEqual(os.calls.terminate, [], 'no escalation was needed')
  assert.equal(r.escalated, false)
})

/* ═══ K7 / K8 / K9 — the declared state must match reality ══════════════════ */

test('*** K7. implemented IS TRUE ONLY BECAUSE THE CODE EXISTS ***', () => {
  assert.equal(KILL_SWITCH_BINDINGS.observerKill.implemented, true)
  assert.equal(typeof K.killObserver, 'function', 'the claim is backed by a real function')
  assert.equal(K.TASK_NAME, 'AromaComputerOperator-Observer')
})

test('*** K8. ⛔ observerKillDemonstrated STAYS FALSE ***', () => {
  /**
   * ⛔ CODE IS NOT A DEMONSTRATION, and Commit E does not change that. Every test here runs
   * against a fake adapter; there is still no real Windows adapter at all, so nothing in this
   * repository can stop anything on Windows today.
   */
  assert.equal(KILL_SWITCH_BINDINGS.observerKillDemonstrated, false)
})

test('*** K9. ⛔ killingCompanionStopsObserver STAYS FALSE ***', () => {
  assert.equal(KILL_SWITCH_BINDINGS.killingCompanionStopsObserver, false)
  assert.deepEqual([...KILL_SWITCH_BINDINGS.demonstratedBindings], ['serviceGate', 'companionAbort', 'osFallback'],
    'the three demonstrated bindings are unchanged — observerKill is not among them')
})

/* ═══ DORMANCY ══════════════════════════════════════════════════════════════ */

test('*** K10. ⛔ THE MODULE IS DORMANT — no side effect at require time ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'observerKill.js'), 'utf8')
  assert.equal(/require\('node:child_process'\)|require\("node:child_process"\)/.test(src), false,
    '⛔ it can spawn a process by itself')
  assert.equal(/execSync|spawnSync|exec\(/.test(src), false, '⛔ it holds an execution path')
  const r = K.killObserver({})
  assert.equal(r.ok, false, 'with no adapter it does nothing')
  assert.equal(r.outcome, 'no_os_adapter')
})

test('*** K11. NO PRODUCTION CALLER IN THIS TRANCHE ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..')
  const hits = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      const st = fs.statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      if (n === 'observerKill.js') continue
      if (/require\(['"][^'"]*observerKill['"]\)/.test(fs.readFileSync(p, 'utf8'))) hits.push(n)
    }
  }
  walk(root)
  assert.deepEqual(hits, [], '⛔ something already calls the kill control: ' + hits.join(', '))
})

/* ═══ F1–F8 — a PID is a slot; the identity is the incarnation occupying it ═ */

test('*** F1. ⛔ A REUSED PID IS NOT THE PROCESS WE PROVED — TERMINATE IS FORBIDDEN ***', () => {
  /**
   * ⛔ TIME OF CHECK IS NOT TIME OF USE, ON THE ONE PATH THAT ENDS SOMETHING IRREVERSIBLY.
   *
   * The sequence asked the task once, kept the answer, stopped the task, then asked whether
   * 「the target」 was still alive — against that same stale list, by PID. But stopping the
   * task is precisely what frees the PID, and Windows reuses it immediately. So: the real
   * Observer dies, 4242 is handed to something else, and if that newcomer resembles the
   * costume the stale list still says 4242 is ours. Then we terminate it.
   *
   * Commit E answered 「did the fixed task start this PID」. This is the other question:
   * 「is this PID still the same process I proved a moment ago」. On a read path the gap is
   * survivable. On a kill path it is the whole risk.
   *
   * ⛔ AND IT IS NOT REPORTED AS A KILL. The original may well have stopped — but the slot
   * now holds a stranger, so that cannot be proven THROUGH it, and a control that says
   * 「killed」 on an unprovable state is back to appearance standing in for proof.
   */
  const reused = Object.assign({}, REAL, { incarnation: 'inc-SOMEONE-ELSE-later' })
  const os = fakeOs({ procs: [REAL], afterStop: [reused] })
  const r = K.killObserver({ os })
  assert.deepEqual(os.calls.terminate, [], '⛔ it terminated a process that merely inherited the PID')
  assert.equal(r.outcome, 'identity_changed', 'outcome was: ' + r.outcome)
  assert.equal(r.ok, false, '⛔ a reused PID was reported as a successful kill')
  assert.equal(r.aliveBefore, true, 'the original was proven alive first')
})

test('*** F2. SAME PID, SAME INCARNATION, STILL ALIVE — ESCALATION IS PERMITTED ***', () => {
  // ⛔ The other half, and it has to be here. If the identity is unchanged then the process
  //    we proved IS the process we terminate, and refusing would leave this control unable
  //    to do the one thing it exists for — which is its own kind of failure.
  const os = fakeOs({ procs: [REAL], afterStop: [REAL] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.escalated, true, 'stopTask left it alive, so terminate was required')
  assert.deepEqual(os.calls.terminate, [4242])
  assert.equal(r.aliveAfter, false)
})

test('*** F3. ⛔ PID-ONLY OWNERSHIP EVIDENCE IS REFUSED, NOT SILENTLY ACCEPTED ***', () => {
  /**
   * ⛔ AN ADAPTER THAT CANNOT NAME THE INCARNATION CANNOT ESTABLISH IDENTITY. The tempting
   * reading is 「pids are still better than nothing, proceed」 — which is exactly the
   * fall-back Commit E refused for missing task evidence and Commit D refused for missing
   * session proof. Not proven is refused, and it is refused BY NAME: 「the Observer is not
   * running」 and 「I could not establish what the task owns」 are different facts with
   * different repairs, and collapsing them is how a broken adapter reads as a quiet machine.
   */
  const os = fakeOs({ procs: [REAL], legacyEvidence: true })
  const r = K.killObserver({ os })
  assert.equal(r.outcome, 'no_task_ownership_evidence', 'outcome was: ' + r.outcome)
  assert.notEqual(r.outcome, 'no_target', '⛔ missing evidence was reported as an absent Observer')
  assert.deepEqual(os.calls.terminate, [])
  assert.deepEqual(os.calls.stopTask, [], '⛔ it stopped the task on evidence it had refused')
})

test('*** F4. ⛔ NotAromaOperator IS NOT AromaOperator ***', () => {
  /**
   * ⛔ THE CHECK WAS `account.endsWith("aromaoperator")`, so `AROMABRAIN\\NotAromaOperator`
   * satisfied it — as would any account anyone can create whose name happens to end in those
   * fourteen characters. Same family as the four findings before it: textual similarity
   * standing in for identity. The final segment of the principal is compared exactly.
   */
  const bad = ['AROMABRAIN\\NotAromaOperator', 'AROMABRAIN\\XAromaOperator', 'AROMABRAIN\\aromaoperator2',
    'AromaOperatorBackup', 'AROMABRAIN\\NOT-AromaOperator', 'aromaoperator\\notaromaoperator']
  for (const account of bad) {
    const proc = Object.assign({}, REAL, { account })
    const os = fakeOs({ procs: [proc], account })
    const r = K.killObserver({ os })
    assert.equal(r.outcome, 'no_target', '⛔ accepted as the fixed account: ' + account)
    assert.deepEqual(os.calls.terminate, [], '⛔ terminated under: ' + account)
  }
})

test('*** F5. THE FIXED PRINCIPAL IS STILL ACCEPTED, IN EITHER SEPARATOR AND ANY CASE ***', () => {
  // ⛔ The narrowing must not become a refusal of the real thing — a kill switch that cannot
  //    recognise its own target is as useless as one that recognises everything.
  for (const account of ['AROMABRAIN\\AromaOperator', 'aromabrain\\aromaoperator', 'AromaOperator', '.\\AromaOperator']) {
    const proc = Object.assign({}, REAL, { account })
    const os = fakeOs({ procs: [proc], account })
    assert.equal(K.killObserver({ os }).ok, true, '⛔ refused the fixed account: ' + account)
  }
})

test('*** F6. ⛔ A PROCESS THAT REPORTS NO INCARNATION IS NEVER A TARGET ***', () => {
  // ⛔ Fail closed on the process side too. A record with no incarnation cannot be shown to
  //    be the one the task owns, so it is not one — 「probably the same」 is not identity.
  const vague = Object.assign({}, REAL); delete vague.incarnation
  const os = fakeOs({ procs: [vague] })
  const r = K.killObserver({ os })
  assert.equal(r.outcome, 'no_target')
  assert.deepEqual(os.calls.terminate, [])
})

test('*** F7. ⛔ A MISMATCHED INCARNATION IS NOT A TARGET EVEN BEFORE THE STOP ***', () => {
  // ⛔ The same reuse can have happened BEFORE we ever looked: the task is idle, its recorded
  //    PID has been handed on, and the new holder wears the costume. Identity is checked on
  //    the way in, not only on the way out.
  const stale = Object.assign({}, REAL, { incarnation: 'inc-A-DIFFERENT-PROCESS' })
  const os = fakeOs({ procs: [stale] })
  const r = K.killObserver({ os })
  assert.equal(r.outcome, 'no_target', '⛔ a PID-reusing stranger was a kill target')
  assert.deepEqual(os.calls.terminate, [])
  assert.deepEqual(os.calls.stopTask, [])
})

test('*** F8. THE MODULE STILL OWNS THE IDENTITY, THE CALLER NEVER DOES ***', () => {
  // ⛔ Commit E moved the target from a caller-supplied pid to task ownership. The incarnation
  //    must not quietly reopen that door: a caller cannot name the incarnation it wants dead
  //    any more than it can name the pid, the account or the task.
  const os = fakeOs({ procs: [REAL] })
  const r = K.killObserver({ os, pid: 4242, incarnation: 'inc-ANYTHING', taskName: 'SomeOtherTask', account: 'AROMABRAIN\\Administrator', scriptPath: 'c:\\evil.ps1' })
  assert.equal(r.ok, true)
  assert.deepEqual(os.calls.taskAsked, [K.TASK_NAME], '⛔ the caller chose which task was asked about')
  assert.deepEqual(os.calls.stopTask, [K.TASK_NAME])
})
