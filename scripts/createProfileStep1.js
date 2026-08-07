'use strict'
/**
 * createProfileStep1.js — STEP 1 of RUNBOOK-CREATE-THE-PROFILE.
 *
 * Creates the profile directory and writes every fence BEFORE Chrome has ever opened it.
 * **Refuses to touch an existing directory** — this runs once, on nothing.
 *
 * No Chrome. No browser. No network. No credential.
 */
const fs = require('node:fs')
const path = require('node:path')
const { writeProfileDefaults } = require('../src/governance/profileProbe')

const DIR = path.join('C:', String.fromCharCode(92), 'Aroma', 'browser-profile')
  .replace(/^C:\\?/, 'C:\\')

const target = 'C:\\Aroma\\browser-profile'

if (fs.existsSync(target)) {
  console.error('⛔ ' + target + ' ALREADY EXISTS — stopping. Nothing was overwritten.')
  process.exit(1)
}

fs.mkdirSync(target, { recursive: true })
const w = writeProfileDefaults(target)

console.log('created:    ' + target)
console.log('prefs file: ' + w.file)
console.log('\n=== settings READ BACK FROM THE FILE, not from what I set ===')

const prefs = JSON.parse(fs.readFileSync(w.file, 'utf8'))
const rows = [
  ['autofill.credit_card_enabled', prefs.autofill && prefs.autofill.credit_card_enabled, false],
  ['autofill.profile_enabled', prefs.autofill && prefs.autofill.profile_enabled, false],
  ['credentials_enable_service', prefs.credentials_enable_service, false],
  ['credentials_enable_autosignin', prefs.credentials_enable_autosignin, false],
  ['signin.allowed', prefs.signin && prefs.signin.allowed, false],
  ['signin.allowed_on_next_startup', prefs.signin && prefs.signin.allowed_on_next_startup, false],
  ['sync.requested', prefs.sync && prefs.sync.requested, false],
  ['sync.has_setup_completed', prefs.sync && prefs.sync.has_setup_completed, false],
  ['account_info (length)', Array.isArray(prefs.account_info) ? prefs.account_info.length : 'MISSING', 0]
]

let bad = 0
for (const [k, v, want] of rows) {
  const ok = v === want
  if (!ok) bad++
  console.log('  ' + (ok ? 'ok  ' : '⛔  ') + String(k).padEnd(32) + ' ' + String(v))
}
console.log('\n  every fence set as intended: ' + (bad === 0 ? 'YES' : 'NO — ' + bad + ' wrong'))
process.exit(bad === 0 ? 0 : 1)
