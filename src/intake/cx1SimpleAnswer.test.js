'use strict'

/**
 * cx1SimpleAnswer.test.js — CX1. A simple question gets a simple answer.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PRODUCTION FAILURE THIS FILE PINS.
 *
 * > **Owner: 「香香，你現在能看圖像，分析圖像嗎？」**
 *
 * The answer is one word long. What came back was an inventory of other capabilities, a
 * roadmap nobody asked for, and a follow-up question — and the follow-up question is the
 * part that matters, because a question after 「I cannot do that」 reads as 「tell me more
 * and I will」.
 *
 * ⛔ NOTHING WAS DISHONEST, AND THAT IS THE WHOLE DIAGNOSIS. `image.input：未實作` has been
 * in `capabilityBlock()` since S1 and really did reach the prompt. Two things were wrong,
 * neither of them a fact:
 *
 *   1. `laneRouter` did not RECOGNISE the question. Both capability patterns anchored the
 *      modal directly to 你, so 「你現在能」 — the adverb sitting where the pattern expected
 *      the modal — fell through to the generic `question` reason.
 *   2. Nothing told the model to ANSWER IT. The conversation contract said 「分清楚三件事」
 *      unconditionally, so a question with a one-word answer was handed a template for
 *      three categories of answer.
 *
 * ⛔ AND THE SHAPE IS ASKED FOR, NEVER IMPOSED. The model authors every word. No path here
 * truncates, trims or rewrites the reply — a length cap applied after generation cuts a
 * sentence in half and calls it brevity.
 *
 * ⛔ THE ONE THING CX1 MUST NOT DO IS ALSO PINNED, IN FIXTURE 9. 「你可以幫我睇下下星期有咩
 * 安排嗎?」 is the SAME SHAPE as a capability question and is a genuine Calendar read. If the
 * answer-shape directive ever reaches it, a real question about next week is answered with a
 * short sermon about what she can do. That fixture is the reason the gate is
 * `isCapabilityOnlyQuestion` and not the router's `capability_question` reason.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const { describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')

/**
 * ⛔ THE STATE A TEST NAMES MUST BE ESTABLISHED, NOT INHERITED — the same reason
 * laneRouter.test.js clears these. Run from a terminal carrying the launcher environment,
 * ambient flags change what routes and what reads.
 */
const clearRuntimeFlags = () => {
  for (const k of [
    'TURN_ROUTER', 'MULTI_AI_ROUTER', 'CONVERSATION_RECALL', 'DECISION_RECALL',
    'READ_ACCESS', 'CONTEXT_DRIVE', 'CONTEXT_GMAIL', 'CONTEXT_CALENDAR',
    'CONTEXT_GITHUB', 'CONTEXT_AROMA_SYSTEM', 'AGENT_BRIDGE', 'XIANGXIANG_ARCHIVE',
    'CONVERSATION_CONTRACT', 'CONVERSATION_DEMO', 'GOAL_DECOMPOSER', 'A4_SEMANTIC_ROUTING'
  ]) delete process.env[k]
}
beforeEach(clearRuntimeFlags)
afterEach(clearRuntimeFlags)

const { routeLane, isCapabilityOnlyQuestion, CHAT, EMAIL, PROPOSAL } = require('./laneRouter')
const { routeTurn } = require('./turnRouter')
const { processIntake } = require('./intakeService')
const { implementationOf, IMPLEMENTATION, capabilityBlock } = require('../governance/selfCapability')
const { CONVERSATION_CONTRACT } = require('../persona/conversationContract')

/** The one marker the answer-shape directive is identified by, everywhere in this file. */
const SHAPE_MARKER = '【直接回答 — 呢句係能力提問】'

/* ══════════════════════════════════════════════════════════════════════════════
 * PART 1 — RECOGNITION. Pure, free, zero-context; no model and no service.
 * ════════════════════════════════════════════════════════════════════════════ */

