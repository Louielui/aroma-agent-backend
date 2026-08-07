'use strict'
/**
 * governanceMigration.test.js — is every known fence actually inside the protected path?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「The forbidden rule fails when the migration is incomplete. Show me a fence file
 * > that is still outside the protected path being caught — or if nothing catches it, say so,
 * > because that is the same gap in a new shape.」**
 *
 * ⛔ THE HONEST ANSWER, STATED BEFORE THE TESTS.
 *
 * PROTECTION is now by LOCATION and needs no maintenance: anything under `src/governance/` is
 * un-allowlistable because of where it lives.
 *
 * **INVENTORY is not.** Whether some new fence was placed OUTSIDE that path is still a
 * judgement, and this file is where that judgement is written down. It is a checklist — but a
 * checklist that FAILS LOUDLY instead of sitting silent, which is the difference between this
 * and the list it replaced.
 *
 * > A red test is not a fence. It is a checklist that shouts. That is an improvement, and it is
 * > not the same thing.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { isForbiddenFile, GOVERNANCE_PATH } = require('../agent/workOrder')

const SRC = path.join(__dirname, '..')

/**
 * ⛔ THE INVENTORY. Every module that DEFINES a fence, audited 2026-08-07.
 *
 * `moved: true` means it must live under src/governance/. `moved: false` is a STATED
 * EXCEPTION with a reason — never an omission, and the test asserts the reason exists.
 */
const FENCES = [
  { file: 'governance/originPolicy.js', what: 'government block + origin allowlist', moved: true },
  { file: 'governance/requestFence.js', what: 'L3 — denies every non-GET', moved: true },
  { file: 'governance/paymentStop.js', what: 'L1 — the payment stop', moved: true },
  { file: 'governance/profileProbe.js', what: 'the credential-profile probes', moved: true },
  { file: 'governance/contextCard.js', what: 'the context-card injection envelope', moved: true },
  { file: 'governance/knockLog.js', what: 'the run interval + the knock record', moved: true },
  { file: 'governance/auth.js', what: 'the service token', moved: true },
  { file: 'governance/ownerAuth.js', what: 'the Owner gate', moved: true },
  { file: 'governance/sectionEnvelope.js', what: 'the section-attachment injection envelope', moved: true },
  { file: 'governance/timerAllowlist.js', what: 'which errand kinds a timer may run', moved: true },
  {
    file: 'home/scheduledRun.js',
    what: 'the read-only gate for scheduled runs',
    moved: false,
    // ⛔ A STATED EXCEPTION, NOT AN OMISSION.
    why: 'The GATE moved to governance/timerAllowlist.js; what remains here is the run loop, ' +
      'which is mechanism rather than fence. Moving the loop would put non-governance code ' +
      'behind an un-editable path — see the note on mixed files in the report.'
  }
]

describe('⛔ the protected path protects by LOCATION, with no maintenance', () => {
  test('anything under src/governance/ is un-allowlistable, including a file nobody has written', () => {
    assert.strictEqual(isForbiddenFile('src/governance/a-fence-added-next-year.js'), true,
      'this is the whole point: the NEXT fence is protected by where it lives')
    assert.strictEqual(isForbiddenFile('src/governance/nested/deeper.js'), true)
    assert.strictEqual(GOVERNANCE_PATH, 'src/governance/')
  })

  test('the by-name entries were NOT removed during the move', () => {
    // Removing them while relocating is how a gap opens in the window between two mechanisms.
    for (const f of ['src/app.js', 'src/agent/audit.js', 'src/agent/workOrder.js', 'src/store/store.js']) {
      assert.strictEqual(isForbiddenFile(f), true, f + ' must still be forbidden by name')
    }
  })
})

/**
 * ⛔ PROOF 1 — THE RULE FAILS WHEN THE MIGRATION IS INCOMPLETE.
 */
describe('⛔ an unmigrated fence is CAUGHT', () => {
  test('every fence marked moved:true is inside the protected path AND forbidden', () => {
    const missing = []
    for (const f of FENCES.filter((x) => x.moved)) {
      const abs = path.join(SRC, f.file)
      if (!fs.existsSync(abs)) { missing.push(f.file + ' (file not found)'); continue }
      if (!isForbiddenFile('src/' + f.file)) missing.push(f.file + ' (exists but NOT forbidden)')
    }
    assert.deepStrictEqual(missing, [],
      'a fence outside the protected path is exactly the state this migration exists to end')
  })

  test('⛔ SEEN TO FAIL — a fence at its OLD location would be caught', () => {
    // The proof the Owner asked for. These are the paths the fences used to occupy. If the
    // migration had been left half-done, `isForbiddenFile` would return false for them — and
    // this assertion is what turns that from silence into a red test.
    const oldPaths = [
      'src/browser/originPolicy.js',
      'src/browser/requestFence.js',
      'src/intake/contextCard.js',
      'src/api/auth.js'
    ]
    for (const p of oldPaths) {
      assert.strictEqual(isForbiddenFile(p), false,
        p + ' is NOT protected — which is precisely why leaving a fence there had to be caught')
      assert.ok(!fs.existsSync(path.join(SRC, p.replace(/^src\//, ''))),
        p + ' must no longer exist; if it does, the migration is incomplete and the line above ' +
        'shows it would be unprotected')
    }
  })

  test('⛔ every stated exception carries its reason', () => {
    for (const f of FENCES.filter((x) => !x.moved)) {
      assert.ok(typeof f.why === 'string' && f.why.length > 40,
        f.file + ' is outside the protected path and must say why, or it is an omission wearing a flag')
    }
  })
})

/**
 * ⛔ THE RESIDUAL GAP, ASSERTED SO IT CANNOT BE FORGOTTEN.
 */
describe('what this does NOT protect', () => {
  test('the launcher is outside the repo and no rule here reaches it', () => {
    // Owner: 「The launcher stays unsolved and stays outside. Do not fold it in.」
    assert.strictEqual(isForbiddenFile('C:/Aroma/xiangxiang.ps1'), false,
      'stated, not hidden: this mechanism cannot protect a file outside the repository')
    // And it is not silently absent from the inventory either.
    assert.ok(!FENCES.some((f) => /xiangxiang\.ps1/.test(f.file)),
      'the launcher needs a different mechanism — see DESIGN-SHE-CHANGES-HERSELF open question L-1')
  })

  test('⛔ the INVENTORY above is still maintained by hand, and that is the remaining gap', () => {
    // This assertion exists to be read, not to catch anything. A fence created outside
    // src/governance/ and never added to FENCES is invisible to every test in this file.
    assert.ok(FENCES.length >= 11, 'the audit found eleven; if this list shrinks, someone removed a fence')
  })
})
