'use strict'
/**
 * testNameLedger.test.js — a deleted test must not remove a guarantee in silence.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE ONLY FAILURE MODE IN THIS PROJECT WITH NO DETECTOR AT ALL.
 *
 * The E0-B1 rewrite deleted `e0b1PublicRead.test.js`, which carried five assertions that the
 * credential path is unreachable, and replaced none of them. **Nothing went red.** The suite
 * was green, the test count went UP (the rewrite added more than it removed), the diff showed
 * one file deleted and three added, and the rewrite was genuinely better.
 *
 * Every observable said improvement. The property simply stopped being checked.
 *
 * It was found a week later, by a hand audit the Owner asked for. Nothing mechanical could see
 * it, and review did not — you would have had to already know the assertion existed.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ NAMES, NOT COUNTS. THE COUNT WENT UP. ────────────────────────────────
 *
 * A count cannot see a swap. A name can:
 * `*** 11 — the model/client cannot supply or widen a target origin ***` either exists or it
 * does not, and its absence is the whole signal.
 *
 * ── ⛔ A RENAME TRIPS THIS, AND THAT IS THE FEATURE ──────────────────────────
 *
 * The false positive is doing the work. A rename is exactly the moment to confirm the property
 * MOVED rather than DIED — which is the question nobody asked during the rewrite that caused
 * this. Re-generating the ledger is a deliberate act with a diff the Owner can read:
 *
 *     node scripts/verify/testNames.js > docs/TEST-NAME-LEDGER.txt
 *
 * ⛔ AND IT IS NOT A REAL DETECTOR. Mutation testing is — delete an assertion INSIDE a test and
 * this sees nothing, because the name survives. That remains recorded as the only true detector
 * and is deliberately unscheduled. This closes the cheap, common half: a whole test vanishing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { testNames } = require('../../scripts/verify/testNames')

const LEDGER = path.resolve(__dirname, '..', '..', 'docs', 'TEST-NAME-LEDGER.txt')
const SRC = path.resolve(__dirname, '..')

test('*** ⛔ no test NAME has disappeared since the ledger was written ***', () => {
  const recorded = fs.readFileSync(LEDGER, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  const present = new Set(testNames(SRC))
  const gone = recorded.filter((n) => !present.has(n))

  assert.deepEqual(gone, [],
    '⛔ These test names no longer exist. A deleted test removes a guarantee in SILENCE — the ' +
    'suite stays green and the property simply stops being checked.\n\n' +
    'If each one MOVED (renamed, or split into differently-named tests), confirm the property ' +
    'is still asserted somewhere and then re-generate:\n' +
    '    node scripts/verify/testNames.js > docs/TEST-NAME-LEDGER.txt\n\n' +
    'If any one DIED, that is the defect this check exists for.')
})

test('*** the ledger is not empty, and not stale to the point of meaninglessness ***', () => {
  const recorded = fs.readFileSync(LEDGER, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  // ⛔ A LEDGER THAT LOST ITS CONTENTS WOULD PASS THE CHECK ABOVE VACUOUSLY — nothing recorded,
  // nothing missing, green. The mechanism has to be able to notice its own erasure.
  assert.ok(recorded.length > 1000, 'the ledger holds the suite, not a fragment: ' + recorded.length)

  // Growth is fine and needs no action; the check is one-directional on purpose. This only
  // asserts the ledger has not drifted so far behind that it is documenting a different repo.
  const present = testNames(SRC)
  assert.ok(present.length >= recorded.length,
    'more names have vanished than appeared — regenerate deliberately, do not let it drift')
})

test('*** ⛔ the extractor sees the shapes this suite actually uses ***', () => {
  // A ledger built by a blind extractor is a ledger of nothing. Assert it catches the awkward
  // real cases: an apostrophe inside a single-quoted name, and the ⛔ marker convention.
  const names = testNames(SRC)
  assert.ok(names.some((n) => /⛔/.test(n)), 'the ⛔ convention is captured')
  assert.ok(names.some((n) => /'/.test(n)), 'a name containing an escaped apostrophe is captured')
  assert.ok(names.some((n) => /credential path is UNREACHABLE/.test(n)),
    'and the very assertion whose deletion caused this file is in the ledger')
})
