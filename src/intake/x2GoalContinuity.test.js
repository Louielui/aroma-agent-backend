'use strict'

/**
 * x2GoalContinuity.test.js — X2.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PRODUCTION TURN THIS FILE EXISTS FOR: 7b0699ce.
 *
 * Three Owner messages into a conversation about designing workspaces inside Xiangxiang, he
 * wrote 「我說的是…」 — a correction of a goal established two turns earlier. What came back was
 * 「你想我睇我哋自己嘅實際情況，定係外面公開嘅情況？」, and a twelve-second Opus answer was
 * thrown away to make room for it.
 *
 * The forensic found THREE separate breaks, and all three had to hold for that to happen:
 *
 *   1. `history` never reached the Cognitive Core. Conversation Recall excludes the live
 *      conversation by design — 「the live one is not memory」 — so the one component whose job
 *      is understanding him saw that sentence alone, while the finalVerifier and the source
 *      resolver both had four of his messages.
 *   2. Two earlier turns produced a good understanding and ZERO facts, and
 *      `plan_named_no_facts` discarded the whole result, frame included.
 *   3. `worldAskDecision` knows nothing about the active goal, and the resolver's vocabulary
 *      had no way to say 「this question has no world」. So `ambiguous` became a clarification
 *      that replaced the answer.
 *
 * ⛔ WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT. Every model envelope here is scripted. They
 * prove the wiring, the bounds and the fences. They prove NOTHING about whether a real model
 * will frame a real correction well — only Owner-generated production turns can show that.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/x2GoalContinuity.test.js
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
  const realLog = console.log
  console.log = (...a) => {
    if (a[0] === '[AROMA-X2]') { try { x2.push(JSON.parse(a[1])) } catch (_) {} return }
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
    x2: x2[x2.length - 1] || null
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

/* ═══ 1. THE CALL BUDGET — role-by-role, the MUT-X1-9 standard ═════════════ */

describe('X2 adds no model call', () => {
  test('*** ⛔ RELEASE-BLOCKING — every call is the core or a turn prompt, and there are no others ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: '我說的是連這裡看到的介面也要一起設計。', history: DESIGN_HISTORY, plan: planOf() })
      assert.equal(t.corePrompts.length, 1, '⛔ the cognitive core ran more than once')
      // ⛔ COUNTING IS NOT ENOUGH — MUT-X1-9 proved an injected call can hide inside a total.
      for (const c of t.allCalls) {
        const isCore = c.schemaName === 'goal_plan'
        const isTurn = c.prompt.includes('介面也要一起設計')
        assert.ok(isCore || isTurn, '⛔ unaccounted model call: schema=' + c.schemaName)
      }
      assert.equal(t.allCalls.length, t.corePrompts.length + t.mainPrompts.length)
      // No continuity classifier, no follow-up classifier, no world-need classifier.
      assert.equal(t.allCalls.filter((c) => c.schemaName === 'goal_plan').length, 1)
    })
  })
})

/* ═══ 2. WORKING CONTEXT — bounds and identity ════════════════════════════ */

