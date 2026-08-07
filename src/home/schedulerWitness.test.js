'use strict'
/**
 * schedulerWitness.test.js — WITNESS #1: what Windows says about the task.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「DID_NOT_RUN needs both witnesses you specified — the task failing in Windows,
 * > and the registry noticing the gap via nextRunAt. One is not enough, and the registry half
 * > is the one that catches a trigger that never fired.」**
 *
 * This is the Windows half. It answers 「係咪真係有個 task,而佢有冇行過」 — from the Task
 * Scheduler itself, not from anything she wrote about herself.
 *
 * ⛔ AND IT IS WHY `scheduled` IS MEASURED RATHER THAN DECLARED.
 *
 * The instruction was to flip `scheduled: true` in the same round, 「so the DUE sentence changes
 * meaning at the moment the meaning changes」. A hand-edited boolean changes meaning when I edit
 * it — which is BEFORE the task is registered and AFTER it is ever removed. In both gaps the
 * briefing would state the opposite of the truth, and the second gap is the dangerous one: a
 * deleted task would still be described as scheduled, and its silence would read as calm.
 *
 * Measuring it closes both gaps by construction. The literal instruction, implemented literally.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { readSchedulerWitness, WITNESS, TASK_NAME } = require('./schedulerWitness')

/** A fake `powershell -Command` that returns whatever JSON the test wants. */
const exec = (out, err) => async () => {
  if (err) throw new Error(err)
  return out
}

describe('it reports what Windows says, and never more', () => {
  test('no such task → NOT_INSTALLED, and that is a fact not a failure', async () => {
    const w = await readSchedulerWitness({ exec: exec(JSON.stringify({ found: false })), now: 1000, cache: false })
    assert.strictEqual(w.state, WITNESS.NOT_INSTALLED)
    assert.strictEqual(w.scheduled, false, 'nothing is scheduled, so nothing may claim to be')
  })

  test('a registered, enabled, healthy task → INSTALLED, scheduled true', async () => {
    const w = await readSchedulerWitness({
      exec: exec(JSON.stringify({ found: true, state: 'Ready', lastTaskResult: 0, lastRunTime: '2026-08-07T07:00:00', nextRunTime: '2026-08-08T07:00:00' })),
      now: Date.parse('2026-08-07T12:00:00Z'),
      cache: false
    })
    assert.strictEqual(w.state, WITNESS.INSTALLED)
    assert.strictEqual(w.scheduled, true)
    assert.strictEqual(w.healthy, true)
  })

  test('⛔ a DISABLED task is not a scheduled task', async () => {
    // The quietest way for a schedule to stop: still present, still listed, never fires.
    const w = await readSchedulerWitness({
      exec: exec(JSON.stringify({ found: true, state: 'Disabled', lastTaskResult: 0 })),
      now: 1000,
      cache: false
    })
    assert.strictEqual(w.state, WITNESS.DISABLED)
    assert.strictEqual(w.scheduled, false, 'a task that cannot fire must not make the briefing say 「scheduled」')
  })

  test('⛔ a non-zero last result is reported as UNHEALTHY, carrying the code', async () => {
    const w = await readSchedulerWitness({
      exec: exec(JSON.stringify({ found: true, state: 'Ready', lastTaskResult: 1, lastRunTime: '2026-08-07T07:00:00' })),
      now: Date.parse('2026-08-07T12:00:00Z'),
      cache: false
    })
    assert.strictEqual(w.healthy, false)
    assert.match(w.saying, /1\b/, 'the exit code is the thing he would search for')
    // 0x1 is the exact failure the backup tasks hit — a scheduler logon that could not see
    // user-profile files. Worth naming, since the same trap waits for anything under the profile.
    assert.match(w.saying, /0x1|退出碼|exit/i)
  })

  test('⛔ UNREADABLE is not NOT_INSTALLED — 「I could not look」 ≠ 「it is not there」', async () => {
    const w = await readSchedulerWitness({ exec: exec(null, 'access denied'), now: 1000, cache: false })
    assert.strictEqual(w.state, WITNESS.UNREADABLE)
    assert.strictEqual(w.scheduled, null,
      'unknown must be null — false would claim a fact this witness failed to establish')
  })

  test('garbage from the shell is UNREADABLE, not a silently-parsed truth', async () => {
    const w = await readSchedulerWitness({ exec: exec('not json at all'), now: 1000, cache: false })
    assert.strictEqual(w.state, WITNESS.UNREADABLE)
  })
})

describe('it does not spawn a shell on every briefing', () => {
  test('the result is cached, and the cache is per-TTL not forever', async () => {
    let calls = 0
    const counting = async () => { calls++; return JSON.stringify({ found: false }) }
    const t0 = 1000000
    await readSchedulerWitness({ exec: counting, now: t0, cacheKey: 'k1' })
    await readSchedulerWitness({ exec: counting, now: t0 + 5000, cacheKey: 'k1' })
    assert.strictEqual(calls, 1, 'a briefing build must not cost a subprocess every time')
    await readSchedulerWitness({ exec: counting, now: t0 + 10 * 60 * 1000, cacheKey: 'k1' })
    assert.strictEqual(calls, 2, 'but it must not go stale forever either')
  })
})

describe('the task name is one constant, shared with the install script', () => {
  test('⛔ the name the code looks for is the name the script registers', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const ps1 = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'scheduler', 'aroma-errand-task.ps1'), 'utf8')
    assert.ok(ps1.includes(TASK_NAME),
      'if these drift, the witness reports NOT_INSTALLED for a task that exists — and the ' +
      'briefing would say 「手動」 about something running on a timer')
  })
})
