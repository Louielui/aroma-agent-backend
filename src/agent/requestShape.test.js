'use strict'

/**
 * requestShape.test.js — IS THIS A REQUEST? The question nothing was asking.
 *
 * `inferWorkRequest` checks COMPLETENESS: is there a file, is there an instruction. It has
 * never checked ILLOCUTION — whether the sentence is a request at all — because it only ran
 * after the model had already classified the turn as an action. Measured, not assumed:
 *
 *   「我啱啱改咗 docs/notes.md 第三行」   fires   (a report of a change already made)
 *   「Codex 改咗 docs/notes.md 個標題」   fires   (somebody else's change)
 *   「如果改 docs/notes.md 第三行會點？」 fires   (a hypothetical)
 *   「要唔要改 docs/notes.md 第三行？」   fires   (a question)
 *   「唔好改 docs/notes.md」              fires   with intent 「唔好改」
 *
 * The last one is the sharpest: it would offer to make a change the Owner just refused.
 *
 * ── WHY A CONSERVATIVE TEST IS SAFE HERE ─────────────────────────────────────
 * The asymmetry is in our favour and it is the whole reason this is buildable:
 *
 *   A MISSED request  → falls through to the model path. Costs exactly what today costs.
 *   A FALSE request   → a visible wrong offer.
 *
 * So this refuses on any doubt. It is a vocabulary, and this project has found holes in
 * three vocabularies this week — but a hole in THIS one degrades to the status quo instead
 * of doing something wrong.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { isChangeRequest, REFUSAL } = require('./requestShape')

const ok = (m) => isChangeRequest(m).ok
const why = (m) => isChangeRequest(m).reason

/* ═══ 1. WHAT MUST FIRE ══════════════════════════════════════════════════ */

test('*** the Owner\'s own request fires ***', () => {
  assert.equal(ok('幫我改 docs/canary/agent-canary.md，第二行改成 line 3'), true)
})

test('a bare imperative fires — 幫我 is politeness, not a requirement', () => {
  assert.equal(ok('改 docs/notes.md 第二行為 line 3'), true)
  assert.equal(ok('請幫我更新 README.md 的版本號'), true)
})

/* ═══ 2. WHAT MUST NOT — each is a measured false trigger ════════════════ */

test('*** a NEGATED instruction never fires ***', () => {
  // 「唔好改 docs/notes.md」 currently yields intent 「唔好改」. Offering to do the thing he
  // just refused is the worst of these, so negation is checked FIRST — the string also
  // contains 改, and a verb test alone would pass it.
  for (const m of ['唔好改 docs/notes.md', '不要改 docs/notes.md 第三行', '唔使改 docs/notes.md', '別動 docs/notes.md']) {
    assert.equal(ok(m), false, m)
    assert.equal(why(m), REFUSAL.NEGATED, m)
  }
})

test('*** a REPORT of a change already made never fires ***', () => {
  for (const m of ['我啱啱改咗 docs/notes.md 第三行', 'Codex 改咗 docs/notes.md 個標題', '我已經更新了 README.md']) {
    assert.equal(ok(m), false, m)
    assert.equal(why(m), REFUSAL.REPORTED, m)
  }
})

test('*** a HYPOTHETICAL never fires ***', () => {
  for (const m of ['如果改 docs/notes.md 第三行會點？', '假如我哋改 docs/notes.md 呢']) {
    assert.equal(ok(m), false, m)
  }
})

test('*** a QUESTION never fires ***', () => {
  for (const m of ['要唔要改 docs/notes.md 第三行？', '改 docs/notes.md 好唔好？', 'docs/notes.md 而家係咩內容?']) {
    assert.equal(ok(m), false, m)
  }
})

test('a sentence with no change verb at all never fires', () => {
  assert.equal(ok('我今日睇咗 docs/notes.md，幾好'), false)
  assert.equal(why('我今日睇咗 docs/notes.md，幾好'), REFUSAL.NO_VERB)
})

/* ═══ 3. THE ASYMMETRY, STATED AS A TEST ════════════════════════════════ */

test('*** a polite request phrased as a question is REFUSED — and that is the safe side ***', () => {
  // 「可以幫我改 X 嗎？」 is a genuine request and this refuses it. That is deliberate: a
  // missed request falls through to the model path, which is exactly today's behaviour, so
  // the cost is zero. Recorded as a test so the loss is visible rather than discovered.
  assert.equal(ok('可以幫我改 docs/notes.md 嗎？'), false)
})

test('empty and non-string inputs refuse', () => {
  for (const m of ['', '   ', null, undefined, 42, {}]) assert.equal(isChangeRequest(m).ok, false, String(m))
})

/* ═══ 4. IT IS PURE ═════════════════════════════════════════════════════ */

test('deterministic and free — the same words always give the same answer', () => {
  const m = '幫我改 docs/notes.md，第二行改成 line 3'
  const a = isChangeRequest(m)
  const b = isChangeRequest(m)
  assert.deepEqual(a, b)
  const src = require('fs').readFileSync(require.resolve('./requestShape'), 'utf8')
  for (const forbidden of ['require(\'http', 'fetch(', 'adapter', 'complete(', 'Math.random', 'Date.now']) {
    assert.equal(src.includes(forbidden), false, 'must stay pure: ' + forbidden)
  }
})
