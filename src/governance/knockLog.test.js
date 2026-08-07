'use strict'
/**
 * knockLog.test.js — who knocked on the scheduled door, and when.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「The knock log matters more than the interval — an endpoint that cannot say who
 * > called it is one I cannot audit, and today three of six calls left no trace anywhere except
 * > a field on a row.」**
 *
 * Measured 2026-08-07: the errand endpoint was invoked SIX times in 45 minutes. Only three
 * appeared in any log, because the only log was written by the PowerShell wrapper — CLIENT
 * side. The three direct calls were invisible; their existence had to be inferred from a
 * `trigger` field on stored rows.
 *
 * ⛔ A door that records nothing cannot distinguish 「nobody called」 from 「I did not look」.
 * That is the same shape as every other finding this week, applied to an entry point.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openKnockLog } = require('./knockLog')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'knock-'))
const T = new Date('2026-08-07T12:00:00Z').getTime()

describe('every knock is recorded, accepted or refused', () => {
  test('an accepted knock is written with its time and caller', () => {
    const d = tmp(); const k = openKnockLog(d)
    k.record({ at: T, verdict: 'ACCEPTED', caller: '127.0.0.1', agent: 'powershell' })
    const rows = k.list()
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].verdict, 'ACCEPTED')
    assert.strictEqual(rows[0].caller, '127.0.0.1')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ a REFUSED knock is recorded too — that is the interesting one', () => {
    // A rate-limited call that leaves no trace is a caller you cannot see. The refusals are
    // precisely the evidence that something is hammering the door.
    const d = tmp(); const k = openKnockLog(d)
    k.record({ at: T, verdict: 'TOO_SOON', caller: '127.0.0.1' })
    assert.strictEqual(k.list()[0].verdict, 'TOO_SOON')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('it never stores an authorization header or any token-shaped value', () => {
    const d = tmp(); const k = openKnockLog(d)
    k.record({ at: T, verdict: 'ACCEPTED', caller: '127.0.0.1', authorization: 'Bearer secret-token-here', token: 'abc' })
    const raw = JSON.stringify(k.list())
    assert.ok(!raw.includes('secret-token-here'))
    assert.ok(!raw.includes('Bearer'))
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('the minimum interval, and it is answered from the LOG not from memory', () => {
  test('a second knock inside the window is TOO_SOON', () => {
    const d = tmp(); const k = openKnockLog(d)
    k.record({ at: T, verdict: 'ACCEPTED', caller: 'x' })
    const v = k.mayRun(T + 5 * 60 * 1000, 60 * 60 * 1000)
    assert.strictEqual(v.ok, false)
    assert.match(v.saying, /分鐘|鐘/)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('outside the window it may run', () => {
    const d = tmp(); const k = openKnockLog(d)
    k.record({ at: T, verdict: 'ACCEPTED', caller: 'x' })
    assert.strictEqual(k.mayRun(T + 61 * 60 * 1000, 60 * 60 * 1000).ok, true)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ only ACCEPTED knocks start the clock — a refusal must not extend the ban', () => {
    // Otherwise a caller retrying every minute could keep itself locked out forever, and the
    // window would measure the retry loop rather than the last real run.
    const d = tmp(); const k = openKnockLog(d)
    k.record({ at: T, verdict: 'ACCEPTED', caller: 'x' })
    k.record({ at: T + 30 * 60 * 1000, verdict: 'TOO_SOON', caller: 'x' })
    assert.strictEqual(k.mayRun(T + 61 * 60 * 1000, 60 * 60 * 1000).ok, true)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('the first knock ever is always allowed', () => {
    const d = tmp(); const k = openKnockLog(d)
    assert.strictEqual(k.mayRun(T, 60 * 60 * 1000).ok, true)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ an unreadable log REFUSES rather than assuming it is safe to run', () => {
    // Fail closed: 「I cannot tell when it last ran」 must not become 「therefore run it」.
    // The failure mode this prevents is the one that just happened — repeated hammering.
    const d = tmp()
    fs.writeFileSync(path.join(d, 'knocks.json'), '{ not json')
    const k = openKnockLog(d)
    const v = k.mayRun(T, 60 * 60 * 1000)
    assert.strictEqual(v.ok, false)
    assert.match(v.saying, /讀唔到|睇唔到/)
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('it does not grow without bound', () => {
  test('the log is capped and keeps the newest', () => {
    const d = tmp(); const k = openKnockLog(d)
    for (let i = 0; i < 600; i++) k.record({ at: T + i * 1000, verdict: 'ACCEPTED', caller: 'x' })
    const rows = k.list()
    assert.ok(rows.length <= 500, 'capped')
    assert.strictEqual(rows[rows.length - 1].at, T + 599 * 1000, 'the newest survives')
    fs.rmSync(d, { recursive: true, force: true })
  })
})
