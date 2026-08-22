'use strict'

/**
 * x3ExecutiveJudgment.test.js — X3.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THE 「RECOMMEND FIRST」 PROMPT WAS NEVER GOING TO BE ENOUGH.
 *
 * Phase 0 mapped the chat lane's output contract and found the answer is structural, not
 * rhetorical. The envelope offers exactly five keys — intent, nextRead, mode, reply,
 * answerPlan. `reasons`, `offer`, `judgment` and `decision` exist in parseDistillResponse but
 * are reachable ONLY from the legacy commit/recommend path, which a chat turn never takes: on
 * every chat turn the return is a hardcoded `judgment: ''`.
 *
 * So a position had nowhere to live but free prose inside `reply` or `directAnswer` — the same
 * field, the same shape, no name — where 「我建議先做 A」 and 「你比較重視邊樣？」 are
 * indistinguishable to every downstream component. You cannot require a slot that does not
 * exist, you cannot order a position ahead of a question when neither is named, and you cannot
 * detect a question that replaced a position. Wording the prompt harder changes none of that.
 *
 * ⛔ AND PHASE 0 FOUND WHERE THE ORDERING HAD TO HAPPEN. `buildReadResultReply` MAY REBUILD THE
 * REPLY FROM ROWS — the codebase already warns about it three lines from the seam. A judgement
 * prepended to `guarded.reply` survives every guard and is then discarded on exactly the read
 * turns where it matters most. It is attached to `view.reply` instead: the bytes he receives.
 *
 * ⛔ WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT. Every model envelope here is scripted. They
 * prove the contract, the bounds, the ordering and the fences. They prove NOTHING about whether
 * a real model will judge a real business question well — only Owner-generated production turns
 * can show that.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/x3ExecutiveJudgment.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const wcMod = require('./goal/workingContext')
const { buildWorkingContext, MAX_MESSAGES, MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS } = wcMod
const { judgeGoalPlan } = require('./goal/goalPlanContract')
const { sourcesForPlan } = require('./goal/goalGate')
const { decideWorldAsk, ASK_REASON } = require('./worldAskDecision')
const resolver = require('./ownerSourceIntentResolver')
const ej = require('./executiveJudgment')
const { judgeExecutiveJudgment, judgmentDirective, withJudgment, JUDGMENT_KEY, JUDGMENT_REFUSED } = ej
const { parseDistillResponse } = require('./distillPrompt')

/* ═══ HARNESS ═══════════════════════════════════════════════════════════════ */

