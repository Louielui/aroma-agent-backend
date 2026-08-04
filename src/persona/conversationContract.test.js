'use strict'

// conversationContract.test.js — Conversation Experience Contract v1.
// Deterministic; NO live API, NO paid model call. Proves the flag is fail-closed,
// that OFF is byte-identical to today, that ON lands in the right slot, and that the
// frozen PERSONA_IDENTITY is untouched.

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-contract-test-'))

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const { CONVERSATION_CONTRACT, resolveConversationContract } = require('./conversationContract')
const { buildPersonaSystemFromPersona, buildPersonaSystem, PERSONA_IDENTITY, CONTEXT_CARD_GUARD, ACTION_HONESTY_GUARD } = require('./xiangxiang')
const { SYSTEM_PROMPT } = require('../intake/distillPrompt')
const { processIntake } = require('../intake/intakeService')

afterEach(() => { delete process.env.CONVERSATION_CONTRACT })

function recAdapter () {
  const calls = []
  return { calls, async complete (prompt, o) { calls.push({ prompt, system: o && o.system }); return { text: JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'ok' }), model: 'rec', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } } }
}

/* ── flag: strict 'on' only, fail-closed ──────────────────────────────────── */
test('resolveConversationContract: strict on only; unset/empty/invalid → off', () => {
  assert.equal(resolveConversationContract({}), 'off')
  for (const bad of ['', 'ON', 'On', 'true', '1', 'yes', 'enabled', ' on', 'off ']) {
    assert.equal(resolveConversationContract({ CONVERSATION_CONTRACT: bad }), 'off', `"${bad}" must be off`)
  }
  assert.equal(resolveConversationContract({ CONVERSATION_CONTRACT: 'off' }), 'off')
  assert.equal(resolveConversationContract({ CONVERSATION_CONTRACT: 'on' }), 'on')
})

/* ── FLAG OFF: byte-identical to today ────────────────────────────────────── */
test('FLAG OFF → adapter system is BYTE-IDENTICAL to the pre-contract composition', async () => {
  delete process.env.CONVERSATION_CONTRACT
  const a = recAdapter()
  await processIntake('聊天', a, [], { demo: true, interactionMode: 'chat' })
  // exactly what the system string was before this feature existed
  const expected = buildPersonaSystemFromPersona(PERSONA_IDENTITY, SYSTEM_PROMPT, { extraGuards: [ACTION_HONESTY_GUARD] })
  assert.equal(a.calls[0].system, expected)
  assert.ok(!a.calls[0].system.includes('對話體驗約定'))
})

/* ── FLAG ON: correct slot, classifier still last ─────────────────────────── */
test('FLAG ON → contract present, AFTER persona+guard, BEFORE the classifier', async () => {
  process.env.CONVERSATION_CONTRACT = 'on'
  const a = recAdapter()
  await processIntake('聊天', a, [], { demo: true, interactionMode: 'chat' })
  const sys = a.calls[0].system
  const iPersona = sys.indexOf(PERSONA_IDENTITY)
  const iGuard = sys.indexOf(CONTEXT_CARD_GUARD)
  const iHonesty = sys.indexOf(ACTION_HONESTY_GUARD)
  const iContract = sys.indexOf(CONVERSATION_CONTRACT)
  const iClassifier = sys.indexOf(SYSTEM_PROMPT)
  assert.ok(iPersona === 0, 'persona first')
  assert.ok(iPersona < iGuard, 'persona before data-boundary guard')
  assert.ok(iGuard < iHonesty, 'guard before honesty frame')
  assert.ok(iHonesty < iContract, 'honesty frame before contract')
  assert.ok(iContract < iClassifier, 'contract BEFORE the classifier')
  assert.ok(sys.endsWith(SYSTEM_PROMPT), 'classifier preserved verbatim at the END')
  assert.equal((sys.match(/對話體驗約定/g) || []).length, 1, 'injected exactly once')
})

test('FLAG ON → the frozen persona and guards are still verbatim in the system', async () => {
  process.env.CONVERSATION_CONTRACT = 'on'
  const a = recAdapter()
  await processIntake('聊天', a, [], { demo: true, interactionMode: 'chat' })
  assert.ok(a.calls[0].system.includes(PERSONA_IDENTITY), 'persona verbatim')
  assert.ok(a.calls[0].system.includes(CONTEXT_CARD_GUARD), 'data-boundary guard verbatim')
  assert.ok(a.calls[0].system.includes(ACTION_HONESTY_GUARD), 'honesty frame verbatim')
})

test('non-demo path is untouched by the flag (no persona, no contract)', async () => {
  process.env.CONVERSATION_CONTRACT = 'on'
  const a = recAdapter()
  await processIntake('聊天', a, []) // demo OFF
  assert.equal(a.calls[0].system, SYSTEM_PROMPT)
  assert.ok(!a.calls[0].system.includes('對話體驗約定'))
})

/* ── the frozen constant is NOT touched ───────────────────────────────────── */
test('PERSONA_IDENTITY is untouched: no contract text leaked into it', () => {
  assert.ok(!PERSONA_IDENTITY.includes('對話體驗約定'))
  assert.ok(!PERSONA_IDENTITY.includes(CONVERSATION_CONTRACT))
  // the 2-arg legacy composer must remain byte-identical (its own frozen test also covers this)
  assert.equal(buildPersonaSystem('CLASSIFIER'), [PERSONA_IDENTITY, CONTEXT_CARD_GUARD, 'CLASSIFIER'].join('\n\n'))
})

