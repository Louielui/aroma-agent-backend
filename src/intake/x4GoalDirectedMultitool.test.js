'use strict'

/**
 * x4GoalDirectedMultitool.test.js — X4.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE NATURAL TURN THIS FILE EXISTS FOR.
 *
 * Asked which of two projects should go first, she produced a sound provisional judgement and
 * offered 「要不要我先讀一次 Drive」 — and then, on the follow-up, said she had no way at all to
 * obtain several of the very unknowns she had just named. Both sentences were about facts whose
 * operation she was authorised to call and had never tried.
 *
 * ⛔ PHASE 0 FOUND NOTHING MISSING — ONLY NOTHING JOINED.
 *
 * The Goal Plan already names each fact and the operation carrying it. `authorisedOperationsFor`
 * already says what this turn may call. `turnOperations` already records what each attempted
 * operation returned, in three states, with 「live is sticky」 already correct. Every piece was
 * present and none of them had ever been shown to the model in the same sentence.
 *
 * What the model actually received was `requirementBlock`: a STATIC list rebuilt every reasoning
 * step and identical every step, because it reads only the plan. To answer 「乜嘢仲未查？」 it had
 * to cross-reference that fixed list against a growing pile of read-context PROSE. A corrected
 * hypothesis, worth recording: a FAILED read does reach the next prompt — `buildReadContext`
 * returns a block saying `UNAVAILABLE`, so the observation count grows and the prompt cache key
 * changes. The failure was visible. It was just never structural.
 *
 * ⛔ WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT. Every model envelope and every read here is
 * scripted. They prove the joining, the states, the bounds and the fences. They prove NOTHING
 * about whether a real model will investigate a real business question well — only
 * Owner-generated production turns can show that.
 *
 * ⛔ NO PRODUCTION DATA. Every fixture is in-process with fake adapters and a fake connector.
 * The X3 release lesson stands: an in-process intake harness pointed at the production tree
 * writes llm_usage rows, so nothing here may ever run against it.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/x4GoalDirectedMultitool.test.js
 */


const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const inv = require('./investigationState')
const { buildInvestigationState, investigationBlock, selfReadableObservation, READ_STATE } = inv
const { MAX_REASONING_STEPS, MAX_REASONING_STEPS_CEILING } = require('./reasoningLoop')

/* ═══ HARNESS ═══════════════════════════════════════════════════════════════ */

const ENV = {
  GOAL_DECOMPOSER: 'on', MULTI_AI_ROUTER: 'off', A4_KNOWLEDGE_ROUTING: 'on',
  READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', CONTEXT_DRIVE: 'on', CONTEXT_CALENDAR: 'on',
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

/**
 * One whole turn. The Cognitive Core envelope, every brain envelope, the verifier, the resolver
 * and the connector are all fakes.
 *
 * `reads` maps capability → 'ok' | 'fail'. A capability absent from it fails, so a fixture can
 * never accidentally succeed at a read it did not set up.
 */
async function turn (opts) {
  const mainPrompts = []
  const allCalls = []
  const readsAttempted = []
  let mainIdx = 0
  const adapter = {
    async complete (p, o = {}) {
      const name = (o.responseFormat && o.responseFormat.name) || null
      allCalls.push({ schemaName: name, prompt: String(p) })
      if (name === 'goal_plan') {
        if (opts.plan === 'THROW') throw new Error('core down')
        return { text: JSON.stringify(opts.plan), usage: { inputTokens: 1, outputTokens: 1 } }
      }
      mainPrompts.push(String(p))
      const script = opts.script || []
      const body = script[Math.min(mainIdx, script.length - 1)]
      mainIdx++
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
  const x4 = []
  const realLog = console.log
  console.log = (...a) => {
    if (a[0] === '[AROMA-X4]') { try { x4.push(JSON.parse(a[1])) } catch (_) {} return }
    if (typeof a[0] === 'string' && a[0].startsWith('[AROMA')) return
    realLog(...a)
  }
  const realWarn = console.warn
  console.warn = () => {}
  let res
  try {
    res = await processIntake(opts.message, adapter, opts.history || [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: {
        sources: opts.sources || ['gmail', 'drive', 'calendar'],
        connector: {
          // ⛔ THE REAL SIGNATURE: read(source, method, params). Getting this wrong made every
          // read fail while the fixture still looked green — the failure was correct behaviour
          // for a broken connector, which is exactly the trap this file is about.
          async read (source) {
            readsAttempted.push(source)
            const verdict = (opts.reads || {})[source]
            if (verdict !== 'ok') throw new Error('fixture: ' + String(source) + ' not readable')
            return { items: [{ id: source + '-1', title: source + ' row', date: '2026-08-01', url: null }] }
          }
        },
        finalVerifier: async () => ({ decision: opts.verifier || 'allow_final', question: null, outcome: opts.verifier || 'allow_final' }),
        sourceIntentResolver: async () => JSON.stringify({ intent: opts.intent || 'not_applicable' })
      }
    })
  } finally { console.log = realLog; console.warn = realWarn }
  return {
    res,
    allCalls,
    mainPrompts,
    readsAttempted,
    terminal: mainPrompts[mainPrompts.length - 1] || '',
    first: mainPrompts[0] || '',
    x4: x4.find((e) => e && e.event === 'INVESTIGATION') || null,
    x4all: x4
  }
}

const fact = (need, operation, necessity) => ({ need, necessity: necessity || 'required', operation, status: 'AVAILABLE' })
const planOf = (facts, over) => Object.assign({
  question_restated: '邊個項目應該行先',
  executive_frame: { taskType: 'plan', decisionNeeded: true, successDefinition: '揀一個先做', answerPosture: 'direct' },
  facts,
  joins: []
}, over)

const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '', nextRead: { capability }, answerPlan: null })
const FINAL = (reply, over) => Object.assign({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null }, over)
const ASK = (reply) => ({ intent: 'question', mode: 'ask', reply, nextRead: null, answerPlan: null })


const distinct = (a) => [...new Set(a)]
/**
 * ⛔ COMMENTS ARE NOT CODE. Four tranches running, a source fence has failed because the
 * paragraph EXPLAINING why a symbol is forbidden contains that symbol. Strip first, scan after.
 */
const codeOf = (mod) => require('fs').readFileSync(require.resolve(mod), 'utf8')
  .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '').replace(new RegExp('^[ \\t]*//.*$', 'gm'), '')
