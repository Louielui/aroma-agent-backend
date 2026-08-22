'use strict'

/**
 * selfCapability.test.js — S1.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ TWO NATURAL FAILURES, ONE GAP.
 *
 * 「我沒法貼圖給你,你好像還沒有這個功能」 — he was right, and she had no way to say so.
 * 「我下月23號會出席一個meeting,幫我加到calendar」 — calendarRead.js is list/get only, the read
 * connector refuses write-shaped method names at registration, and no event could ever have
 * been created. She had no way to know that either.
 *
 * ⛔ THE HALF OF THIS FILE THAT MATTERS MOST IS THE REGISTRY-VS-CODE HALF. A hand-written
 * capability table is a promise; a hand-written table nobody checks is a promise that rots.
 * Every entry below is asserted against a real callable production surface — the code is the
 * fact and this registry is the contract, and when they disagree the suite says so.
 *
 * ⛔ WHAT IT DOES NOT PROVE. Every model envelope here is scripted. These prove the registry is
 * true, that the truth travels, and that it grants nothing. Whether a real model USES it well
 * is only knowable from Owner-generated production turns.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/governance/selfCapability.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cap = require('./selfCapability')
const { IMPLEMENTATION, REGISTRY, implementationOf, capabilityBlock, CAPABILITY_NAMES } = cap
const selfDescription = require('./selfDescription')
const { processIntake } = require('../intake/intakeService')
const { judgeGoalPlan, goalPlanSchema } = require('../intake/goal/goalPlanContract')
const { sourcesForPlan, executiveFrameBlock } = require('../intake/goal/goalGate')

const SRC = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
/** ⛔ Comments are not code — the fence that scans for surfaces must not match its own prose. */
const codeOf = (rel) => {
  const raw = read(rel)
  const noBlock = raw.split('/*').map((p, i) => (i === 0 ? p : p.slice(p.indexOf('*/') + 2))).join(' ')
  return noBlock.split(String.fromCharCode(10))
    .map((l) => { const k = l.indexOf('//'); return k === -1 ? l : l.slice(0, k) })
    .join(String.fromCharCode(10))
}
/** The method names an adapter factory actually exposes. */
const methodsOf = (rel, factory) => {
  const m = require(path.join(SRC, rel))
  const inst = m[factory]({ client: {}, clock: () => 't' })
  return Object.keys((inst && inst.methods) || {})
}

/* ═══ 1. THE REGISTRY MATCHES THE CODE ═════════════════════════════════════ */

