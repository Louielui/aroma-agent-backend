'use strict'
/**
 * probeProfileStep2.js — STEP 2 of RUNBOOK-CREATE-THE-PROFILE.
 *
 * Four probes on the empty profile, BEFORE the Owner logs in.
 *
 * > **Owner: 「I would rather understand a surprise on an empty profile than on one carrying
 * > my sessions.」**
 *
 * No Chrome. No browser. No network. Reads files only.
 */
const P = require('../src/browser/profileProbe')
const DIR = 'C:\\Aroma\\browser-profile'

const expected = {
  payment: 'NO_DATABASE_YET',
  cardSaving: 'DISABLED',
  signIn: 'BLOCKED',
  lock: 'FREE'
}

const pay = P.probePaymentMethods(DIR)
const card = P.probeCardSavingDisabled(DIR)
const signIn = P.probeBrowserSignIn(DIR)
const lock = P.probeProfileLock(DIR)

const rows = [
  ['payment methods', pay.state, expected.payment, pay.saying],
  ['card saving', card.state, expected.cardSaving, card.saying],
  ['browser sign-in', signIn.state, expected.signIn, signIn.saying],
  ['profile lock', lock.state, expected.lock, lock.saying]
]

console.log('=== STEP 2 — four probes, empty profile, before any login ===\n')
let surprises = 0
for (const [name, got, want, saying] of rows) {
  const ok = got === want
  if (!ok) surprises++
  console.log(`  ${ok ? 'as expected' : '⚠ SURPRISE '}  ${name.padEnd(17)} ${String(got).padEnd(18)} (expected ${want})`)
  console.log(`               ${saying}`)
}

console.log('\n=== VERDICT ===')
if (surprises === 0) {
  console.log('  All four as expected. STEP 3 is the Owner\'s to run — nothing of mine will be running.')
} else {
  console.log(`  ⛔ ${surprises} surprise(s). STOPPING. A probe that surprises us on an EMPTY profile`)
  console.log('     is a probe we do not understand yet, and understanding it here costs nothing.')
}
process.exit(surprises === 0 ? 0 : 1)
