'use strict'

/**
 * capabilityDenial.test.js — 「我未連接」 is not 「我讀唔到」, and the guard only knew the second.
 *
 * > **Owner: 「capability denials are a different class from read failures, and your four
 * > missed variants are the evidence. A guard that only knows 「我讀唔到」 while she says
 * > 「我未連接」 has been narrow since it was written — this is the sixth failure and the first
 * > that is the guard's fault rather than the model's.」**
 *
 * ── THE TWO CLASSES ──────────────────────────────────────────────────────────
 *   READ FAILURE      — 「我讀不到 X」. A claim about one attempt.
 *   CAPABILITY DENIAL — 「我未連接到 X」,「我沒有…權限」. A claim about the CONFIGURATION, which
 *                       is a bigger and more damaging thing to be wrong about: it tells the
 *                       Owner a switch is off when it is on, and he stops asking.
 *
 * ⛔ AND THE SHAPE THAT LET IT THROUGH IS THE SAME ONE AS THE INTENT BUG. `UNREADABLE_CLAIM`
 * carries the contiguous string 「沒有權限」; she wrote 「沒有直接連接到 Aroma System 的讀取權限」.
 * Contiguous substring, defeated by interposed words — exactly like 「訂貨」 vs 「訂什麼貨」 one
 * layer up. So these patterns allow a BOUNDED GAP, and the bound stops at clause punctuation
 * so a denial in one clause cannot reach a noun in the next.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { enforceReadState, detectFalseReadClaim, CAPABILITY_DENIAL } = require('./readStateGuard')

const MSG = '香香, 到aroma system, 看看今天要向costco訂什麼貨'
const READ_LIVE = [{ source: 'aroma_system', trust: 'live', count: 4, error: null }]

// The four that were measured as missed on 2026-08-08.
const MISSED_ON_THE_DAY = [
  '我目前沒有直接連接到 Aroma System 的讀取權限',
  '我沒有直接連接到 Aroma System',
  '我未連接到 Aroma System',
  '目前尚未連接到餐廳系統，所以無法提供'
]

for (const reply of MISSED_ON_THE_DAY) {
  test('*** corrected now (was missed): ' + reply + ' ***', () => {
    const found = detectFalseReadClaim(reply, READ_LIVE, MSG)
    assert.equal(found.violated, true)
    assert.deepEqual(found.sources, ['aroma_system'])
    assert.equal(found.kind, 'capability', 'a configuration claim is its own class, not a read failure')

    const out = enforceReadState(reply, READ_LIVE, MSG)
    assert.equal(out.corrected, true)
    assert.ok(out.reply.startsWith(reply), 'her words are kept; the correction is appended')
  })
}

test('*** ⛔ a capability denial is NOT corrected when the source really was not read ***', () => {
  // trust !== 'live' — the claim may well be true, and a control that argues with a true
  // statement is worse than one that stays quiet. The prior Owner ruling in this file.
  const notRead = [{ source: 'aroma_system', trust: 'unavailable', count: 0, error: 'timeout' }]
  const found = detectFalseReadClaim('我未連接到 Aroma System', notRead, MSG)
  assert.equal(found.violated, false)
})

test('*** ⛔ KNOWN GAP, DELIBERATE: an unattributable denial stays silent ***', () => {
  // 「我沒有讀取權限」 names no source. The attribution rule that keeps this guard from
  // arguing with true statements about FIELDS also keeps it quiet here. Left uncorrected on
  // purpose rather than widened — and the case that actually happened is covered by
  // enforceNoReadClaim, which needs no attribution because nothing was read at all.
  const found = detectFalseReadClaim('我沒有讀取權限', READ_LIVE, MSG)
  assert.equal(found.violated, false)
})

test('*** the gap is bounded by clause punctuation — a denial cannot reach into the next clause ***', () => {
  // 「沒有」 in one clause, 「權限」 far away in another, about different things.
  assert.equal(CAPABILITY_DENIAL.test('今天沒有新的發票。權限設定我已經看過了'), false)
})

test('*** read-failure detection is unchanged — this widened the guard, it did not move it ***', () => {
  const found = detectFalseReadClaim('我讀不到 Aroma System', READ_LIVE, MSG)
  assert.equal(found.violated, true)
  assert.equal(found.kind, 'named', 'the original class keeps its original kind')
})