describe('X2 Working Context is bounded, ordered, and not the current message', () => {
  test('*** it keeps both sides, oldest first, and excludes the current turn ***', () => {
    const wc = buildWorkingContext(DESIGN_HISTORY)
    assert.ok(wc.block.includes('Louie: 我想在這裡規劃不同工作區'))
    assert.ok(wc.block.includes('香香: 可以先由 Email 跟進開始設計'))
    assert.ok(wc.block.indexOf('Louie: 我想') < wc.block.indexOf('香香: 可以先由'), 'chronological')
    assert.equal(wc.messages, 2)
  })

  test('*** ⛔ the bounds hold, and the OLDEST turn is what a cap drops ***', () => {
    const many = []
    for (let i = 1; i <= 10; i++) many.push({ role: i % 2 ? 'user' : 'assistant', text: 'M' + i + '-' + 'x'.repeat(500) })
    const wc = buildWorkingContext(many)
    /**
     * ⛔ ASSERTED AGAINST LITERALS, NOT AGAINST THE CONSTANTS THIS GUARDS.
     *
     * Found by MUT-X2-12: raising MAX_TOTAL_CHARS to 100,000 left `wc.chars <= MAX_TOTAL_CHARS`
     * true, because the test read the very number the mutation moved. A bound that measures
     * itself is not a bound. The declared contract is 4 messages / 300 per message / 1,200
     * total, and those numbers are written here so a change to them has to change this file.
     */
    assert.equal(MAX_MESSAGES, 4)
    assert.equal(MAX_MESSAGE_CHARS, 300)
    assert.equal(MAX_TOTAL_CHARS, 1200)
    assert.ok(wc.messages <= 4, 'message cap: ' + wc.messages)
    assert.ok(wc.chars <= 1200, 'total cap: ' + wc.chars)
    assert.ok(wc.block.length <= 2200, 'the rendered block stays small: ' + wc.block.length)
    for (const line of wc.block.split('\n')) assert.ok(line.length <= MAX_MESSAGE_CHARS + 20, 'per-message cap')
    assert.ok(wc.block.includes('M10'), 'the newest turn is kept')
    assert.equal(wc.block.includes('M1-'), false, 'the oldest turn is what goes')
  })

  test('*** ⛔ it declares itself CONTEXT, NOT EVIDENCE, and says a named source is not a read ***', () => {
    const wc = buildWorkingContext([{ role: 'user', text: '幫我睇下 Gmail 嘅設計。' }])
    assert.match(wc.block, /CONTEXT，不是 EVIDENCE/)
    assert.match(wc.block, /唔係「而家嘅事實」嘅證明/)
    assert.match(wc.block, /都唔等於獲准去讀嗰個來源/)
    // No evidence machinery may appear.
    for (const forbidden of ['ref=', 'trust', 'retrievedAt', 'sourceId', '[gmail]']) {
      assert.equal(wc.block.includes(forbidden), false, '⛔ working context carries ' + forbidden)
    }
  })

  test('*** empty or unusable history yields no block at all ***', () => {
    for (const h of [[], null, undefined, [{ role: 'system', text: 'x' }], [{ role: 'user', text: '   ' }]]) {
      assert.equal(buildWorkingContext(h).block, null, JSON.stringify(h))
    }
  })

  test('*** ⛔ it is NOT Conversation Recall — that module still excludes the live conversation ***', () => {
    const fs = require('node:fs'); const path = require('node:path')
    const cr = fs.readFileSync(path.join(__dirname, '..', 'lab', 'conversationRecall.js'), 'utf8')
    assert.match(cr, /the live one is not memory/,
      '⛔ Conversation Recall stopped excluding the current conversation — X2 must not have done that')
  })
})

/* ═══ 3. FIXTURE A — the correction keeps the goal ════════════════════════ */

describe('X2 FIXTURE A — a correction is read against the active conversation', () => {
  test('*** ⛔ the previous exchange reaches the Cognitive Core ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: '我說的是連這裡看到的介面也要一起設計。', history: DESIGN_HISTORY, plan: planOf() })
      assert.match(t.corePrompt, /WORKING CONTEXT/, '⛔ the core still cannot see this conversation')
      assert.ok(t.corePrompt.includes('Email 跟進、廣告推廣'), 'the Owner turn must be there')
      assert.ok(t.corePrompt.includes('可以先由 Email 跟進開始設計'), 'the assistant turn must be there')
      assert.match(t.corePrompt, /延續、修正或者補充/, 'the continuity instruction must travel')
    })
  })

  test('*** ⛔ the active goal reaches the brain, and no world question replaces the answer ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: '我說的是連這裡看到的介面也要一起設計。', history: DESIGN_HISTORY, plan: planOf(), intent: 'not_applicable' })
      assert.match(t.terminal, /EXECUTIVE FRAME/)
      assert.ok(t.terminal.includes('設計香香工作區'), '⛔ the Owner goal was lost before the brain')
      assert.equal(String(t.res.reply).includes('內部'), false)
      assert.equal(/公開/.test(String(t.res.reply)), false, '⛔ a world clarification replaced the answer')
      assert.ok(String(t.res.reply).includes('Email 區'), 'the model answer must survive')
    })
  })
})

/* ═══ 4. FIXTURE B — a short follow-up ════════════════════════════════════ */

describe('X2 FIXTURE B — 「那你覺得呢？」 is answered against the live thread', () => {
  test('*** the active decision is in the core prompt, not an old conversation ***', async () => {
    const history = [
      { role: 'user', text: '中央工場同 Tea House，我而家先集中中央工場。' },
      { role: 'assistant', text: '明白，咁就先擺低 Tea House。' }
    ]
    await withEnv({}, async () => {
      const t = await turn({ message: '那你覺得呢？', history, plan: planOf({ question_restated: '就集中中央工場呢個決定畀睇法' }) })
      assert.ok(t.corePrompt.includes('中央工場'), '⛔ the live thread did not reach the core')
      assert.ok(t.terminal.includes('就集中中央工場呢個決定畀睇法'))
    })
  })
})

/* ═══ 5. FIXTURE C — zero facts, frame survives, nothing is authorised ════ */