const ENV = {
  GOAL_DECOMPOSER: 'on', MULTI_AI_ROUTER: 'off', A4_KNOWLEDGE_ROUTING: 'on',
  READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', CONTEXT_DRIVE: 'off', CONTEXT_CALENDAR: 'off',
  CONTEXT_GITHUB: 'off', CONTEXT_AROMA_SYSTEM: 'on', CONVERSATION_DEMO: 'on',
  DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off', TURN_ROUTER: 'on'
}
async function withEnv (extra, fn) {
  const all = Object.assign({}, ENV, extra || {})
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const ANSWER = { intent: 'question', mode: 'chat', reply: '我哋可以咁設計：先做一個 Email 區。', nextRead: null, answerPlan: null }

/**
 * One whole turn. Everything is a fake: the Cognitive Core envelope, the brain envelope, the
 * verifier and the resolver. The connector THROWS — any read at all fails the turn loudly.
 */
async function turn (opts) {
  const corePrompts = []
  const mainPrompts = []
  const allCalls = []
  const resolverInputs = []
  let mainIdx = 0
  const adapter = {
    async complete (p, o = {}) {
      const name = (o.responseFormat && o.responseFormat.name) || null
      allCalls.push({ schemaName: name, prompt: String(p) })
      if (name === 'goal_plan') {
        corePrompts.push(String(p))
        if (opts.plan === 'THROW') throw new Error('core down')
        return { text: JSON.stringify(opts.plan), usage: { inputTokens: 1, outputTokens: 1 } }
      }
      mainPrompts.push(String(p))
      const body = (opts.script || [ANSWER])[Math.min(mainIdx, (opts.script || [ANSWER]).length - 1)]
      mainIdx++
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
  const x2 = []
  const x3 = []
  const realLog = console.log
  console.log = (...a) => {
    if (a[0] === '[AROMA-X2]') { try { x2.push(JSON.parse(a[1])) } catch (_) {} return }
    if (a[0] === '[AROMA-X3]') { try { x3.push(JSON.parse(a[1])) } catch (_) {} return }
    if (typeof a[0] === 'string' && a[0].startsWith('[AROMA')) return
    realLog(...a)
  }
  let res
  try {
    res = await processIntake(opts.message, adapter, opts.history || [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: {
        sources: opts.sources || ['gmail'],
        connector: { async read () { throw new Error('THIS FIXTURE MUST NOT READ') } },
        // ⛔ PER-FIXTURE. `allow_final` ends the turn before the source resolver is ever
        // consulted — which is why the world fixtures below saw no resolver at all until this
        // was made explicit. Production 7b0699ce reached the resolver via `require_internal`.
        finalVerifier: async () => ({ decision: opts.verifier || 'allow_final', question: null, outcome: opts.verifier || 'allow_final' }),
        sourceIntentResolver: async (input) => {
          resolverInputs.push(input)
          return JSON.stringify({ intent: opts.intent || 'not_applicable' })
        }
      }
    })
  } finally { console.log = realLog }
  return {
    res,
    corePrompt: corePrompts[corePrompts.length - 1] || '',
    terminal: mainPrompts[mainPrompts.length - 1] || '',
    mainPrompts,
    corePrompts,
    allCalls,
    resolverInputs,
    x2: x2[x2.length - 1] || null,
    x3: x3[x3.length - 1] || null
  }
}

const frame = (over) => Object.assign({
  taskType: 'plan', decisionNeeded: true, successDefinition: '畀出工作區同介面嘅設計方向', answerPosture: 'direct'
}, over)
const planOf = (over) => Object.assign({
  question_restated: '設計香香工作區，包括而家見到嘅介面',
  executive_frame: frame(),
  facts: [],
  joins: []
}, over)

const DESIGN_HISTORY = [
  { role: 'user', text: '我想在這裡規劃不同工作區，Email 跟進、廣告推廣等等。' },
  { role: 'assistant', text: '可以先由 Email 跟進開始設計。' }
]

const J = (over) => Object.assign({
  status: 'decided', statement: '我建議先做 Email 區。', uncertainties: [], changeIf: []
}, over)
const answerWith = (j, over) => Object.assign({
  intent: 'question', mode: 'chat', reply: '兩邊都做得，睇你想先解決邊個。', nextRead: null, answerPlan: null,
  [JUDGMENT_KEY]: j
}, over)

const DECIDE_MSG = '你覺得我應該先做 Email 區定廣告推廣？'

/* ═══ 1. THE CALL BUDGET — role-by-role, the MUT-X1-9 standard ═════════════ */

describe('X3 adds no model call', () => {
  test('*** ⛔ RELEASE-BLOCKING — every call is the core or a turn prompt, and there are no others ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [answerWith(J())] })
      assert.equal(t.corePrompts.length, 1, '⛔ the cognitive core ran more than once')
      // ⛔ COUNTING IS NOT ENOUGH — MUT-X1-9 proved an injected call can hide inside a total by
      // consuming a scripted reply. Every call must be identifiable BY ROLE.
      for (const c of t.allCalls) {
        const isCore = c.schemaName === 'goal_plan'
        const isTurn = c.prompt.includes(DECIDE_MSG)
        assert.ok(isCore || isTurn, '⛔ a call that is neither the core nor a turn prompt: ' + String(c.schemaName))
      }
      assert.ok(t.allCalls.length <= 3, '⛔ call budget exceeded: ' + t.allCalls.length)
    })
  })
})

/* ═══ 2. THE CONTRACT — closed, bounded, and never a reasoning trace ═══════ */

