'use strict'

/**
 * DECLARED CAPABILITY EVIDENCE — POSITIVE EVIDENCE ONLY, AND NEVER A VERDICT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT THIS IS NOT. It is not `capabilityAvailable`, not `hasCoverage`, and
 * `no_positive_match` does NOT mean 「the capability does not exist」.
 *
 * Q8 is the whole reason for that rule. 「邊啲貨低過 PAR？」 was answered with a clarification
 * and zero reads on 2026-08-17, and the historical attribution called it ROUTING. It was:
 * `aroma_system.inventory` carries `currentStock` AND `parLevel`, there is a declared
 * derivation 缺口 = parLevel − currentStock, and a declared ranking metric
 * `absolute_shortfall`. The capability was there the whole time; the lexical router could
 * not see it. A signal that reported 「unavailable」 on a lexical miss would have written that
 * same mistake into the log with more authority.
 *
 * ⛔ AND IT IS NOT A SECOND VOCABULARY. Every token below is read out of a declaration that
 * already existed — `METRICS_OF`, `DERIVATIONS_OF`, `FIELD_LABELS_OF`, `ENTITY_OF`,
 * `AROMA_INTENTS`. Nothing here adds 「PAR」, 「人工成本」, 「事實」 or 「推斷」 to any list. If
 * this file ever needs a synonym added to make a case pass, the case is telling the truth
 * and the synonym is the lie.
 *
 * ⛔ THE MECHANISM FOR Q8, STATED SO IT CAN BE CHECKED: the declared FIELD NAME is `parLevel`
 * (inventory) and `par_level` (orderPlanning). Splitting an identifier on camelCase and
 * underscores is a deterministic operation on the schema's own name — it yields the token
 * `par`, which is the word the Owner typed. That is reading the declaration, not guessing.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { evidenceFor, EVIDENCE_KIND, EVIDENCE_STATUS, tokensOfIdentifier } = require('./declaredCapabilityEvidence')
const { AROMA_OPERATIONS } = require('./readOperations')
const { ENDPOINT_OF_METHOD, PATHS, createAromaSystemReadAdapter } = require('./adapters/aromaSystemRead')

/* ── the exact historical strings, recovered from the persisted conversation store ── */
const Q8 = '邊啲貨低過 PAR？'
const Q19 = '上星期人工成本幾多？'
const Q27 = '我剛才問你的答案，有幾多係事實、有幾多係推斷？'
/** A turn the existing router DOES recognise — so a negative result cannot be vacuous. */
const CONTROL = '而家有咩訂貨建議？'

const ALL_OPERATIONS = AROMA_OPERATIONS.map((o) => o.operation)

/* ═══ THE BRIDGE — the one declaration this tranche was allowed to expose ═════ */

test('*** ⛔ THE ENDPOINT/METHOD BRIDGE IS COMPLETE IN BOTH DIRECTIONS ***', () => {
  /**
   * ⛔ THE POINT OF THIS TEST IS DRIFT, NOT EXISTENCE. The pairing used to live only as
   * literals inside the adapter factory (`listInventory → enveloped('inventory')`), where
   * nothing could check it. Now it is declared — so the risk becomes two lists that must
   * agree, which is exactly the shape `readOperations.js` warns about. This is the check
   * that makes disagreement impossible to ship.
   */
  const adapter = createAromaSystemReadAdapter({ apiKey: '', baseUrl: 'http://127.0.0.1:0' })
  const realMethods = Object.keys(adapter.methods).sort()
  assert.deepEqual(Object.keys(ENDPOINT_OF_METHOD).sort(), realMethods,
    '⛔ the declared bridge and the adapter\'s real methods disagree')
  assert.deepEqual([...new Set(Object.values(ENDPOINT_OF_METHOD))].sort(), Object.keys(PATHS).sort(),
    '⛔ the declared bridge and the reachable PATHS disagree')
  assert.deepEqual(Object.keys(ENDPOINT_OF_METHOD).sort(), AROMA_OPERATIONS.map((o) => o.method).sort(),
    '⛔ the declared bridge and the operation table disagree')
})

/* ═══ THE NORMALISATION, JUSTIFIED RATHER THAN ASSUMED ═══════════════════════ */