describe('CX1 PART 1 — the classifier', () => {
  test('*** ⛔ THE PRODUCTION FAILURE: 「你現在能…嗎？」 is a capability question ***', () => {
    const m = '香香，你現在能看圖像，分析圖像嗎？'
    assert.equal(routeLane(m, {}).reason, 'capability_question',
      '⛔ the adverb between the pronoun and the modal still hides the question')
    assert.equal(routeLane(m, {}).lane, CHAT)
    assert.equal(isCapabilityOnlyQuestion(m), true)
  })

  test('an adverb may sit between the pronoun and the modal, in either spelling', () => {
    for (const m of [
      '你現在能看圖像嗎？', '你而家可唔可以自己改 code?', '你目前可以連到 Gmail 嗎?',
      '你依家識唔識收圖?', '你如今能夠幫我做呢啲嗎?', '你仲可以記得我哋講過咩嗎?',
      '你而家仲可唔可以出提案?', '你究竟識唔識做?', '你到底能唔能夠做到呢件事?'
    ]) {
      assert.equal(routeLane(m, {}).reason, 'capability_question', 'should be a capability question: ' + m)
    }
  })

  test('the forms that already worked still work — the adverb slot took nothing away', () => {
    for (const m of [
      '你識唔識寫 email?', '你識唔識得做?', '你會唔會做?', '你可唔可以做?',
      '你能唔能夠做?', '你得唔得閒?', 'can you draft a reply', 'could you do this',
      'are you able to do that', 'do you know how to do it', '你可以幫我回覆 email 嗎？'
    ]) {
      assert.equal(routeLane(m, {}).reason, 'capability_question', 'regressed: ' + m)
    }
  })

  test('the A-唔-A form is recognised for ABILITY / MEMORY / REACHABILITY verbs', () => {
    for (const m of [
      '你記唔記得我哋上次講咩?', '你讀唔讀到 Calendar?', '你知唔知呢件事?',
      '你知道唔知道呢件事?', '你而家記唔記得?'
    ]) {
      assert.equal(routeLane(m, {}).reason, 'capability_question', 'A-唔-A missed: ' + m)
    }
  })

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⛔ THE OWNER'S RELEASE BLOCKER, PINNED. CX1 IS NOT A ROUTING TRANCHE.
   *
   * The first draft matched ANY repeated verb, so 「你改唔改 docs/x.md」 and 「你回唔回覆
   * Rob」 became capability questions and left their lanes. Both are yes/no questions, and
   * moving them to chat is the safe DIRECTION — but the safe-fallback principle is a rule
   * about ambiguity, not a warrant to change general action semantics inside a tranche
   * authorised only to fix an answer shape.
   *
   * These two fixtures are the Owner's, verbatim, and they assert PRE-CX1 semantics.
   * ══════════════════════════════════════════════════════════════════════════
   */
  test('*** ⛔ SCOPE: 「你改唔改 docs/x.md」 keeps its pre-CX1 routing ***', () => {
    const r = routeLane('你改唔改 docs/x.md', {})
    assert.equal(r.lane, PROPOSAL, '⛔ CX1 moved a change instruction out of the proposal lane')
    assert.notEqual(r.reason, 'capability_question')
    assert.equal(isCapabilityOnlyQuestion('你改唔改 docs/x.md'), false)
  })

  test('*** ⛔ SCOPE: 「你回唔回覆 Rob」 keeps its pre-CX1 routing ***', () => {
    const r = routeLane('你回唔回覆 Rob', {})
    assert.equal(r.lane, EMAIL, '⛔ CX1 moved a correspondence instruction out of the email lane')
    assert.notEqual(r.reason, 'capability_question')
    assert.equal(isCapabilityOnlyQuestion('你回唔回覆 Rob'), false)
  })

  /**
   * ⛔ THE ACT VERBS AS A CLASS, not only the Owner's two. An act performed on an object is
   * never a capability question, in the A-唔-A form or any other.
   */
  test('*** ⛔ SCOPE: no act verb in the A-唔-A form becomes a capability question ***', () => {
    for (const m of [
      '你改唔改 docs/x.md', '你回唔回覆 Rob', '你寫唔寫封 email 畀 Rob',
      '你刪唔刪除 docs/x.md', '你加唔加入 docs/x.md'
    ]) {
      assert.notEqual(routeLane(m, {}).reason, 'capability_question', '⛔ an act verb became a capability question: ' + m)
      assert.equal(isCapabilityOnlyQuestion(m), false, '⛔ act verb captured: ' + m)
    }
  })

  /**
   * ⛔ THE PRE-CX1 LANE TABLE, RE-ASSERTED WHOLE. The Owner asked for proof that the genuine
   * instruction fixtures still route as they did, not merely that his two examples do.
   * These are lifted from laneRouter.test.js — the routing table as it stood at 950e6df.
   */
  test('*** ⛔ SCOPE: the pre-CX1 EMAIL and PROPOSAL fixtures are untouched ***', () => {
    for (const m of [
      '幫我回覆 Rob', '回覆 Rob 話我聽日覆佢', '寫封 email 畀供應商', '寫信畀 Rob',
      '幫我回覆這封 email', 'Reply to the marketing team', '你可以幫我回覆呢封 email'
    ]) assert.equal(routeLane(m, {}).lane, EMAIL, 'EMAIL regressed: ' + m)

    for (const m of ['修改 canary file', '幫我改 docs/x.md', '更新 src/index.js', '你改唔改 docs/x.md']) {
      assert.equal(routeLane(m, {}).lane, PROPOSAL, 'PROPOSAL regressed: ' + m)
    }

    for (const m of ['今日有冇重要 email?', '今日點呀', '幫我設計一個每天檢查同回覆 email 的工作流程']) {
      assert.equal(routeLane(m, {}).lane, CHAT, 'CHAT regressed: ' + m)
    }
  })

  /**
   * ⛔ THE QUESTION MARKER IS STILL REQUIRED, AND THIS IS WHY THE ADVERB LIST IS CLOSED.
   * A wildcard between the pronoun and the modal would let a VERB in, and 「你幫我改 code
   * 可以嗎」 is a request. These are polite INSTRUCTIONS; every one must keep its lane.
   */
  test('*** ⛔ ADVERSARIAL: a polite instruction is not a question and keeps its lane ***', () => {
    for (const m of ['你可以幫我回覆呢封 email', '你而家幫我回覆呢封 email', '你現在幫我回覆 Rob']) {
      assert.equal(routeLane(m, {}).lane, EMAIL, 'a polite instruction stopped drafting: ' + m)
      assert.equal(isCapabilityOnlyQuestion(m), false)
    }
    for (const m of ['幫我改 docs/x.md', '你而家幫我改 docs/x.md']) {
      assert.equal(routeLane(m, {}).lane, PROPOSAL, 'a change instruction stopped proposing: ' + m)
      assert.equal(isCapabilityOnlyQuestion(m), false)
    }
  })

  /**
   * ⛔ A NOUN IS NOT AN INSTRUCTION. Every one of these names email, code or Calendar and
   * every one is asking what she IS. If the noun ever decides the lane, the E3 defect is back.
   */
  test('a capability question containing email / code / calendar nouns stays a question', () => {
    for (const m of [
      '你可以幫我 send email 嗎?', '你可以幫我改 code 嗎?', '你而家讀唔讀到 Calendar?',
      '你識唔識寫 code?', '你現在能連到 Gmail 嗎?'
    ]) {
      const r = routeLane(m, {})
      assert.equal(r.lane, CHAT, 'a capability question left chat: ' + m)
      assert.equal(r.reason, 'capability_question', m)
      assert.equal(isCapabilityOnlyQuestion(m), true, 'should be capability-only: ' + m)
    }
  })

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⛔ FIXTURE 9, AT THE CLASSIFIER. THE CRITICAL NEGATIVE.
   *
   * 「你可以幫我睇下下星期有咩安排嗎?」 matches CAPABILITY_ENQUIRY — it always has, and the
   * lane has always been CHAT. What must stay true is that it is not treated as a question
   * ABOUT her: it names a look-up act, so it is a request to go and read.
   * ══════════════════════════════════════════════════════════════════════════
   */
  test('*** ⛔ CRITICAL NEGATIVE: a genuine read request is not a capability-only question ***', () => {
    for (const m of [
      '你可以幫我睇下下星期有咩安排嗎?', '你可以幫我睇下 Calendar 嗎?',
      '你而家可唔可以查下今日有咩 email?', '你可以 check 下有冇新訂單嗎?'
    ]) {
      assert.equal(isCapabilityOnlyQuestion(m), false, '⛔ a read request was read as a capability question: ' + m)
    }
  })

  test('*** ⛔ CRITICAL NEGATIVE: read routing is unchanged — Calendar is still named ***', () => {
    process.env.TURN_ROUTER = 'on'
    const d = routeTurn('你可以幫我睇下下星期有咩安排嗎?', {})
    assert.equal(d.route, 'BUSINESS_QUERY', '⛔ the read route was lost')
    assert.ok(d.sources.includes('calendar'), '⛔ Calendar is no longer a source for this turn')
  })

  test('ordinary chat and self-description are not capability questions', () => {
    for (const m of ['你係邊個?', '你而家用緊邊個 model?', '今日點呀', '早晨']) {
      assert.equal(isCapabilityOnlyQuestion(m), false, 'ordinary chat was captured: ' + m)
    }
  })

  test('the predicate is pure, total and never throws on junk', () => {
    for (const m of [null, undefined, 0, {}, [], '', '   ']) {
      assert.equal(isCapabilityOnlyQuestion(m), false, JSON.stringify(m))
    }
    const m = '你現在能看圖像嗎？'
    for (let i = 0; i < 5; i++) assert.equal(isCapabilityOnlyQuestion(m), true, 'not idempotent')
  })

  /**
   * ⛔ IT REPORTS A SHAPE; IT DECIDES NO ROUTE. If this predicate ever appears in routeLane
   * or routeTurn, a wrong `true` stops being a longer answer and starts being a lost read.
   */
  test('*** ⛔ the shape predicate is not wired into any routing decision ***', () => {
    const fs = require('fs')
    const path = require('path')
    for (const f of ['laneRouter.js', 'turnRouter.js']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
      // The declaration is `function isCapabilityOnlyQuestion (message)` — with the space
      // this project's style requires — so a bare `name(` is a CALL and nothing else.
      const calls = src.split('isCapabilityOnlyQuestion(').length - 1
      assert.equal(calls, 0, `⛔ ${f} calls the shape predicate ${calls} time(s) — a wrong 'true' would now cost a read, not a longer answer`)
    }
    // …and it really is defined where this test thinks it is, or the check above is vacuous.
    assert.match(fs.readFileSync(path.join(__dirname, 'laneRouter.js'), 'utf8'),
      /function isCapabilityOnlyQuestion \(message\)/, 'the predicate moved; this survey is no longer looking at it')
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * PART 2 — THE PROMPT. Scripted adapter, zero live model calls.
 * ════════════════════════════════════════════════════════════════════════════ */

const ENV = {
  READ_ACCESS: 'on', CONTEXT_CALENDAR: 'on', CONTEXT_GMAIL: 'on', CONTEXT_DRIVE: 'off',
  CONTEXT_GITHUB: 'off', CONTEXT_AROMA_SYSTEM: 'on', CONVERSATION_DEMO: 'on',
  DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off', TURN_ROUTER: 'on'
}
async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/**
 * ⛔ NO LIVE MODEL, EVER. `complete` is a scripted function: it records the prompt it was
 * handed and returns a fixed body. Qualification for CX1 is about what the model is TOLD,
 * which is fully observable without asking one.
 */
async function turn (opts) {
  const prompts = []
  let idx = 0
  const adapter = {
    async complete (p, o = {}) {
      const name = (o.responseFormat && o.responseFormat.name) || null
      if (name === 'goal_plan') return { text: JSON.stringify(opts.plan || {}), usage: { inputTokens: 1, outputTokens: 1 } }
      prompts.push(String(p))
      const script = opts.script || [{ intent: 'question', mode: 'chat', reply: '做唔到。', nextRead: null, answerPlan: null }]
      const body = script[Math.min(idx, script.length - 1)]
      idx++
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
  let reads = 0
  const realLog = console.log
  console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[AROMA')) return; realLog(...a) }
  let res
  try {
    res = await processIntake(opts.message, adapter, [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: {
        sources: opts.sources || ['calendar'],
        connector: { async read () { reads++; return { ok: true, items: [] } } },
        finalVerifier: async () => ({ decision: 'allow_final', question: null }),
        sourceIntentResolver: async () => JSON.stringify({ intent: opts.intent || 'not_applicable' })
      }
    })
  } finally { console.log = realLog }
  return { res, reads, prompts, terminal: prompts[prompts.length - 1] || '', all: prompts.join('\n---\n') }
}

/** Every fixture in the Owner's list, and what the prompt must look like for each. */
const FIXTURES = [
  { n: 1, m: '香香，你現在能看圖像，分析圖像嗎？', shape: true, capability: 'image.input', state: IMPLEMENTATION.NOT_IMPLEMENTED },
  { n: 2, m: '你可以幫我改 code 嗎?', shape: true, capability: 'github.write', state: IMPLEMENTATION.NOT_IMPLEMENTED },
  { n: 3, m: '你記唔記得我哋上次講咩?', shape: true, capability: 'conversation_recall', state: IMPLEMENTATION.IMPLEMENTED },
  { n: 4, m: '你而家讀唔讀到 Calendar?', shape: true, capability: 'calendar.read', state: IMPLEMENTATION.IMPLEMENTED },
  { n: 5, m: '你識唔識收檔案?', shape: true, capability: 'file.input', state: IMPLEMENTATION.NOT_IMPLEMENTED },
  { n: 6, m: '你可以幫我 send email 嗎?', shape: true, capability: 'gmail.send', state: IMPLEMENTATION.NOT_IMPLEMENTED },
  { n: 7, m: '你係邊個?', shape: false, capability: null, state: null },
  { n: 8, m: '你而家用緊邊個 model?', shape: false, capability: null, state: null },
  { n: 9, m: '你可以幫我睇下下星期有咩安排嗎?', shape: false, capability: null, state: null },
  { n: 10, m: '你可以幫我改 Aroma System 啲數?', shape: true, capability: 'aroma_system.write', state: IMPLEMENTATION.NOT_IMPLEMENTED }
]

describe('CX1 PART 2 — the answer-shape directive reaches exactly the right turns', () => {
  for (const f of FIXTURES) {
    test(`fixture ${f.n}: 「${f.m}」 → shape directive ${f.shape ? 'PRESENT' : 'ABSENT'}`, async () => {
      await withEnv(async () => {
        const t = await turn({ message: f.m })
        assert.equal(t.terminal.includes(SHAPE_MARKER), f.shape,
          f.shape
            ? `⛔ fixture ${f.n} did not receive the answer-shape directive`
            : `⛔ fixture ${f.n} received the answer-shape directive and must not`)
        // The capability FACTS travel on every turn, shape directive or not.
        assert.ok(t.terminal.includes('【SELF CAPABILITY'), 'the capability block stopped travelling')
      })
    })
  }

  test('*** ⛔ THE PRIMARY FAILURE, END TO END: the shape directive and image.input：未實作 ***', async () => {
    await withEnv(async () => {
      const t = await turn({ message: '香香，你現在能看圖像，分析圖像嗎？' })
      assert.equal(implementationOf('image.input'), IMPLEMENTATION.NOT_IMPLEMENTED)
      assert.ok(t.terminal.includes(SHAPE_MARKER), '⛔ the answer-shape directive never reached the model')
      assert.match(t.terminal, /image\.input（睇圖／收圖）：未實作/, '⛔ the fact did not travel')
      // The shape directive sits directly under the facts it is about.
      assert.ok(t.terminal.indexOf('【SELF CAPABILITY') < t.terminal.indexOf(SHAPE_MARKER),
        '⛔ the directive was placed above the facts it refers to')
    })
  })

  /**
   * ⛔ FIXTURE 9 AT THE PROMPT: the read really happens AND no sermon is requested.
   * Two assertions, because either one alone would pass on a broken build — a turn that
   * reads nothing also carries no shape directive.
   */
  test('*** ⛔ CRITICAL NEGATIVE: the real read runs and carries no shape directive ***', async () => {
    await withEnv(async () => {
      const t = await turn({ message: '你可以幫我睇下下星期有咩安排嗎?', sources: ['calendar'] })
      assert.equal(t.terminal.includes(SHAPE_MARKER), false, '⛔ a genuine read request was told to answer briefly about capability')
      assert.ok(t.reads >= 1, '⛔ THE READ DID NOT RUN — this fixture cannot prove anything about suppression')
    })
  })

  test('the directive is composed once and never truncates the reply', async () => {
    await withEnv(async () => {
      const long = '一二三四五六七八九十'.repeat(30)
      const t = await turn({
        message: '你識唔識收檔案?',
        script: [{ intent: 'question', mode: 'chat', reply: long, nextRead: null, answerPlan: null }]
      })
      assert.ok(t.terminal.includes(SHAPE_MARKER))
      const reply = String((t.res && (t.res.reply || t.res.content)) || '')
      assert.ok(reply.includes(long), '⛔ the reply was truncated after generation — CX1 asks for a shape, it does not cut prose')
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * PART 3 — CAPABILITY HONESTY IS NOT WHAT WAS SHORTENED.
 * ════════════════════════════════════════════════════════════════════════════ */

describe('CX1 PART 3 — honesty survives the narrowing', () => {
  test('*** ⛔ the shape directive carries the two clauses that stop a brief reassurance ***', async () => {
    await withEnv(async () => {
      const t = await turn({ message: '你識唔識收檔案?' })
      assert.match(t.terminal, /「未實作」係確定嘅答案/, '⛔ unavailable stopped meaning unavailable')
      assert.match(t.terminal, /唔可以暗示佢畀多啲細節、換個講法或者再試一次就做到/, '⛔ the no-false-unlock clause is gone')
      assert.match(t.terminal, /「已實作」唔等於而家連得到/, '⛔ implementation was allowed to mean reachability')
      assert.match(t.terminal, /亦唔等於呢一轉有權用/, '⛔ implementation was allowed to mean turn authority')
    })
  })

  test('the contract still discloses limits first, and no longer expands three ways by default', () => {
    assert.ok(CONVERSATION_CONTRACT.includes('先說明這個限制'), 'disclosure-first was removed')
    assert.ok(CONVERSATION_CONTRACT.includes('然後才問細節'), 'details-after was removed')
    // The three-way split still exists — it is now SCOPED to a task request.
    assert.ok(CONVERSATION_CONTRACT.includes('你現在可以做的'))
    assert.ok(CONVERSATION_CONTRACT.includes('需要 Louie 批准的'))
    assert.ok(CONVERSATION_CONTRACT.includes('必須由獲授權執行者執行的'))
    assert.match(CONVERSATION_CONTRACT, /只有在他要你動手做一件事時,才分清楚三件事/,
      '⛔ the three-way split is unconditional again — CX1 exists because it was')
    assert.match(CONVERSATION_CONTRACT, /直接問你有沒有某項能力時,直接答那一項就夠/,
      '⛔ the direct-question exemption is gone')
    assert.ok(CONVERSATION_CONTRACT.includes('不可暗示只要提供更多細節'), 'no-false-unlock was removed')
    assert.match(CONVERSATION_CONTRACT, /「已實作」不等於現在連得到,也不等於這一輪有權使用/,
      '⛔ implementation ≠ reachability ≠ turn authority was dropped')
  })

  /**
   * ⛔ D — CAPABILITY TRUTH IS NOT A CX1 SEAM. The registry answers what the build DOES;
   * CX1 only changes how that is said. A tranche that had to edit the registry to make a
   * capability question answer well would be changing the product, not the prose.
   */
  test('*** ⛔ the capability registry was not touched: the block is byte-identical ***', () => {
    const block = capabilityBlock()
    assert.match(block, /image\.input（睇圖／收圖）：未實作/)
    assert.match(block, /file\.input（收檔案附件）：未實作/)
    assert.match(block, /gmail\.send（send／回覆郵件）：未實作/)
    assert.match(block, /aroma_system\.write（改 Aroma System 資料）：未實作/)
    assert.match(block, /calendar\.read（讀 Calendar）：已實作/)
    assert.match(block, /conversation_recall（記得過往對話）：已實作/)
    assert.ok(block.includes('「已實作」唔等於而家連得到'), 'the registry rule text changed')
    assert.equal(block.includes(SHAPE_MARKER), false, '⛔ CX1 wording leaked into the capability facts')
  })

  /**
   * ⛔ ONE CONSUMER, AND A SURVEY TEST BECAUSE THIS IS A CATEGORY RULE. A second call site
   * would be a second place for the shape and the facts to drift apart, and the Owner would
   * never see the drift — he would see an answer that was almost right.
   */
  test('*** ⛔ exactly one consumer of the answer-shape directive in the whole tree ***', () => {
    const fs = require('fs')
    const path = require('path')
    const root = path.join(__dirname, '..')
    let calls = 0
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue
        const src = fs.readFileSync(p, 'utf8')
        calls += src.split('CAPABILITY_ANSWER_SHAPE').length - 1
      }
    }
    walk(root)
    // Exactly two occurrences, both in intakeService.js: the definition and the one use.
    assert.equal(calls, 2, `⛔ the answer-shape directive has ${calls} mentions; expected the definition plus ONE consumer`)
  })
})