describe('X2 FIXTURE C — a zero-fact plan keeps the understanding and grants nothing', () => {
  test('*** ⛔ the frame survives to the brain although the fact plan was refused ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: '幫我設計香香首頁應該有邊幾個區域。', history: DESIGN_HISTORY, plan: planOf({ facts: [] }) })
      assert.equal(t.x2.factPlanOk, false, 'the fact plan really was refused')
      assert.equal(t.x2.factPlanReason, 'plan_named_no_facts')
      assert.equal(t.x2.executiveFramePresent, true, '⛔ zero facts deleted the understanding again')
      assert.match(t.terminal, /EXECUTIVE FRAME/)
    })
  })

  test('*** ⛔ ZERO FACTS IS NOT A PROOF THAT NO READ IS NEEDED ***', () => {
    // The refusal keeps its fail-closed meaning: no usable plan, so nothing is narrowed and the
    // pre-B fallback stands. An omission must never become an authority.
    const judged = judgeGoalPlan(planOf({ facts: [] }))
    assert.equal(judged.ok, false)
    assert.equal(judged.plan, undefined, 'a refused plan is still not a plan')
    assert.ok(judged.understanding.executiveFrame, 'but the understanding survives beside it')
    assert.equal(sourcesForPlan(null, ['gmail', 'aroma_system']), null,
      '⛔ a refused plan must narrow NOTHING — null, never []')
  })

  test('*** and a usable plan still behaves exactly as before ***', () => {
    const j = judgeGoalPlan(planOf({ facts: [{ id: 'f1', need: '郵件', operation: 'gmail', entity: null, fields: [], necessity: 'required' }] }))
    assert.equal(j.ok, true)
    assert.deepEqual(sourcesForPlan(j.plan, ['gmail', 'aroma_system']), ['gmail'])
  })
})

/* ═══ 6. FIXTURE D — a genuine world question is still asked ══════════════ */

describe('X2 FIXTURE D — legitimate world ambiguity still interrupts', () => {
  test('*** ⛔ ambiguous still asks — X2 did not sedate the gate ***', () => {
    const r = decideWorldAsk({ resolverIntent: 'ambiguous', route: 'CONVERSATION', routerSources: [], authorisedSources: ['aroma_system'] })
    assert.equal(r.ask, true)
    assert.equal(r.reason, ASK_REASON.GENUINELY_AMBIGUOUS)
  })

  test('*** ⛔ and rubbish still asks, rather than defaulting to reading his data ***', () => {
    for (const bad of [null, undefined, 'internalish', 42, {}]) {
      assert.equal(decideWorldAsk({ resolverIntent: bad, route: 'CONVERSATION', routerSources: [], authorisedSources: [] }).ask, true, String(bad))
    }
  })

  test('*** a price question with no established scope reaches the ambiguous branch ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: '最近價格升了多少？', history: [], plan: planOf({ facts: [] }), intent: 'ambiguous', verifier: 'require_internal' })
      assert.ok(String(t.res.reply).length > 0)
      // The clarification is the ANSWER here, and that is correct behaviour.
      assert.match(String(t.res.reply), /公開|出面|自己/, 'the world question must still be asked')
    })
  })
})

/* ═══ 7. FIXTURE E — the world question does not apply ════════════════════ */

describe('X2 FIXTURE E — "no world selection required" is expressible and grants nothing', () => {
  test('*** ⛔ not_applicable: no ask, no obligation, no world opened ***', () => {
    const r = decideWorldAsk({ resolverIntent: 'not_applicable', route: 'CONVERSATION', routerSources: [], authorisedSources: ['gmail', 'aroma_system'] })
    assert.equal(r.ask, false)
    assert.equal(r.requiredWorlds, null, '⛔ an obligation was manufactured')
    assert.equal(r.reason, ASK_REASON.WORLD_NOT_APPLICABLE)
  })

  test('*** ⛔ it authorises NO read — both worlds false, and no capability matches ***', () => {
    assert.deepEqual(resolver.WORLDS_FOR_INTENT.not_applicable, { internal: false, public: false })
    assert.equal(resolver.readMatchesIntent('gmail', 'not_applicable'), false)
    assert.equal(resolver.readMatchesIntent('aroma_system.inventory', 'not_applicable'), false)
    assert.equal(resolver.readMatchesIntent('public_knowledge.search', 'not_applicable'), false)
  })

  test('*** ⛔ it is a CLOSED enum member, not a free string ***', () => {
    assert.ok(resolver.INTENT_SCHEMA.properties.intent.enum.includes('not_applicable'))
    assert.equal(resolver.INTENT_SCHEMA.properties.intent.enum.length, 5)
    assert.equal(resolver.INTENT_SCHEMA.additionalProperties, false)
  })

  test('*** the goal reaches the resolver as MEANING, never as access ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: '我說的是這個介面。', history: DESIGN_HISTORY, plan: planOf(), verifier: 'require_internal' })
      assert.ok(t.resolverInputs.length >= 1, 'the resolver ran')
      const inp = t.resolverInputs[0]
      assert.ok(typeof inp.goalContext === 'string' && inp.goalContext.length > 0, 'the goal must travel')
      assert.ok(inp.goalContext.length <= resolver.MAX_GOAL_CONTEXT_CHARS, 'bounded')
      for (const forbidden of ['authorisedSources', 'availableWorlds', 'evidence', 'connector', 'trust']) {
        assert.equal(JSON.stringify(inp).includes(forbidden), false, '⛔ the resolver was told about ' + forbidden)
      }
    })
  })
})