test('*** IDENTIFIER SPLITTING IS DETERMINISTIC AND READS THE SCHEMA\'S OWN NAME ***', () => {
  assert.deepEqual(tokensOfIdentifier('parLevel'), ['par', 'level'])
  assert.deepEqual(tokensOfIdentifier('par_level'), ['par', 'level'])
  assert.deepEqual(tokensOfIdentifier('suggested_order_qty'), ['suggested', 'order', 'qty'])
  assert.deepEqual(tokensOfIdentifier('currentStock'), ['current', 'stock'])
  assert.deepEqual(tokensOfIdentifier(''), [])
  assert.deepEqual(tokensOfIdentifier(null), [])
})

/* ═══ THE THREE HISTORICAL TURNS — whatever the mechanism truthfully derives ══ */

test('*** ⛔ Q8 — THE DECLARED FIELD NAME SEES WHAT THE KEYWORD LIST MISSES ***', () => {
  const e = evidenceFor(Q8)
  assert.equal(e.status, EVIDENCE_STATUS.POSITIVE, '⛔ the declarations no longer connect PAR to anything')
  assert.ok(e.operations.includes('aroma_system.inventory'),
    '⛔ inventory was not derived: ' + JSON.stringify(e.operations))
  assert.ok(e.evidenceKinds.includes(EVIDENCE_KIND.FIELD_NAME),
    '⛔ the evidence did not come from a declared field name: ' + JSON.stringify(e.evidenceKinds))
  // ⛔ NOT hard-coded to inventory alone: `par_level` is declared on orderPlanning too, and
  //    reporting only one of them would be the matcher lying about what it read.
  assert.ok(e.operations.includes('aroma_system.replenishment'),
    'orderPlanning declares par_level as well — both are evidence')
})

test('*** Q19 AND Q27 REPORT NO POSITIVE MATCH, AND THAT IS THE HONEST ANSWER ***', () => {
  for (const [label, q] of [['Q19', Q19], ['Q27', Q27]]) {
    const e = evidenceFor(q)
    assert.equal(e.status, EVIDENCE_STATUS.NONE, label + ' unexpectedly matched: ' + JSON.stringify(e))
    assert.deepEqual(e.operations, [], label)
    assert.deepEqual(e.evidenceKinds, [], label)
    assert.equal(e.matchCount, 0, label)
  }
  // ⛔ AND THIS IS NOT A VERDICT. Nothing in the emitted object may be read as
  //    「the capability does not exist」 — the enum says only that no declaration matched.
  assert.equal(EVIDENCE_STATUS.NONE, 'no_positive_match')
  assert.equal(Object.values(EVIDENCE_STATUS).includes('unavailable'), false)
  assert.equal(Object.values(EVIDENCE_STATUS).includes('capability_unavailable'), false)
})

test('*** THE CONTROL — a turn the router already recognises still matches ***', () => {
  const e = evidenceFor(CONTROL)
  assert.equal(e.status, EVIDENCE_STATUS.POSITIVE)
  assert.ok(e.operations.includes('aroma_system.replenishment'),
    'the declared intent vocabulary must still be evidence: ' + JSON.stringify(e.operations))
  assert.ok(e.evidenceKinds.includes(EVIDENCE_KIND.INTENT))
})

/* ═══ CLOSED OUTPUT — nothing free-form may travel ═══════════════════════════ */

