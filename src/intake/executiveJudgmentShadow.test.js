'use strict'
/**
 * executiveJudgmentShadow.test.js — C1-A.
 *
 * Two things are under test and they are not the same thing:
 *   1. the classifier answers the narrow question it claims to answer, and
 *   2. NOTHING IN THE PIPELINE ACTS ON THE ANSWER.
 *
 * (2) is the one that matters. A shadow that quietly starts steering is not a shadow, and
 * the measurement it produced stops being a baseline the moment it does.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  classifyExecutiveJudgmentShadow, emitExecutiveJudgmentShadow,
  ALLOWED, EVENT, UNKNOWN, FINAL_DECISION, MODE, ASK_ORIGIN, ROUTE, GAP_DECISION, GAP_MODE
} = require('./executiveJudgmentShadow')

const { DECISION } = require('./finalKnowledgeRequirement')
const { ASK_ORIGIN: REAL_ASK_ORIGIN } = require('./askForkTrace')
const { ROUTES: REAL_ROUTES } = require('./turnRouter')
const { STATUS } = require('./goal/goalPlanContract')

const cls = (o) => classifyExecutiveJudgmentShadow(o)
const fact = (necessity, status, operation) => ({ necessity, status, operation: operation || null })

/* ═══ 1. THE VOCABULARIES ARE THE REAL ONES ══════════════════════════════════ */

describe('the enums are copied from their owners, not invented here', () => {
  test('*** ⛔ EVERY VOCABULARY MATCHES ITS SOURCE MODULE EXACTLY ***', () => {
    // If an owner module renames a value, this fails here rather than silently
    // mislabelling every telemetry line in production as "unknown".
    assert.deepStrictEqual([...FINAL_DECISION].sort(), Object.values(DECISION).sort())
    assert.deepStrictEqual([...ASK_ORIGIN].sort(), Object.values(REAL_ASK_ORIGIN).sort())
    assert.deepStrictEqual([...ROUTE].sort(), [...REAL_ROUTES].sort())
  })

  test('the mode vocabulary matches the distill parser', () => {
    const src = fs.readFileSync(path.join(__dirname, 'distillPrompt.js'), 'utf8')
    const m = src.match(/const MODES = \[([^\]]*)\]/)
    assert.ok(m, 'distillPrompt must still declare MODES')
    const real = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    assert.deepStrictEqual([...MODE].sort(), real.sort())
  })

  test('the gap constants are the two values the C0 forensic named', () => {
    assert.strictEqual(GAP_DECISION, 'allow_final')
    assert.strictEqual(GAP_MODE, 'ask')
  })
})

/* ═══ 2. THE C0 SIGNATURE ════════════════════════════════════════════════════ */

describe('⛔ the C0 structural signature', () => {
  test('*** C0-A — allow_final + ask IS a candidate ***', () => {
    const r = cls({ finalDecision: DECISION.ALLOW, mode: 'ask' })
    assert.strictEqual(r.candidateJudgmentGap, true)
    assert.strictEqual(r.finalDecision, 'allow_final')
    assert.strictEqual(r.mode, 'ask')
  })

  test('*** C0-B — allow_final + recommend is NOT a candidate ***', () => {
    assert.strictEqual(cls({ finalDecision: DECISION.ALLOW, mode: 'recommend' }).candidateJudgmentGap, false)
  })

  test('*** C0-C — clarify + ask is NOT a candidate (may be real blocking ambiguity) ***', () => {
    assert.strictEqual(cls({ finalDecision: DECISION.CLARIFY, mode: 'ask' }).candidateJudgmentGap, false)
  })

  test('*** C0-D — every require_* decision + ask is NOT a candidate ***', () => {
    for (const d of [DECISION.INTERNAL, DECISION.PUBLIC, DECISION.MIXED]) {
      assert.strictEqual(cls({ finalDecision: d, mode: 'ask' }).candidateJudgmentGap, false, d + ' must not be a candidate')
    }
  })

  test('*** ⛔ THE CANDIDATE NEEDS BOTH HALVES — no other pairing qualifies ***', () => {
    for (const d of FINAL_DECISION) {
      for (const m of MODE) {
        const expected = (d === GAP_DECISION && m === GAP_MODE)
        assert.strictEqual(cls({ finalDecision: d, mode: m }).candidateJudgmentGap, expected,
          d + ' + ' + m + ' classified wrongly')
      }
    }
  })
})

/* ═══ 3. FAIL-CLOSED ═════════════════════════════════════════════════════════ */