describe('the judgment contract', () => {
  test('three states and no fourth', () => {
    assert.deepEqual(ej.STATUSES, ['decided', 'provisional', 'blocked'])
  })

  test('*** ⛔ NO CONFIDENCE SCORE ANYWHERE — no percentage, no high/medium/low ***', () => {
    const props = Object.keys(ej.judgmentSchema().properties)
    for (const banned of ['confidence', 'certainty', 'score', 'probability', 'likelihood', 'level']) {
      assert.equal(props.includes(banned), false, '⛔ pseudo-precision field: ' + banned)
    }
    const j = judgeExecutiveJudgment(J()).judgment
    assert.deepEqual(Object.keys(j), ['status', 'statement', 'uncertainties', 'changeIf'])
  })

  test('*** ⛔ NOT A REASONING TRACE — no rationale/analysis/stepByStep/chainOfThought slot ***', () => {
    const props = Object.keys(ej.judgmentSchema().properties)
    for (const banned of ['reasoning', 'rationale', 'analysis', 'stepByStep', 'thoughtProcess', 'chainOfThought', 'thinking', 'deliberation']) {
      assert.equal(props.includes(banned), false, '⛔ a deliberation channel opened: ' + banned)
    }
  })

  test('an out-of-list status is REFUSED, never normalised to the nearest legal one', () => {
    for (const bad of ['DECIDED', 'maybe', 'partial', 'unsure', '', null, 7]) {
      const r = judgeExecutiveJudgment({ status: bad, statement: 'x', uncertainties: [], changeIf: [] })
      assert.equal(r.ok, false, '⛔ accepted status ' + JSON.stringify(bad))
      assert.equal(r.reason, JUDGMENT_REFUSED.BAD_STATUS)
    }
  })

  test('*** ⛔ `blocked` MAY NOT CARRY A POSITION — the fabricated recommendation in an honest label ***', () => {
    const r = judgeExecutiveJudgment({ status: 'blocked', statement: '我建議先做 A。', uncertainties: [], changeIf: [] })
    assert.equal(r.ok, false)
    assert.equal(r.reason, JUDGMENT_REFUSED.BLOCKED_WITH_STATEMENT)
  })

  test('decided and provisional must both carry a position', () => {
    for (const st of ['decided', 'provisional']) {
      assert.equal(judgeExecutiveJudgment({ status: st, statement: '   ', uncertainties: [], changeIf: [] }).ok, false)
      assert.equal(judgeExecutiveJudgment({ status: st, statement: '先做 A', uncertainties: [], changeIf: [] }).ok, true)
    }
  })

  test('bounds are literal, not read back from the constant under test', () => {
    const long = 'x'.repeat(9000)
    const j = judgeExecutiveJudgment({ status: 'decided', statement: long, uncertainties: [long, long, long, long, long], changeIf: [long, long, long, long] }).judgment
    assert.equal(j.statement.length, 220)
    assert.equal(j.uncertainties.length, 3)
    assert.equal(j.changeIf.length, 3)
    assert.equal(j.uncertainties[0].length, 160)
    assert.equal(j.changeIf[0].length, 160)
  })

  test('absent, null and non-object all refuse — each with its own reason', () => {
    assert.equal(judgeExecutiveJudgment(null).reason, JUDGMENT_REFUSED.ABSENT)
    assert.equal(judgeExecutiveJudgment(undefined).reason, JUDGMENT_REFUSED.ABSENT)
    assert.equal(judgeExecutiveJudgment('decided').reason, JUDGMENT_REFUSED.NOT_AN_OBJECT)
    assert.equal(judgeExecutiveJudgment([{ status: 'decided' }]).reason, JUDGMENT_REFUSED.NOT_AN_OBJECT)
  })
})

/* ═══ 3. THE SCHEMA SEAM — required when owed, byte-identical when not ═════ */

describe('the schema is shaped only when a decision is owed', () => {
  const base = Object.freeze({ type: 'object', required: ['intent', 'mode'], properties: { intent: {}, mode: {} } })

  test('*** ⛔ A RETRIEVAL TURN IS THE SAME OBJECT, NOT AN EQUAL CLONE ***', () => {
    assert.equal(withJudgment(base, { executiveFrame: { decisionNeeded: false } }), base)
    assert.equal(withJudgment(base, { executiveFrame: null }), base)
    assert.equal(withJudgment(base, null), base)
    assert.equal(withJudgment(base, {}), base)
  })

  test('a decision turn gains exactly one required key', () => {
    const w = withJudgment(base, { executiveFrame: { decisionNeeded: true } })
    assert.deepEqual(w.required, ['intent', 'mode', JUDGMENT_KEY])
    assert.deepEqual(Object.keys(w.properties), ['intent', 'mode', JUDGMENT_KEY])
    assert.deepEqual(base.required, ['intent', 'mode'], '⛔ the source schema was mutated')
  })

  test('the key is nullable, so 「no judgement owed」 is expressible under strict mode', () => {
    const s = ej.judgmentSchema()
    assert.deepEqual(s.type, ['object', 'null'])
    assert.equal(s.additionalProperties, false)
    assert.deepEqual(s.required, ['status', 'statement', 'uncertainties', 'changeIf'])
  })
})