test('*** ⛔ THE OBJECT IS CLOSED — enums, closed operation names and counts only ***', () => {
  for (const q of [Q8, Q19, Q27, CONTROL]) {
    const e = evidenceFor(q)
    assert.deepEqual(Object.keys(e).sort(), ['evidenceKinds', 'matchCount', 'operations', 'status'],
      '⛔ a key appeared on the evidence object: ' + JSON.stringify(Object.keys(e)))
    assert.ok(Object.values(EVIDENCE_STATUS).includes(e.status), 'status must be a closed enum')
    for (const op of e.operations) {
      assert.ok(ALL_OPERATIONS.includes(op), '⛔ an operation outside the closed vocabulary: ' + op)
    }
    for (const k of e.evidenceKinds) {
      assert.ok(Object.values(EVIDENCE_KIND).includes(k), '⛔ an evidence kind outside the closed enum: ' + k)
    }
    assert.ok(Number.isInteger(e.matchCount) && e.matchCount >= 0)

    // ⛔ THE OWNER'S WORDS MAY NOT TRAVEL. Not the message, not the matched phrase.
    const serialized = JSON.stringify(e)
    assert.equal(serialized.includes('PAR'), false, '⛔ the matched raw phrase reached the object')
    assert.equal(serialized.includes('par'), false, '⛔ the matched token reached the object')
    for (const fragment of ['邊啲貨', '人工成本', '事實', '推斷', '訂貨建議', '安全存量', 'parLevel']) {
      assert.equal(serialized.includes(fragment), false, '⛔ content reached the object: ' + fragment)
    }
  }
})

test('*** ⛔ MALFORMED INPUT FAILS CLOSED, NEVER OPEN ***', () => {
  // ⛔ THE OBJECT WITH A toString IS THE INTERESTING ONE: a matcher that coerces its input
  //    would read the Owner's question out of a non-string and match on it.
  for (const bad of [null, undefined, 42, {}, [], '', '   ', { toString: () => Q8 }]) {
    const e = evidenceFor(bad)
    assert.equal(e.status, EVIDENCE_STATUS.NONE, '⛔ malformed input produced a match: ' + String(bad))
    assert.deepEqual(e.operations, [])
    assert.deepEqual(e.evidenceKinds, [])
    assert.equal(e.matchCount, 0)
  }
})

test('*** matchCount COUNTS EVIDENCE PAIRS, AND SAYS SO ***', () => {
  /**
   * ⛔ A NUMBER LABELLED AS ONE THING AND MEASURING ANOTHER IS THIS REPOSITORY'S RECURRING
   * DEFECT (`TURN_COST.reads` counts observations). So it is pinned: matchCount is the number
   * of distinct (operation, evidenceKind) pairs — not operations, not tokens, not hits.
   */
  const e = evidenceFor(Q8)
  assert.ok(Number.isInteger(e.matchCount))
  // A pair count can never be smaller than either axis, and never larger than their product.
  assert.ok(e.matchCount >= e.operations.length, 'at least one kind per matched operation')
  assert.ok(e.matchCount >= e.evidenceKinds.length, 'at least one operation per kind')
  assert.ok(e.matchCount <= e.operations.length * e.evidenceKinds.length,
    '⛔ more pairs than operations x kinds — matchCount is counting something else: ' + e.matchCount)
})

/* ═══ THE HANDOFF — ONE BOUNDARY, DELIBERATELY ══════════════════════════════ */

/**
 * ⛔ WHY IT RIDES ON THE ROUTE DECISION AND NOT ON ANSWER_PLAN.
 *
 * `ANSWER_PLAN` needs TWO manual handoffs (validatePlan → readResultView's entry →
 * logAnswerPlan's projection) and has silently swallowed a field FOUR times:
 * `droppedLimitations`, `rankingVerdicts`, `rankingClaims`, and `rankingSalvage` — the last
 * of which was found only because a live acceptance turn went looking. That is recorded as
 * ANSWER_PLAN_DUAL_HANDOFF_OBSERVABILITY_DEBT and is NOT solved here.
 *
 * `routeTurn` already holds the message and already carries measurement-only fields that
 * nothing routes on (`intentBreadth`, `intentKeys`, Owner GO 2026-08-08). Attaching here
 * means ONE handoff and no change at either `logTurnRoute` call site.
 */

const { routeTurn, logTurnRoute } = require('../intake/turnRouter')
const { decideWorldAsk } = require('../intake/worldAskDecision')

const lineFor = (message, decision) => {
  let captured = null
  logTurnRoute({ decision, lane: 'chat', sourcesRead: [], rowsRetrieved: 0, answerPlanForced: false, requestId: 'r' }, (l) => { captured = l })
  return captured
}