const blockOf = (prompt) => {
  const m = String(prompt).match(/【調查狀態 — CONTROL STATE[\s\S]*?唔好自己作[^\n]*/)
  return m ? m[0] : ''
}
const stateOf = (prompt, operation) => {
  const line = blockOf(prompt).split('\n').find((l) => l.includes('（' + operation + '）'))
  return line ? line.split('—— ')[1] : null
}

/* ═══ 1. THE CONTRACT — five states, closed, computed not guessed ═══════════ */

describe('the investigation state', () => {
  const plan = {
    questionRestated: '邊個先做',
    facts: [
      { need: '進度', necessity: 'required', operation: 'drive' },
      { need: '檔期', necessity: 'required', operation: 'calendar' },
      { need: '報價', necessity: 'required', operation: null },
      { need: '客量', necessity: 'enriching', operation: 'gmail' },
      { need: '股東意向', necessity: 'required', operation: 'github' }
    ]
  }
  const st = () => buildInvestigationState({
    plan,
    authorised: ['drive', 'calendar', 'gmail'],
    attempted: new Map([['calendar', 'unavailable'], ['drive', 'live']])
  })

  test('five closed states and no sixth', () => {
    assert.deepEqual(Object.values(READ_STATE).sort(),
      ['failed', 'no_system_operation', 'not_attempted', 'not_authorised', 'succeeded'])
  })

  test('*** ⛔ EACH FACT LANDS IN THE STATE ITS EVIDENCE ACTUALLY SUPPORTS ***', () => {
    const s = st()
    assert.equal(s.facts[0].readState, READ_STATE.SUCCEEDED, 'drive was attempted and live')
    assert.equal(s.facts[1].readState, READ_STATE.FAILED, 'calendar was attempted and did not land')
    assert.equal(s.facts[2].readState, READ_STATE.NO_SYSTEM_OPERATION, 'no operation carries it')
    assert.equal(s.facts[3].readState, READ_STATE.NOT_ATTEMPTED, 'authorised, never tried')
    assert.equal(s.facts[4].readState, READ_STATE.NOT_AUTHORISED, 'operation exists, this turn may not')
  })

  test('*** ⛔ PLANNED IS NOT AUTHORISED — the intersection, never the union ***', () => {
    const wide = buildInvestigationState({ plan, authorised: [], attempted: new Map() })
    for (const f of wide.facts) {
      assert.notEqual(f.readState, READ_STATE.NOT_ATTEMPTED, '⛔ a plan name became a permission')
    }
    assert.deepEqual(wide.readableNow, [], '⛔ nothing is self-readable with nothing authorised')
  })

  test('*** ⛔ AN ATTEMPT OUTRANKS A PERMISSION QUESTION — the past is not re-litigated ***', () => {
    // Read ran, then authority narrowed. It still SUCCEEDED; calling it not_authorised would be
    // a false statement about something that already happened.
    const s = buildInvestigationState({ plan, authorised: [], attempted: new Map([['drive', 'live']]) })
    assert.equal(s.facts[0].readState, READ_STATE.SUCCEEDED)
  })

  test('readableNow is REQUIRED only — an enriching fact is never a self-read obligation', () => {
    const s = st()
    assert.deepEqual(s.readableNow, [], 'drive done, calendar failed, gmail is enriching')
    const fresh = buildInvestigationState({ plan, authorised: ['drive', 'calendar', 'gmail'], attempted: new Map() })
    assert.deepEqual(fresh.readableNow, ['drive', 'calendar'], '⛔ an enriching fact must never be a self-read obligation')
  })

  test('remainingRequired counts required facts without live evidence', () => {
    assert.equal(st().remainingRequired, 3, '4 required facts, drive already live')
  })

  test('no plan, or zero facts, yields nothing at all', () => {
    assert.equal(buildInvestigationState({ plan: null }), null)
    assert.equal(buildInvestigationState({ plan: { facts: [] } }), null)
    assert.equal(investigationBlock(null), null)
  })

  test('bounds are literal, not read back from the constant under test', () => {
    const many = { facts: Array.from({ length: 40 }, (_, i) => ({ need: 'x'.repeat(500) + i, necessity: 'required', operation: 'drive' })), questionRestated: 'y'.repeat(900) }
    const s = buildInvestigationState({ plan: many, authorised: ['drive'], attempted: new Map() })
    assert.equal(s.facts.length, 8)
    assert.equal(s.facts[0].need.length, 120)
    assert.equal(s.goal.length, 200)
  })

  test('*** ⛔ NOT EVIDENCE — no row, id, date, value or trust can reach the block ***', () => {
    const b = investigationBlock(st())
    assert.match(b, /唔係證據/)
    assert.match(b, /唔會批准任何來源/)
    for (const banned of ['ref=', 'trust:', 'retrievedAt', 'evidenceId', 'sourceId']) {
      assert.equal(b.includes(banned), false, '⛔ the block looks like evidence: ' + banned)
    }
  })

  test('*** ⛔ THE MODULE REACHES FOR NOTHING — no env, no require, no authority symbol ***', () => {
    const code = codeOf('./investigationState')
    for (const banned of ['require(', 'process.env', 'READ_ACCESS', 'sourcesForPlan', 'connector', 'Proposal', 'dispatch', 'executeRead']) {
      assert.equal(code.includes(banned), false, '⛔ reached for: ' + banned)
    }
  })

  test('*** ⛔ THE ACTIVE GOAL REACHES EVERY REASONING STEP ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('下個月檔期', 'calendar')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [READ('drive'), READ('calendar'), FINAL('我建議先做 A。')]
      })
      // Not 「it was in the first prompt」 — a goal that survives only to step 1 is the defect.
      assert.equal(t.mainPrompts.length, 3, 'three reasoning steps')
      for (let i = 0; i < t.mainPrompts.length; i++) {
        assert.match(t.mainPrompts[i], /目標：邊個項目應該行先/, '⛔ the goal was lost by step ' + (i + 1))
      }
    })
  })

  test('*** ⛔ THE BLOCK NEVER RANKS — no read order is prescribed ***', () => {
    const b = investigationBlock(buildInvestigationState({ plan, authorised: ['drive', 'calendar'], attempted: new Map() }))
    for (const banned of ['先查', '首先讀', '第一步讀', '優先讀']) {
      assert.equal(b.includes(banned), false, '⛔ the server ordered the reads: ' + banned)
    }
    assert.ok(b.indexOf('進度') < b.indexOf('檔期'), 'plan order is preserved, which is not a ranking')
  })

  test('*** ⛔ NEITHER READ-ALL NOR PREMATURE STOP IS ENDORSED — both are named ***', () => {
    const b = investigationBlock(st())
    assert.match(b, /唔使因為計劃入面列咗就逐個讀晒/)
    assert.match(b, /唔好當已經夠/)
  })

  test('*** ⛔ NO owner_only LABEL — operation=null proves a catalogue gap, not who knows it ***', () => {
    const code = codeOf('./investigationState')
    assert.equal(/owner_only|OWNER_ONLY/.test(code), false)
    assert.equal(READ_STATE.NO_SYSTEM_OPERATION, 'no_system_operation')
  })
})

