'use strict'

/**
 * workOrderPromises.test.js — ROUND 1 of the language-policy rewrite: B-10 / B-11.
 *
 * The Owner's reason for putting this first: it is the surface he stares at immediately
 * before approving, and nothing else in the product costs more if a word degrades.
 *
 * Reading it for its PROMISES rather than its language found two defects that are not
 * about language at all:
 *
 *   1. 「不會提交、不會上傳、不會合併、不會部署。」 was a HARDCODED sentence. workOrderView.js's
 *      own header declares property #1 — every value on the card is read from
 *      canonicalWorkOrder, "there is no second projection". This sentence was the second
 *      projection.
 *
 *   2. Because it was hardcoded, it UNDER-REPORTED. MUST_FORBID is five actions —
 *      commit, push, PR, merge, deploy. The card named four. **開 PR was never shown to
 *      the Owner**, on the one screen whose entire job is to say what cannot happen.
 *
 * A promise that is retyped rather than derived is a promise that drifts. This round makes
 * it derived, so it cannot under-report again.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildApprovalView } = require('./workOrderView')
const { MUST_FORBID, FORBIDDEN_ACTIONS } = require('./workOrder')
const { proposeWorkOrder } = require('./workOrderProducer')

// A plain order object — canonicalWorkOrder() normalises it. There is no sealWorkOrder().
const ORDER = (over = {}) => (Object.assign({
  approvalId: 'a1',
  goal: '把 README 的第一行改成新的標題',
  branch: 'main',
  allowedFiles: ['README.md'],
  allowedTestCommand: null,
  forbiddenActions: [...MUST_FORBID],
  timeoutSec: 120,
  costCapUsd: 0.5,
  approvalTtlSec: 900,
  currentExcerpt: 'old',
  currentExcerptTruncated: false,
  intendedChange: 'new'
}, over))

const faceOf = (v) => v.lines.join('\n')

/* ═══ 1. THE PROMISE THAT UNDER-REPORTED ══════════════════════════════════ */

test('*** the card tells the Owner that no PR will be opened ***', () => {
  // THE DEFECT. MUST_FORBID has five entries; the card named four. The one it dropped is
  // the one that would publish his code to a place he did not choose.
  const text = faceOf(buildApprovalView(ORDER()))
  assert.ok(/PR/.test(text), 'the sealed order forbids PR and the card must say so: ' + text)
})

test('*** every forbidden action in the SEALED order reaches the card ***', () => {
  const wo = ORDER({ forbiddenActions: [...FORBIDDEN_ACTIONS] })
  const v = buildApprovalView(wo)
  const text = faceOf(v)
  for (const a of v.canonical.forbiddenActions) {
    assert.ok(text.includes(a) || v.display.willNotHappenActions.includes(a),
      'silently dropped from the Owner-facing card: ' + a)
  }
})

