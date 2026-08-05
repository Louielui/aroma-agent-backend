'use strict'

/**
 * routeEvidenceGuard.test.js — STEP 4, the last piece of the Intent Router.
 *
 * Steps 1–3 decided WHICH sources a turn may read. Nothing yet checks the other end: a
 * business question the router did not recognise falls to CONVERSATION, reads nothing, and
 * is then answered from the model's own fluency with zero evidence behind it.
 *
 * That failure is live today. 「今日邊啲貨要補？」 routes to CONVERSATION — the router's
 * vocabulary has 補貨 but not 要補 — so it reads nothing and answers anyway.
 *
 * WITHHOLDING MUST BE VISIBLE. A confident answer with nothing behind it is the failure;
 * quietly deleting it is the same failure with the evidence removed.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { enforceRouteEvidence, ROUTE_EVIDENCE_NOTE_RE } = require('./routeEvidenceGuard')

const NO_EVIDENCE = { evidenceSets: [], perSource: [] }
const say = (reply, message, extra) => enforceRouteEvidence(Object.assign({ reply, message }, NO_EVIDENCE, extra || {}))

/* ═══ 1. THE NUMERIC HALF — sentenceIsSupported against an empty index ════ */

test('*** an operational number with nothing read is withheld, and said so ***', () => {
  const r = say('今日有 3 樣貨要補。', '今日邊啲貨要補？')
  assert.equal(r.violated, true)
  assert.deepEqual(r.withheld.length, 1)
  assert.equal(/3 樣貨/.test(r.reply), false, 'the claim itself must not survive')
  assert.ok(ROUTE_EVIDENCE_NOTE_RE.test(r.reply), 'and the withholding is VISIBLE: ' + r.reply)
})

test('*** the note names the source that was not consulted ***', () => {
  const r = say('存貨還有 12 箱。', '仲有幾多貨？')
  assert.ok(r.reply.includes('餐廳系統'), 'got: ' + r.reply)
  assert.ok(/沒有查/.test(r.reply), 'and says it was not consulted: ' + r.reply)
})

test('CJK numerals are caught too — the numeric half is not ASCII-only', () => {
  assert.equal(say('大概二十件存貨。', '仲有幾多？').violated, true)
})

test('the clean sentences survive; only the claim is removed', () => {
  const r = say('好呀。今日有 3 樣貨要補。要我幫你開單嗎？', '今日邊啲貨要補？')
  assert.ok(r.reply.startsWith('好呀。'), 'got: ' + r.reply)
  assert.ok(r.reply.includes('開單'), 'the offer survives: ' + r.reply)
})

/* ═══ 2. THE ENTITY-PLUS-STATUS HALF — weaker, and known to be ═══════════ */

test('*** a status claim with no number at all is still caught ***', () => {
  const r = say('存貨全部充足。', '今日邊啲貨要補？')
  assert.equal(r.violated, true, 'sentenceIsSupported passes this — a number check cannot see it')
})

test('*** WRITTEN WHERE IT WILL BE SEEN: what this half cannot catch ***', () => {
  // THE LIMIT I FLAGGED, pinned as a test so it cannot be quietly assumed away.
  //
  // The entity half matches the INTENT TABLE's own nouns. The guard therefore CANNOT see a
  // business claim phrased without one — which is the SAME blind spot that sent the turn to
  // CONVERSATION in the first place. The guard cannot catch what the router could not route.
  const blind = say('今日一切正常，唔使做嘢。', '今日邊啲貨要補？')
  assert.equal(blind.violated, false, 'DOCUMENTED, NOT ACCEPTED AS SAFE — see the module header')

  // Widening the noun list narrows this hole in BOTH places at once, because the router and
  // the guard read the same table. That is the fix; a second private list is not.
  const { INTENTS } = require('../context/readContext')
  const { ENTITY_NOUNS } = require('./routeEvidenceGuard')
  const fromTable = new Set(INTENTS.flatMap((i) => i.cjk || []))
  for (const n of ENTITY_NOUNS) assert.ok(fromTable.has(n), 'the guard grew its own vocabulary: ' + n)
})

