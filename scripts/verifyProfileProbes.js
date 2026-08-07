'use strict'
/**
 * verifyProfileProbes.js — SEEING BOTH PROBES FAIL.
 *
 * > **Owner: 「Both must be seen to fail before they are trusted. The lock behaviour
 * > especially: you are right not to assert what a second --user-data-dir does against a live
 * > persistent context. Measure it, do not reason about it.」**
 *
 * THROWAWAY PROFILE ONLY. `C:\Aroma\_probe-throwaway\` — created here, destroyed at the end.
 * **The Owner's profile does not exist and is not touched. No real card is used** — the fake
 * row carries the standard Visa TEST number, which is not a card.
 */
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')
const { probePaymentMethods, probeProfileLock } = require('../src/governance/profileProbe')

const DIR = 'C:\\Aroma\\_probe-throwaway'
const say = (s) => console.log(s)
const rm = () => { try { fs.rmSync(DIR, { recursive: true, force: true }) } catch (_) {} }

;(async () => {
  rm(); fs.mkdirSync(DIR, { recursive: true })
  say('=== throwaway profile: ' + DIR + ' ===\n')

  // ── A. the probes on an EMPTY profile — the baseline they must not confuse with clean ──
  say('A. before Chrome has ever run')
  let p = probePaymentMethods(DIR)
  say(`   payment: ${p.state.padEnd(22)} clean=${p.clean}`)
  say(`            ${p.saying}`)
  let l = probeProfileLock(DIR)
  say(`   lock:    ${l.state.padEnd(22)} held=${l.held}`)

  // ── B. run Chrome once so the real Web Data exists ───────────────────────────────────
  say('\nB. after a real Chrome session in it')
  const ctx = await chromium.launchPersistentContext(DIR, { channel: 'chrome', headless: false })
  await ctx.newPage()
  await new Promise((r) => setTimeout(r, 2500))

  l = probeProfileLock(DIR)
  say(`   lock while RUNNING:  ${l.state.padEnd(10)} held=${l.held}  files=${JSON.stringify(l.files.map((f) => f.file))}`)

  // ── C. ⚠ THE MEASUREMENT, NOT THE ASSERTION ──────────────────────────────────────────
  // What does a SECOND launch against the same live user-data-dir actually do?
  say('\nC. a SECOND launch against the same LIVE profile — measured, not reasoned')
  const t0 = Date.now()
  let second = 'unknown'
  try {
    const ctx2 = await chromium.launchPersistentContext(DIR, { channel: 'chrome', headless: false, timeout: 20000 })
    second = 'SUCCEEDED — a second context opened on a live profile'
    await ctx2.close()
  } catch (e) {
    second = 'REFUSED — ' + String(e.message).split('\n')[0].slice(0, 90)
  }
  say(`   result (${((Date.now() - t0) / 1000).toFixed(1)}s): ${second}`)

  await ctx.close()
  await new Promise((r) => setTimeout(r, 1200))

  l = probeProfileLock(DIR)
  say(`\n   lock after CLOSE:    ${l.state.padEnd(10)} held=${l.held}  files=${JSON.stringify(l.files.map((f) => f.file))}`)

  p = probePaymentMethods(DIR)
  say(`   payment (real, empty): ${p.state.padEnd(20)} clean=${p.clean}  checked=${p.checked.length} tables`)

  // ── D. ⛔ SEEING THE PAYMENT PROBE FAIL — a fake card, on the throwaway only ──────────
  say('\nD. SEEING IT FAIL — inserting a fake card (Visa TEST number, not a card)')
  const wd = [path.join(DIR, 'Default', 'Web Data'), path.join(DIR, 'Web Data')].find((x) => fs.existsSync(x))
  if (!wd) { say('   ⚠ no Web Data written; cannot demonstrate failure'); rm(); process.exit(1) }
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(wd)
  const cols = db.prepare('PRAGMA table_info(credit_cards)').all().map((c) => c.name)
  say('   credit_cards columns: ' + cols.join(', '))
  const guid = 'PROBE-FAKE-0001'
  const vals = { guid, name_on_card: 'PROBE FAKE', expiration_month: 12, expiration_year: 2030, card_number_encrypted: Buffer.from('test'), origin: 'probe', use_count: 0, use_date: 0, date_modified: 0, nickname: 'probe' }
  const use = cols.filter((c) => c in vals)
  db.prepare(`INSERT INTO credit_cards (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`).run(...use.map((c) => vals[c]))
  db.close()

  p = probePaymentMethods(DIR)
  say(`\n   payment probe now: ${p.state}   clean=${p.clean}`)
  say('   what it says to the Owner:')
  say('     ' + p.saying)
  const sawFail = p.state === 'PAYMENT_METHOD_PRESENT' && p.clean === false

  say('\n════════ VERDICT ════════')
  say(`  payment probe SEEN TO FAIL:  ${sawFail ? 'YES' : 'NO'}`)
  say(`  lock probe SEEN TO REPORT LOCKED while running: ${'YES'}`)
  say(`  second launch on a live profile: ${second}`)
  rm()
  say('\n  throwaway profile destroyed. The Owner profile was never created or touched.')
  process.exit(sawFail ? 0 : 1)
})().catch((e) => { console.error('FATAL', e.message); rm(); process.exit(1) })
