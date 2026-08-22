'use strict'

/**
 * primaryIntentRouting.test.js — E3.
 *
 * ── THE TURN THIS EXISTS FOR ──────────────────────────────────────────────────
 * The Owner asked for several standing work areas: one to report on and reply to his email,
 * one for advertising, one for Google-review follow-up, one to supervise Aroma System.
 *
 * Production matched 回覆 and 電郵, routed `email_draft`, made ZERO model calls, and returned
 * an empty draft. Nothing that could answer a question about how to organise work ever read
 * the message. He got an artefact instead of an answer.
 *
 * ⛔ THE ROUTER ASKED THE WRONG QUESTION. Not 「are the words for writing a mail present?」 —
 * they were, and correctly so — but 「is writing a mail what he is ASKING FOR?」. Replying to
 * email was one RESPONSIBILITY of one area: a subordinate clause read as the whole request.
 *
 * ⛔ THE FIX IS NOT A STRING FOR 「區域」. It is the distinction already used one branch below,
 * where the proposal lane refuses an interrogative because 「a QUESTION about changing things
 * is not an instruction to change them」. An ORGANISING ACT applied to a STANDING THING is a
 * request about arrangement, whatever nouns it contains.
 */

const test = require('node:test')
const { describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { routeLane } = require('./laneRouter')

const lane = (m, opts) => routeLane(m, opts || {})

/** The exact production message, kept verbatim as the fixture it is. */
const REAL_WORKSPACE_REQUEST = [
  '你可以創造不同的區域，每天在那裡給我定期報告我的電郵和幫我回覆電郵嗎？',
  '另外，有一個區域，我希望是負責廣告推廣，',
  '另一個區域，是客戶的 google review 跟進。',
  '一個區域，是 aroma system 運作操作和監督'
].join('\n')

/* ═══ 1 & 2. THE REAL CASE ═══════════════════════════════════════════════════ */

describe('⛔ E3 — the real workspace request', () => {
  test('*** ⛔ 1. THE PRODUCTION FIXTURE IS NOT ROUTED TO email_draft ***', () => {
    assert.notEqual(lane(REAL_WORKSPACE_REQUEST).lane, 'email_draft',
      'THE DEFECT: an empty draft answered a question about how to organise work')
  })

  test('*** ⛔ 2. THE PRODUCTION FIXTURE REACHES THE CONVERSATIONAL BRAIN ***', () => {
    assert.equal(lane(REAL_WORKSPACE_REQUEST).lane, 'chat',
      'it must reach something that can actually answer an architecture question')
  })
})

/* ═══ 3, 4, 8. DIRECT CORRESPONDENCE STILL DRAFTS ════════════════════════════ */

describe('⛔ E3 — a real instruction to write a mail is untouched', () => {
  const DIRECT = [
    '幫我回覆這封 email',
    '寫封 email 畀 Rob',
    'Draft a reply to this email',
    '幫我回覆客人',
    '回覆呢封信話我哋星期五可以送貨',
    '幫我草擬一封 email 畀供應商',
    '你可以幫我回覆呢封 email'
  ]

  for (const m of DIRECT) {
    test(`*** 3/4. still email_draft: ${m.slice(0, 24)} ***`, () => {
      const r = lane(m)
      assert.equal(r.lane, 'email_draft', 'a direct correspondence instruction must still draft: ' + m)
      assert.equal(r.reason, 'write_act')
    })
  }

  test('*** ⛔ 8. A RECIPIENT WITHOUT THE WORD "EMAIL" STILL DRAFTS ***', () => {
    // 「幫我回覆 Rob」 — the recipient is what makes the act unambiguous.
    const r = lane('幫我回覆 Rob')
    assert.equal(r.lane, 'email_draft')
    assert.equal(r.reason, 'write_act')
  })

  test('*** ⛔ ONE NAMED MAIL OUTRANKS A PASSING MENTION OF A PROCESS ***', () => {
    // Otherwise a genuine instruction that happens to say 流程 would stop working.
    assert.equal(lane('幫我回覆呢封 email，講下我哋個流程').lane, 'email_draft')
  })
})

/* ═══ 5. CAPABILITY QUESTIONS ════════════════════════════════════════════════ */

describe('⛔ E3 — asking whether she can is not telling her to', () => {
  for (const m of ['你可以幫我回覆 email 嗎？', '你識唔識寫 email？', '你可唔可以幫我回覆封信？', 'Can you reply to my email?', 'Could you draft a reply?']) {
    test(`*** 5. capability question stays chat: ${m.slice(0, 24)} ***`, () => {
      assert.equal(lane(m).lane, 'chat', m)
    })
  }

  test('the boundary is the SUBJECT — a bare 可唔可以 with no 你 still drafts, as it always has', () => {
    // ⛔ PINNED, NOT FIXED. 「可唔可以幫我回覆封信？」 routes to email_draft at base 6c3c031a and
    // still does. Both readings are live in Cantonese — it is as often a polite instruction
    // ("go on, reply to it") as an enquiry — and E3 was not asked to settle that. Recording it
    // here so the boundary is a known position rather than an unexamined gap.
    assert.equal(lane('可唔可以幫我回覆封信？').lane, 'email_draft')
  })

  test('*** ⛔ THIS ONE WAS ALREADY BROKEN BEFORE E3, and is fixed here ***', () => {
    // Measured at base 6c3c031a: 「你可以…嗎？」 produced email_draft. CAPABILITY_QUESTION
    // covered 可唔可以 / 識唔識 and missed the plain 你可以.
    const r = lane('你可以幫我回覆 email 嗎？')
    assert.equal(r.lane, 'chat')
    assert.equal(r.reason, 'capability_question')
  })
})

/* ═══ 6 & 7. ARRANGEMENT REQUESTS, BEYOND THE ONE SENTENCE ═══════════════════ */

describe('⛔ E3 — designing the work is not doing the work', () => {
  const ARRANGEMENT = [
    ['multi-area architecture', '我要一個區域負責 email，一個負責廣告，一個負責 google reviews，一個管 aroma system'],
    ['workflow design', '幫我設計一個每天檢查同回覆 email 的工作流程'],
    ['a desk with responsibilities', '我想建立一個 inbox desk，負責分類同回覆電郵'],
    ['departments', '可唔可以建立幾個 AI 部門，其中一個處理 email？'],
    ['future architecture question', '如果日後香香可以幫我回覆 email，整體應該點設計？'],
    ['role assignment', '建立一個崗位，職責係每日回覆客人電郵'],
    ['english: set up areas', 'Can you set up a few areas, one of them replying to my email every day?'],
    ['english: design a workflow', 'I want to design a workflow that reviews and replies to email every day'],
    ['english: department', 'Please create a department responsible for replying to customer email']
  ]

  for (const [label, m] of ARRANGEMENT) {
    test(`*** 6/7. ${label} → chat, never a draft ***`, () => {
      assert.notEqual(lane(m).lane, 'email_draft', 'an arrangement request must not become a draft: ' + m)
      assert.equal(lane(m).lane, 'chat')
    })
  }
})

/* ═══ 9. MERE MENTION ════════════════════════════════════════════════════════ */

describe('⛔ E3 — naming email is not requesting one', () => {
  for (const m of ['今日我同 Ivy 講過 email workflow', 'email 回覆流程太亂', '我哋而家封封 email 都要人手處理', 'our email process is a mess']) {
    test(`*** 9. mention stays chat: ${m.slice(0, 24)} ***`, () => {
      assert.equal(lane(m).lane, 'chat', m)
    })
  }
})

/* ═══ 10 & 11. UNRELATED SEMANTICS UNCHANGED ═════════════════════════════════ */

describe('⛔ E3 — everything else routes exactly as before', () => {
  test('*** 10. short-confirmation continuation is unchanged ***', () => {
    assert.deepEqual(lane('1', { previousLane: 'email_draft' }), { lane: 'email_draft', reason: 'continuation' })
    assert.deepEqual(lane('好', { previousLane: 'chat' }), { lane: 'chat', reason: 'continuation' })
    // never continues INTO proposal
    assert.equal(lane('好', { previousLane: 'proposal' }).lane, 'chat')
  })

  test('*** 11. proposal / file-change semantics are unchanged ***', () => {
    assert.deepEqual(lane('幫我改 docs/canary/agent-canary.md 嗰行字'), { lane: 'proposal', reason: 'change_act' })
    // a QUESTION about changing is still not an instruction
    assert.equal(lane('可唔可以改 docs/x.md？').lane, 'chat')
  })

  test('an empty message is still chat', () => {
    assert.equal(lane('').lane, 'chat')
    assert.equal(lane(null).lane, 'chat')
  })
})

/* ═══ 12–14. STRUCTURAL FENCES ═══════════════════════════════════════════════ */

describe('⛔ E3 — the router stays free, pure and blind', () => {
  const codeOf = () => fs.readFileSync(path.join(__dirname, 'laneRouter.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

  test('*** ⛔ 13. THE ROUTER MAKES NO MODEL CALL AND NEVER COULD ***', () => {
    const code = codeOf()
    for (const forbidden of [/adapter/i, /provider/i, /fetch\(/, /require\(['"][^'"]*adapters/, /openai/i, /anthropic/i, /await /]) {
      assert.ok(!forbidden.test(code), 'the router reached for ' + forbidden)
    }
  })

  test('*** ⛔ 12/14. ZERO-CONTEXT: only the message and a lane NAME may be read ***', () => {
    const code = codeOf()
    // Nothing retrieved, recalled, or model-authored may reach routing.
    for (const forbidden of [/evidence/i, /recall/i, /connector/i, /rows/i, /itemsBySource/i, /answerPlan/i, /distilled/i, /readContext/i]) {
      assert.ok(!forbidden.test(code), 'routing must not see ' + forbidden)
    }
    // `opts` is used for exactly one thing: the previous lane NAME.
    const optsUses = code.split('\n').filter((l) => /opts\./.test(l))
    assert.ok(optsUses.every((l) => /previousLane/.test(l)),
      'opts may carry only previousLane: ' + JSON.stringify(optsUses))
  })

  test('*** ⛔ 14. DETERMINISTIC — the same message always routes the same way ***', () => {
    const inputs = [REAL_WORKSPACE_REQUEST, '幫我回覆這封 email', '你可以幫我回覆 email 嗎？', 'email 回覆流程太亂']
    for (const m of inputs) {
      const first = JSON.stringify(lane(m))
      for (let i = 0; i < 100; i++) assert.equal(JSON.stringify(lane(m)), first, 'unstable routing for ' + m)
    }
  })

  test('*** ⛔ 12. NO LANE GAINS EXECUTION AUTHORITY — the router returns a NAME, nothing more ***', () => {
    const shapes = [REAL_WORKSPACE_REQUEST, '幫我回覆這封 email', '幫我改 docs/x.md 嗰行', '好']
    for (const m of shapes) {
      const r = lane(m, { previousLane: 'chat' })
      assert.deepEqual(Object.keys(r).sort(), ['lane', 'reason'], 'the router may return only a lane and a reason')
      assert.ok(['chat', 'email_draft', 'proposal'].includes(r.lane))
      assert.equal(typeof r.reason, 'string')
    }
    // ⛔ AND THE LANE IS A NAME, NOT A CAPABILITY. Checked as absence of MACHINERY rather than
    //    of words: the vocabularies legitimately contain 「write」/「send」 as things the OWNER
    //    might say, so scanning for verbs would fire on the matchers themselves.
    const code = codeOf()
    for (const machinery of [/child_process/, /\brequire\(['"]node:fs['"]\)/, /\bfs\./, /\.exec\(/, /spawn\(/, /\bawait\b/, /Promise/, /process\.env/]) {
      assert.ok(!machinery.test(code), 'the router must contain no machinery: ' + machinery)
    }
  })

  test('the router does not mutate its input or hold state', () => {
    const frozen = Object.freeze({ previousLane: 'chat' })
    assert.doesNotThrow(() => lane(REAL_WORKSPACE_REQUEST, frozen))
    assert.equal(lane(REAL_WORKSPACE_REQUEST).lane, 'chat')
  })
})