test('*** the sentence is DERIVED, not retyped — WYSIWYA property #1 ***', () => {
  // Remove one action from the sealed order and the sentence must shrink with it. A
  // hardcoded string passes every test about its own content and none about its truth.
  const five = buildApprovalView(ORDER()).display.whatWillHappen
  const four = buildApprovalView(ORDER({ forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy', 'cred-edit'] })).display.whatWillHappen
  assert.notEqual(five, four, 'the card did not change when the sealed order did')
})

test('*** an action with no Chinese label is REPORTED, never dropped ***', () => {
  // The silent-drop lesson, applied here. An action the label map does not know must
  // surface as a count, not vanish into a sentence that reads complete.
  const { willNotHappenFrom } = require('./workOrderView')
  const out = willNotHappenFrom(['commit', 'push', 'PR', 'merge', 'deploy', 'a-brand-new-action'])
  assert.ok(/1/.test(out), 'the unlabelled action must be counted: ' + out)
})

/* ═══ 2. WHAT THE OWNER ACTUALLY SEES — reported, not silently changed ════ */

test('*** the four negations and the isolation scope are NOT on the visible face ***', () => {
  // RECORDED AS A FINDING, NOT FIXED. The Owner described this card as carrying "four
  // negations plus the isolation scope in one screen". Today `card.sections` — the visible
  // face — holds only the file, the intent and the worst case; 不會發生, 影響範圍 and 上限
  // sit inside `card.details`, behind the 詳細 disclosure in app.js.
  //
  // Moving them is a card-design decision that belongs to the Owner, not a wording fix, so
  // this test PINS TODAY'S TRUTH and will fail loudly if anyone changes it quietly.
  const v = buildApprovalView(ORDER())
  const faceText = v.card.sections.map((s) => s.body).join('\n')
  assert.equal(/不會提交/.test(faceText), false, 'if this now passes, the card was redesigned — update the audit')
  assert.ok(v.card.details.some((d) => d.title === '不會發生'), 'it lives in details')
  assert.ok(v.card.details.some((d) => d.title === '影響範圍'), 'so does the isolation scope')
})

/* ═══ 3. WRITTEN CHINESE — punctuation, the actual language defect here ═══ */

const CJK_ASCII_PUNCT = /[一-鿿][,;?!():][一-鿿]/

test('*** no ASCII punctuation between two Chinese characters — the card ***', () => {
  const v = buildApprovalView(ORDER({ currentExcerptTruncated: true }))
  const strings = [
    v.card.heading, v.display.worstCase, v.display.whatWillHappen,
    ...v.card.details.map((d) => `${d.title}\n${d.body}`),
    ...v.technicalLines
  ]
  const bad = strings.filter((s) => CJK_ASCII_PUNCT.test(String(s)))
  assert.deepEqual(bad, [], 'half-width punctuation inside Chinese prose')
})

test('*** no ASCII punctuation between two Chinese characters — the refusals ***', () => {
  const r = proposeWorkOrder({ proposal: { goal: 'x', candidateFile: 'nope/missing.js' }, conversation: ['nope/missing.js'] })
  assert.equal(r.ok, false)
  assert.equal(CJK_ASCII_PUNCT.test(r.reasonForOwner), false, 'got: ' + r.reasonForOwner)
})

test('the aligned technical dump keeps its ASCII separators — alignment is not prose', () => {
  // The `label        : value` colons are layout, not punctuation, and full-width would
  // break the monospace alignment. The rule above is deliberately scoped to CJK-CJK.
  const v = buildApprovalView(ORDER())
  assert.ok(v.technicalLines.some((l) => / : /.test(l)))
})

/* ═══ 4. THE PROMISES THEMSELVES, UNCHANGED ══════════════════════════════ */

test('every B-10 promise still stands after the rewrite', () => {
  const v = buildApprovalView(ORDER({ currentExcerptTruncated: true }))
  const text = faceOf(v)
  const promises = [
    ['只修改', 'scope is one file'],
    ['丟棄式副本', 'isolation'],
    ['不會被改動', 'the real repository is untouched'],
    ['仍未執行', 'intent is not result'],
    ['實際結果可能不同', 'intent is not result'],
    ['已截斷', 'what you are shown may be partial'],
    ['逾時自動失效', 'approval expires'],
    ['必須重新建立一張新的工作單', 'no mid-flight scope growth'],
    ['已移除所有 remote', 'isolation, mechanically'],
    ['無法回到 main', 'isolation, mechanically']
  ]
  for (const [needle, why] of promises) assert.ok(text.includes(needle), 'LOST: ' + why + ' — ' + needle)
})

test('every B-11 refusal still states that NO work order was created', () => {
  const cases = [
    { proposal: { goal: 'x', candidateFile: 'a.js' }, conversation: [] },
    { proposal: { goal: 'x', candidateFile: 'src/*.js' }, conversation: ['src/*.js'] },
    { proposal: { goal: 'x', candidateFile: '.env' }, conversation: ['.env'] },
    { proposal: { goal: '', candidateFile: 'README.md' }, conversation: ['README.md'] }
  ]
  for (const c of cases) {
    const r = proposeWorkOrder(c)
    assert.equal(r.ok, false, JSON.stringify(c))
    assert.equal(r.workOrder, null, 'nothing was created')
    assert.ok(r.reasonForOwner.includes('未能建立工作單'), 'and it says so: ' + r.reasonForOwner)
  }
})