describe('⛔ a claim built on an unreadable value is not a claim', () => {
  test('*** malformed input never produces a candidate ***', () => {
    for (const v of [null, undefined, 42, 'x', [], {}]) {
      assert.strictEqual(cls(v).candidateJudgmentGap, false)
    }
  })

  test('unknown decision or mode is reported as unknown, never guessed', () => {
    const r = cls({ finalDecision: 'made_up', mode: 'invented' })
    assert.strictEqual(r.finalDecision, UNKNOWN)
    assert.strictEqual(r.mode, UNKNOWN)
    assert.strictEqual(r.candidateJudgmentGap, false)
  })

  test('an unknown value can never masquerade as a real enum member', () => {
    assert.ok(!FINAL_DECISION.includes(UNKNOWN))
    assert.ok(!MODE.includes(UNKNOWN))
    assert.ok(!ROUTE.includes(UNKNOWN))
  })

  test('the classifier is deterministic', () => {
    const input = { finalDecision: 'allow_final', mode: 'ask', route: 'CONVERSATION' }
    const first = JSON.stringify(cls(input))
    for (let i = 0; i < 50; i++) assert.strictEqual(JSON.stringify(cls(input)), first)
  })
})

/* ═══ 4. GOAL FACT COUNTS — OBSERVATION DATA, NO AUTHORITY ═══════════════════ */

describe('goal necessity is counted and nothing more', () => {
  test('*** ⛔ NO PLAN IS null, NOT ZERO — the two are different facts ***', () => {
    const r = cls({ finalDecision: 'allow_final', mode: 'ask', goalPlan: null })
    assert.strictEqual(r.requiredFacts, null)
    assert.strictEqual(r.enrichingFacts, null)
    assert.strictEqual(r.factsWithOperation, null)
    // and a plan that genuinely has no facts really is zero
    const z = cls({ finalDecision: 'allow_final', mode: 'ask', goalPlan: { facts: [] } })
    assert.strictEqual(z.requiredFacts, 0)
    assert.strictEqual(z.enrichingFacts, 0)
  })

  test('counts split by necessity and status', () => {
    const goalPlan = {
      facts: [
        fact('required', STATUS.AVAILABLE, 'aroma_system.inventory'),
        fact('required', STATUS.UNAVAILABLE, null),
        fact('required', STATUS.PARTIAL, 'aroma_system.invoices'),
        fact('enriching', STATUS.UNAVAILABLE, null)
      ]
    }
    const r = cls({ finalDecision: 'allow_final', mode: 'ask', goalPlan })
    assert.strictEqual(r.requiredFacts, 3)
    assert.strictEqual(r.enrichingFacts, 1)
    assert.strictEqual(r.requiredUnavailableFacts, 1)
    assert.strictEqual(r.requiredPartialFacts, 1)
    assert.strictEqual(r.enrichingUnavailableFacts, 1)
    assert.strictEqual(r.factsWithOperation, 2)
    assert.strictEqual(r.factsWithoutOperation, 2)
  })

  test('*** ⛔ NECESSITY HAS NO QUESTION-AUTHORITY — counts never move the candidate ***', () => {
    // The C0 confusion was "required to read" drifting into "must ask the Owner first".
    // Whatever the fact profile, the candidate depends on decision+mode and nothing else.
    const profiles = [
      null,
      { facts: [] },
      { facts: [fact('required', STATUS.UNAVAILABLE)] },
      { facts: [fact('required', STATUS.AVAILABLE, 'op'), fact('required', STATUS.AVAILABLE, 'op')] },
      { facts: [fact('enriching', STATUS.AVAILABLE, 'op')] }
    ]
    for (const goalPlan of profiles) {
      assert.strictEqual(cls({ finalDecision: 'allow_final', mode: 'ask', goalPlan }).candidateJudgmentGap, true)
      assert.strictEqual(cls({ finalDecision: 'clarify', mode: 'ask', goalPlan }).candidateJudgmentGap, false)
    }
  })

  test('malformed facts are skipped without throwing', () => {
    const goalPlan = { facts: [null, 'x', 7, fact('required', STATUS.AVAILABLE, 'op')] }
    const r = cls({ finalDecision: 'allow_final', mode: 'ask', goalPlan })
    assert.strictEqual(r.requiredFacts, 1)
  })
})

/* ═══ 5. PRIVACY ═════════════════════════════════════════════════════════════ */