/* ═══ 4. THE PARSER — Phase 0's name collision, and judged not copied ══════ */

describe('the parser admits a judged judgment only', () => {
  const env = (j) => JSON.stringify({ intent: 'x', mode: 'chat', reply: 'hi', [JUDGMENT_KEY]: j })

  test('*** ⛔ `judgment` STAYS THE LEGACY COMMIT STRING ON EVERY LANE ***', () => {
    const out = parseDistillResponse(env(J()), {})
    assert.equal(typeof out.judgment, 'string', '⛔ the legacy commit summary changed type')
    assert.equal(out.judgment, '')
    assert.equal(typeof out[JUDGMENT_KEY], 'object')
  })

  test('a refused judgment is DROPPED — the turn behaves exactly as it did before X3', () => {
    for (const bad of [{ status: 'blocked', statement: '先做 A' }, { status: 'nope', statement: 'x' }, 'text', 42]) {
      const diag = {}
      const out = parseDistillResponse(env(bad), diag)
      assert.equal(JUDGMENT_KEY in out, false, '⛔ a refused judgment reached the envelope')
      assert.ok(diag.judgmentRefused, '⛔ a refusal went unrecorded')
    }
  })

  test('an explicit null is silent — it is the contract, not a failure', () => {
    const diag = {}
    const out = parseDistillResponse(env(null), diag)
    assert.equal(JUDGMENT_KEY in out, false)
    assert.equal(diag.judgmentRefused, undefined)
  })

  test('an absent key leaves the envelope byte-identical to pre-X3', () => {
    const out = parseDistillResponse(JSON.stringify({ intent: 'x', mode: 'chat', reply: 'hi' }), {})
    assert.equal(JUDGMENT_KEY in out, false)
    assert.deepEqual(Object.keys(out),
      ['intent', 'mode', 'reply', 'understanding', 'judgment', 'decision', 'tasks', 'risks', 'next_step', 'reasons', 'offer'])
  })
})

/* ═══ 5. THE PROMPT DIRECTIVE — required when owed, silent when not ════════ */

describe('the directive', () => {
  test('*** ⛔ FAIL SOFT — no frame, refused frame, or no decision owed all yield NOTHING ***', () => {
    assert.equal(judgmentDirective(null), null)
    assert.equal(judgmentDirective({}), null)
    assert.equal(judgmentDirective({ executiveFrame: null }), null)
    assert.equal(judgmentDirective({ executiveFrame: { decisionNeeded: false } }), null)
  })

  test('*** ⛔ 「資料唔齊」 IS NAMED AS A NON-REASON — that sentence IS the tranche ***', () => {
    const d = judgmentDirective({ executiveFrame: { decisionNeeded: true, answerPosture: 'direct' } })
    assert.match(d, /資料唔齊唔等於冇意見/)
    assert.match(d, /provisional/)
    assert.match(d, /唔好淨係反問/)
  })

  test('the directive never instructs a reasoning dump', () => {
    const d = judgmentDirective({ executiveFrame: { decisionNeeded: true, answerPosture: 'evidence_first' } })
    for (const banned of ['step by step', '逐步', '思考過程', 'chain of thought']) {
      assert.equal(d.includes(banned), false, '⛔ the directive asked for deliberation: ' + banned)
    }
  })
})

/* ═══ 6. OWNER-VISIBLE FIXTURES A–I ════════════════════════════════════════ */

