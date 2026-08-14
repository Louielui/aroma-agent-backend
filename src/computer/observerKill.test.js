'use strict'

/**
 * observerKill.test.js — E0-W1 COMMIT B. The stop control the three demonstrated bindings miss.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE GAP, STATED IN CODE ON THE 3b BRANCH AND CORRECT.
 *
 * The Observer is NOT the Companion. It is a separate process started by a fixed scheduled
 * task, so the Companion can neither start it nor stop it. Asked plainly — does killing A stop
 * B — the answer is no, and all three bindings demonstrated in 3a miss it:
 *
 *   serviceGate     stops the NEXT step being dispatched. An observation already running in
 *                   another process is not dispatched through the gate and continues.
 *   companionAbort  stops the Companion. The Observer has no parent-child relationship with it.
 *   osBackstop      destroys the IPC channel. The Observer does not use it to do its work.
 *
 * > **「It will stop by itself shortly」 is not a kill switch.** A bound is not a control.
 *
 * ⛔ AND THIS COMMIT DOES NOT MAKE IT DEMONSTRATED. Code existing is not a demonstration
 * against a real process, and `observerKillDemonstrated` stays false until one happens with
 * the Owner watching. A test may not flip that bit; K8 exists to make sure none does.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const K = require('./observerKill')
const { KILL_SWITCH_BINDINGS } = require('./killSwitch')

/** A deterministic fake OS. No task, no process, no PowerShell is ever touched by this suite. */
function fakeOs (over = {}) {
  const calls = { stopTask: [], terminate: [], listed: 0 }
  let procs = over.procs || []
  return {
    calls,
    listProcesses () { calls.listed++; return procs.slice() },
    stopTask (name) {
      calls.stopTask.push(name)
      if (over.stopTaskFails) return { ok: false, error: 'access denied' }
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

/** Exactly the shape the fixed task launches. */
const REAL = {
  pid: 4242,
  name: 'powershell.exe',
  commandLine: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\AromaOperator-Probe\\observer.ps1 -Action list_windows -OutJson C:\\Aroma\\ComputerOperator-Evidence\\observer-result.json'
}

/* ═══ K1 / K6 — success needs BOTH halves ═══════════════════════════════════ */

test('*** K1. ⛔ SUCCESS REQUIRES ALIVE-BEFORE AND ABSENT-AFTER ***', () => {
  const os = fakeOs({ procs: [REAL] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.aliveBefore, true, 'it proved the target was running')
  assert.equal(r.aliveAfter, false, 'and proved it is gone')
  assert.equal(r.pid, 4242)
  assert.deepEqual(os.calls.stopTask, ['AromaComputerOperator-Observer'])
})

test('*** K6. ⛔ aliveAfter TRUE IS ALWAYS A FAILURE, WHATEVER ELSE SUCCEEDED ***', () => {
  // Both underlying calls report ok; the process is still there. That is not a kill.
  const os = fakeOs({ procs: [REAL], stopTaskLeavesAlive: true, terminateLeavesAlive: true })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false, '⛔ a survivor was reported as killed')
  assert.equal(r.aliveAfter, true)
  assert.equal(r.outcome, 'still_alive')
})

/* ═══ K2 — a zero result is not a kill ══════════════════════════════════════ */

test('*** K2. ⛔ NOTHING TO KILL IS A NAMED NON-SUCCESS, NOT A KILL CLAIM ***', () => {
  /**
   * ⛔ THE VACUOUS PASS THIS WHOLE PROJECT KEEPS FINDING. 「I looked, found nothing, therefore
   * it is stopped」 is the same shape as an assertion that cannot fail. If the Observer was
   * never running, the honest answer is that no kill happened — not that one succeeded.
   */
  const os = fakeOs({ procs: [] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false, '⛔ an empty search reported success')
  assert.equal(r.outcome, 'no_target')
  assert.equal(r.aliveBefore, false)
  assert.deepEqual(os.calls.stopTask, [], 'nothing was stopped')
  assert.deepEqual(os.calls.terminate, [], 'nothing was terminated')
})

/* ═══ K3 — ambiguity kills nothing ══════════════════════════════════════════ */

test('*** K3. ⛔ MORE THAN ONE MATCH KILLS NOTHING ***', () => {
  const os = fakeOs({ procs: [REAL, Object.assign({}, REAL, { pid: 4243 })] })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, 'target_ambiguous')
  assert.equal(r.matched, 2)
  assert.deepEqual(os.calls.terminate, [], '⛔ it killed something while unsure which')
  assert.deepEqual(os.calls.stopTask, [], '⛔ it acted while unsure')
})

test('*** K3b. ⛔ AND IT NEVER KILLS AN ARBITRARY powershell.exe ***', () => {
  /**
   * ⛔ IDENTITY IS THE WHOLE CONTROL. A stop that matches on process NAME would kill the
   * Owner's own shell, a backup job, or this very test run. Three independent things must
   * agree: the exact staged script path, the expected command shape, and the interpreter.
   */
  const strangers = [
    { pid: 1, name: 'powershell.exe', commandLine: 'powershell.exe -NoProfile -File C:\\Users\\louis\\something-else.ps1' },
    { pid: 2, name: 'powershell.exe', commandLine: 'powershell.exe -Command Get-Process' },
    { pid: 3, name: 'node.exe', commandLine: 'node.exe C:\\AromaOperator-Probe\\observer.ps1 -Action list_windows' },
    { pid: 4, name: 'powershell.exe', commandLine: 'powershell.exe -File C:\\Elsewhere\\observer.ps1 -Action list_windows' }
  ]
  const os = fakeOs({ procs: strangers })
  const r = K.killObserver({ os })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, 'no_target', '⛔ a stranger matched: ' + JSON.stringify(r))
  assert.deepEqual(os.calls.terminate, [], '⛔ it terminated a process it did not identify')
})

test('*** K3c. ⛔ NO CALLER-SUPPLIED PID, PATH OR PROCESS NAME IS HONOURED ***', () => {
  // Model or user free text must not be able to name a target. The identity is fixed in code.
  const os = fakeOs({ procs: [{ pid: 99, name: 'powershell.exe', commandLine: 'powershell.exe -File C:\\Anything\\evil.ps1' }] })
  const r = K.killObserver({ os, pid: 99, scriptPath: 'C:\\Anything\\evil.ps1', taskName: 'SomethingElse' })
  assert.equal(r.ok, false)
  assert.equal(r.outcome, 'no_target', '⛔ a caller redirected the kill: ' + JSON.stringify(r))
  assert.deepEqual(os.calls.stopTask, [], '⛔ a caller-named task was stopped')
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
  // ⛔ And then terminate is NOT called. A kill control that always escalates would be
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
  assert.equal(typeof K.TASK_NAME, 'string')
  assert.equal(K.TASK_NAME, 'AromaComputerOperator-Observer')
})

test('*** K8. ⛔ observerKillDemonstrated STAYS FALSE ***', () => {
  /**
   * ⛔ CODE IS NOT A DEMONSTRATION. Every test here runs against a fake OS; not one real task
   * or process was touched. Flipping this bit requires a live run with the Owner watching, and
   * no test may do it — which is exactly what this test is for.
   */
  assert.equal(KILL_SWITCH_BINDINGS.observerKillDemonstrated, false)
})

test('*** K9. ⛔ killingCompanionStopsObserver STAYS FALSE ***', () => {
  // Building a separate control does not change the fact it was needed. Killing the Companion
  // still does not kill the Observer; that disclosure must survive this commit.
  assert.equal(KILL_SWITCH_BINDINGS.killingCompanionStopsObserver, false)
  assert.deepEqual([...KILL_SWITCH_BINDINGS.demonstratedBindings], ['serviceGate', 'companionAbort', 'osFallback'],
    'the three demonstrated bindings are unchanged — observerKill is not among them')
})

/* ═══ DORMANCY ══════════════════════════════════════════════════════════════ */

test('*** K10. ⛔ THE MODULE IS DORMANT — no side effect at require time ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'observerKill.js'), 'utf8')
  // It builds no OS adapter of its own: one must be injected, so requiring it can do nothing.
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
