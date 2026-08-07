'use strict'

/**
 * _verify.js — the shared shape for every standing claim.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「every 'verified' claim names a command he can re-run that reprints the verdict.
 * > Report 引用 the command, not the conclusion.」**
 * > **「一個假嘅『已驗證』唔止係漏咗一次檢查 —— 佢退役咗你嗰份關注。」**
 *
 * The failure this exists for: I perform an action and grade it from the same output (HR-41's
 * HR-25 twin). Every gate in this system terminates in me saying 「verified」, and a false
 * verified does not cost one check — **it costs every future check he would have made.**
 *
 * So the verdict must come from an artefact I did not author, in a form he can re-run without
 * me. These scripts are that artefact.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ THREE VERDICTS, NEVER TWO.
 *
 *   PASS    — checked, and it holds.
 *   FAIL    — checked, and it does not.
 *   UNKNOWN — **could not check.** HR-23: a guardrail that cannot read its own evidence is
 *             BLIND, not clean. UNKNOWN exits non-zero, because 「I could not look」 must never
 *             be the same exit code as 「I looked and it was fine」.
 *
 * ⛔ AND EVERY CHECK PRINTS ITS EVIDENCE, not just its verdict — the number, the path, the
 * date it read. A verdict with no evidence is the thing being replaced.
 */

const CHECK = { PASS: 'PASS', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' }

function runVerify (title, checks) {
  const results = []
  console.log('')
  console.log('  ' + title)
  console.log('  ' + '─'.repeat(Math.max(20, title.length)))

  for (const c of checks) {
    let r
    try {
      r = c.run()
    } catch (e) {
      // A check that throws is UNKNOWN, never FAIL — it did not establish anything.
      r = { verdict: CHECK.UNKNOWN, evidence: '檢查本身爆咗:' + String(e && e.message).split('\n')[0].slice(0, 120) }
    }
    results.push({ name: c.name, ...r })
    const mark = r.verdict === CHECK.PASS ? '✅' : (r.verdict === CHECK.FAIL ? '❌' : '⚠ ')
    console.log('  ' + mark + ' ' + r.verdict.padEnd(8) + c.name)
    if (r.evidence) console.log('       ' + r.evidence)
    if (r.detail) console.log('       ' + r.detail)
  }

  const fails = results.filter((r) => r.verdict === CHECK.FAIL)
  const unknowns = results.filter((r) => r.verdict === CHECK.UNKNOWN)
  console.log('  ' + '─'.repeat(Math.max(20, title.length)))
  if (fails.length) {
    console.log('  ❌ FAIL —— ' + fails.length + ' 項唔成立' + (unknowns.length ? ',' + unknowns.length + ' 項查唔到' : '') + '。')
  } else if (unknowns.length) {
    // ⛔ Not 「mostly fine」. Unreadable evidence is its own verdict and it is not a pass.
    console.log('  ⚠ UNKNOWN —— ' + unknowns.length + ' 項查唔到。查唔到唔等於冇事。')
  } else {
    console.log('  ✅ PASS —— ' + results.length + ' 項全部成立。')
  }
  console.log('')
  process.exit(fails.length ? 1 : (unknowns.length ? 2 : 0))
}

module.exports = { runVerify, CHECK }