/* ═══ 2. OWNER-VISIBLE FIXTURES A–L ════════════════════════════════════════ */

describe('Owner-visible behaviour', () => {
  test('*** ⛔ A — TWO READABLE SOURCES: A, then B, and Louie carries nothing between them ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('下個月檔期', 'calendar')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [READ('drive'), READ('calendar'), FINAL('我建議先做 A。')]
      })
      assert.deepEqual(distinct(t.readsAttempted), ['drive', 'calendar'], '⛔ both reads must run, in the model\'s order')
      // The step AFTER the first read still knows B is outstanding — the whole point.
      assert.equal(stateOf(t.mainPrompts[1], 'drive'), '已經查到（上面讀取結果入面）')
      assert.equal(stateOf(t.mainPrompts[1], 'calendar'), '未查（你有權自己查）')
      // And by the final call both are resolved.
      assert.equal(stateOf(t.mainPrompts[2], 'calendar'), '已經查到（上面讀取結果入面）')
      assert.equal(t.x4.successfulReads, 2)
      assert.equal(t.x4.remainingRequiredFacts, 0)
      assert.ok(String(t.res.reply).includes('我建議先做 A。'))
    })
  })

  test('*** ⛔ B — STOP WHEN ENOUGH: a planned read is not spent just because it was planned ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('下個月檔期', 'calendar')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [READ('drive'), FINAL('讀完 Drive 已經夠：我建議先做 A。')]
      })
      assert.deepEqual(distinct(t.readsAttempted), ['drive'], '⛔ calendar was planned and must NOT auto-run')
      assert.equal(t.x4.plannedReads, 2)
      assert.equal(t.x4.attemptedReads, 1, '⛔ read-all behaviour')
      assert.ok(String(t.res.reply).includes('我建議先做 A。'))
    })
  })

  test('*** ⛔ C — SELF-READ BEFORE ASK: she may not ask for what she can still fetch ***', async () => {
    await withEnv({}, async () => {
      // She reads one source, then tries to ask Louie for the OTHER one — which she is
      // authorised to read and has not tried. That is the 「幫我搬資料」 defect exactly.
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('下個月檔期', 'calendar')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [READ('drive'), ASK('你可唔可以send下個月嘅檔期畀我？'), READ('calendar'), FINAL('我建議先做 A。')]
      })
      const nudged = t.x4all.find((e) => e && e.event === 'ask_refused_self_readable')
      assert.ok(nudged, '⛔ the ask stood while calendar sat authorised and unread')
      assert.deepEqual(distinct(t.readsAttempted), ['drive', 'calendar'], 'she went and got it herself')
      assert.equal(/send下個月嘅檔期畀我/.test(String(t.res.reply)), false, '⛔ the fetch-request reached the Owner')
    })
  })

  test('C2 — the nudge fires at most once; a second ask stands', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('下個月檔期', 'calendar')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [READ('drive'), ASK('問題一？'), ASK('問題二？'), ASK('問題三？')]
      })
      const nudges = t.x4all.filter((e) => e && e.event === 'ask_refused_self_readable')
      assert.equal(nudges.length, 1, '⛔ a refusal loop: ' + nudges.length)
    })
  })

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⛔ X4.4 — C3 WAS A PINNED GAP, AND IT IS NOW CLOSED. THESE INVERT IT.
   *
   * The old C3 recorded that an ASK in the model's FIRST envelope never reached this seam: it
   * sets no `nextRead`, `allow_final` on an ASK sets no A4 obligation, and the loop guard was
   * therefore false. Measured, on this exact fixture: the plan named 兩邊進度（drive）, the
   * investigation state already held `readableNow: ['drive']` at that line, and the turn still
   * ended with ZERO connector calls and Louie asked to go and fetch it himself.
   *
   * ⛔ WHAT CHANGED IS ONE CONDITION, NOT A NEW RULE. 「required + authorised + never tried」 is
   * still defined once, in `buildInvestigationState`. The initial entrance calls the SAME
   * refusal the loop calls, spends the SAME one-nudge budget, and emits the SAME event. Nothing
   * reads the ASK text — 「send」/「畀我」/「幫我攞」 are irrelevant to whether the system owes
   * itself a look, and matching on them is what this deliberately does not do.
   *
   * ⛔ AND IT REOPENS THE TURN, IT DOES NOT PERFORM A READ. The server names no operation and
   * chooses no ordering. She may read, answer, or ask again.
   * ══════════════════════════════════════════════════════════════════════════
   */

  test('*** ⛔ C3-A — AN INITIAL ASK IS REFUSED ONCE, AND SHE GOES AND GETS IT ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok' },
        script: [ASK('你可唔可以send兩邊嘅進度畀我？'), READ('drive'), FINAL('睇完 Drive，我建議先做 A。')]
      })
      const n = t.x4all.filter((e) => e && e.event === 'ask_refused_self_readable')
      assert.equal(n.length, 1, '⛔ the initial ask was not refused: ' + n.length)
      assert.equal(n[0].origin, 'initial', '⛔ wrong entrance recorded: ' + n[0].origin)
      assert.deepEqual(distinct(t.readsAttempted), ['drive'], 'she read the thing she was authorised to read')
      assert.ok(String(t.res.reply).includes('我建議先做 A。'), '⛔ the answer did not reach him')
      assert.equal(/send兩邊嘅進度畀我/.test(String(t.res.reply)), false, '⛔ the fetch-request reached the Owner')
      // ⛔ AND THE REFUSAL REACHED HER. Spending the budget silently would refuse the ask and
      // then hand the model the same prompt it just answered — a nudge she never saw.
      assert.match(t.mainPrompts[1], /【調查狀態 — 你仲有未用過嘅讀取權限】/, '⛔ the self-readable observation never reached the next step')
      assert.match(t.mainPrompts[1], /你自己有權讀（而且仲未讀）嘅操作：drive/, '⛔ the operation was not named to her')
    })
  })

  test('*** ⛔ C3-B — TWO READABLE FACTS: SHE PICKS, THE SERVER DOES NOT ORDER THEM ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        // ⛔ calendar IS LISTED FIRST ON PURPOSE. A server that quietly picked a read for her
        // would take readableNow[0] — calendar. She takes drive. The two must not coincide,
        // or this fixture would pass for a server that chose.
        plan: planOf([fact('下個月檔期', 'calendar'), fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [ASK('你可唔可以send晒兩樣畀我？'), READ('drive'), FINAL('夠料喇，我建議先做 A。')]
      })
      const n = t.x4all.filter((e) => e && e.event === 'ask_refused_self_readable')
      assert.equal(n.length, 1)
      assert.equal(n[0].readableNow, 2, 'both were offered as readable')
      assert.deepEqual(distinct(t.readsAttempted), ['drive'], '⛔ the server chose a read for her')
      assert.equal(stateOf(t.terminal, 'calendar'), '未查（你有權自己查）', 'the one she skipped stays visibly unread')
      assert.ok(String(t.res.reply).includes('我建議先做 A。'))
    })
  })

  test('*** ⛔ C3-C — AN ENRICHING FACT IS NOT A REASON TO HOLD A TURN OPEN ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '幫我寫封回覆',
        plan: planOf([fact('兩邊進度', 'drive', 'enriching')]),
        reads: { drive: 'ok' },
        script: [ASK('你想我用正式定輕鬆語氣寫？')]
      })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false, '⛔ a nice-to-have held the turn open')
      assert.deepEqual(t.readsAttempted, [], '⛔ a read was forced for an enriching fact')
      assert.equal(t.mainPrompts.length, 1, '⛔ an enriching fact reopened the turn')
      assert.ok(String(t.res.reply).includes('正式定輕鬆語氣'), 'his preference question stands')
    })
  })

  test('*** ⛔ C3-D — AN UNAUTHORISED OPERATION IS NOT SOMETHING SHE CAN GO AND GET ***', async () => {
    await withEnv({ CONTEXT_CALENDAR: 'off' }, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        sources: ['gmail', 'drive'],
        plan: planOf([fact('下個月檔期', 'calendar')]),
        reads: { calendar: 'ok' },
        script: [ASK('你可唔可以send下個月檔期畀我？')]
      })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false, '⛔ an unauthorised operation counted as readable')
      assert.deepEqual(t.readsAttempted, [], '⛔ an unauthorised read executed')
      assert.ok(String(t.res.reply).includes('send下個月檔期畀我'), 'the ask stands — she genuinely cannot reach it this turn')
    })
  })

  test('*** ⛔ C3-E — operation:null IS NOT READABLE, AND NO NEIGHBOUR IS SUBSTITUTED ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('供應商報價', null)]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [ASK('你可唔可以send供應商報價畀我？')]
      })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false, '⛔ a fact nothing carries counted as readable')
      assert.deepEqual(t.readsAttempted, [], '⛔ something was read in place of a fact nothing carries')
      assert.ok(String(t.res.reply).includes('send供應商報價畀我'), 'asking him is the correct move here')
    })
  })

  test('*** ⛔ C3-F — A FAILED OPERATION IS NOT UNREAD, AND IS NEVER RETRIED ***', async () => {
    // ⛔ WHY THIS IS A LOOP CASE AND NOT AN INITIAL ONE, AND IT IS NOT AN EXCUSE. At the FIRST
    // envelope nothing can have been attempted yet: buildInvestigationState runs at
    // intakeService.js:1159 and the read block is built at :1197, so within ONE prompt build the
    // state is always computed BEFORE any read, and turnOperations is per-turn. An initial ASK
    // therefore cannot follow a failure in the same turn. What IS reachable is pinned here, and
    // the exclusion itself is pinned directly on the one helper below.
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'fail' },
        script: [READ('drive'), ASK('Drive 讀唔到，你可唔可以send畀我？'), ASK('再問一次？')]
      })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false, '⛔ a failed read was treated as never tried')
      assert.equal(distinct(t.readsAttempted).length, 1, '⛔ a retry happened')
      assert.equal(stateOf(t.terminal, 'drive'), '今次查過但讀唔到')
    })
    const failed = buildInvestigationState({
      plan: { facts: [fact('兩邊進度', 'drive')], questionRestated: 'x' },
      authorised: ['drive'],
      attempted: new Map([['drive', 'unavailable']])
    })
    assert.deepEqual(failed.readableNow, [], '⛔ a failed operation is still offered as readable')
  })

  test('*** ⛔ C3-G — A PREFERENCE QUESTION WITH NOTHING OUTSTANDING STANDS, WORD FOR WORD ***', async () => {
    await withEnv({}, async () => {
      const q = '你想我用正式定輕鬆語氣寫？'
      const t = await turn({
        message: '幫我寫封回覆',
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok' },
        script: [READ('drive'), ASK(q)]
      })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false, '⛔ an Owner-preference question was suppressed')
      assert.equal(String(t.res.reply).trim(), q, '⛔ his question came back changed')
    })
  })

  test('*** ⛔ C3-H — A4 allow_final + A LEGITIMATE ASK + NO X4 DUTY: UNTOUCHED ***', async () => {
    await withEnv({}, async () => {
      const q = '你想我用正式定輕鬆語氣寫？'
      const t = await turn({
        message: '幫我寫封回覆',
        verifier: 'allow_final',
        plan: planOf([fact('語氣偏好', null)]),
        script: [ASK(q)]
      })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false)
      assert.deepEqual(t.readsAttempted, [], '⛔ allow_final started reading')
      assert.equal(String(t.res.reply).trim(), q, '⛔ allow_final no longer preserves a legitimate ask')
    })
  })

  test('*** ⛔ C3-I — A GATE-AUTHORED QUESTION IS A4 JURISDICTION AND X4 DOES NOT OVERRULE IT ***', async () => {
    await withEnv({}, async () => {
      // The verifier REPLACES her question with its own: his meaning is genuinely open. A
      // readable fact exists, and X4 still must not convert that judgement into a read.
      const t = await turn({
        message: '邊個項目應該行先？',
        verifier: 'clarify',
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok' },
        script: [ASK('你可唔可以send兩邊嘅進度畀我？')]
      })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false, '⛔ X4 overruled a clarify verdict')
      assert.deepEqual(t.readsAttempted, [], '⛔ a clarify verdict started a read')
    })
  })

  test('*** ⛔ C3-J — THE LATER-LOOP NUDGE IS UNCHANGED, AND STILL FIRES AT MOST ONCE ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('下個月檔期', 'calendar')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [READ('drive'), ASK('問題一？'), ASK('問題二？'), ASK('問題三？')]
      })
      const n = t.x4all.filter((e) => e && e.event === 'ask_refused_self_readable')
      assert.equal(n.length, 1, '⛔ a refusal loop: ' + n.length)
      assert.equal(n[0].origin, 'reasoning_loop', '⛔ the loop entrance mislabelled itself: ' + n[0].origin)
    })
  })

  test('*** ⛔ C3-K — NO GOAL PLAN, NO X4: THE TURN IS WHAT IT WAS BEFORE X4 EXISTED ***', async () => {
    await withEnv({}, async () => {
      const q = '你想點做？'
      const t = await turn({ message: '幫我諗下', plan: null, reads: { drive: 'ok' }, script: [ASK(q)] })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false, '⛔ a plan-less turn entered X4')
      assert.deepEqual(t.readsAttempted, [], '⛔ a plan-less turn read something')
      // ⛔ AND IT DID NOT REOPEN. Entering the loop and stopping at the same answer is NOT
      // byte-identical — it is a second paid model call for a turn X4 has no business in.
      assert.equal(t.mainPrompts.length, 1, '⛔ a plan-less turn entered the reasoning loop')
      assert.equal(String(t.res.reply).trim(), q)
    })
  })

  test('*** ⛔ C3-L — ONE NUDGE IS NOT A READ-ALL: THE REST ARE NOT RUN FOR HER ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('下個月檔期', 'calendar'), fact('人手', 'gmail')]),
        reads: { drive: 'ok', calendar: 'ok', gmail: 'ok' },
        // She reads ONE, decides she can answer responsibly, and stops. Two remain planned.
        script: [ASK('你可唔可以send晒啲資料畀我？'), READ('drive'), FINAL('夠料落判斷喇，我建議先做 A。')]
      })
      assert.deepEqual(distinct(t.readsAttempted), ['drive'], '⛔ the remaining planned reads were run automatically')
      assert.equal(t.x4.selfReadableLeft, 2, 'and the two she chose not to read are still counted as readable')
      assert.ok(String(t.res.reply).includes('我建議先做 A。'), 'her answer stands')
    })
  })

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⛔ THE SNAPSHOT IS OLDER THAN THE DECISION — AND A–L COULD NOT SEE IT.
   *
   * `investigationObserved` is written at intakeService.js:1167. The AUTOMATIC read block runs
   * AFTERWARDS in the same prompt build (:1197) and calls `recordOperation` per returned row
   * (:1220). So between the snapshot and the first envelope returning, `turnOperations` can gain
   * the very operation the snapshot called 未查.
   *
   * ⛔ EVERY A–L FIXTURE RUNS WITH A4 SEMANTIC ROUTING ON, which sets `sources = []` and
   * suppresses the automatic path entirely. The window simply never opened. These three turn it
   * OFF, which is the legacy configuration where it does.
   *
   * ⛔ A SUCCESSFUL READ IS NOT UNREAD, AND A FAILED READ IS NOT UNREAD EITHER. Both are excluded
   * by `buildInvestigationState` already — the defect was never the rule, only its clock.
   * ══════════════════════════════════════════════════════════════════════════
   */

  test('*** ⛔ M1 — AN AUTOMATIC READ THAT SUCCEEDED IS NOT SOMETHING SHE STILL OWES HERSELF ***', async () => {
    await withEnv({ A4_KNOWLEDGE_ROUTING: 'off', TURN_ROUTER: 'off' }, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        sources: ['drive'],
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok' },
        script: [ASK('你可唔可以send兩邊嘅進度畀我？')]
      })
      // The automatic path really did run — otherwise this fixture proves nothing.
      assert.deepEqual(distinct(t.readsAttempted), ['drive'], 'the automatic read did not run; the window was never opened')
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false,
        '⛔ she was told to go and read something she had already read')
      assert.ok(String(t.res.reply).includes('send兩邊嘅進度畀我'), 'the ask stands on the existing semantics')
    })
  })

  test('*** ⛔ M2 — AN AUTOMATIC READ THAT FAILED IS NOT UNREAD, AND IS NOT RETRIED ***', async () => {
    await withEnv({ A4_KNOWLEDGE_ROUTING: 'off', TURN_ROUTER: 'off' }, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        sources: ['drive'],
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'fail' },
        script: [ASK('你可唔可以send兩邊嘅進度畀我？')]
      })
      assert.deepEqual(distinct(t.readsAttempted), ['drive'], 'the automatic read was attempted')
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false,
        '⛔ a failed read was re-offered as never tried')
      assert.equal(t.readsAttempted.length, 1, '⛔ a retry happened')
      assert.ok(String(t.res.reply).includes('send兩邊嘅進度畀我'), 'asking him is right once the read has failed')
    })
  })

  test('*** ⛔ M3 — CONTROL: THE FRESH STATE STILL REFUSES WHAT IS GENUINELY UNATTEMPTED ***', async () => {
    await withEnv({ A4_KNOWLEDGE_ROUTING: 'off', TURN_ROUTER: 'off' }, async () => {
      // ⛔ ONE SOURCE, TWO OPERATIONS, AND ONLY ONE OF THEM RAN. The automatic path reads
      // aroma_system once and records the operation the MESSAGE maps to (:1220) — 訂貨建議 here.
      // 發票 is on the same source, authorised, and nobody asked it. A refresh that merely
      // marked the whole source attempted would lose that, and a stale snapshot would offer
      // both. Exactly one is still owed.
      const t = await turn({
        message: '而家有咩要補貨',
        sources: ['aroma_system'],
        plan: planOf([fact('訂貨建議', 'aroma_system.replenishment'), fact('發票紀錄', 'aroma_system.invoices')]),
        reads: { aroma_system: 'ok' },
        script: [ASK('你可唔可以send發票畀我？')]
      })
      assert.deepEqual(distinct(t.readsAttempted), ['aroma_system'], 'the automatic read ran')
      const n = t.x4all.filter((e) => e && e.event === 'ask_refused_self_readable')
      assert.equal(n.length, 1, '⛔ the freshness correction disabled X4.4 on the legacy configuration')
      assert.equal(n[0].origin, 'initial')
      assert.equal(n[0].readableNow, 1,
        '⛔ the state is not current: the operation that DID run is still being offered')
    })
  })

  test('*** ⛔ M4 — THE REFRESH MAY NARROW WHAT IS OFFERED, NEVER WIDEN IT ***', async () => {
    await withEnv({}, async () => {
      // ⛔ CONTEXT_CALENDAR IS STILL 'on' HERE. What withholds calendar is the AUTHORISED SOURCE
      // LIST for this turn, which `authorisedSourcesFor` takes from readDeps (:728) — not the
      // env. A refresh that re-derived authorisation from `enabledSources(process.env)` would
      // hand calendar back, and X4 would order a read this turn was never allowed to make.
      const t = await turn({
        message: '邊個項目應該行先？',
        sources: ['gmail', 'drive'],
        plan: planOf([fact('下個月檔期', 'calendar')]),
        reads: { calendar: 'ok', drive: 'ok' },
        script: [ASK('你可唔可以send下個月檔期畀我？')]
      })
      assert.equal(t.x4all.some((e) => e && e.event === 'ask_refused_self_readable'), false,
        '⛔ the refresh widened authorisation past the turn boundary')
      assert.deepEqual(t.readsAttempted, [], '⛔ an unauthorised read executed')
      assert.ok(String(t.res.reply).includes('send下個月檔期畀我'), 'the ask stands')
    })
  })

  test('*** ⛔ D — NO SYSTEM OPERATION: nothing is substituted for a fact nothing carries ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('供應商報價', null), fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok' },
        script: [READ('drive'), FINAL('報價我攞唔到。暫時建議先做 A。')]
      })
      const b = blockOf(t.mainPrompts[0])
      assert.match(b, /供應商報價 —— ⛔ 系統冇任何讀取操作承載得到呢樣嘢/)
      assert.match(b, /唔好就近搵一個似樣嘅來源頂替/)
      assert.equal(t.x4.noSystemOperation, 1)
      // Only the operation the plan actually named was ever attempted — no neighbour was tried.
      assert.deepEqual(distinct(t.readsAttempted), ['drive'])
      assert.ok(String(t.res.reply).includes('暫時建議先做 A。'), 'a provisional position survives')
    })
  })

  test('*** ⛔ E — READ FAILURE: attempted-and-failed, never "not implemented", never retried ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'fail' },
        script: [READ('drive'), FINAL('Drive 今次讀唔到。')]
      })
      assert.equal(stateOf(t.mainPrompts[1], 'drive'), '今次查過但讀唔到')
      assert.match(blockOf(t.mainPrompts[1]), /唔好講成係冇呢個功能，亦唔好再試一次/)
      assert.equal(t.x4.failedReads, 1)
      assert.equal(t.x4.successfulReads, 0)
      assert.equal(distinct(t.readsAttempted).length, 1, '⛔ a retry happened')
    })
  })

  test('*** ⛔ F — AUTHORISATION DENIED: the operation exists and does not run ***', async () => {
    await withEnv({ CONTEXT_CALENDAR: 'off' }, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        sources: ['gmail', 'drive'], // this turn simply does not admit calendar
        plan: planOf([fact('下個月檔期', 'calendar'), fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [READ('calendar'), READ('drive'), FINAL('我建議先做 A。')]
      })
      assert.equal(t.readsAttempted.includes('calendar'), false, '⛔ an unauthorised read executed')
      assert.equal(stateOf(t.mainPrompts[0], 'calendar'), '有呢個操作，但今個 turn 唔用得')
      assert.match(blockOf(t.mainPrompts[0]), /唔好講成呢個功能唔存在/)
    })
  })

  test('*** ⛔ G — X3 UPDATES: the final position is the post-read one, not the pre-read one ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok' },
        script: [
          // A real provisional position BEFORE the read, so 「stale」 has something to be.
          Object.assign(READ('drive'), { executiveJudgment: { status: 'provisional', statement: '未讀之前，我暫時建議先做 A。', uncertainties: ['未睇過進度'], changeIf: ['睇完進度之後'] } }),
          FINAL('', { executiveJudgment: { status: 'decided', statement: '睇完 Drive，我改為建議先做 B。', uncertainties: [], changeIf: [] } })
        ]
      })
      const reply = String(t.res.reply)
      assert.ok(reply.includes('我改為建議先做 B。'), '⛔ the updated position did not reach him')
      assert.equal(reply.includes('我暫時建議先做 A。'), false, '⛔ the stale pre-read judgement survived the read')
    })
  })

  test('*** ⛔ H — NON-DECISION RETRIEVAL stays ordinary ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '我下個月有咩行程？',
        plan: planOf([fact('下個月行程', 'calendar')], {
          question_restated: '下個月行程',
          executive_frame: { taskType: 'retrieval', decisionNeeded: false, successDefinition: '列出行程', answerPosture: 'direct' }
        }),
        reads: { calendar: 'ok' },
        script: [READ('calendar'), FINAL('你下個月有三個會。')]
      })
      assert.equal(/資料唔齊唔等於冇意見/.test(t.terminal), false, '⛔ X3 judgement pollution')
      assert.equal(String(t.res.reply).includes('暫定判斷'), false)
      assert.equal(String(t.res.reply).includes('未知：'), false, '⛔ judgement scaffolding on a retrieval turn')
      assert.ok(String(t.res.reply).length > 0, 'the turn still answers')
      assert.equal(t.readsAttempted.includes('calendar'), true, 'the retrieval read still happens')
      // X4 still describes the investigation — that is retrieval semantics, not a judgement.
      assert.equal(t.x4.goalFacts, 1)
      assert.equal(t.x4.successfulReads, 1)
    })
  })

  test('*** ⛔ I — ONE OPERATION SERVES TWO FACTS: one read, not two ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('兩邊負責人', 'drive')]),
        reads: { drive: 'ok' },
        script: [READ('drive'), READ('drive'), FINAL('我建議先做 A。')]
      })
      assert.deepEqual(distinct(t.readsAttempted), ['drive'])
      assert.equal(t.x4.goalFacts, 2)
      // Both facts resolve off the single read, because both name the same operation.
      assert.equal(stateOf(t.mainPrompts[1], 'drive'), '已經查到（上面讀取結果入面）')
      assert.equal(t.x4.successfulReads, 2, 'two facts, one connector read')
    })
  })

  test('*** ⛔ J — AN ENRICHING FACT IS NEVER READ AUTOMATICALLY ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('去年客量', 'gmail', 'enriching')]),
        reads: { drive: 'ok', gmail: 'ok' },
        script: [READ('drive'), FINAL('我建議先做 A。')]
      })
      assert.deepEqual(distinct(t.readsAttempted), ['drive'], '⛔ an optional fact was read automatically')
      assert.match(blockOf(t.mainPrompts[0]), /去年客量（可有可無）/)
      assert.equal(t.x4.remainingRequiredFacts, 0, 'the optional fact does not hold the turn open')
    })
  })

  test('*** ⛔ K — MIXED WORLDS: X4 grants no public read ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('外面市場行情', 'public_knowledge'), fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok', public_knowledge: 'ok' },
        script: [READ('public_knowledge'), READ('drive'), FINAL('我建議先做 A。')]
      })
      // Whatever the existing world/egress governance decides, X4 must not have widened it: the
      // public read is not admitted merely because the plan found it useful.
      assert.equal(t.readsAttempted.includes('public_knowledge'), false,
        '⛔ X4 turned a useful public source into an automatic permission')
    })
  })

  test('*** ⛔ L — CAPABILITY TRUTH: a write-shaped name can never become a read candidate ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '幫我加落 Calendar',
        plan: planOf([fact('要加嘅事件', 'calendar.write')]),
        reads: { calendar: 'ok' },
        script: [READ('calendar.write'), FINAL('Calendar 寫入我做唔到。')]
      })
      assert.deepEqual(t.readsAttempted, [], '⛔ a write-shaped capability executed')
      const { isNotImplemented } = require('../governance/selfCapability')
      assert.equal(isNotImplemented('calendar.write'), true, 'S1 truth is unchanged')
      // The plan named it, so the block shows it — as unauthorised, never as a candidate to run.
      assert.equal(stateOf(t.mainPrompts[0], 'calendar.write'), '有呢個操作，但今個 turn 唔用得')
    })
  })
})

