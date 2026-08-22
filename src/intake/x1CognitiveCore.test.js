'use strict'

/**
 * x1CognitiveCore.test.js — X1.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT PHASE 0 FOUND, AND WHY THIS TRANCHE IS SMALL.
 *
 * `question_restated` — one sentence naming the Owner's problem — has been produced by the
 * decomposer on every turn since B shipped, and traced to ZERO consumers. Meanwhile three
 * modules reinterpret his message independently (turnRouter by keyword, sourceIntentResolver
 * by world, laneRouter by lane) and none of them is given the goal. That is the pipeline the
 * Owner keeps feeling: every part asks a narrow question about the words, and nothing holds
 * the problem.
 *
 * X1 does not add a call, a model, a source or a permission. It asks the call that already
 * exists a better question first, and lets the answer travel.
 *
 * ⛔ WHAT THESE TESTS PROVE, AND WHAT THEY CANNOT. Every envelope here is SCRIPTED. They prove
 * the contract, the wiring, the fail-soft and the fences. They prove NOTHING about whether
 * Haiku, Opus or GPT will produce a good Executive Frame in production — that is only knowable
 * from a real turn after a controlled deployment.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/x1CognitiveCore.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { judgeGoalPlan, goalPlanSchema } = require('./goal/goalPlanContract')
const { sourcesForPlan, requirementBlock, executiveFrameBlock } = require('./goal/goalGate')
const { decomposeGoal } = require('./goal/goalDecomposer')
const frameMod = require('./goal/executiveFrame')

/**
 * ⛔ COMMENTS ARE NOT CODE, AND THIS FILE LEARNED IT THE USUAL WAY.
 *
 * The fences below scan source for names a module must not reach. Run against raw text they
 * matched THIS TRANCHE'S OWN PROSE: the note reading 「no connector call」 tripped the connector
 * fence, and 「authorisation is READ_ACCESS plus…」 tripped the authorisation one. A guard a
 * comment can fail is a guard nobody can trust when it passes.
 */
function codeOf (relPath) {
  const fs = require('node:fs'); const path = require('node:path')
  const raw = fs.readFileSync(path.join(__dirname, relPath), 'utf8')
  const noBlock = raw.split('/*').map((part, n) => (n === 0 ? part : part.slice(part.indexOf('*/') + 2))).join(' ')
  return noBlock.split(String.fromCharCode(10))
    .map((l) => { const k = l.indexOf('//'); return k === -1 ? l : l.slice(0, k) })
    .join(String.fromCharCode(10))
}
const { TASK_TYPE, ANSWER_POSTURE, judgeExecutiveFrame, FRAME_REFUSED } = frameMod

/* ═══ HARNESS ═══════════════════════════════════════════════════════════════ */

const mail = (id, title) => ({
  source: 'gmail', sourceId: id, title, originalDate: '2026-08-21', content: 'sanitised',
  retrievedAt: '2026-08-22', link: null, trust: 'live', error: null, entityType: 'mail', fields: {}
})
const ROWS = [mail('m1', 'SANITISED-MAIL-A'), mail('m2', 'SANITISED-MAIL-B'),
  mail('m3', 'SANITISED-MAIL-C'), mail('m4', 'SANITISED-MAIL-D')]

function gmailConnector () {
  return {
    async read (source, method, params) {
      if (source !== 'gmail') throw new Error('not wired')
      if (params && typeof params === 'object') {
        const wanted = Object.values(params).find((x) => typeof x === 'string')
        const hit = ROWS.find((r) => r.sourceId === wanted)
        if (hit) return { asOf: '2026-08-22', source, count: 1, results: [hit] }
      }
      return { asOf: '2026-08-22', source, count: ROWS.length, results: ROWS }
    }
  }
}

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