describe('⛔ the telemetry line carries structure, never content', () => {
  const capture = (obs, requestId) => {
    const lines = []
    emitExecutiveJudgmentShadow(requestId === undefined ? 'req-1' : requestId, obs, (l, p) => lines.push([l, p]))
    return lines
  }

  test('*** ⛔ ONLY ALLOWLISTED KEYS REACH THE LOG ***', () => {
    const obs = Object.assign(cls({ finalDecision: 'allow_final', mode: 'ask' }), {
      reply: 'SHOULD NOT APPEAR',
      message: 'SHOULD NOT APPEAR',
      prompt: 'SHOULD NOT APPEAR',
      history: ['SHOULD NOT APPEAR'],
      need: 'SHOULD NOT APPEAR',
      content: 'SHOULD NOT APPEAR',
      body: 'SHOULD NOT APPEAR'
    })
    const [[label, payload]] = capture(obs)
    assert.strictEqual(label, '[AROMA-JUDGMENT]')
    const p = JSON.parse(payload)
    for (const k of Object.keys(p)) assert.ok(ALLOWED.includes(k), k + ' is not allowlisted')
    for (const forbidden of ['reply', 'message', 'prompt', 'history', 'need', 'content', 'body']) {
      assert.ok(!(forbidden in p), forbidden + ' reached the telemetry line')
    }
    assert.ok(!payload.includes('SHOULD NOT APPEAR'), 'no content value may survive anywhere in the line')
  })

  test('*** every string value except requestId/timestamp is a closed enum ***', () => {
    const [[, payload]] = capture(cls({ finalDecision: 'allow_final', mode: 'ask', route: 'CONVERSATION', askOrigin: 'model_initial_ask' }))
    const p = JSON.parse(payload)
    const closed = [...FINAL_DECISION, ...MODE, ...ASK_ORIGIN, ...ROUTE, UNKNOWN, EVENT]
    for (const [k, v] of Object.entries(p)) {
      if (typeof v !== 'string') continue
      if (k === 'requestId' || k === 'timestamp') continue
      assert.ok(closed.includes(v), k + '=' + v + ' is not a closed enum value')
    }
  })

  test('the event carries the shadow marker and the event name', () => {
    const [[, payload]] = capture(cls({ finalDecision: 'allow_final', mode: 'ask' }))
    const p = JSON.parse(payload)
    assert.strictEqual(p.shadow, true)
    assert.strictEqual(p.event, EVENT)
    assert.strictEqual(p.requestId, 'req-1')
  })

  test('a non-string requestId becomes null rather than leaking an object', () => {
    const [[, payload]] = capture(cls({ finalDecision: 'allow_final', mode: 'ask' }), { secret: 1 })
    assert.strictEqual(JSON.parse(payload).requestId, null)
  })

  test('emitting never throws and never returns a decision', () => {
    assert.doesNotThrow(() => emitExecutiveJudgmentShadow('r', null, () => { throw new Error('sink exploded') }))
    assert.strictEqual(emitExecutiveJudgmentShadow('r', {}, () => {}), undefined)
  })
})

/* ═══ 6. THE FENCE — NOTHING ACTS ON IT ══════════════════════════════════════ */