/* ── content constraints from the brief ───────────────────────────────────── */
test('contract governs HOW she speaks: no title reference, no schema change, no citation restatement', () => {
  // must NOT restate or soften the deferred title question
  assert.ok(!CONVERSATION_CONTRACT.includes('營運長'))
  assert.ok(!CONVERSATION_CONTRACT.includes('COO'))
  // must not redefine the output contract (that is the classifier's)
  assert.ok(CONVERSATION_CONTRACT.includes('不改變輸出格式'))
  assert.ok(!CONVERSATION_CONTRACT.includes('JSON'))
  // must NOT duplicate the read-context header's citation / three-state wording
  for (const owned of ['出處同日期', '讀到但冇相關結果', '目前讀不到', 'cite its source']) {
    assert.ok(!CONVERSATION_CONTRACT.includes(owned), `read-context header owns: ${owned}`)
  }
  // required substance is present
  for (const clause of ['自然流暢', '承接上文', '不奉承', '不編造', '不假裝擁有人類感情', '同一把聲音', '不可超過證據']) {
    assert.ok(CONVERSATION_CONTRACT.includes(clause), `missing clause: ${clause}`)
  }
})

/* ── v1.1: capability-boundary disclosure (the task-request gap) ───────────── */
test('v1.1: capability limits must be disclosed BEFORE asking for details', () => {
  assert.ok(CONVERSATION_CONTRACT.includes('能力邊界'), 'capability-boundary group present')
  // (1) disclose the limitation first, then ask for details
  assert.ok(CONVERSATION_CONTRACT.includes('先說明這個限制'), 'must disclose the limit first')
  assert.ok(CONVERSATION_CONTRACT.includes('然後才問細節'), 'details come after disclosure')
  assert.ok(/未接通|未啟用|未獲授權/.test(CONVERSATION_CONTRACT), 'covers unconnected/disabled/unauthorized')
  // (2) the three-way split
  assert.ok(CONVERSATION_CONTRACT.includes('你現在可以做的'), 'can do now')
  assert.ok(CONVERSATION_CONTRACT.includes('需要 Louie 批准的'), 'needs Owner approval')
  assert.ok(CONVERSATION_CONTRACT.includes('必須由獲授權執行者執行的'), 'authorized executor')
  // (3) no implication that more detail unlocks an unavailable capability
  assert.ok(CONVERSATION_CONTRACT.includes('不可暗示只要提供更多細節'), 'no false-unlock implication')
})

test('v1.1: the amendment did not disturb the existing groups or their order', () => {
  const i = (s) => CONVERSATION_CONTRACT.indexOf(s)
  assert.ok(i('表達:') < i('態度:'), '表達 before 態度')
  assert.ok(i('態度:') < i('能力邊界:'), '態度 before 能力邊界')
  assert.ok(i('能力邊界:') < i('一致性:'), '能力邊界 before 一致性')
  assert.ok(i('一致性:') < i('核心規則:'), '一致性 before 核心規則')
  assert.ok(CONVERSATION_CONTRACT.endsWith('語氣的確定程度不可超過證據所支持的程度。'), 'core rule still last')
  // v1.1 must remain a pure ADDITION: no citation/three-state wording crept in
  for (const owned of ['出處同日期', '讀到但冇相關結果', '目前讀不到']) {
    assert.ok(!CONVERSATION_CONTRACT.includes(owned), `read-context header owns: ${owned}`)
  }
  assert.ok(!CONVERSATION_CONTRACT.includes('營運長'), 'still no title reference')
})

test('contract is a static constant within the agreed size budget', () => {
  assert.equal(typeof CONVERSATION_CONTRACT, 'string')
  // Budget: the brief targeted ~500-900 chars. Every required clause is present (see the
  // clause test above) and the plain-text Chinese rendering costs 464 chars; the 500 floor
  // came from a markdown-formatted draft. Padding to reach it would spend tokens on
  // whitespace, so the floor is set at a sane 400.
  //
  // CEILING RAISED 900 → 1700, 2026-08-04, and NOT quietly. The Owner Language Policy adds a
  // permanent 語言 / 專有名詞 / 人稱 section of ~680 chars. The pre-existing contract was 870
  // chars — already 30 short of the old ceiling — so the policy could not have fitted under
  // it at any reasonable wording. The budget existed to stop this block bloating and
  // diluting the classifier that follows it, which is still the right concern; squeezing
  // an Owner-specified policy to fit a number set for a different purpose is not the right
  // answer to it. 1700 leaves headroom for wording fixes without another budget change, and
  // the ceiling remains a real constraint: a second section this size would break it again,
  // which is when someone should ask whether the contract needs restructuring.
  assert.ok(CONVERSATION_CONTRACT.length >= 400 && CONVERSATION_CONTRACT.length <= 1700, `char count ${CONVERSATION_CONTRACT.length} outside 400-1700`)
  assert.equal(CONVERSATION_CONTRACT, require('./conversationContract').CONVERSATION_CONTRACT) // same object each call
})