test('*** ⛔ THE EVIDENCE REACHES THE TURN_ROUTE LINE ***', () => {
  const d = routeTurn(Q8, {})
  assert.ok(d.declaredCapabilityEvidence, '⛔ routeTurn did not attach the evidence')
  const line = lineFor(Q8, d)
  assert.ok(line.declaredCapabilityEvidence, '⛔ the projection dropped it')
  assert.equal(line.declaredCapabilityEvidence.status, EVIDENCE_STATUS.POSITIVE)
  assert.ok(line.declaredCapabilityEvidence.operations.includes('aroma_system.inventory'))
})

test('*** ⛔ THE FIELD IS NEVER ABSENT — a no-match turn still carries the shape ***', () => {
  const line = lineFor(Q19, routeTurn(Q19, {}))
  assert.deepEqual(line.declaredCapabilityEvidence,
    { status: EVIDENCE_STATUS.NONE, operations: [], evidenceKinds: [], matchCount: 0 })
})

test('*** ⛔ THE PROJECTION IS A WHITELIST — pollution cannot ride in ***', () => {
  const polluted = {
    route: 'CONVERSATION',
    reason: 'question',
    declaredCapabilityEvidence: {
      status: 'positive_match',
      operations: ['aroma_system.inventory', 'not_an_operation', 'gmail'],
      evidenceKinds: ['field_name', 'free_form_kind'],
      matchCount: 2,
      message: Q8,
      matchedPhrase: 'PAR',
      rows: [{ name: 'Napa Cabbage' }],
      credentials: 'sk-must-never-appear'
    }
  }
  const line = lineFor(Q8, polluted)
  const e = line.declaredCapabilityEvidence
  assert.deepEqual(Object.keys(e).sort(), ['evidenceKinds', 'matchCount', 'operations', 'status'],
    '⛔ a key rode into the log: ' + JSON.stringify(Object.keys(e)))
  assert.deepEqual(e.operations, ['aroma_system.inventory'], '⛔ a non-operation survived: ' + JSON.stringify(e.operations))
  assert.deepEqual(e.evidenceKinds, ['field_name'], '⛔ a free-form kind survived: ' + JSON.stringify(e.evidenceKinds))
  const serialized = JSON.stringify(line)
  for (const forbidden of ['Napa Cabbage', 'sk-must-never-appear', 'matchedPhrase', '邊啲貨', 'not_an_operation', 'free_form_kind']) {
    assert.equal(serialized.includes(forbidden), false, '⛔ content reached the log: ' + forbidden)
  }
})

test('*** ⛔ AN UNKNOWN STATUS FAILS CLOSED IN THE PROJECTION TOO ***', () => {
  const line = lineFor(Q8, { route: 'CONVERSATION', declaredCapabilityEvidence: { status: 'available', operations: ['aroma_system.inventory'], evidenceKinds: ['intent'], matchCount: 9 } })
  assert.deepEqual(line.declaredCapabilityEvidence,
    { status: EVIDENCE_STATUS.NONE, operations: [], evidenceKinds: [], matchCount: 0 },
    '⛔ an unrecognised status shipped half an object')
})

/* ═══ NOTHING ELSE MOVED ════════════════════════════════════════════════════ */

test('*** ⛔ THE ROUTING DECISION IS STRUCTURALLY UNCHANGED, AND NOTHING ROUTES ON THIS ***', () => {
  for (const q of [Q8, Q19, Q27, CONTROL, '', '聽日幾號？']) {
    const d = routeTurn(q, {})
    // Every field the router decided on, before this tranche existed.
    const routing = ['route', 'reason', 'confidence', 'utility', 'domain', 'sources', 'intentBreadth', 'intentKeys']
    for (const k of routing) assert.ok(k in d, 'the router lost ' + k + ' on: ' + JSON.stringify(q))
    assert.deepEqual(Object.keys(d).sort(), routing.concat(['declaredCapabilityEvidence']).sort(),
      '⛔ the decision object grew something else: ' + JSON.stringify(Object.keys(d)))
  }
  // ⛔ MEASURED, NOT ASSERTED: the routing verdict for the three historical turns is the
  //    same as it was before this signal existed — a positive match must not become a route.
  assert.equal(routeTurn(Q8, {}).route, 'CONVERSATION', '⛔ Q8 started routing — this tranche must not repair it')
  assert.deepEqual(routeTurn(Q8, {}).sources, [], '⛔ Q8 gained a source entitlement')
  assert.equal(routeTurn(CONTROL, {}).route, 'BUSINESS_QUERY')
  assert.equal(routeTurn(CONTROL, {}).domain, 'order_planning')
})

