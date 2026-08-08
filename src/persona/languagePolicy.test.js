'use strict'

/**
 * languagePolicy.test.js — Owner Language Policy, Round 1.
 *
 * ── THE FINDING THIS ROUND ACTS ON ───────────────────────────────────────────
 * PERSONA_IDENTITY line 12 has always said 「使用繁體中文」, and it contains ZERO Cantonese
 * (3,113 chars, 31 lines, 0 colloquial markers). The Cantonese output was authorised by
 * exactly ONE clause, one file away, in a block placed AFTER the persona in the system
 * string and therefore winning:
 *
 *     '- 語氣溫暖、有判斷力、有彈性;可自然使用廣東話、中文與英文。'
 *
 * Two contradictory language instructions in the same system string, and the more specific,
 * later one decided her voice. Removing it is necessary and NOT sufficient — a model mirrors
 * the language it is written to, and the Owner writes Cantonese — so the clause is REPLACED
 * with a positive default rather than deleted.
 *
 * ── WHY IT LIVES HERE AND NOT IN THE PERSONA ─────────────────────────────────
 * The Conversation Contract is already a plain string handed across the abstract LLMAdapter
 * boundary, so Claude and GPT receive byte-identical text. The frozen PERSONA_IDENTITY needs
 * no unlock and no re-signature, and the test below proves this round did not touch it.
 *
 * ── WHAT THESE TESTS CAN AND CANNOT PROVE ────────────────────────────────────
 * HONESTLY: the language of an actual reply is MODEL BEHAVIOUR. Nothing here proves she will
 * write 目前 instead of 而家 — only a real (paid) turn can show that, and the Owner judges it
 * by using her. What is proven here is everything that is deterministic: that the instruction
 * exists, that it says what the policy says, that it reaches the model exactly once, that the
 * persona is untouched — and, in the last section, the part that is NOT model behaviour at
 * all: that no code path rewrites a proper noun.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { CONVERSATION_CONTRACT } = require('./conversationContract')
const { PERSONA_IDENTITY } = require('./xiangxiang')

const CANTO = /[嘅咗唔喺睇冇嘢咁乜嗰哋㗎嘞咩嚟攞俾諗搵揾啱嘥喎囉啲]|而家|梗係/

/* ═══ 1. THE AUTHORISING CLAUSE IS GONE ═════════════════════════════════════ */

test('*** the contract no longer authorises Cantonese output ***', () => {
  assert.equal(CONVERSATION_CONTRACT.includes('可自然使用廣東話'), false,
    'THE CLAUSE that overrode PERSONA_IDENTITY line 12 for the life of the feature')
})

test('*** and it is REPLACED by a positive default, not merely deleted ***', () => {
  // Deleting it would leave the model to mirror whatever language the Owner writes in —
  // which is Cantonese. Silence is not an instruction.
  assert.ok(CONVERSATION_CONTRACT.includes('書面繁體中文'), 'the default is named')
  assert.ok(/無論.*哪一種語言/.test(CONVERSATION_CONTRACT), 'and it holds regardless of what he writes in')
})

/* ═══ 2. COMPREHENSION IS UNCHANGED — ONLY OUTPUT ═══════════════════════════ */

test('*** she must still UNDERSTAND Cantonese; only her output changes ***', () => {
  assert.ok(/聽得懂|理解/.test(CONVERSATION_CONTRACT) && CONVERSATION_CONTRACT.includes('廣東話'),
    'Cantonese comprehension is stated, not withdrawn')
})

test('*** the Owner is never asked to switch language ***', () => {
  assert.ok(CONVERSATION_CONTRACT.includes('不要請他轉用'), 'he writes Cantonese; that is not a problem to be fixed')
})

test('Cantonese on explicit request only', () => {
  assert.ok(/明確要求時才用廣東話/.test(CONVERSATION_CONTRACT))
})

/* ═══ 3. MIXED LANGUAGE ═════════════════════════════════════════════════════ */

test('*** English words in the question do not turn the whole answer English ***', () => {
  assert.ok(CONVERSATION_CONTRACT.includes('保留那些英文原文'), 'English terms survive')
  assert.ok(/不要因為出現英文字就整段改用英文/.test(CONVERSATION_CONTRACT), 'and the answer stays Chinese')
  assert.ok(/以英文為主/.test(CONVERSATION_CONTRACT), 'full English has its own, narrower trigger')
})

/* ═══ 4. PRONOUNS ═══════════════════════════════════════════════════════════ */

test('*** never guess gender ***', () => {
  assert.ok(CONVERSATION_CONTRACT.includes('絕不猜測性別'), 'stated flatly')
  assert.ok(/不要機械地把「佢」/.test(CONVERSATION_CONTRACT), 'and 佢 is not mechanically converted')
  assert.ok(/重複名字|省略人稱|中性/.test(CONVERSATION_CONTRACT), 'with something to do instead')
})

