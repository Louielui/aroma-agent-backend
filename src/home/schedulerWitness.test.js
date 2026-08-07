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

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ SCHED_S_* ARE STATUSES, NOT FAILURES. FOUND THE MINUTE THE TASK WAS REGISTERED.
 *
 * A freshly registered task reports `LastTaskResult = 267011` and `LastRunTime = 1999-11-30`.
 * That is `SCHED_S_TASK_HAS_NOT_RUN` and Windows' never-ran epoch — **the task is perfectly
 * healthy and has simply not fired yet.**
 *
 * The first version tested `code === 0`, so the briefing said 「上次行嗰次 Windows 報失敗,退出碼
 * 267011」 within seconds of a clean install — and appended the 0x1 profile-visibility hint,
 * which had nothing to do with anything. **A brand-new healthy task described as a failing one**,
 * and, worse, the first thing he would have read after approving the install.
 *
 * The 0x41300-family are informational. Some mean trouble (TERMINATED, NO_VALID_TRIGGERS) and
 * some do not (HAS_NOT_RUN, RUNNING, READY) — they must not be lumped together under 「≠ 0」.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('⛔ a task that has never run is not a task that failed', () => {
  const w = (lastTaskResult, lastRunTime) => readSchedulerWitness({
    exec: exec(JSON.stringify({ found: true, state: 'Ready', lastTaskResult, lastRunTime: lastRunTime || '1999-11-30T00:00:00' })),
    now: Date.parse('2026-08-07T12:00:00Z'),
    cache: false
  })

  test('267011 SCHED_S_TASK_HAS_NOT_RUN → not unhealthy, and says it has not run', async () => {
    const r = await w(267011)
    assert.notStrictEqual(r.healthy, false, 'a fresh install must not be described as failing')
    assert.match(r.saying, /未行過|冇行過/)
    assert.doesNotMatch(r.saying, /0x1 /, 'the profile-visibility hint is about code 1, not about this')
  })

  test('the 1999-11-30 never-ran epoch is not reported as a real last-run time', async () => {
    const r = await w(267011)
    assert.strictEqual(r.lastRunAt, null, '1999 is a sentinel, not a date he should be shown')
  })

  test('267009 RUNNING and 267008 READY are also not failures', async () => {
    for (const code of [267009, 267008]) {
      assert.notStrictEqual((await w(code)).healthy, false, code + ' is a status')
    }
  })

  test('⛔ but 267014 TERMINATED and 267015 NO_VALID_TRIGGERS ARE trouble, and say which', async () => {
    const term = await w(267014, '2026-08-07T07:00:00')
    assert.strictEqual(term.healthy, false)
    assert.match(term.saying, /終止|時限/)
    const notrig = await w(267015, '2026-08-07T07:00:00')
    assert.strictEqual(notrig.healthy, false)
    assert.match(notrig.saying, /trigger/i)
  })

  test('a real exit code 1 still gets the profile-visibility hint — it is the measured trap', async () => {
    const r = await w(1, '2026-08-07T07:00:00')
    assert.strictEqual(r.healthy, false)
    assert.match(r.saying, /0x1/)
    assert.match(r.saying, /profile/i)
  })

  test('0 with a real run time is healthy', async () => {
    const r = await w(0, '2026-08-07T07:00:00')
    assert.strictEqual(r.healthy, true)
  })
})
