'use strict'

/**
 * requestShapeCorpus.test.js — GUARD DISCIPLINE, not vocabulary discipline.
 *
 * The Owner's instruction, and the reason for it: 「If it is written from imagined phrasings
 * it will pass and still miss me, which is the shape of every vocabulary defect this week.」
 *
 * So every entry carries a `real` flag. REAL means the sentence is one the Owner actually
 * typed — taken from this repository's own record of his words (his message on 2026-08-05,
 * the phrasing quoted in requestInference.js's header, the fixture in
 * scripts/diff/behaviourSurface.js, and the commit examples in distillPrompt.js that carry
 * his 2026-07-15 sign-off). CONSTRUCTED means I wrote it, and it is marked so that the
 * ratio is visible rather than assumed — a corpus of my own invented phrasings would agree
 * with my own regexes by construction.
 *
 * The negations are the ones that matter most and are also the ones I have fewest real
 * samples of. That gap is asserted below rather than hidden: if it stays this thin, the
 * corpus is telling us to collect more, not that the module is fine.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { isChangeRequest } = require('./requestShape')

/**
 * @typedef {{ msg: string, want: boolean, real: boolean, note: string }} Case
 */
const CORPUS = Object.freeze([
  // ── MUST FIRE — real ──────────────────────────────────────────────────────
  { msg: '幫我改 docs/canary/agent-canary.md，第二行改成 line 3', want: true, real: true, note: 'his message, 2026-08-05' },
  { msg: '幫我改 docs/canary/agent-canary.md，喺第一行後面加一句「edited by the agent」', want: true, real: true, note: 'quoted in requestInference.js' },
  { msg: '改 docs/canary/agent-canary.md 嗰行字', want: true, real: true, note: 'behaviourSurface.js fixture' },
  { msg: '幫我把 Timeline 的輪詢在終止狀態後停掉', want: true, real: true, note: 'distillPrompt commit example' },
  { msg: '建立一個新的供應商資料表', want: true, real: true, note: 'distillPrompt commit example' },

  // ── MUST FIRE — constructed, covering how he mixes script ────────────────
  { msg: '幫我 update README.md 個 version number', want: true, real: false, note: 'mixed script, Cantonese frame' },
  { msg: '唔該幫我加一行入 docs/notes.md', want: true, real: false, note: '唔該 as politeness, not refusal' },
  { msg: '請更新 README.md 的版本號', want: true, real: false, note: 'written Chinese register' },

  // ── NEGATIONS — the class the Owner named as mattering most ──────────────
  { msg: '唔好改 docs/notes.md', want: false, real: false, neg: true, note: 'plain refusal' },
  { msg: '唔使改 docs/notes.md 第三行', want: false, real: false, neg: true, note: 'not necessary' },
  { msg: '先唔好郁 docs/notes.md', want: false, real: false, neg: true, note: 'hold off — 郁 is his register' },
  { msg: '暫時唔好改 README.md', want: false, real: false, neg: true, note: 'temporary hold' },
  { msg: '不要改 docs/notes.md 第三行', want: false, real: false, neg: true, note: 'written Chinese refusal' },
  { msg: '別動 docs/notes.md', want: false, real: false, neg: true, note: 'terse written refusal' },
  { msg: '唔准改 src/agent/audit.js', want: false, real: false, neg: true, note: 'prohibition' },

  // ── REPORTS — a change that already happened ─────────────────────────────
  { msg: '我啱啱改咗 docs/notes.md 第三行', want: false, real: false, note: 'first person, perfective' },
  { msg: 'Codex 改咗 docs/notes.md 個標題', want: false, real: false, note: 'third party, perfective' },
  { msg: '我已經更新了 README.md', want: false, real: false, note: 'written Chinese perfective' },
  { msg: '我改過 docs/notes.md 一次', want: false, real: false, note: 'experiential aspect' },

  // ── QUESTIONS AND HYPOTHETICALS ──────────────────────────────────────────
  { msg: '要唔要改 docs/notes.md 第三行？', want: false, real: false, note: 'asking him-or-me' },
  { msg: '改 docs/notes.md 好唔好？', want: false, real: false, note: 'seeking agreement' },
  { msg: '如果改 docs/notes.md 第三行會點？', want: false, real: false, note: 'hypothetical' },
  { msg: '假如我哋改 docs/notes.md 呢', want: false, real: false, note: 'hypothetical, trailing particle' },
  { msg: '可以幫我改 docs/notes.md 嗎？', want: false, real: false, note: 'ACCEPTED LOSS — a real request, refused; see requestShape.js' },

  // ── NOT ABOUT CHANGING ANYTHING ──────────────────────────────────────────
  { msg: '我今日睇咗 docs/notes.md，幾好', want: false, real: false, note: 'reading, not changing' },
  { msg: 'docs/canary/agent-canary.md 而家係咩內容?', want: false, real: false, note: 'a question about content' },
  { msg: '你好呀', want: false, real: false, note: 'greeting' }
])

/* ═══ THE CORPUS ITSELF ══════════════════════════════════════════════════ */

test('*** every corpus case gets the verdict it should ***', () => {
  const wrong = []
  for (const c of CORPUS) {
    const got = isChangeRequest(c.msg).ok
    if (got !== c.want) wrong.push(`${c.want ? 'SHOULD FIRE' : 'MUST NOT FIRE'}: ${c.msg}  (${c.note})`)
  }
  assert.deepEqual(wrong, [])
})

test('*** every negation is refused — the class that matters most ***', () => {
  // Asked separately from the sweep above so a negation regression names itself rather
  // than arriving as one line in a list of thirty.
  // TAGGED, NOT PATTERN-MATCHED ON PROSE. My first version filtered by note text and
  // caught 「唔該幫我加一行入 docs/notes.md」 — whose note reads 'not refusal' — then failed
  // it for firing, which it should. A test that selects its own cases by substring is the
  // same class of mistake as a guard that selects its cases by substring.
  const negations = CORPUS.filter((c) => c.neg === true)
  assert.ok(negations.length >= 7, 'the negation set shrank: ' + negations.length)
  for (const c of negations) assert.equal(isChangeRequest(c.msg).ok, false, c.msg)
})

/* ═══ WHAT THE CORPUS ADMITS ABOUT ITSELF ═══════════════════════════════ */

test('*** the real-sample count is visible, and the negation gap is stated ***', () => {
  const real = CORPUS.filter((c) => c.real)
  assert.ok(real.length >= 5, 'real samples: ' + real.length)

  // THE HONEST GAP. Every real sample is a request that SHOULD fire — this repository has
  // recorded the Owner asking for changes, and never recorded him refusing one in the
  // shape this module has to catch. So the negation branch, which he named as the case he
  // cares about most, is tested entirely against phrasings I wrote.
  //
  // That is exactly the defect shape he warned about, and it cannot be closed by writing
  // more of my own sentences. It closes when he refuses a change in a real turn and the
  // wording is added here. Until then the double-check in workRequestOffer.js is not
  // belt-and-braces — it is the compensation for this gap.
  const realNegations = CORPUS.filter((c) => c.real && c.want === false)
  assert.equal(realNegations.length, 0, 'if this is no longer 0, update the comment above — a real negation was captured')
})

test('the corpus covers each refusal reason at least once', () => {
  const seen = new Set()
  for (const c of CORPUS) {
    const r = isChangeRequest(c.msg).reason
    if (r) seen.add(r)
  }
  for (const r of ['negated', 'reported', 'hypothetical', 'question', 'no_verb']) {
    assert.ok(seen.has(r), 'no corpus case exercises: ' + r)
  }
})

module.exports = { CORPUS }
