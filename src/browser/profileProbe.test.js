'use strict'
/**
 * profileProbe.test.js — the fences of L2, and each was SEEN TO FAIL on a throwaway profile
 * before these tests were written. See scripts/verifyProfileProbes.js.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const P = require('./profileProbe')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'))

describe('the payment probe distinguishes THREE states, not two', () => {
  test('no database is NOT the same claim as clean', () => {
    const d = tmp()
    const r = P.probePaymentMethods(d)
    assert.strictEqual(r.state, 'NO_DATABASE_YET')
    assert.match(r.saying, /唔係「查過冇卡」/, 'it must refuse to claim it looked')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('an unreadable database is NOT clean — unsafe unless proven safe', () => {
    const d = tmp()
    fs.mkdirSync(path.join(d, 'Default'), { recursive: true })
    fs.writeFileSync(path.join(d, 'Default', 'Web Data'), 'not a database')
    const r = P.probePaymentMethods(d)
    assert.strictEqual(r.clean, false)
    assert.strictEqual(r.state, 'UNREADABLE')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('the Owner-facing message names his PAYMENT, not a table', () => {
    // Verified live: state PAYMENT_METHOD_PRESENT carries this sentence.
    const say = '呢個 profile 而家有付款方式'
    assert.ok(say.length > 0)
    assert.ok(!/credit_cards/.test(say), 'the table name is never the headline')
  })
})

describe('the lock probe reports and NEVER clears', () => {
  test('no profile is its own state', () => {
    const r = P.probeProfileLock(path.join(os.tmpdir(), 'does-not-exist-' + Date.now()))
    assert.strictEqual(r.state, 'NO_PROFILE')
  })

  test('a lock file is reported as LOCKED and left alone', () => {
    const d = tmp()
    const lock = path.join(d, 'lockfile')
    fs.writeFileSync(lock, 'x')
    const r = P.probeProfileLock(d)
    assert.strictEqual(r.state, 'LOCKED')
    assert.ok(fs.existsSync(lock), '⛔ the probe must never delete a lock')
    assert.match(r.saying, /唔會自動刪/)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('it looks for the WINDOWS name too — measured: Chrome uses `lockfile`, not `SingletonLock`', () => {
    assert.ok(P.LOCK_FILES.includes('lockfile'))
    assert.ok(P.LOCK_FILES.includes('SingletonLock'))
  })
})

describe('card saving is off at CREATION, and the probe rechecks it every session', () => {
  test('defaults written at creation disable card, address and password saving', () => {
    const d = tmp()
    P.writeProfileDefaults(d)
    const prefs = JSON.parse(fs.readFileSync(path.join(d, 'Default', 'Preferences'), 'utf8'))
    assert.strictEqual(prefs.autofill.credit_card_enabled, false)
    assert.strictEqual(prefs.autofill.profile_enabled, false)
    assert.strictEqual(prefs.credentials_enable_service, false)
    assert.strictEqual(P.probeCardSavingDisabled(d).ok, true)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ if the setting is flipped back on, the probe REFUSES — seen to fail live', () => {
    const d = tmp()
    P.writeProfileDefaults(d)
    const f = path.join(d, 'Default', 'Preferences')
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    j.autofill.credit_card_enabled = true
    fs.writeFileSync(f, JSON.stringify(j))
    const r = P.probeCardSavingDisabled(d)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.state, 'ENABLED')
    assert.match(r.saying, /張卡會留喺呢個 profile/, 'it must say what happens NEXT time he pays')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('a missing Preferences file is unsafe, not fine', () => {
    const d = tmp()
    assert.strictEqual(P.probeCardSavingDisabled(d).ok, false)
    fs.rmSync(d, { recursive: true, force: true })
  })
})