/* ═══ 8. FIXTURE F — a named source is still not a read ═══════════════════ */

describe('X2 FIXTURE F — a source named anywhere authorises nothing', () => {
  test('*** ⛔ Gmail in the message, in Working Context AND in the goal reads nothing ***', async () => {
    const history = [
      { role: 'user', text: '我想設計一個 Gmail 跟進區域。' },
      { role: 'assistant', text: '可以，我哋傾吓個設計。' }
    ]
    await withEnv({}, async () => {
      const t = await turn({
        message: '先不要讀 Gmail，我現在只是在設計介面。',
        history,
        plan: planOf({ question_restated: '設計 Gmail 跟進區域嘅介面', facts: [] })
      })
      // The connector THROWS on any read; reaching a reply at all proves none happened.
      assert.ok(String(t.res.reply).length > 0)
      assert.ok(t.corePrompt.includes('Gmail 跟進區域'), 'the design goal is preserved')
      assert.deepEqual(sourcesForPlan(judgeGoalPlan(planOf({ facts: [] })).plan || null, ['gmail']), null)
    })
  })

  test('*** ⛔ a source named in Working Context cannot widen sourcesForPlan ***', () => {
    // sourcesForPlan reads FACTS and their operations. Working Context is prompt text and is
    // not an input to it at all — the strongest form this fence can take.
    const fs = require('node:fs'); const path = require('node:path')
    const raw = fs.readFileSync(path.join(__dirname, 'goal', 'goalGate.js'), 'utf8')
    const code = raw.split('/*').map((p, i) => (i === 0 ? p : p.slice(p.indexOf('*/') + 2))).join(' ')
      .split(String.fromCharCode(10)).map((l) => { const k = l.indexOf('//'); return k === -1 ? l : l.slice(0, k) }).join(' ')
    assert.equal(/workingContext|WorkingContext/.test(code), false, '⛔ the gate now reads working context')
    /**
     * ⛔ THE FENCE IS ON `sourcesForPlan`'S BODY, NOT THE WHOLE FILE — and the first version
     * was wrong for a boring reason: the module re-exports `executiveFrameBlock`, so the
     * string 'executiveFrame' appears in an import path and a whole-file scan can never pass.
     * What matters is that the function deciding READS does not consult the frame.
     */
    const body = code.slice(code.indexOf('function sourcesForPlan'))
    const fn = body.slice(0, body.indexOf('function requirementBlock'))
    assert.ok(fn.includes('necessity') && fn.includes('operation'), 'the right function was located')
    assert.equal(/executiveFrame|questionRestated|taskType|answerPosture/.test(fn), false,
      '⛔ sourcesForPlan now consults the Executive Frame')
  })
})

/* ═══ 9. FAILURE MUST NOT PROPAGATE ══════════════════════════════════════ */

describe('X2 is not a new single point of failure', () => {
  test('*** ⛔ a dead Cognitive Core leaves the turn working ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: '我說的是連這裡看到的介面也要一起設計。', history: DESIGN_HISTORY, plan: 'THROW' })
      assert.ok(String(t.res.reply).length > 0, '⛔ X2 broke an otherwise valid turn')
      assert.equal(/EXECUTIVE FRAME/.test(t.terminal), false, 'nothing is invented when nothing was produced')
    })
  })

  test('*** ⛔ telemetry is shape only — no message, no context text, no goal prose ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({ message: '我說的是連這裡看到的介面也要一起設計。', history: DESIGN_HISTORY, plan: planOf() })
      const s = JSON.stringify(t.x2)
      for (const forbidden of ['介面也要一起設計', 'Email 跟進、廣告推廣', '設計香香工作區', '畀出工作區', '香香: ', 'Louie: ']) {
        assert.equal(s.includes(forbidden), false, '⛔ telemetry leaked: ' + forbidden)
      }
      assert.deepEqual(Object.keys(t.x2).sort(), [
        'durationMs', 'event', 'executiveFramePresent', 'factPlanOk', 'factPlanReason',
        'requestId', 'workingContextChars', 'workingContextMessages', 'workingContextPresent'
      ].sort())
    })
  })
})