test('*** ⛔ decideWorldAsk IS UNTOUCHED BY THE EVIDENCE ***', () => {
  // The evidence is not an input to it, and the same inputs must give the same verdict.
  for (const q of [Q8, Q19, Q27]) {
    const d = routeTurn(q, {})
    const out = decideWorldAsk({ resolverIntent: null, route: d.route, routerSources: d.sources, authorisedSources: ['aroma_system'] })
    assert.equal(out.ask, true, q)
    assert.equal(out.reason, 'genuinely_ambiguous', q)
    assert.equal(out.requiredWorlds, null, q)
  }
  const ctl = routeTurn(CONTROL, {})
  const settled = decideWorldAsk({ resolverIntent: null, route: ctl.route, routerSources: ctl.sources, authorisedSources: ['aroma_system'] })
  assert.equal(settled.ask, false)
  assert.equal(settled.reason, 'route_established_internal_and_capability_available')
})

/* === THE FILE MUST BE READABLE BY A HUMAN AND BY GIT ===================== */

test('*** ⛔ NO RAW NUL BYTE IN ANY FILE OF THIS CHANGE ***', () => {
  /**
   * ⛔ THIS SHIPPED ONCE, AND NEITHER GUARD CAUGHT IT.
   *
   * The pair key joins an operation to an evidence kind with a separator chosen so it cannot
   * collide with an operation name. The separator is correct; how it reached the file was not.
   * Three RAW 0x00 bytes were written into the source, and `git diff --stat` reported
   * `Bin 0 -> 8736 bytes` — a JavaScript file git treats as binary has no textual diff, no
   * blame and no reviewable change. The one file most needing review was the one nobody
   * could read.
   *
   * ⛔ AND THE TWO CHECKS THAT RAN BOTH PASSED: `git diff --check` looks for whitespace
   * damage, `standard` parses tokens — an invisible control character is neither. Every test
   * was green, because the join and the split agreed with each other. Correct behaviour and
   * an unreviewable artifact are not the same property, and only one of them was measured.
   *
   * The source now spells the separator as a textual escape, which evaluates to the same
   * character, so collision resistance is unchanged and the file is text again.
   */
  const fs = require('node:fs')
  const path = require('node:path')
  const REPO = path.resolve(__dirname, '..', '..')
  const FILES = [
    'src/context/adapters/aromaSystemRead.js',
    'src/context/declaredCapabilityEvidence.js',
    'src/context/declaredCapabilityEvidence.test.js',
    'src/intake/turnRouter.js',
    'src/intake/turnRouter.test.js'
  ]
  for (const rel of FILES) {
    const buf = fs.readFileSync(path.join(REPO, rel))
    let raw = 0
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0) raw++
    assert.equal(raw, 0, '⛔ ' + rel + ' carries ' + raw + ' raw NUL byte(s) — git will treat it as binary')
  }
})

test('*** THE SEPARATOR STILL RESISTS COLLISION — the fix changed bytes, not the value ***', () => {
  // An operation name containing the separator would let two different pairs collapse into
  // one. Nothing in either closed vocabulary can contain a control character, which is why
  // this separator was chosen — and the textual escape evaluates to the same character.
  const SEP = String.fromCharCode(0)
  for (const op of AROMA_OPERATIONS.map((o) => o.operation)) {
    assert.equal(op.includes(SEP), false, 'an operation enum contains the separator: ' + op)
  }
  for (const kind of Object.values(EVIDENCE_KIND)) {
    assert.equal(kind.includes(SEP), false, 'an evidence kind contains the separator: ' + kind)
  }
  // And the behaviour it protects is unchanged: two operations, one kind, two distinct pairs.
  const e = evidenceFor(Q8)
  assert.equal(e.operations.length, 2)
  assert.equal(e.evidenceKinds.length, 1)
  assert.equal(e.matchCount, 2)
})