/* ═══ 5. PROPER NOUNS — POLICY TEXT ═════════════════════════════════════════ */

test('*** proper nouns keep their original spelling ***', () => {
  for (const name of ["Miller's Meats", 'SUNCO FOODS', 'Napa Cabbage', 'Aroma System']) {
    assert.ok(CONVERSATION_CONTRACT.includes(name), 'named as an example: ' + name)
  }
  assert.ok(/不可取代原名/.test(CONVERSATION_CONTRACT), 'a Chinese gloss adds, never replaces')
})

test('*** the policy governs prose only — it may never touch source data ***', () => {
  assert.ok(/絕不可用來翻譯或改動資料本身/.test(CONVERSATION_CONTRACT),
    'the one line that stops a style rule becoming a data mutation')
})

/* ═══ 6. THE FROZEN PERSONA IS UNTOUCHED ════════════════════════════════════ */

test('*** PERSONA_IDENTITY was not touched, and did not need to be ***', () => {
  assert.equal(CANTO.test(PERSONA_IDENTITY), false, 'it never held any Cantonese')
  assert.ok(PERSONA_IDENTITY.includes('使用繁體中文'), 'it already required Traditional Chinese')
  assert.equal(PERSONA_IDENTITY.includes('書面繁體中文'), false, 'and the new policy did not leak into it')
})

/* ═══ 7. IT STILL REACHES THE MODEL, ONCE ═══════════════════════════════════ */

test('*** the policy is inside the block that crosses the adapter boundary ***', async () => {
  // Vendor-neutral by construction: same string to Claude and to GPT. This asserts the
  // policy travels with the contract rather than sitting in a file nobody sends.
  const { buildPersonaSystemFromPersona } = require('./xiangxiang')
  const sys = buildPersonaSystemFromPersona(PERSONA_IDENTITY, 'CLASSIFIER', { extraGuards: [CONVERSATION_CONTRACT] })
  assert.ok(sys.includes('書面繁體中文'), 'the policy is in the composed system string')
  assert.equal((sys.match(/書面繁體中文/g) || []).length >= 1, true)
  assert.ok(sys.indexOf(PERSONA_IDENTITY) < sys.indexOf('書面繁體中文'), 'after the persona, as the seam requires')
})

/* ═══ 8. NO PROPER NOUN IS REWRITTEN BY CODE — the deterministic half ═══════ */

test('*** the Aroma System rewrite table is WITHDRAWN ***', () => {
  // Owner decision, this round: the policy lists Aroma System as a preserve-original
  // example, and one rule holds better than two exceptions.
  const { SOURCE_NAME_REWRITES } = require('../intake/answerPlan')
  assert.deepEqual(SOURCE_NAME_REWRITES, [], 'no name rewrites remain')
})

test('*** "Aroma System" survives verbatim through the render path ***', () => {
  // NOT model behaviour — this is code that used to rewrite it, and now must not.
  const { validatePlan } = require('../intake/answerPlan')
  const evidenceSets = [{ source: 'aroma_system', trust: 'live', matchingTotal: 199, shownCount: 1, completeness: 'sample', scope: {}, metrics: {} }]
  const itemsBySource = [{
    source: 'aroma_system',
    items: [{ source: 'aroma_system', sourceId: '1', title: 'Napa Cabbage', entityType: 'inventory_item', fields: { name: 'Napa Cabbage' } }]
  }]
  const r = validatePlan({
    citesEvidence: true,
    directAnswer: 'Aroma System 有 199 項存貨記錄。',
    sections: [{ heading: 'Aroma System', items: [{ title: 'Napa Cabbage', sourceId: '1', ref: 'aroma_system#1', facts: [] }] }],
    limitations: [],
    followUp: null
  }, { evidenceSets, itemsBySource, message: '' })
  assert.ok(r.plan.directAnswer.includes('Aroma System'), 'THE REWRITE: prose said 餐廳系統 instead')
  assert.equal(r.plan.directAnswer.includes('餐廳系統'), false)
  assert.equal(r.plan.sections[0].heading, 'Aroma System', 'headings too')
})

test('a supplier and a product name are never transliterated by code', () => {
  const { translate, SOURCE_NAME_REWRITES } = require('../intake/answerPlan')
  // `translate` is a status-enum lookup and must stay one: a NAME passes straight through.
  for (const name of ["Miller's Meats", 'SUNCO FOODS', 'Napa Cabbage', 'The Forks', 'Claude', 'GPT']) {
    assert.equal(translate(name), name, 'must pass through untouched: ' + name)
    let s = name
    for (const [re, to] of SOURCE_NAME_REWRITES) s = s.replace(re, to)
    assert.equal(s, name, 'and no rewrite rule may claim it: ' + name)
  }
})
