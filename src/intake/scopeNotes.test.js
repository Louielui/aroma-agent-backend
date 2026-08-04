'use strict'

/**
 * scopeNotes.test.js — say it once, not every turn.
 *
 * ── THE FINDING ──────────────────────────────────────────────────────────────
 * Across seven consecutive turns of one conversation, every 資料限制 block restated the
 * SAME FIXED PROPERTIES of the same sources — these rows carry no location, these rows
 * carry no timestamp, this is a sample of 199 — in slightly different words each time,
 * because the model rewrites them from the SCOPE lines it is handed on every turn.
 *
 * Those properties are facts about the SOURCE, not about the turn. They do not change
 * between question one and question seven. Repeating them is what made her read like a
 * disclaimer generator rather than someone who had already told him something.
 *
 * ── WHAT IS AND IS NOT SUPPRESSED ────────────────────────────────────────────
 * SUPPRESSED: a restatement of a fixed scope property that (a) the EvidenceSet actually
 * asserts this turn, and (b) she already stated earlier in THIS conversation.
 * KEPT ALWAYS: the first statement of it, and anything genuinely per-turn — every
 * server-authored omission note, and any model limitation carrying a count that is not
 * one of the source's own scope numbers.
 *
 * ── THE HONEST PART ──────────────────────────────────────────────────────────
 * Deciding "is this sentence a scope restatement" is KEYWORD-ANCHORED, not proven. Two
 * gates keep the blast radius small: the concept must be one the EvidenceSet asserts, and
 * the sentence must carry no number the EvidenceSet does not already own. It can only ever
 * DELETE a repeat; it can never invent, rewrite, or suppress a first statement.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { pruneRepeatedScopeNotes } = require('./scopeNotes')

/** A stock read: 199 records, 20 shown, no location, no timestamp. */
const EV = [{
  source: 'aroma_system',
  trust: 'live',
  totalCount: 199,
  shownCount: 20,
  completeness: 'sample',
  scope: { hasLocation: false, hasAsOf: false, note: null }
}]

const said = (text) => [{ role: 'assistant', text }]
const prune = (limitations, history) => pruneRepeatedScopeNotes(limitations, { evidenceSets: EV, history })

/* ═══ 1. ONCE — the first statement always survives ═════════════════════════ */

test('*** with nothing said before, the scope note is KEPT ***', () => {
  const { kept, dropped } = prune(['庫存資料冇分地點，睇唔到邊個倉。'], [])
  assert.deepEqual(kept, ['庫存資料冇分地點，睇唔到邊個倉。'], 'he has to be told once')
  assert.equal(dropped, 0)
})

/* ═══ 2. NOT AGAIN — a reworded repeat is dropped ═══════════════════════════ */

test('*** once she has said it, a REWORDED restatement is dropped ***', () => {
  // Different words, same fixed property. Exact-string matching would have caught none of
  // the seven live repeats, because she never wrote it the same way twice.
  const { kept, dropped } = prune(
    ['呢啲數字冇地點維度，唔分倉。'],
    said('庫存資料冇分地點，睇唔到邊個倉。')
  )
  assert.deepEqual(kept, [], 'THE DEFECT: the same fixed property, restated every turn')
  assert.equal(dropped, 1)
})

test('the timestamp property and the sample property are each tracked on their own', () => {
  // Having said "no location" does not license dropping "no timestamp" — they are two
  // separate facts and he has been told one of them.
  const { kept } = prune(
    ['冇地點。', '亦都冇記錄係幾時更新，唔知係咪最新。'],
    said('庫存資料冇分地點。')
  )
  assert.deepEqual(kept, ['亦都冇記錄係幾時更新，唔知係咪最新。'], 'the unsaid one still gets said')
})

/* ═══ 3. PER-TURN NOTES ARE NEVER TOUCHED ══════════════════════════════════ */