describe('Owner-visible behaviour', () => {
  test('A — a decision question gets a POSITION, and it is the first thing he reads', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [answerWith(J())] })
      const reply = String(t.res.reply).trim()
      assert.ok(reply.startsWith('我建議先做 Email 區。'), '⛔ the position was not first:\n' + reply.slice(0, 200))
      assert.equal(t.x3.status, 'decided')
      assert.equal(t.x3.ledReply, true)
    })
  })

  test('B — missing information produces PROVISIONAL, not silence: position, then what is unknown, then what would change it', async () => {
    await withEnv({}, async () => {
      const j = J({ status: 'provisional', statement: '暫時建議先做 Email 區。', uncertainties: ['未知廣告預算'], changeIf: ['如果廣告預算已經批咗'] })
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [answerWith(j)] })
      const reply = String(t.res.reply)
      assert.ok(reply.trim().startsWith('暫時建議先做 Email 區。'), '⛔ the provisional position was not first')
      assert.match(reply, /呢個係暫定判斷/)
      assert.ok(reply.indexOf('未知：') > reply.indexOf('暫時建議'), '⛔ uncertainty came before the position')
      assert.match(reply, /未知廣告預算/)
      assert.match(reply, /會改變我睇法嘅情況：/)
      assert.match(reply, /如果廣告預算已經批咗/)
    })
  })

  test('C — BLOCKED says so plainly and fabricates no position', async () => {
    await withEnv({}, async () => {
      const j = { status: 'blocked', statement: '', uncertainties: ['連兩邊嘅成本都未知'], changeIf: [] }
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [answerWith(j)] })
      const reply = String(t.res.reply)
      assert.match(reply, /畀唔到一個負責任嘅判斷/)
      assert.equal(/我建議/.test(reply), false, '⛔ a blocked judgement still recommended something')
      assert.equal(t.x3.status, 'blocked')
      assert.equal(t.x3.statementChars, 0)
    })
  })

  test('*** ⛔ D — A RETRIEVAL TURN IS UNTOUCHED: no directive, no slot, no judgement text ***', async () => {
    await withEnv({}, async () => {
      const plan = planOf({ executive_frame: frame({ taskType: 'retrieval', decisionNeeded: false }) })
      const t = await turn({ message: '我下個月有咩行程？', history: [], plan, script: [{ intent: 'question', mode: 'chat', reply: '你下個月有三個會。', nextRead: null, answerPlan: null }] })
      assert.equal(t.x3, null, '⛔ a retrieval turn emitted a judgement')
      assert.equal(/資料唔齊唔等於冇意見/.test(t.terminal), false, '⛔ the judgement directive polluted a retrieval prompt')
      assert.equal(/唔好淨係反問/.test(t.terminal), false, '⛔ the judgement directive polluted a retrieval prompt')
      assert.equal(String(t.res.reply).includes('未知：'), false)
      assert.equal(String(t.res.reply).includes('暫定判斷'), false)
    })
  })

  test('*** ⛔ E — A QUESTION MAY FOLLOW A JUDGEMENT AND MAY NEVER REPLACE ONE ***', async () => {
    await withEnv({}, async () => {
      const body = answerWith(J(), { reply: '你比較重視即刻嘅回覆速度，定係長遠嘅客源？' })
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [body] })
      const reply = String(t.res.reply)
      const posAt = reply.indexOf('我建議先做 Email 區。')
      const qAt = reply.indexOf('你比較重視')
      assert.ok(posAt >= 0, '⛔ the position vanished')
      assert.ok(qAt > posAt, '⛔ the question came first — this is the exact failure X3 exists for')
    })
  })

  test('F — a `blocked` carrying a position is refused, and the turn ships as it would have pre-X3', async () => {
    await withEnv({}, async () => {
      const body = answerWith({ status: 'blocked', statement: '我建議先做 A。', uncertainties: [], changeIf: [] })
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [body] })
      assert.equal(t.x3, null, '⛔ a refused judgement was still rendered')
      assert.match(String(t.res.reply), /兩邊都做得/, 'the ordinary reply must survive untouched')
    })
  })

  test('G — an unknown status is refused, never coerced to `decided`', async () => {
    await withEnv({}, async () => {
      const body = answerWith({ status: 'leaning', statement: '大概係 A。', uncertainties: [], changeIf: [] })
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [body] })
      assert.equal(t.x3, null)
      assert.equal(String(t.res.reply).includes('大概係 A。'), false, '⛔ a refused status was rendered anyway')
    })
  })

  test('*** ⛔ H — X1 UNAVAILABLE MEANS PRE-X3 BEHAVIOUR, NOT DEGRADED BEHAVIOUR ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: 'THROW', script: [answerWith(J())] })
      assert.equal(/資料唔齊唔等於冇意見/.test(t.terminal), false, '⛔ the directive appeared without a frame')
      assert.ok(String(t.res.reply).length > 0, 'the turn must still answer')
    })
  })

  test('*** ⛔ I — A JUDGEMENT IS NOT AUTHORITY: it opens no source and triggers no read ***', async () => {
    await withEnv({}, async () => {
      // The fixture connector THROWS on any read at all, so a widened authorisation fails loudly.
      const j = J({ statement: '我建議先睇 Gmail 再決定。' })
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [answerWith(j)] })
      assert.ok(String(t.res.reply).includes('我建議先睇 Gmail 再決定。'), 'the position still ships')
      assert.equal(t.res.blocked, false)
    })
  })
})

