'use strict'
/**
 * launcherPin.test.js — L-1 ②. The launcher is pinned, and the pin lives where she cannot reach it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE CIRCULARITY THIS CLOSES, AND WHAT PAID FOR IT.
 *
 * A check she performs on a file she can edit is worth nothing if she can also edit the check.
 * As of `d54c3ed` there is somewhere to put it: `src/governance/` is forbidden BY LOCATION.
 *
 * > **This is the first thing the migration paid for.** Before it, there was nowhere to put a
 * > checker that the thing being checked could not rewrite.
 *
 * ⛔ AND IT REPORTS, NEVER REFUSES. A legitimate flag edit must not brick her — the thing that
 * would repair a refused start is the thing that refused to start. L2-1's shape, same answer.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { checkLauncher, SHIM_PATH, BODY_REL, PIN, LAUNCHER } = require('./launcherPin')
const { isForbiddenFile } = require('../agent/workOrder')

const REPO = path.join(__dirname, '..', '..')

describe('⛔ the pin lives inside the protected path', () => {
  test('the checker itself is un-allowlistable', () => {
    assert.strictEqual(isForbiddenFile('src/governance/launcherPin.js'), true,
      'a checker she could edit is not a check')
  })
})

describe('① the shim carries nothing worth hiding', () => {
  test('⛔ the shim carries no configuration', () => {
    const shim = fs.readFileSync(SHIM_PATH, 'utf8')
    // A flag here would be a flag with no history — the whole reason the body moved.
    assert.doesNotMatch(shim, /\$env:/, 'no environment variable may be set in the shim')
    assert.ok(shim.length < 2500, 'the shim must stay small enough that any change is obvious')
    assert.match(shim, /xiangxiang-body\.ps1/, 'it must hand off to the body')
  })

  test('the body exists at the pinned path, in the repo', () => {
    const body = path.join(REPO, BODY_REL)
    assert.ok(fs.existsSync(body), BODY_REL + ' must exist — the shim invokes it by absolute path')
    assert.match(fs.readFileSync(body, 'utf8'), /\$env:/, 'the body is where the flags actually live')
  })

  test('the launcher body IS in the monthly backup sources', () => {
    // §4 — a separate defect: the one file that starts everything had no copy.
    const monthly = fs.readFileSync(path.join(REPO, 'scripts', 'backup', 'Monthly-OfflineBackup.ps1'), 'utf8')
    assert.match(monthly, /launcher/i, 'the launcher must be backed up like everything else')
  })
})

describe('② the check answers three ways, and never throws', () => {
  test('the live shim matches its pin', () => {
    const r = checkLauncher()
    assert.strictEqual(r.state, 'MATCH', r.saying)
  })

  test('⛔ a mismatch NEVER throws — it reports', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'))
    const fake = path.join(d, 'shim.ps1')
    fs.writeFileSync(fake, '# something else entirely')
    let r
    assert.doesNotThrow(() => { r = checkLauncher({ shimPath: fake }) })
    assert.strictEqual(r.state, 'CHANGED')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ SEEN TO FAIL — a modified shim is DETECTED, byte for byte', () => {
    // A guard never observed failing is not evidence. This takes the real shim, changes ONE
    // character, and shows the check catches it.
    const real = fs.readFileSync(SHIM_PATH, 'utf8')
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'))
    const tampered = path.join(d, 'shim.ps1')
    fs.writeFileSync(tampered, real + ' ')
    const r = checkLauncher({ shimPath: tampered })
    assert.strictEqual(r.state, 'CHANGED', 'one trailing space must be enough')
    assert.match(r.saying, /改過|唔同/)
    assert.ok(r.actual && r.expected && r.actual !== r.expected, 'both hashes are reported as evidence')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ a MISSING shim is UNKNOWN, not MATCH and not CHANGED', () => {
    // 「I could not look」 is its own state — HR-23. Reporting a missing file as unchanged would
    // be the calmest possible lie.
    const r = checkLauncher({ shimPath: path.join(os.tmpdir(), 'definitely-not-here-' + Date.now() + '.ps1') })
    assert.strictEqual(r.state, 'UNREADABLE')
  })

  test('the pin is a full sha256, not a prefix', () => {
    assert.match(PIN, /^[0-9a-f]{64}$/, 'a truncated hash is a weaker claim wearing the same word')
  })
})

describe('⛔ the check runs at STARTUP, so it is not 「remember to check」', () => {
  test('index.js calls the check at startup', () => {
    const idx = fs.readFileSync(path.join(REPO, 'src', 'index.js'), 'utf8')
    assert.match(idx, /checkLauncher/, 'every restart must be a check; nobody has to remember')
  })

  test('⛔ index.js does NOT exit or throw on a mismatch', () => {
    const idx = fs.readFileSync(path.join(REPO, 'src', 'index.js'), 'utf8')
    const i = idx.indexOf('checkLauncher')
    const near = idx.slice(Math.max(0, i - 200), i + 900)
    assert.doesNotMatch(near, /process\.exit|throw /,
      'refusing to start would brick her on a legitimate flag edit, and the thing that repairs a refused start is the thing that refused to start')
  })

  test('LAUNCHER names both halves, so a reader can find them', () => {
    assert.ok(LAUNCHER.shim && LAUNCHER.body)
  })
})

describe('what the pin does NOT claim', () => {
  test('⛔ it detects; it does not prevent', () => {
    // Stated in the module so nobody later reads a hash as a lock. Anything running as the
    // Owner can change the shim, the body, the pin and the checker, in that order.
    const src = fs.readFileSync(path.join(__dirname, 'launcherPin.js'), 'utf8')
    assert.match(src, /偵測|detect/i)
    assert.match(src, /唔係防止|not prevention/i)
  })

  test('the expected hash is recomputable by hand, and the command is in the file', () => {
    const src = fs.readFileSync(path.join(__dirname, 'launcherPin.js'), 'utf8')
    assert.match(src, /sha256/i, 'he must be able to re-derive the pin without trusting this code')
    // and prove the stated algorithm is the one used
    const live = crypto.createHash('sha256').update(fs.readFileSync(SHIM_PATH)).digest('hex')
    assert.strictEqual(live, PIN)
  })
})