test('*** the server\'s own omission notes always survive ***', () => {
  // These are the counts of what was dropped from THIS turn. They are the whole reason the
  // omission machinery exists, and they carry a number the EvidenceSet does not own.
  const history = said('庫存資料冇分地點，亦冇時間戳。')
  const { kept } = prune(['有 3 項系統核對唔到，冇顯示。', '有 6 個數值核對唔到，冇顯示。'], history)
  assert.equal(kept.length, 2, 'a per-turn count is not a fixed source property')
})

test('*** a limitation carrying a count the evidence does not own is per-turn, and stays ***', () => {
  const history = said('庫存資料冇分地點。')
  // 4 is neither the total (199) nor the shown count (20): this is about these four rows,
  // not about the source. Both spellings — she writes counts in Chinese numerals by default.
  for (const line of ['有 4 項冇地點資料，排除咗。', '有四項冇地點資料，排除咗。']) {
    assert.deepEqual(prune([line], history).kept, [line], 'per-turn: ' + line)
  }
})

test('a repeat that quotes only the source\'s own scope numbers is still a repeat', () => {
  const history = said('199 項入面淨係顯示咗 20 項。')
  const { kept } = prune(['呢個係 199 項嘅樣本，只出咗 20 項。'], history)
  assert.deepEqual(kept, [], '199 and 20 are the source\'s numbers, not this turn\'s')
})

/* ═══ 4. ANCHORED TO WHAT THE EVIDENCE ACTUALLY SAYS ═══════════════════════ */

test('*** a concept the EvidenceSet does not assert is never suppressed ***', () => {
  // These rows DO carry a location. So a sentence about location is saying something else —
  // something real about this turn — and nothing here may touch it.
  const evidenceSets = [{ ...EV[0], scope: { hasLocation: true, hasAsOf: false, note: null } }]
  const line = '有啲行嘅地點對唔上，冇計入。'
  const { kept } = pruneRepeatedScopeNotes([line], { evidenceSets, history: said('地點資料冇分倉。') })
  assert.deepEqual(kept, [line], 'suppression is gated on what the evidence asserts, not on keywords alone')
})

test('a source that was not read live asserts nothing', () => {
  const evidenceSets = [{ ...EV[0], trust: 'cached' }]
  const line = '庫存資料冇分地點。'
  assert.deepEqual(pruneRepeatedScopeNotes([line], { evidenceSets, history: said(line) }).kept, [line])
})

/* ═══ 5. WHOSE WORDS COUNT AS HAVING SAID IT ═══════════════════════════════ */

test('*** only HER prior turns count — the Owner saying it is not her having said it ***', () => {
  // Same family as the attribution bug next door: if his messages are read as hers, she
  // concludes she has already explained something she never explained.
  const line = '庫存資料冇分地點。'
  const { kept } = prune([line], [{ role: 'user', text: '啲庫存數字冇分地點㗎可？' }])
  assert.deepEqual(kept, [line], 'he asked about it; she has not yet told him')
})

test('it reads the field the client actually sends', () => {
  const line = '庫存資料冇分地點。'
  assert.deepEqual(prune([line], [{ role: 'assistant', text: '冇地點維度。' }]).kept, [], 'text')
  assert.deepEqual(prune([line], [{ role: 'assistant', content: '冇地點維度。' }]).kept, [], 'content')
})

/* ═══ 6. IT CAN ONLY EVER DELETE ═══════════════════════════════════════════ */

test('*** it never rewrites a line and never adds one ***', () => {
  const lines = ['庫存資料冇分地點。', '有 3 項核對唔到。', '未讀到供應商價目。']
  const { kept } = prune(lines, said('冇地點。'))
  for (const k of kept) assert.ok(lines.includes(k), 'every surviving line is byte-identical to its input: ' + k)
  assert.ok(kept.length <= lines.length)
})

test('bad input degrades to keeping everything, never to throwing', () => {
  for (const bad of [null, undefined, 'not an array', 42]) {
    assert.deepEqual(pruneRepeatedScopeNotes(['x'], { evidenceSets: bad, history: bad }).kept, ['x'])
  }
  assert.deepEqual(pruneRepeatedScopeNotes(null, {}).kept, [])
})