/* ═══ 7. FENCES — telemetry, authority, and the C1-A observer ══════════════ */

describe('X3 fences', () => {
  test('*** ⛔ TELEMETRY CARRIES SHAPE ONLY — no statement, no uncertainty, no reply text ***', async () => {
    await withEnv({}, async () => {
      const j = J({ status: 'provisional', statement: '暫時建議先做 Email 區。', uncertainties: ['未知廣告預算'], changeIf: ['預算已批'] })
      const t = await turn({ message: DECIDE_MSG, history: DESIGN_HISTORY, plan: planOf(), script: [answerWith(j)] })
      const blob = JSON.stringify(t.x3)
      for (const secret of ['暫時建議先做 Email 區。', '未知廣告預算', '預算已批', '兩邊都做得', DECIDE_MSG]) {
        assert.equal(blob.includes(secret), false, '⛔ telemetry carried text: ' + secret)
      }
      assert.deepEqual(Object.keys(t.x3).sort(),
        ['changeIf', 'ledReply', 'path', 'requestId', 'statementChars', 'status', 'uncertainties'])
      assert.equal(typeof t.x3.statementChars, 'number')
    })
  })

  test('*** ⛔ THE SERVER AUTHORS NO OPINION — every word of the position comes from the model ***', () => {
    // A sentinel round-trip, not a keyword grep. Grep cannot tell a business stance from a
    // SCHEMA FORMAT EXAMPLE, and this file learned that by failing for the wrong reason.
    const S1 = 'QQPOSITIONQQ'; const S2 = 'QQUNKNOWNQQ'; const S3 = 'QQCHANGEQQ'
    const j = judgeExecutiveJudgment({ status: 'provisional', statement: S1, uncertainties: [S2], changeIf: [S3] }).judgment
    const rendered = ej.renderJudgment(j)
    // Strip the model's words and the fixed server labels. Anything left is content the
    // server invented — on a business question that would be an opinion nobody authored.
    const LABELS = ['（呢個係暫定判斷。）', '未知：', '會改變我睇法嘅情況：']
    let residue = rendered.split(S1).join('').split(S2).join('').split(S3).join('')
    for (const l of LABELS) residue = residue.split(l).join('')
    assert.equal(residue.trim(), '', '⛔ the server contributed content of its own: ' + JSON.stringify(residue))
    // And a blocked judgement renders a refusal — never a manufactured stance.
    const b = judgeExecutiveJudgment({ status: 'blocked', statement: '', uncertainties: [], changeIf: [] }).judgment
    assert.equal(ej.renderJudgment(b), '我而家畀唔到一個負責任嘅判斷。')
  })

  test('*** ⛔ C1-A STAYS AN OBSERVER — X3 does not branch on candidateJudgmentGap ***', () => {
    const svc = require('fs').readFileSync(require.resolve('./intakeService'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    assert.equal(/if\s*\([^)]*candidateJudgmentGap/.test(svc), false, '⛔ the shadow observer became load-bearing')
  })

  test('*** ⛔ X3 WIDENS NOTHING — no source vocabulary, READ_ACCESS or A4 surface is touched ***', () => {
    const code = require('fs').readFileSync(require.resolve('./executiveJudgment'), 'utf8')
    for (const banned of ['READ_ACCESS', 'sourcesForPlan', 'ALL_SOURCES', 'worldForCapability', 'require(', 'process.env']) {
      assert.equal(code.includes(banned), false, '⛔ the judgement module reached for: ' + banned)
    }
  })

  test('*** ⛔ S1 CAPABILITY TRUTH STILL WINS — a judgement cannot promise an unimplemented write ***', () => {
    const { isNotImplemented } = require('../governance/selfCapability')
    assert.equal(isNotImplemented('calendar.write'), true, '⛔ S1 truth changed under X3')
    const j = judgeExecutiveJudgment(J({ statement: '我幫你加咗落 Calendar。' })).judgment
    // X3 shapes and orders; it does not vet business claims. The S1 block in the SAME prompt is
    // what forbids the promise — proven here so the division of labour is explicit, not assumed.
    assert.equal(j.statement, '我幫你加咗落 Calendar。')
    const { capabilityBlock } = require('../governance/selfCapability')
    assert.match(capabilityBlock(), /未實作/)
  })
})