const FINAL = {
  intent: 'question', mode: 'chat', reply: '好。', nextRead: null,
  answerPlan: {
    directAnswer: '先睇 SANITISED-MAIL-B。',
    answerClaims: null,
    sections: [{ heading: '需要你處理', rankingClaim: null, items: [{ sourceId: 'gmail#m2', title: 'SANITISED-MAIL-B', facts: [] }] }],
    limitations: [], followUp: null, unanswerable: false, citesEvidence: true
  }
}
const PROVISIONAL_FINAL = {
  intent: 'question', mode: 'chat', reply: '我畀個初步判斷。', nextRead: null,
  answerPlan: {
    directAnswer: '暫時只可以講一個初步判斷。',
    answerClaims: null, sections: [], limitations: ['有一樣資料而家讀唔到'],
    followUp: null, unanswerable: false, citesEvidence: false
  }
}

/**
 * One whole turn. `plan` is the scripted Cognitive Core envelope; `script` is what the MAIN
 * brain returns. Both are fakes — no provider, no connector beyond the stub, no network.
 */
async function turn (plan, script, opts = {}) {
  const mainPrompts = []
  const corePrompts = []
  let mainCalls = 0
  let totalCalls = 0
  const allCalls = []
  const adapter = {
    async complete (p, o = {}) {
      totalCalls++
      if (o.responseFormat && o.responseFormat.name === 'goal_plan') {
        corePrompts.push(String(p))
        allCalls.push({ schemaName: 'goal_plan', prompt: String(p) })
        if (plan === 'THROW') throw new Error('decomposer down')
        return { text: JSON.stringify(plan), usage: { inputTokens: 1, outputTokens: 1 } }
      }
      mainPrompts.push(String(p))
      allCalls.push({ schemaName: (o.responseFormat && o.responseFormat.name) || null, prompt: String(p) })
      const body = script[Math.min(mainCalls, script.length - 1)]
      mainCalls++
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
  const x1 = []
  const realLog = console.log
  console.log = (...a) => {
    if (a[0] === '[AROMA-X1]') { try { x1.push(JSON.parse(a[1])) } catch (_) {} return }
    if (typeof a[0] === 'string' && a[0].startsWith('[AROMA')) return
    realLog(...a)
  }
  let res
  try {
    res = await processIntake(opts.message || '幫我看看最近 Gmail，有哪些事情我需要優先處理？\n你直接幫我排優先次序和告訴我為什麼。', adapter, [], Object.assign({
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: { sources: opts.sources || ['gmail'], connector: gmailConnector() }
    }, opts.extraOpts || {}))
  } finally { console.log = realLog }
  return { res, mainPrompts, corePrompts, totalCalls, allCalls, terminal: mainPrompts[mainPrompts.length - 1] || '', x1: x1[x1.length - 1] || null }
}

const framed = (over) => Object.assign({
  taskType: 'prioritize', decisionNeeded: true,
  successDefinition: '畀出有先後嘅處理次序同理由', answerPosture: 'evidence_first'
}, over)
const planOf = (over) => Object.assign({
  question_restated: '排出最近 Gmail 邊幾件要先處理',
  executive_frame: framed(),
  facts: [{ id: 'f1', need: '最近郵件', operation: 'gmail', entity: null, fields: [], necessity: 'required' }],
  joins: []
}, over)

/* ═══ RELEASE-BLOCKING: THE CALL COUNT ═════════════════════════════════════ */

describe('X1 model-call count is preserved', () => {
  test('*** ⛔ RELEASE-BLOCKING — X1 adds NO model call ***', async () => {
    await withEnv({}, async () => {
      const withX1 = await turn(planOf(), [{ intent: 'question', mode: 'chat', reply: '睇睇', nextRead: { capability: 'gmail' } }, FINAL])
      // 1 cognitive core + 1 main + 1 post-read reasoning. The core call is the SAME call the
      // decomposer already made; it is not joined by an "executive understanding" call.
      assert.equal(withX1.corePrompts.length, 1, '⛔ the cognitive core ran more than once')
      assert.equal(withX1.totalCalls, 3)
      assert.equal(withX1.totalCalls, withX1.corePrompts.length + withX1.mainPrompts.length,
        '⛔ a call happened that is neither the core nor the brain')
      /**
       * ⛔ COUNTING ALONE IS NOT ENOUGH, AND MUTATION PROVED IT.
       *
       * MUT-X1-9 injects an extra `adapter.complete(...)` and this test PASSED: the injected
       * call consumed a scripted reply, the flow short-circuited, and the total stayed at
       * three. A budget that can be spent on the wrong thing while the total holds is not a
       * budget. So every call is now accounted for BY ROLE — a goal_plan call, or a turn
       * prompt that actually contains the Owner's question. An 「executive understanding」
       * call is neither.
       */
      const QUESTION_MARK = '優先處理'
      for (const c of withX1.allCalls) {
        const isCore = c.schemaName === 'goal_plan'
        const isTurn = c.prompt.includes(QUESTION_MARK)
        assert.ok(isCore || isTurn,
          '⛔ an unaccounted model call was made: schema=' + c.schemaName)
      }
      assert.equal(withX1.allCalls.filter((c) => c.schemaName === 'goal_plan').length, 1)
      assert.equal(withX1.allCalls.length, 3)
    })
  })

  test('*** with the decomposer OFF the core call does not happen at all ***', async () => {
    await withEnv({ GOAL_DECOMPOSER: 'off' }, async () => {
      const t = await turn(planOf(), [{ intent: 'question', mode: 'chat', reply: '睇睇', nextRead: { capability: 'gmail' } }, FINAL])
      assert.equal(t.corePrompts.length, 0)
      assert.equal(t.totalCalls, 2)
    })
  })
})

/* ═══ THE CONTRACT ═════════════════════════════════════════════════════════ */

describe('X1 the Executive Frame contract is closed and never normalised', () => {
  test('*** the schema requires the frame, with two closed enums ***', () => {
    const s = goalPlanSchema()
    assert.ok(s.required.includes('executive_frame'))
    const ef = s.properties.executive_frame
    assert.deepEqual(ef.required, ['taskType', 'decisionNeeded', 'successDefinition', 'answerPosture'])
    assert.deepEqual(ef.properties.taskType.enum, TASK_TYPE)
    assert.deepEqual(ef.properties.answerPosture.enum, ANSWER_POSTURE)
    assert.equal(ef.additionalProperties, false)
    assert.equal(TASK_TYPE.length, 8, 'a small vocabulary, not a taxonomy')
  })

  test('*** ⛔ AN INVALID VALUE IS REFUSED, NEVER MAPPED TO THE NEAREST PLAUSIBLE ONE ***', () => {
    // Quietly turning 「diagnostic」 into `diagnose` would manufacture an understanding nobody
    // produced — inventing evidence, one layer up.
    for (const [over, reason] of [
      [{ taskType: 'diagnostic' }, FRAME_REFUSED.BAD_TASK_TYPE],
      [{ taskType: 'DIAGNOSE' }, FRAME_REFUSED.BAD_TASK_TYPE],
      [{ answerPosture: 'evidence' }, FRAME_REFUSED.BAD_POSTURE],
      [{ decisionNeeded: 'true' }, FRAME_REFUSED.BAD_DECISION_NEEDED],
      [{ successDefinition: '' }, FRAME_REFUSED.BAD_SUCCESS],
      [{ successDefinition: 'x'.repeat(frameMod.MAX_SUCCESS_CHARS + 1) }, FRAME_REFUSED.BAD_SUCCESS]
    ]) {
      const r = judgeExecutiveFrame(framed(over))
      assert.equal(r.ok, false, 'accepted ' + JSON.stringify(over))
      assert.equal(r.reason, reason)
    }
    assert.equal(judgeExecutiveFrame(null).reason, FRAME_REFUSED.ABSENT)
    assert.equal(judgeExecutiveFrame('diagnose').reason, FRAME_REFUSED.NOT_AN_OBJECT)
  })

  test('*** ⛔ FAIL-SOFT — a malformed frame does NOT take the fact plan down ***', () => {
    const bad = judgeGoalPlan(planOf({ executive_frame: framed({ taskType: 'nonsense' }) }))
    assert.equal(bad.ok, true, '⛔ X1 became a new way for a working turn to fail')
    assert.equal(bad.plan.executiveFrame, null)
    assert.equal(bad.plan.executiveFrameRefused, FRAME_REFUSED.BAD_TASK_TYPE)
    assert.equal(bad.plan.facts.length, 1, 'the facts survive under the rules they always had')
    assert.deepEqual(sourcesForPlan(bad.plan, ['gmail', 'aroma_system']), ['gmail'])
  })

  test('*** the frame is not a reasoning trace — there is nowhere to put one ***', () => {
    const ef = goalPlanSchema().properties.executive_frame
    assert.deepEqual(Object.keys(ef.properties).sort(),
      ['answerPosture', 'decisionNeeded', 'successDefinition', 'taskType'])
    for (const k of ['reasoning', 'rationale', 'analysis', 'steps', 'thinking', 'chainOfThought']) {
      assert.equal(Object.prototype.hasOwnProperty.call(ef.properties, k), false, 'a prose channel appeared: ' + k)
    }
    assert.match(ef.description, /唔係推理過程/)
  })
})

/* ═══ AUTHORITY: THE FRAME CANNOT WIDEN ANYTHING ══════════════════════════ */

describe('X1 the frame guides understanding and confers no authority', () => {
  test('*** ⛔ sourcesForPlan reads FACTS, never the frame ***', async () => {
    // Same facts, wildly different frames: the read set must be identical.
    const a = judgeGoalPlan(planOf({ executive_frame: framed({ answerPosture: 'evidence_first', taskType: 'retrieve' }) })).plan
    const b = judgeGoalPlan(planOf({ executive_frame: framed({ answerPosture: 'direct', taskType: 'converse' }) })).plan
    const enabled = ['gmail', 'drive', 'calendar', 'github', 'aroma_system']
    assert.deepEqual(sourcesForPlan(a, enabled), sourcesForPlan(b, enabled))
    assert.deepEqual(sourcesForPlan(a, enabled), ['gmail'])
    // And a frame with NO facts reaches nothing at all.
    const none = judgeGoalPlan(planOf({ facts: [] })).plan || null
    assert.deepEqual(sourcesForPlan(none, enabled), null, 'an empty plan narrows nothing; it authorises nothing either')
  })

  test('*** ⛔ evidence_first does not authorise a disabled source ***', () => {
    const p = judgeGoalPlan(planOf()).plan
    assert.deepEqual(sourcesForPlan(p, ['aroma_system']), [], '⛔ the posture widened authorisation')
    assert.deepEqual(sourcesForPlan(p, []), [])
  })

  test('*** ⛔ the frame block carries no source, id, row or count ***', () => {
    const block = executiveFrameBlock(judgeGoalPlan(planOf()).plan)
    assert.ok(block.includes('唔係證據'), 'it must say what it is not')
    for (const forbidden of ['gmail#', 'ref=', 'SANITISED-MAIL', '[gmail]', 'trust']) {
      assert.equal(block.includes(forbidden), false, '⛔ the frame block carries ' + forbidden)
    }
  })

  test('*** ⛔ no X1 module can reach execution, proposal or work-order authority ***', () => {
    for (const rel of ['goal/executiveFrame.js', 'goal/goalDecomposer.js', 'goal/goalGate.js']) {
      const src = codeOf(rel)
      for (const forbidden of ['promoteToProposal', 'executeDispatch', 'workOrder', 'createDispatches', 'startRun', 'publicQueryPlanner']) {
        assert.equal(src.includes(forbidden), false, '⛔ ' + rel + ' reaches ' + forbidden)
      }
      assert.equal(/connector|createLiveReadConnector|axios/.test(src), false, '⛔ ' + rel + ' can reach the world')
    }
  })
})

/* ═══ RECALL IS CONTEXT, NEVER EVIDENCE ═══════════════════════════════════ */

describe('X1 recall answers "what is he talking about", never "what is true"', () => {
  test('*** ⛔ the core is given the ALREADY-BUILT recall, labelled as context ***', async () => {
    let seen = ''
    await decomposeGoal({
      question: '那你覺得呢？',
      contextBlocks: ['【過往決定】SANITISED-DECISION-42'],
      callModel: async ({ prompt }) => { seen = prompt; return { text: JSON.stringify(planOf()) } }
    })
    assert.ok(seen.includes('SANITISED-DECISION-42'), 'the bounded recall must reach the core')
    assert.match(seen, /CONTEXT，唔係 EVIDENCE/, '⛔ recall arrived unlabelled')
    assert.match(seen, /唔可以當佢係「而家嘅事實」/)
    assert.match(seen, /唔可以因為佢入面提過某個來源就當要讀嗰個來源/,
      '⛔ recall could be read as a request to read a source it mentions')
  })

  test('*** ⛔ recall NEVER becomes an EvidenceSet, a live row or a citable id ***', async () => {
    await withEnv({}, async () => {
      const t = await turn(planOf({ facts: [] }), [FINAL], {
        message: '那你覺得呢？',
        extraOpts: { decisionRecallDeps: {}, conversationRecallDeps: {} }
      })
      // Nothing recall-shaped may appear as evidence in the answer path.
      assert.equal(/trust.*live.*DECISION/i.test(t.terminal), false)
      // And the structural fence: recall is a prompt string, never a perSource/evidence row.
      const fs = require('node:fs'); const path = require('node:path')
      const dec = fs.readFileSync(path.join(__dirname, '..', 'coo', 'decisionRecall.js'), 'utf8')
      assert.equal(/makeContextResult|evidenceSets|trust: 'live'/.test(dec), false,
        '⛔ decision recall can construct evidence')
    })
  })

  test('*** the core runs with no recall at all, and says nothing about context ***', async () => {
    let seen = ''
    await decomposeGoal({ question: 'x', callModel: async ({ prompt }) => { seen = prompt; return { text: JSON.stringify(planOf()) } } })
    assert.equal(/CONTEXT，唔係 EVIDENCE/.test(seen), false, 'no recall, no context section')
  })
})

/* ═══ THE FIXTURES ════════════════════════════════════════════════════════ */

describe('X1 FIXTURE A — business diagnosis with something unreadable', () => {
  const PLAN_A = {
    question_restated: '判斷近期生意是否真的放慢、找出較可能原因並指出先看哪些訊號',
    executive_frame: {
      taskType: 'diagnose', decisionNeeded: true, answerPosture: 'provisional',
      successDefinition: '給出有優先次序的初步診斷，並指出哪些資料會令判斷更準'
    },
    facts: [
      { id: 'f1', need: '每日人流／客量趨勢', operation: null, entity: null, fields: [], necessity: 'required' },
      { id: 'f2', need: '近期倉存動向', operation: 'aroma_system.inventory', entity: 'inventory_item', fields: ['currentStock'], necessity: 'enriching' }
    ],
    joins: []
  }

  test('*** ⛔ the goal survives, and the unreadable fact does not replace it ***', async () => {
    await withEnv({}, async () => {
      const t = await turn(PLAN_A, [PROVISIONAL_FINAL], { message: '最近生意好像慢了，你覺得有什麼問題？' })
      assert.ok(/EXECUTIVE FRAME/.test(t.terminal), '⛔ the frame did not reach the brain')
      assert.ok(t.terminal.includes('判斷近期生意是否真的放慢'), '⛔ the Owner goal was lost')
      assert.match(t.terminal, /工作類型：diagnose/)
      assert.match(t.terminal, /作答姿態：provisional/)
      assert.match(t.terminal, /讀唔到嘅嘢係限制，唔係換題目嘅理由/,
        '⛔ nothing tells the brain to keep the problem when data is missing')
      assert.match(t.terminal, /provisional：資料唔齊係一個限制/,
        'the provisional posture must be spelled out, not implied')
    })
  })

  test('*** ⛔ the ENRICHING Aroma fact is not read, and does not become the answer ***', async () => {
    const p = judgeGoalPlan(PLAN_A).plan
    assert.equal(p.facts[0].status, 'UNAVAILABLE', 'the required fact really is unreadable')
    assert.deepEqual(sourcesForPlan(p, ['gmail', 'aroma_system']), [],
      '⛔ an enriching inventory fact pulled a read the question never asked for')
  })

  test('*** a provisional answer with explicit limitations survives ***', async () => {
    await withEnv({}, async () => {
      const t = await turn(PLAN_A, [PROVISIONAL_FINAL], { message: '最近生意好像慢了，你覺得有什麼問題？' })
      assert.ok(String(t.res.reply).length > 0, 'the Owner still receives an answer')
      assert.equal(t.x1.taskType, 'diagnose')
      assert.equal(t.x1.answerPosture, 'provisional')
      assert.equal(t.x1.unavailableFactCount, 1)
    })
  })
})

describe('X1 FIXTURE B — Gmail priority, with C4 intact', () => {
  test('*** ⛔ gmail still maps to gmail, PARTIAL semantics unchanged, no Aroma forced ***', async () => {
    const p = judgeGoalPlan(planOf()).plan
    assert.equal(p.facts[0].operation, 'gmail')
    assert.equal(p.facts[0].status, 'PARTIAL', '⛔ C4 source-level semantics moved')
    assert.deepEqual(sourcesForPlan(p, ['gmail', 'aroma_system']), ['gmail'])
    assert.equal(requirementBlock(p).includes('aroma_system'), false)
  })

  test('*** ⛔ the goal stays "prioritise Gmail", not "describe four rows" ***', async () => {
    await withEnv({}, async () => {
      const t = await turn(planOf(), [{ intent: 'question', mode: 'chat', reply: '睇睇', nextRead: { capability: 'gmail' } }, FINAL])
      assert.ok(t.terminal.includes('排出最近 Gmail 邊幾件要先處理'))
      assert.match(t.terminal, /工作類型：prioritize/)
      assert.match(t.terminal, /點先算有用：/)
      for (const r of ROWS) assert.ok(t.terminal.includes(r.title), 'evidence still travels: ' + r.title)
      assert.equal(/aroma_system\.(inventory|suppliers|invoices)/.test(t.terminal), false)
    })
  })
})

describe('X1 FIXTURE C — contextual follow-up', () => {
  test('*** ⛔ 「那你覺得呢？」 is framed from recall, and recall authorises nothing ***', async () => {
    let seen = ''
    const CONTEXTUAL = {
      question_restated: '就上次講嘅供應商換貨決定，畀我一個睇法',
      executive_frame: { taskType: 'recommend', decisionNeeded: true, answerPosture: 'provisional', successDefinition: '就嗰個決定畀一個清楚立場同理由' },
      // ⛔ ONE FACT WITH NO OPERATION. The contract refuses a zero-fact plan
      // (`plan_named_no_facts`), and 「nothing in this system carries this」 is exactly what a
      // null operation means — which is the honest shape for a question recall alone frames.
      facts: [{ id: 'f1', need: '我對嗰個決定嘅睇法', operation: null, entity: null, fields: [], necessity: 'required' }], joins: []
    }
    const out = await decomposeGoal({
      question: '那你覺得呢？',
      contextBlocks: ['【過往決定】SANITISED-DECISION-供應商換貨', '【過往對話】SANITISED-CONVERSATION'],
      callModel: async ({ prompt }) => { seen = prompt; return { text: JSON.stringify(CONTEXTUAL) } }
    })
    assert.ok(out.ok)
    assert.equal(out.plan.executiveFrame.taskType, 'recommend')
    assert.ok(out.plan.questionRestated.includes('供應商換貨'), 'the frame reflects the contextual problem')
    assert.ok(seen.includes('SANITISED-DECISION-供應商換貨'))
    assert.match(seen, /CONTEXT，唔係 EVIDENCE/)
    // ⛔ AND NO SOURCE IS AUTHORISED BY RECALL MENTIONING ONE.
    assert.deepEqual(sourcesForPlan(out.plan, ['gmail', 'aroma_system']), [],
      '⛔ recall created a read — it must not')
  })
})

describe('X1 FIXTURE D — naming a source is not asking for it', () => {
  const PLAN_D = {
    question_restated: '解釋 Gmail 呢個功能喺系統入面點運作',
    executive_frame: { taskType: 'understand', decisionNeeded: false, answerPosture: 'direct', successDefinition: '講清楚呢個功能點運作，唔使讀佢嘅資料' },
    facts: [{ id: 'f1', need: '解釋 Gmail 功能點運作', operation: null, entity: null, fields: [], necessity: 'required' }], joins: []
  }

  test('*** ⛔ a discussion goal produces no required Gmail fact and no read ***', async () => {
    const p = judgeGoalPlan(PLAN_D).plan
    assert.equal(p.facts.length, 1)
    assert.equal(p.facts[0].operation, null, '⛔ a source name in the message produced an operation')
    assert.deepEqual(sourcesForPlan(p, ['gmail']), [], '⛔ a discussion ABOUT Gmail read Gmail')
    assert.equal(p.executiveFrame.taskType, 'understand')
    assert.equal(p.executiveFrame.decisionNeeded, false)
    assert.equal(p.executiveFrame.answerPosture, 'direct')
  })

  test('*** ⛔ the contract TELLS the core that a mention is not a request ***', async () => {
    let seen = ''
    await decomposeGoal({
      question: '唔好讀 Gmail，我只係想討論 Gmail 呢個功能點運作。',
      callModel: async ({ prompt }) => { seen = prompt; return { text: JSON.stringify(PLAN_D) } }
    })
    assert.match(seen, /提到一個來源嘅名，唔等於要讀嗰個來源/)
    assert.match(seen, /或者明講「唔好讀」/)
  })

  test('*** ⛔ and X1 itself never widens Gmail authorisation nor performs a read ***', () => {
    const src = codeOf('goal/executiveFrame.js')
    assert.equal(/READ_ACCESS|CONTEXT_GMAIL|enabledSources|sourcesForProvider/.test(src), false,
      '⛔ the frame module touches source authorisation')
  })
})

/* ═══ FAILURE MUST NOT PROPAGATE ══════════════════════════════════════════ */

describe('X1 is not a new single point of failure', () => {
  test('*** ⛔ a completely failed core leaves the turn working, exactly as before ***', async () => {
    await withEnv({}, async () => {
      const t = await turn('THROW', [{ intent: 'question', mode: 'chat', reply: '睇睇', nextRead: { capability: 'gmail' } }, FINAL])
      assert.ok(String(t.res.reply).length > 0, '⛔ X1 broke an otherwise valid turn')
      assert.equal(/EXECUTIVE FRAME/.test(t.terminal), false, 'no frame is invented when none was produced')
      for (const r of ROWS) assert.ok(t.terminal.includes(r.title), 'the evidence path is untouched')
    })
  })

  test('*** ⛔ telemetry says WHICH failure it was, and carries no words ***', async () => {
    await withEnv({}, async () => {
      const t = await turn(planOf({ executive_frame: framed({ answerPosture: 'guess' }) }),
        [{ intent: 'question', mode: 'chat', reply: '睇睇', nextRead: { capability: 'gmail' } }, FINAL])
      assert.equal(t.x1.framePresent, false)
      assert.equal(t.x1.frameRefused, FRAME_REFUSED.BAD_POSTURE)
      const s = JSON.stringify(t.x1)
      for (const forbidden of ['排出最近', '優先處理', '畀出有先後', 'SANITISED', 'gmail#']) {
        assert.equal(s.includes(forbidden), false, '⛔ telemetry leaked: ' + forbidden)
      }
      assert.deepEqual(Object.keys(t.x1).sort(), [
        'answerPosture', 'decisionNeeded', 'durationMs', 'event', 'factCount', 'frameRefused',
        'framePresent', 'requestId', 'requiredFactCount', 'taskType', 'unavailableFactCount',
        'usedConversationRecall', 'usedDecisionRecall'
      ].sort())
    })
  })
})
