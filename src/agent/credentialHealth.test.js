'use strict'

/**
 * credentialHealth.test.js — the login check, and the field it is actually keyed to.
 *
 * The brief said "read expiresAt, warn under 7 days, refuse when expired". Measured right
 * after a fresh /login on this machine, `expiresAt` was +8 HOURS and
 * `refreshTokenExpiresAt` was +27 days: `expiresAt` is the ACCESS token, which the CLI
 * renews by itself. Keying the rule to it would have warned on every run and refused every
 * morning — a check that cries wolf is one the Owner clicks past.
 *
 * So the refusal and the warning are keyed to the REFRESH token, which is what actually
 * requires typing /login again. These tests pin that choice, including the case that would
 * have been wrong.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { checkCredentialHealth, loginHint, STATE, WARN_DAYS } = require('./credentialHealth')

const NOW = Date.parse('2026-08-03T00:00:00.000Z')
const days = (n) => NOW + n * 24 * 60 * 60 * 1000

function creds (over) {
  return JSON.stringify({
    claudeAiOauth: Object.assign({
      accessToken: 'ACCESS-TOKEN-VALUE-MUST-NEVER-APPEAR',
      refreshToken: 'REFRESH-TOKEN-VALUE-MUST-NEVER-APPEAR',
      expiresAt: days(0.3),
      refreshTokenExpiresAt: days(27),
      scopes: ['a', 'b'],
      subscriptionType: 'max'
    }, over || {})
  })
}

const check = (text, over) => checkCredentialHealth(Object.assign({
  now: () => NOW,
  readFileFn: () => (typeof text === 'function' ? text() : text)
}, over || {}))

/* ── 1. the healthy case, and the one that would have been wrong ──────────── */

test('*** a fresh login is ok, even though the ACCESS token expires in hours ***', () => {
  const h = check(creds())
  assert.equal(h.state, STATE.OK)
  assert.equal(h.canRun, true)
  assert.equal(h.warning, null, 'no warning — the refresh token has 27 days')
  assert.equal(h.daysLeft, 27)
})

test('*** an EXPIRED access token with a live refresh token still runs ***', () => {
  // This is the normal morning state. The CLI renews it. Refusing here would have made
  // the feature unusable after eight hours.
  const h = check(creds({ expiresAt: days(-0.5) }))
  assert.equal(h.canRun, true)
  assert.equal(h.state, STATE.OK)
  assert.equal(h.accessTokenValid, false, 'and it is REPORTED, just not acted on')
})

test('*** POSITIVE CONTROL — keying the rule to expiresAt would have refused ***', () => {
  // The rule as originally briefed, applied to the same fixture.
  const parsed = JSON.parse(creds({ expiresAt: days(-0.5) })).claudeAiOauth
  assert.equal(parsed.expiresAt <= NOW, true, 'expiresAt says expired')
  assert.equal(parsed.refreshTokenExpiresAt > NOW, true, 'while the login is perfectly good')
  assert.equal(check(creds({ expiresAt: days(-0.5) })).canRun, true, 'and we run anyway')
})

/* ── 2. the states that stop or warn ──────────────────────────────────────── */

test('*** a refresh token inside the warning window runs, but says so ***', () => {
  const h = check(creds({ refreshTokenExpiresAt: days(3) }))
  assert.equal(h.state, STATE.EXPIRING_SOON)
  assert.equal(h.canRun, true, 'a heads-up, not a gate')
  assert.match(h.warning, /還有 3 日到期/)
  assert.match(h.warning, /login/)
  assert.equal(h.daysLeft, 3)
})

test('*** exactly at the boundary is still a warning, and outside it is silence ***', () => {
  assert.equal(check(creds({ refreshTokenExpiresAt: days(WARN_DAYS - 0.1) })).state, STATE.EXPIRING_SOON)
  assert.equal(check(creds({ refreshTokenExpiresAt: days(WARN_DAYS + 0.1) })).state, STATE.OK)
})

test('*** an expired refresh token REFUSES, and says exactly how to fix it ***', () => {
  const h = check(creds({ refreshTokenExpiresAt: days(-1) }))
  assert.equal(h.state, STATE.EXPIRED)
  assert.equal(h.canRun, false)
  assert.match(h.refusal, /登入已經過期/)
  assert.match(h.refusal, /claude\.exe/, 'the absolute path, because a bare `claude` is blocked')
  assert.match(h.refusal, /login/)
})

/* ── 3. unknown is never assumed usable ───────────────────────────────────── */

test('*** every unreadable state refuses — the Owner\'s rule ***', () => {
  const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' })
  const cases = [
    [() => { throw enoent }, STATE.ABSENT, 'no file at all'],
    [() => { throw new Error('EACCES') }, STATE.UNREADABLE, 'unreadable file'],
    [() => 'not json', STATE.UNREADABLE, 'unparseable'],
    [() => JSON.stringify({ somethingElse: true }), STATE.UNREADABLE, 'no oauth block'],
    [() => creds({ refreshToken: '' }), STATE.UNREADABLE, 'no refresh token'],
    [() => creds({ accessToken: '' }), STATE.UNREADABLE, 'no access token'],
    [() => JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'b' } }), STATE.UNREADABLE, 'no expiry recorded']
  ]
  for (const [fn, state, label] of cases) {
    const h = check(fn)
    assert.equal(h.state, state, label)
    assert.equal(h.canRun, false, label + ' must not run')
    assert.ok(h.refusal && h.refusal.length > 20, label + ' must explain itself')
  }
})

/* ── 4. the tokens themselves never leave ─────────────────────────────────── */

test('*** no token value appears anywhere in the result, in any state ***', () => {
  const NEEDLES = ['ACCESS-TOKEN-VALUE-MUST-NEVER-APPEAR', 'REFRESH-TOKEN-VALUE-MUST-NEVER-APPEAR']
  const states = [creds(), creds({ refreshTokenExpiresAt: days(3) }), creds({ refreshTokenExpiresAt: days(-1) })]
  for (const c of states) {
    const serialized = JSON.stringify(check(c))
    for (const n of NEEDLES) assert.equal(serialized.includes(n), false, 'a token reached the result')

    // Stronger, and about VALUES rather than field names: `accessTokenValid` is a boolean
    // and is fine — what must not exist is any long opaque string, which is what a token
    // looks like. This catches a leak I did not think to name a needle for.
    const walk = (v) => {
      if (typeof v === 'string') {
        assert.equal(/^[A-Za-z0-9_\-.]{24,}$/.test(v), false, 'a token-shaped value is present: ' + v.length + ' chars')
        return
      }
      if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(check(c))
  }
})

test('*** the module has no path that could log or return a token ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'credentialHealth.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/console\./.test(code), false, 'it never logs')
  // The token fields are only ever tested for presence, never bound to a name.
  assert.match(code, /typeof o\.accessToken === 'string' && o\.accessToken\.length > 0/)
  assert.equal(/=\s*o\.accessToken\b/.test(code), false, 'the value is never assigned')
  assert.equal(/=\s*o\.refreshToken\b/.test(code), false, 'nor the refresh token')
})

test('*** the fix instruction carries the absolute path and says why ***', () => {
  const hint = loginHint('C:\\some\\claude.exe')
  assert.match(hint, /C:\\some\\claude\.exe/)
  assert.match(hint, /PowerShell/, 'the Owner hit this; the reason is recorded where it is needed')
})