/* ═══ 3. FENCES — calls, bounds, authority, telemetry ══════════════════════ */

describe('X4 fences', () => {
  test('*** ⛔ RELEASE-BLOCKING — X4 adds no planner, classifier or critic call ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive'), fact('下個月檔期', 'calendar')]),
        reads: { drive: 'ok', calendar: 'ok' },
        script: [READ('drive'), READ('calendar'), FINAL('我建議先做 A。')]
      })
      const core = t.allCalls.filter((c) => c.schemaName === 'goal_plan')
      const turns = t.allCalls.filter((c) => c.schemaName !== 'goal_plan' && c.prompt.includes('邊個項目應該行先？'))
      const other = t.allCalls.filter((c) => c.schemaName !== 'goal_plan' && !c.prompt.includes('邊個項目應該行先？'))
      assert.equal(core.length, 1, '⛔ the Cognitive Core ran more than once')
      assert.equal(other.length, 0, '⛔ an unaccounted role: ' + JSON.stringify(other.map((c) => c.schemaName)))
      assert.equal(core.length + turns.length, t.allCalls.length)
      // Three reasoning decisions for two reads plus a final — the pre-X4 shape, unchanged.
      assert.equal(turns.length, 3)
    })
  })

  test('*** ⛔ THE READ BOUND IS UNCHANGED — 3 default, 5 ceiling ***', () => {
    assert.equal(MAX_REASONING_STEPS, 3)
    assert.equal(MAX_REASONING_STEPS_CEILING, 5)
    const code = codeOf('./investigationState')
    assert.equal(/maxSteps|MAX_REASONING/.test(code), false, '⛔ X4 reached for the bound')
  })

  test('*** ⛔ NO WRITE OR ACTION VOCABULARY ANYWHERE IN X4 ***', () => {
    const code = codeOf('./investigationState')
    for (const banned of ['create', 'approve', 'send', 'write', 'dispatch', 'workOrder', 'work_order', 'proposal', 'execute']) {
      assert.equal(code.toLowerCase().includes(banned.toLowerCase()), false, '⛔ action vocabulary: ' + banned)
    }
  })

  test('*** ⛔ THE WRITE-SHAPE GUARD IS A REAL SECOND FENCE, PROVEN AT THE GUARD ***', async () => {
    // ⛔ RE-AIMED, AND THE FIRST AIM IS WORTH RECORDING. Fixture L asks for `calendar.write`
    // through the intake path and proves it never runs — but disabling the write-shape guard
    // does not change that outcome, because NO authorisable operation is write-shaped
    // (gmail, drive, calendar, aroma_system.*, public_knowledge.search, github) and the
    // allowlist therefore refuses the name one line earlier. The mutation was EQUIVALENT
    // through that fixture: it proved the allowlist, not the guard.
    //
    // So the guard is proven where it actually stands — with a write-shaped name ALREADY in
    // the allowlist, which is the only situation it exists for.
    const { runReasoningLoop, WRITE_SHAPED } = require('./reasoningLoop')
    const executed = []
    const out = await runReasoningLoop({
      // An ARRAY: the loop builds its own Set and ignores anything that is not one, so a
      // Set here silently yields an EMPTY allowlist and proves the wrong thing.
      capabilities: ['calendar.write', 'drive'],
      executeRead: async ({ capability }) => { executed.push(capability); return { capability, ok: true } },
      callModel: async ({ step }) => (step === 1
        ? { type: 'read', capability: 'calendar.write' }
        : { type: 'final', result: { reply: 'done' } })
    })
    assert.equal(WRITE_SHAPED.test('calendar.write'), true, 'the name is write-shaped')
    assert.deepEqual(executed, [], '⛔ a write-shaped capability executed from inside the allowlist')
    assert.equal(out.stopReason, 'final')
  })

  test('*** ⛔ TELEMETRY IS SHAPE ONLY — counts and one closed stop reason ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: planOf([fact('兩邊進度', 'drive')]),
        reads: { drive: 'ok' },
        script: [READ('drive'), FINAL('我建議先做 A。')]
      })
      const blob = JSON.stringify(t.x4)
      for (const secret of ['兩邊進度', '邊個項目應該行先', '我建議先做 A。', '邊個先做', 'drive row']) {
        assert.equal(blob.includes(secret), false, '⛔ telemetry carried text: ' + secret)
      }
      assert.deepEqual(Object.keys(t.x4).sort(), [
        'askRefusals', 'attemptedReads', 'authorisedPlannedReads', 'event', 'failedReads', 'goalFacts',
        'noSystemOperation', 'plannedReads', 'reasoningSteps', 'remainingRequiredFacts', 'requestId',
        'selfReadableLeft', 'stopReason', 'successfulReads'
      ])
    })
  })

  test('*** ⛔ FAIL SOFT — no plan means the pre-X4 turn, not a degraded one ***', async () => {
    await withEnv({}, async () => {
      const t = await turn({
        message: '邊個項目應該行先？',
        plan: 'THROW',
        reads: { drive: 'ok' },
        script: [FINAL('我建議先做 A。')]
      })
      assert.equal(blockOf(t.mainPrompts[0]), '', '⛔ a block appeared with no plan')
      assert.equal(t.x4, null)
      assert.ok(String(t.res.reply).includes('我建議先做 A。'), 'the turn still answers')
    })
  })

  test('*** ⛔ X3 STAYS INTACT UNDER X4 — the judgement contract is untouched ***', () => {
    const ej = require('./executiveJudgment')
    assert.deepEqual(ej.STATUSES, ['decided', 'provisional', 'blocked'])
    assert.equal(ej.judgeExecutiveJudgment({ status: 'blocked', statement: '我建議 A', uncertainties: [], changeIf: [] }).ok, false)
  })
})