describe('S1 the registry is checked against real production surfaces', () => {
  test('*** ⛔ calendar.read implemented — the adapter really exposes read methods ***', () => {
    const m = methodsOf('context/adapters/calendarRead.js', 'createCalendarReadAdapter')
    assert.deepEqual(m.sort(), ['getEvent', 'listEvents'])
    assert.equal(implementationOf('calendar.read'), IMPLEMENTATION.IMPLEMENTED)
  })

  test('*** ⛔ calendar.write not_implemented — there is NO mutation surface anywhere ***', () => {
    const m = methodsOf('context/adapters/calendarRead.js', 'createCalendarReadAdapter')
    const WRITE = /^(insert|update|patch|delete|remove|move|create|add)/i
    assert.equal(m.some((n) => WRITE.test(n)), false, 'the adapter exposes a write method')
    // And nothing else in production writes to Calendar either.
    for (const rel of ['context/adapters/calendarRead.js', 'context/liveClients.js', 'context/readConnector.js']) {
      assert.equal(/events\.(insert|update|patch|delete|move)/.test(codeOf(rel)), false, rel + ' mutates Calendar')
    }
    assert.equal(implementationOf('calendar.write'), IMPLEMENTATION.NOT_IMPLEMENTED)
  })

  test('*** ⛔ the read connector REFUSES a write-shaped method at registration ***', () => {
    const { createReadConnector } = require(path.join(SRC, 'context/readConnector.js'))
    const c = createReadConnector({ env: {} })
    assert.throws(() => c.register({ source: 'calendar', methods: { createEvent: async () => ({}) } }),
      /refuses write-shaped method/, '⛔ the write fence is gone')
  })

  test('*** ⛔ image.input / file.input not_implemented — no route, no adapter, no UI accepts one ***', () => {
    // The intake route validates exactly two string fields.
    const router = codeOf('routes/demoRouter.js')
    assert.equal(/multipart|type=["']file["']|req\.files|upload/i.test(router), false, 'the route accepts an upload')
    // No adapter builds an image content block for any provider.
    for (const rel of ['adapters/ClaudeAdapter.js', 'adapters/OpenAIAdapter.js']) {
      assert.equal(/image_url|type: *'image'|"type": *"image"/.test(codeOf(rel)), false, rel + ' sends images')
    }
    assert.equal(implementationOf('image.input'), IMPLEMENTATION.NOT_IMPLEMENTED)
    assert.equal(implementationOf('file.input'), IMPLEMENTATION.NOT_IMPLEMENTED)
  })

  test('*** ⛔ every read capability marked implemented has real read methods ***', () => {
    const pairs = [
      ['gmail.read', 'context/adapters/gmailRead.js', 'createGmailReadAdapter'],
      ['drive.read', 'context/adapters/driveRead.js', 'createDriveReadAdapter'],
      ['github.read', 'context/adapters/githubRead.js', 'createGithubReadAdapter']
    ]
    for (const [name, rel, factory] of pairs) {
      let m = []
      try { m = methodsOf(rel, factory) } catch (_) { m = [] }
      assert.ok(m.length > 0, name + ': no methods found on ' + rel)
      assert.equal(implementationOf(name), IMPLEMENTATION.IMPLEMENTED, name)
    }
  })

  test('*** ⛔ no write capability claims to be implemented ***', () => {
    for (const e of REGISTRY.filter((x) => x.kind === 'write')) {
      assert.equal(e.implementation, IMPLEMENTATION.NOT_IMPLEMENTED,
        '⛔ ' + e.capability + ' claims a write surface this build does not have')
    }
  })

  test('*** ⛔ IMPLEMENTATION IS NOT DERIVED FROM FLAGS OR CREDENTIALS ***', () => {
    // A flag proves an intention; a credential proves a secret exists. Neither proves a method
    // was written. The registry module must not read either.
    const code = codeOf('governance/selfCapability.js')
    for (const forbidden of ['process.env', 'READ_ACCESS', 'CONTEXT_', 'API_KEY', 'TOKEN', 'resolveFlag', 'enabledSources']) {
      assert.equal(code.includes(forbidden), false, '⛔ the registry reads ' + forbidden)
    }
    // And flipping every flag changes nothing.
    const before = REGISTRY.map((e) => e.capability + '=' + e.implementation).join(',')
    const saved = {}
    for (const k of ['READ_ACCESS', 'CONTEXT_CALENDAR', 'CONTEXT_GMAIL']) { saved[k] = process.env[k]; process.env[k] = 'off' }
    try {
      const after = require('./selfCapability').REGISTRY.map((e) => e.capability + '=' + e.implementation).join(',')
      assert.equal(after, before, '⛔ a flag moved the registry')
    } finally {
      for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    }
  })
})

/* ═══ 2. IMPLEMENTATION IS NOT REACHABILITY ════════════════════════════════ */

describe('S1 implemented never means "works right now"', () => {
  test('*** ⛔ the registry has NO reachability field at all ***', () => {
    for (const e of REGISTRY) {
      for (const forbidden of ['reachable', 'available', 'connected', 'enabled', 'live', 'healthy']) {
        assert.equal(Object.prototype.hasOwnProperty.call(e, forbidden), false,
          '⛔ ' + e.capability + ' carries a ' + forbidden + ' field')
      }
      assert.deepEqual(Object.keys(e).sort(), ['capability', 'implementation', 'kind', 'label'])
    }
  })

  test('*** ⛔ the block states the rule in its own text ***', () => {
    const b = capabilityBlock()
    assert.match(b, /實作事實，唔係實時證據/)
    assert.match(b, /「已實作」唔等於而家連得到/)
    assert.match(b, /要真係讀一次先知/)
    assert.match(b, /「未實作」係確定嘅/)
  })

  test('*** the existing selfDescription rule is preserved, not replaced ***', () => {
    assert.match(selfDescription.describe(), /唔會用設定嚟當答案/,
      '⛔ the original flag-is-not-capability sentence was lost')
    // ONE registry — selfDescription re-exports it rather than holding a second table.
    assert.equal(selfDescription.capabilities, REGISTRY)
    const sd = codeOf('governance/selfDescription.js')
    assert.equal(/implementation: *'(implemented|not_implemented)'/.test(sd), false,
      '⛔ a second capability table appeared in selfDescription')
  })
})

/* ═══ 3. THE COGNITIVE CORE NAMES THE CAPABILITY ═══════════════════════════ */

describe('S1 the requested capability is a closed enum on the existing call', () => {
  test('*** the schema offers the registry, nullable, and requires the field ***', () => {
    const s = goalPlanSchema()
    assert.ok(s.required.includes('requested_capability'))
    const p = s.properties.requested_capability
    assert.deepEqual(p.anyOf.find((b) => b.enum).enum, CAPABILITY_NAMES)
    assert.ok(p.anyOf.some((b) => b.type === 'null'), 'null must be sayable — most turns are null')
  })

  test('*** ⛔ an invented capability resolves to null, never to the nearest one ***', () => {
    const F = { taskType: 'act', decisionNeeded: false, successDefinition: 's', answerPosture: 'direct' }
    for (const bogus of ['calendar.teleport', 'calendar.Write', 'calendar', 'image.upload', '']) {
      const u = judgeGoalPlan({ question_restated: 'x', executive_frame: F, requested_capability: bogus, facts: [], joins: [] }).understanding
      assert.equal(u.requestedCapability, null, 'accepted ' + JSON.stringify(bogus))
      assert.equal(u.requestedCapabilityImplementation, null)
    }
  })

  test('*** ⛔ the implementation state comes from the registry, not from the model ***', () => {
    const F = { taskType: 'act', decisionNeeded: false, successDefinition: 's', answerPosture: 'direct' }
    const u = judgeGoalPlan({ question_restated: 'x', executive_frame: F, requested_capability: 'calendar.write', facts: [], joins: [] }).understanding
    assert.equal(u.requestedCapability, 'calendar.write')
    assert.equal(u.requestedCapabilityImplementation, IMPLEMENTATION.NOT_IMPLEMENTED)
  })
})

/* ═══ 4. THE FIXTURES ══════════════════════════════════════════════════════ */

const ENV = {
  GOAL_DECOMPOSER: 'on', MULTI_AI_ROUTER: 'off', A4_KNOWLEDGE_ROUTING: 'on',
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
const FRAME = (over) => Object.assign({ taskType: 'act', decisionNeeded: false, successDefinition: '幫佢做到嗰件事', answerPosture: 'direct' }, over)
const PLAN = (over) => Object.assign({ question_restated: '將下月 23 號嘅 meeting 加落 Calendar', executive_frame: FRAME(), requested_capability: null, facts: [], joins: [] }, over)

async function turn (opts) {
  const corePrompts = []
  const mainPrompts = []
  const allCalls = []
  let reads = 0
  let idx = 0
  const adapter = {
    async complete (p, o = {}) {
      const name = (o.responseFormat && o.responseFormat.name) || null
      allCalls.push({ schemaName: name, prompt: String(p) })
      if (name === 'goal_plan') { corePrompts.push(String(p)); return { text: JSON.stringify(opts.plan), usage: { inputTokens: 1, outputTokens: 1 } } }
      mainPrompts.push(String(p))
      const body = (opts.script || [{ intent: 'question', mode: 'chat', reply: '好。', nextRead: null, answerPlan: null }])[Math.min(idx, (opts.script || [1]).length - 1)]
      idx++
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
  const s1 = []
  const realLog = console.log
  console.log = (...a) => {
    if (a[0] === '[AROMA-S1]') { try { s1.push(JSON.parse(a[1])) } catch (_) {} return }
    if (typeof a[0] === 'string' && a[0].startsWith('[AROMA')) return
    realLog(...a)
  }
  let res
  try {
    res = await processIntake(opts.message, adapter, opts.history || [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: {
        sources: opts.sources || ['calendar'],
        connector: { async read () { reads++; throw new Error('THIS FIXTURE MUST NOT READ') } },
        finalVerifier: async () => ({ decision: 'allow_final', question: null }),
        sourceIntentResolver: async () => JSON.stringify({ intent: opts.intent || 'not_applicable' })
      }
    })
  } finally { console.log = realLog }
  return { res, reads, allCalls, corePrompts, terminal: mainPrompts[mainPrompts.length - 1] || '', s1: s1[s1.length - 1] || null }
}

describe('S1 FIXTURE A — calendar write is not implemented', () => {
  test('*** ⛔ the truth travels, nothing is read, and no execution is promised ***', async () => {
    await withEnv(async () => {
      const t = await turn({
        message: '我下月23號有個 meeting，幫我加到 Calendar。',
        plan: PLAN({ requested_capability: 'calendar.write' }),
        script: [{ intent: 'question', mode: 'chat', reply: '我而家淨係讀得到 Calendar，加唔到事件；我可以幫你先整理好內容。', nextRead: null, answerPlan: null }]
      })
      assert.equal(implementationOf('calendar.write'), IMPLEMENTATION.NOT_IMPLEMENTED)
      assert.equal(t.reads, 0, '⛔ a connector was called for an unimplemented write')
      assert.match(t.terminal, /佢要求嘅能力：calendar\.write/)
      assert.match(t.terminal, /未實作】/, '⛔ the brain was not told the capability is absent')
      assert.match(t.terminal, /唔好扮問細節當跟住會做/, '⛔ nothing stops it asking for a start time it cannot use')
      assert.match(t.terminal, /唔好講成係connection問題/)
      assert.equal(t.s1.requestedCapability, 'calendar.write')
      assert.equal(t.s1.implementationState, 'not_implemented')
    })
  })
})

describe('S1 FIXTURE B — calendar read exists, reachability does not follow', () => {
  test('*** ⛔ implemented is stated WITHOUT a live claim ***', async () => {
    await withEnv(async () => {
      const t = await turn({
        message: '你可唔可以睇我 Calendar？',
        plan: PLAN({ question_restated: '睇下 Calendar 有咩', requested_capability: 'calendar.read' })
      })
      assert.match(t.terminal, /佢要求嘅能力：calendar\.read/)
      assert.match(t.terminal, /已實作唔等於而家連得到/, '⛔ implemented was allowed to mean connected')
      assert.equal(/calendar\.read.*而家一定/.test(t.terminal), false)
    })
  })
})

describe('S1 FIXTURE C — image input', () => {
  test('*** ⛔ no pretence of visual access, no world question, no connector ***', async () => {
    await withEnv(async () => {
      const t = await turn({
        message: '我可以貼張圖畀你睇嗎？',
        plan: PLAN({ question_restated: '問我可唔可以收圖', requested_capability: 'image.input' })
      })
      assert.equal(t.reads, 0)
      assert.match(t.terminal, /佢要求嘅能力：image\.input/)
      assert.match(t.terminal, /未實作】/)
      assert.equal(/公開|外面/.test(String(t.res.reply)), false, '⛔ a world clarification appeared')
    })
  })
})

describe('S1 FIXTURE D — a capability is not an authorisation', () => {
  test('*** ⛔ gmail.read implemented does NOT read Gmail on an unrelated question ***', async () => {
    await withEnv(async () => {
      assert.equal(implementationOf('gmail.read'), IMPLEMENTATION.IMPLEMENTED)
      const t = await turn({
        message: '中央工場同 Tea House，我應該先集中邊邊？',
        plan: PLAN({ question_restated: '揀先集中邊間', requested_capability: null }),
        sources: ['gmail']
      })
      assert.equal(t.reads, 0, '⛔ Gmail was read because the registry says it is implemented')
    })
  })

  test('*** ⛔ the registry is not consulted by sourcesForPlan at all ***', () => {
    const gate = codeOf('intake/goal/goalGate.js')
    assert.equal(/selfCapability|implementationOf|capabilityBlock|requestedCapability/.test(gate), false,
      '⛔ the read gate now reads the capability registry')
    // Same facts, different requested capability: identical read set.
    const F = FRAME()
    const facts = [{ id: 'f1', need: 'n', operation: 'calendar', entity: null, fields: [], necessity: 'required' }]
    const a = judgeGoalPlan({ question_restated: 'x', executive_frame: F, requested_capability: 'calendar.write', facts, joins: [] }).plan
    const b = judgeGoalPlan({ question_restated: 'x', executive_frame: F, requested_capability: null, facts, joins: [] }).plan
    assert.deepEqual(sourcesForPlan(a, ['calendar']), sourcesForPlan(b, ['calendar']))
  })
})

describe('S1 FIXTURE E — an action request does not invent a surface', () => {
  test('*** ⛔ aroma_system.write is not_implemented and nothing is written ***', async () => {
    await withEnv(async () => {
      assert.equal(implementationOf('aroma_system.write'), IMPLEMENTATION.NOT_IMPLEMENTED)
      const t = await turn({
        message: '直接幫我改 Aroma System。',
        plan: PLAN({ question_restated: '直接改 Aroma System 資料', requested_capability: 'aroma_system.write' }),
        sources: ['aroma_system']
      })
      assert.equal(t.reads, 0)
      assert.match(t.terminal, /未實作】/)
      // The Aroma adapter really has no mutation surface.
      assert.equal(/method: *'(POST|PUT|PATCH|DELETE)'/.test(codeOf('context/adapters/aromaSystemRead.js')), false)
    })
  })
})

describe('S1 FIXTURE F — ordinary cognition is untouched', () => {
  test('*** ⛔ a judgement question stays a judgement question ***', async () => {
    await withEnv(async () => {
      const t = await turn({
        message: '中央工場同 Tea House，我應該先集中邊邊？',
        plan: PLAN({ question_restated: '揀邊間先集中', executive_frame: FRAME({ taskType: 'recommend', decisionNeeded: true, answerPosture: 'provisional' }), requested_capability: null })
      })
      assert.equal(t.s1.requestedCapability, null, '⛔ a business judgement became a capability request')
      assert.equal(/佢要求嘅能力/.test(t.terminal), false, 'no capability line when none was requested')
      // The capability block is still present — it is static context, not a trigger.
      assert.match(t.terminal, /SELF CAPABILITY/)
    })
  })
})

/* ═══ 5. AUTHORITY AND EVIDENCE FENCES ═════════════════════════════════════ */

describe('S1 capability truth grants nothing and proves nothing about the business', () => {
  test('*** ⛔ the block carries no row, id, date or value ***', () => {
    const b = capabilityBlock()
    for (const forbidden of ['ref=', 'trust', 'retrievedAt', 'sourceId', '[gmail]', '[calendar]', 'SANITISED']) {
      assert.equal(b.includes(forbidden), false, '⛔ the capability block carries ' + forbidden)
    }
    assert.match(b, /唔會批准任何來源、寫入或者執行/)
  })

  test('*** ⛔ the registry module cannot reach a connector, a write or governance ***', () => {
    const code = codeOf('governance/selfCapability.js')
    for (const forbidden of ['require(', 'connector', 'axios', 'promoteToProposal', 'executeDispatch', 'workOrder']) {
      assert.equal(code.includes(forbidden), false, '⛔ the registry reaches ' + forbidden)
    }
  })

  test('*** ⛔ it never becomes evidence ***', () => {
    const code = codeOf('governance/selfCapability.js')
    assert.equal(/makeContextResult|evidenceSets|EvidenceSet|trust: *'live'/.test(code), false)
  })

  test('*** ⛔ S1 adds NO model call — role-by-role accounting ***', async () => {
    await withEnv(async () => {
      const t = await turn({ message: '幫我加到 Calendar', plan: PLAN({ requested_capability: 'calendar.write' }) })
      assert.equal(t.corePrompts.length, 1, 'the cognitive core ran once')
      for (const c of t.allCalls) {
        const isCore = c.schemaName === 'goal_plan'
        const isTurn = c.prompt.includes('加到 Calendar')
        assert.ok(isCore || isTurn, '⛔ unaccounted model call: schema=' + c.schemaName)
      }
      assert.equal(t.allCalls.length, 2)
    })
  })

  test('*** ⛔ telemetry is enums and a boolean, never words ***', async () => {
    await withEnv(async () => {
      const t = await turn({ message: '幫我加到 Calendar', plan: PLAN({ requested_capability: 'calendar.write' }) })
      const s = JSON.stringify(t.s1)
      for (const forbidden of ['加到 Calendar', '將下月', 'meeting', '幫佢做到']) {
        assert.equal(s.includes(forbidden), false, '⛔ telemetry leaked: ' + forbidden)
      }
      assert.deepEqual(Object.keys(t.s1).sort(),
        ['capabilityContextPresent', 'event', 'implementationState', 'requestId', 'requestedCapability'])
    })
  })
})