describe('⛔ C1-A IS A SHADOW, AND THIS IS WHERE THAT IS ENFORCED', () => {
  const codeOf = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

  test('*** ⛔ NOTHING IN intakeService BRANCHES ON THE SHADOW ***', () => {
    const code = codeOf('intakeService.js')
    for (const sym of ['judgmentShadow', 'candidateJudgmentGap']) {
      assert.ok(!new RegExp('if\\s*\\([^)]*' + sym).test(code), 'if (' + sym + ') — the shadow became a gate')
      assert.ok(!new RegExp(sym + '\\s*(&&|\\|\\|)').test(code), sym + ' used in a boolean chain')
      assert.ok(!new RegExp('(&&|\\|\\|)\\s*' + sym).test(code), sym + ' used in a boolean chain')
      assert.ok(!new RegExp(sym + '[^\\n]*\\?[^\\n]*:').test(code), sym + ' used in a ternary')
      assert.ok(!new RegExp('return[^\\n]*' + sym).test(code), sym + ' returned from the pipeline')
    }
  })

  test('*** ⛔ THE SHADOW IS COMPUTED, LOGGED, AND DROPPED ***', () => {
    const code = codeOf('intakeService.js')
    const uses = code.split('\n').filter((l) => /judgmentShadow/.test(l))
    // exactly two: the assignment, and the emit call
    assert.strictEqual(uses.length, 2, 'judgmentShadow must appear exactly twice: assign + emit')
    assert.ok(/const judgmentShadow = classifyExecutiveJudgmentShadow\(/.test(uses[0]))
    assert.ok(/emitExecutiveJudgmentShadow\(requestId, judgmentShadow\)/.test(uses[1]))
  })

  test('*** ⛔ THE OBSERVER CANNOT REACH A MODEL, A READ, OR THE FILESYSTEM ***', () => {
    const code = codeOf('executiveJudgmentShadow.js')
    for (const forbidden of [/require\(/, /process\.env/, /fs\./, /fetch\(/, /child_process/, /adapter/i, /decomposeOnce/, /connector/i]) {
      assert.ok(!forbidden.test(code), 'the observer reached for ' + forbidden)
    }
  })

  test('*** ⛔ THE PLAN IS CAPTURED, NEVER RE-REQUESTED — no fourth model call ***', () => {
    const code = codeOf('intakeService.js')
    // decomposeOnce() may only be called where it always was: inside the goal-block path.
    assert.strictEqual((code.match(/await decomposeOnce\(\)/g) || []).length, 1,
      'a second decomposeOnce() await would be a new model call on turns the goal path skipped')
    assert.ok(/goalPlanObserved = plan/.test(code), 'the plan must be captured from the existing await')
    assert.ok(!/goalPlan: await/.test(code), 'the observation point must not await anything')
  })

  test('*** ⛔ THE OBSERVER DOES NOT TOUCH THE RESPONSE ENVELOPE ***', () => {
    const code = codeOf('executiveJudgmentShadow.js')
    for (const key of ['reply', 'nextRead', 'answerPlan', 'intent', 'distilled']) {
      assert.ok(!new RegExp('\\b' + key + '\\b').test(code), 'the observer mentions ' + key)
    }
  })

  test('the classifier returns a fresh object and cannot mutate its input', () => {
    const goalPlan = Object.freeze({ facts: Object.freeze([Object.freeze(fact('required', STATUS.AVAILABLE, 'op'))]) })
    const input = Object.freeze({ finalDecision: 'allow_final', mode: 'ask', goalPlan })
    assert.doesNotThrow(() => cls(input))
    const r = cls(input)
    r.candidateJudgmentGap = false
    assert.strictEqual(cls(input).candidateJudgmentGap, true, 'the classifier held state between calls')
  })
})

/* ═══ 7. BEHAVIOUR CLASSES ═══════════════════════════════════════════════════ */

describe('the behaviour classes C1 must eventually serve', () => {
  test('CLASS A — strategic/advisory: candidate true, and that is ALL that happens', () => {
    const r = cls({
      finalDecision: 'allow_final', mode: 'ask', route: 'CONVERSATION',
      askOrigin: 'model_initial_ask',
      goalPlan: { facts: [fact('required', STATUS.AVAILABLE, 'op'), fact('required', STATUS.AVAILABLE, 'op')] }
    })
    assert.strictEqual(r.candidateJudgmentGap, true)
    // the record is an observation and carries no instruction of any kind
    assert.ok(!('action' in r) && !('intervene' in r) && !('reply' in r) && !('mode_override' in r))
  })

  test('CLASS B — current factual: a require_* path is never a candidate', () => {
    assert.strictEqual(cls({ finalDecision: 'require_internal', mode: 'ask', route: 'BUSINESS_QUERY' }).candidateJudgmentGap, false)
  })

  test('CLASS C — advisory where data would help: counted, not judged', () => {
    const r = cls({
      finalDecision: 'require_internal', mode: 'recommend', route: 'BUSINESS_QUERY',
      goalPlan: { facts: [fact('required', STATUS.UNAVAILABLE), fact('enriching', STATUS.AVAILABLE, 'op')] }
    })
    assert.strictEqual(r.candidateJudgmentGap, false)
    assert.strictEqual(r.requiredUnavailableFacts, 1)
    assert.strictEqual(r.enrichingFacts, 1)
  })

  test('CLASS D — true ambiguity: clarify keeps the question legitimate', () => {
    assert.strictEqual(cls({ finalDecision: 'clarify', mode: 'ask' }).candidateJudgmentGap, false)
  })

  test('CLASS E — action: commit mode is never a candidate, whatever the verdict', () => {
    for (const d of FINAL_DECISION) {
      assert.strictEqual(cls({ finalDecision: d, mode: 'commit', route: 'ACTION' }).candidateJudgmentGap, false)
    }
  })

  test('CLASS F — social: a greeting turn carries no plan and is not a candidate', () => {
    // chat mode, no plan — the shape the greeting turn (ab8d023f) actually had.
    const r = cls({ finalDecision: 'allow_final', mode: 'chat', route: 'CONVERSATION', askOrigin: 'none', goalPlan: null })
    assert.strictEqual(r.candidateJudgmentGap, false)
    assert.strictEqual(r.requiredFacts, null)
  })
})

/* ═══ 8. L2-A IS UNAFFECTED ══════════════════════════════════════════════════ */

describe('C1-A and L2-A do not touch each other', () => {
  test('*** ⛔ THE OBSERVER KNOWS NOTHING ABOUT PURE-CHAT ELIGIBILITY ***', () => {
    const src = fs.readFileSync(path.join(__dirname, 'executiveJudgmentShadow.js'), 'utf8')
    assert.ok(!/pureChat|PURE_CHAT|eligib/i.test(src), 'C1-A must not couple itself to L2-A')
  })

  test('the pure-chat classifier is untouched by this tranche', () => {
    const { classifyPureChatEligibility } = require('./pureChatEligibility')
    assert.deepStrictEqual(
      classifyPureChatEligibility('你好', { route: 'CONVERSATION' }),
      { eligible: true, reason: 'greeting' })
  })
})