/* ═══ 3. WHAT IT MUST NEVER TOUCH ════════════════════════════════════════ */

test('a question or an offer is not a claim', () => {
  assert.equal(say('要我查一下餐廳系統的存貨嗎？', '今日邊啲貨要補？').violated, false)
  assert.equal(say('你想我睇邊 3 樣？', '睇下先').violated, false)
})

test('*** UTILITY is exempt — its numbers are computed, not claimed ***', () => {
  // 「5磅是2.27公斤」 has a number and no evidence, and is perfectly honest.
  assert.equal(say('5 磅是 2.27 公斤。', '5磅是多少公斤？').violated, false)
})

test('*** ACTION and BUSINESS_QUERY are out of scope ***', () => {
  assert.equal(say('已經改咗 3 行。', '幫我改 docs/a.md').violated, false, 'ACTION')
  assert.equal(say('今日有 3 個安排。', '今日有咩安排？').violated, false, 'BUSINESS_QUERY: the read path guards it')
})

test('*** a turn that DID read is out of scope, even with one source ***', () => {
  const withEvidence = { evidenceSets: [{ source: 'aroma_system', trust: 'live', totalCount: 1, shownCount: 1 }] }
  assert.equal(say('存貨還有 12 箱。', '仲有幾多貨？', withEvidence).violated, false,
    'evidence exists; answerPlan is the layer that checks it, and this guard must not double-judge')
})

test("*** the Owner's own number, this turn, is his — not a claim of hers ***", () => {
  // His standing carve-out, applied here: repeating what he just wrote is not laundering.
  assert.equal(say('12 箱,明白。', '仲有 12 箱,夠唔夠？').violated, false)
})

test('an ordinary conversational reply is untouched, byte for byte', () => {
  const plain = '好呀，今日想傾咩？'
  const r = say(plain, '你好呀')
  assert.equal(r.violated, false)
  assert.equal(r.reply, plain)
})

test('the note is never added twice, and never to a clean reply', () => {
  const r = say('好呀。', '你好呀')
  assert.equal(ROUTE_EVIDENCE_NOTE_RE.test(r.reply), false)
  const twice = enforceRouteEvidence(Object.assign({ reply: say('存貨全部充足。', '今日邊啲貨要補？').reply, message: '今日邊啲貨要補？' }, NO_EVIDENCE))
  assert.equal(twice.violated, false, 'the server line must not trip the guard that wrote it')
})

test('everything withheld leaves the note standing alone, never an empty reply', () => {
  const r = say('存貨全部充足。', '今日邊啲貨要補？')
  assert.ok(r.reply.trim().length > 0)
  assert.ok(ROUTE_EVIDENCE_NOTE_RE.test(r.reply))
})

/* ═══ 4. WIRED, not merely written ═══════════════════════════════════════ */

test('*** the guard is actually on the conversational reply path ***', () => {
  const { buildReadResultReply } = require('./readResultView')
  const out = buildReadResultReply({
    reply: '存貨還有 12 箱。', message: '仲有幾多貨？',
    answerPlan: null, evidenceSets: [], itemsBySource: [], perSource: []
  })
  assert.ok(ROUTE_EVIDENCE_NOTE_RE.test(out.reply), 'a module nothing calls is not a guard: ' + out.reply)
})

test('the written-Chinese policy holds for the server line', () => {
  const r = say('存貨還有 12 箱。', '仲有幾多貨？')
  const note = r.reply.slice(r.reply.search(ROUTE_EVIDENCE_NOTE_RE))
  assert.equal(/唔|嘅|咗|冇|嗰/.test(note), false, 'Cantonese in a server-generated line: ' + note)
})
