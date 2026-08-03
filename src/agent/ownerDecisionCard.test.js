'use strict'

/**
 * ownerDecisionCard.test.js — proofs for the Owner Decision Card v2.
 *
 * The card was rewritten because the Owner could not understand v1. A friendlier card is
 * worthless if it is no longer trustworthy, so these tests pin the three properties that
 * make it safe to act on:
 *   1. WYSIWYA survives the redesign — every displayed value is a projection of the sealed
 *      canonical object, and mutating any of them changes the hash.
 *   2. 現時內容 is a real bounded read of a real file; a non-existent path REFUSES to seal.
 *   3. 心燈打算改成 is labelled as INTENT and never stated as an achieved result.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { buildApprovalView, humanDuration } = require('./workOrderView')
const { proposeWorkOrder, plainGoal, readCurrentExcerptFromDisk, MAX_EXCERPT_LINES, MAX_EXCERPT_CHARS } = require('./workOrderProducer')
const { canonicalWorkOrder, hashWorkOrder } = require('./workOrder')
const { buildAgentResultView } = require('./agentResultView')

const REPO = path.resolve(__dirname, '..', '..')
const CANARY = 'docs/canary/agent-canary.md'

/** Seal a real Work Order against the real repo — the exact path the Owner card uses. */
function sealReal (over = {}) {
  return proposeWorkOrder(Object.assign({
    proposal: {
      goal: '把 canary 檔的一行文字由 line 1 改成 line 2',
      candidateFile: CANARY,
      intendedChange: 'canary target — safe to modify. line 2.'
    },
    conversation: ['請改 ' + CANARY],
    newId: () => 'appr_test01'
  }, over))
}

/* ── 1. WYSIWYA after the redesign ────────────────────────────────────────── */

test('every displayed value is a projection of the sealed canonical object', () => {
  const r = sealReal()
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const v = buildApprovalView(r.workOrder)
  const canonical = canonicalWorkOrder(r.workOrder)

  // the view's own canonical/hash are the SAME ones the runner will recompute
  assert.deepEqual(v.canonical, canonical)
  assert.equal(v.hash, hashWorkOrder(r.workOrder))

  // field parity: nothing on the card is invented
  assert.equal(v.display.goal, canonical.goal)
  assert.equal(v.display.allowedFile, canonical.allowedFiles[0])
  assert.equal(v.display.currentExcerpt, canonical.currentExcerpt)
  assert.equal(v.display.intendedChange, canonical.intendedChange)
  assert.equal(v.display.approvalTtlSec, canonical.approvalTtlSec)
  assert.equal(v.technical.hash, v.hash)
  assert.deepEqual(v.technical.forbiddenActions, canonical.forbiddenActions)

  // and every canonical VALUE that the Owner is meant to read actually appears in the
  // rendered text (visible face + collapsed section together)
  const rendered = v.lines.join('\n')
  for (const val of [canonical.goal, canonical.allowedFiles[0], canonical.branch, canonical.approvalId, v.hash, canonical.intendedChange]) {
    assert.ok(rendered.includes(val), 'card must show: ' + String(val).slice(0, 40))
  }
  // the excerpt is indented for readability, so assert it line by line — every line of the
  // real file's head must be on the card, unaltered.
  for (const line of canonical.currentExcerpt.split('\n')) {
    assert.ok(rendered.includes(line), 'card must show excerpt line: ' + line.slice(0, 40))
  }
  assert.ok(rendered.includes(String(canonical.costCapUsd)), 'cost cap shown')
  assert.ok(rendered.includes('2 分鐘'), 'timeout shown in plain language (120s)')
})

test('mutating ANY displayed canonical value changes both the hash and the card', () => {
  const base = sealReal().workOrder
  const baseView = buildApprovalView(base)

  const mutations = {
    goal: '偷偷換掉的目標',
    allowedFiles: ['src/demo/demoHtml.js'],
    allowedTestCommand: 'npm run evil',
    forbiddenActions: ['commit'],
    timeoutSec: 99999,
    costCapUsd: 999,
    branch: 'main',
    approvalId: 'appr_other1',
    currentExcerpt: '假的現時內容',
    currentExcerptTruncated: true,
    intendedChange: '其實想做別的事',
    approvalTtlSec: 86400
  }
  // every key of the canonical object must be covered by this table — a new canonical
  // field must not be able to slip in unhashed-and-undisplayed without failing here.
  assert.deepEqual(Object.keys(canonicalWorkOrder(base)).sort(), Object.keys(mutations).sort())

  for (const [k, v] of Object.entries(mutations)) {
    const tampered = Object.assign({}, base, { [k]: v })
    assert.notEqual(hashWorkOrder(tampered), baseView.hash, 'hash must change when ' + k + ' changes')
    const tv = buildApprovalView(tampered)
    assert.notEqual(tv.lines.join('\n'), baseView.lines.join('\n'), 'card must change when ' + k + ' changes')
  }
})

test('the card is deterministic and model-free — same order in, byte-identical card out', () => {
  const wo = sealReal().workOrder
  const a = buildApprovalView(wo)
  const b = buildApprovalView(wo)
  assert.deepEqual(a.card, b.card)
  assert.deepEqual(a.lines, b.lines)
  assert.equal(a.hash, b.hash)
  // no I/O and no model call in the renderer
  const src = fs.readFileSync(path.join(__dirname, 'workOrderView.js'), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  for (const f of ['fs.', 'readFile', 'Date.now', 'Math.random', 'complete(', 'adapter', 'llm']) {
    assert.ok(!src.includes(f), 'the renderer must not use ' + f)
  }
})

/* ── 2. honest before/after ───────────────────────────────────────────────── */

test('現時內容 is read from the REAL file, bounded to 20 lines / 800 chars', () => {
  const r = sealReal()
  const real = fs.readFileSync(path.join(REPO, CANARY), 'utf8').replace(/\r\n/g, '\n')
  const expectedHead = real.split('\n').slice(0, MAX_EXCERPT_LINES).join('\n').slice(0, MAX_EXCERPT_CHARS)
  assert.equal(r.workOrder.currentExcerpt, expectedHead, 'excerpt equals the real file head')
  assert.equal(MAX_EXCERPT_LINES, 20)
  assert.equal(MAX_EXCERPT_CHARS, 800)
  // the real canary content is actually visible on the card
  assert.ok(buildApprovalView(r.workOrder).lines.join('\n').includes('line 1.'))
})

test('the bounded read truncates by lines AND by chars, and says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-excerpt-'))
  try {
    const many = path.join(dir, 'many.md')
    fs.writeFileSync(many, Array.from({ length: 100 }, (_, i) => 'line ' + i).join('\n'))
    const a = readCurrentExcerptFromDisk(dir, 'many.md')
    assert.equal(a.ok, true)
    assert.equal(a.text.split('\n').length, MAX_EXCERPT_LINES)
    assert.equal(a.truncated, true)

    const long = path.join(dir, 'long.md')
    fs.writeFileSync(long, 'x'.repeat(5000))
    const b = readCurrentExcerptFromDisk(dir, 'long.md')
    assert.equal(b.text.length, MAX_EXCERPT_CHARS)
    assert.equal(b.truncated, true)

    const small = path.join(dir, 'small.md')
    fs.writeFileSync(small, 'one line')
    const c = readCurrentExcerptFromDisk(dir, 'small.md')
    assert.equal(c.text, 'one line')
    assert.equal(c.truncated, false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a NON-EXISTENT path REFUSES to seal, with a reason the Owner can read', () => {
  const r = sealReal({ proposal: { goal: 'g', candidateFile: 'docs/canary/does-not-exist.md' }, conversation: ['請改 docs/canary/does-not-exist.md'] })
  assert.equal(r.ok, false)
  assert.equal(r.workOrder, null, 'no Work Order is produced')
  assert.ok(r.reasonForOwner.includes('不存在'), r.reasonForOwner)
  assert.ok(r.reasonForOwner.includes('does-not-exist.md'))
  // this closes the old gap: the validator alone performed no fs check
  assert.ok(r.errors.some((e) => e.includes('不存在')))
})

test('a directory, an unreadable file and a path outside the repo all refuse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-excerpt-'))
  try {
    fs.mkdirSync(path.join(dir, 'sub'))
    assert.equal(readCurrentExcerptFromDisk(dir, 'sub').reason, 'not_a_file')
    assert.equal(readCurrentExcerptFromDisk(dir, 'nope.md').reason, 'not_found')
    // '..' never escapes: the producer rejects it at L0, and the reader would too
    const esc = readCurrentExcerptFromDisk(path.join(dir, 'sub'), '../../outside.md')
    assert.equal(esc.ok, false)
    assert.equal(esc.reason, 'outside_repo')

    // and the producer surfaces the directory case as a refusal, not a card
    const r = proposeWorkOrder({
      proposal: { goal: 'g', candidateFile: 'sub/x.md' },
      conversation: ['改 sub/x.md'],
      readCurrentExcerpt: () => ({ ok: false, reason: 'not_a_file' })
    })
    assert.equal(r.ok, false)
    assert.ok(r.reasonForOwner.includes('不是一個檔案'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('打算改成 is labelled INTENT — the card never claims it as a result', () => {
  const v = buildApprovalView(sealReal().workOrder)
  // The before/after moved into the collapsed 詳細 by Owner decision — the FACE now
  // carries only file / change / worst case. The honest labelling is unchanged.
  const beforeAfter = v.card.details.find((s) => s.title === '現時內容 / 打算改成')
  assert.ok(beforeAfter, 'the before/after section exists')

  // the intent label must say, in the Owner's language, that this has NOT happened yet
  assert.ok(beforeAfter.body.includes('香香打算改成'), 'intent is labelled as an intention')
  assert.ok(beforeAfter.body.includes('不是已完成的結果'), 'explicitly not a result')
  assert.ok(beforeAfter.body.includes('仍未執行'), 'explicitly not yet run')
  assert.ok(beforeAfter.body.includes('實際結果可能不同'), 'explicitly may differ')
  // and the fact side is labelled as read from the file
  assert.ok(beforeAfter.body.includes('讀自真實檔案'), 'the before side is labelled a real read')

  // nowhere may the card use completed-action language about the change
  const rendered = v.lines.join('\n')
  for (const claim of ['已改成', '已經改成', '已完成修改', '已修改為']) {
    assert.ok(!rendered.includes(claim), 'card must not claim: ' + claim)
  }
})

test('a truncated excerpt is disclosed on the card', () => {
  const wo = Object.assign({}, sealReal().workOrder, { currentExcerpt: 'abc', currentExcerptTruncated: true })
  const v = buildApprovalView(wo)
  const ba = v.card.details.find((s) => s.title === '現時內容 / 打算改成')
  assert.ok(ba.body.includes('已截斷'), 'truncation is stated, not hidden')
  assert.ok(v.technicalLines.join('\n').includes('現時內容是否截斷  : 是'))
})

/* ── 3. the card reads like a decision, not a log dump ────────────────────── */

test('the visible face follows the Owner-specified structure, in plain Chinese', () => {
  const v = buildApprovalView(sealReal().workOrder)

  // HOUSE RULE: the face shows only what the decision needs. The Owner judges three
  // things — which file, what change, what is the worst case — so the face is those three
  // and nothing else. The heading says what she WANTS, not what category of exercise it is.
  assert.equal(v.card.heading, '香香想改一個檔案')
  assert.equal(v.card.sections.length, 3, 'three facts, no more')
  assert.deepEqual(v.card.sections.map((s) => s.title), [null, null, null], 'the face needs no labels')
  assert.equal(v.card.sections[0].body, 'docs/canary/agent-canary.md', 'which file')
  assert.ok(v.card.sections[1].body.length > 0, 'what change')
  assert.ok(v.card.sections[2].body.includes('你的程式庫不受影響'), 'what is the worst case')
  assert.deepEqual(v.card.actions, ['批准', '拒絕'])
  assert.equal(v.card.detailsTitle, '詳細')
  assert.equal(v.card.technicalTitle, '技術細節')

  // NOTHING WAS DELETED — every promise the Owner relies on is still there, collapsed.
  const details = v.card.details
  const byTitle = (t) => details.find((d) => d.title === t)
  assert.ok(byTitle('影響範圍').body.includes('丟棄式副本'))
  assert.ok(byTitle('影響範圍').body.includes('真實程式庫不會被改動'))
  assert.equal(byTitle('不會發生').body, '不會提交、不會上傳、不會合併、不會部署。')
  assert.equal(byTitle('上限').body, '最長 2 分鐘 · 最多 US$0.50', 'money reads as money')
  assert.ok(byTitle('要修改的內容'), 'the goal is still readable')

  // The face does NOT repeat the epistemic disclaimer: 「香香想改」 already says it, and
  // saying it twice is how a page starts sounding anxious rather than clear.
  const faceBodies = v.card.sections.map((s) => s.body).join('\n')
  assert.equal(/不是已完成的結果|仍未執行/.test(faceBodies), false, 'the face says it once, in the heading')

  // the front face carries NO machine noise: no 64-char hash, no English constants, no ids
  const face = [v.card.heading].concat(v.card.sections.map((s) => s.title + '\n' + s.body)).join('\n')
  assert.ok(!/[0-9a-f]{64}/.test(face), 'no hash on the visible face')
  assert.ok(!face.includes('approvalId'), 'no approvalId on the visible face')
  assert.ok(!face.includes('forbiddenActions'), 'no English constant names on the visible face')
  assert.ok(!face.includes('timeoutSec') && !face.includes('costCapUsd'))
  assert.ok(!/Title:|Details:/.test(face), 'no worker-brief structure on the visible face')

  // ...and all of it IS present in the collapsed section
  const tech = v.technicalLines.join('\n')
  for (const s of [v.hash, 'approvalId', '禁止動作', '工作單有效時間']) assert.ok(tech.includes(s), 'collapsed section holds ' + s)
})

test('a promoted Proposal brief no longer leaks Title:/Details: into the goal', () => {
  assert.equal(plainGoal('Title: 改 canary 檔\n\nDetails: 由 line 1 改成 line 2'), '改 canary 檔（由 line 1 改成 line 2）')
  assert.equal(plainGoal('Title: 只有標題'), '只有標題')
  assert.equal(plainGoal('  普通一句話  '), '普通一句話')
  assert.equal(plainGoal(null), '')

  const r = sealReal({ proposal: { goal: 'Title: 改 canary 檔\n\nDetails: 由 line 1 改成 line 2', candidateFile: CANARY, intendedChange: 'line 2' }, conversation: ['請改 ' + CANARY] })
  assert.equal(r.ok, true)
  assert.ok(!/Title:|Details:/.test(r.workOrder.goal), 'the sealed goal is a clean sentence')
  // and because the goal is normalized at SEAL time, the clean sentence is what is hashed
  assert.equal(buildApprovalView(r.workOrder).canonical.goal, r.workOrder.goal)
})

test('humanDuration renders caps the way a person reads them', () => {
  assert.equal(humanDuration(120), '2 分鐘')
  assert.equal(humanDuration(600), '10 分鐘')
  assert.equal(humanDuration(90), '90 秒')
  assert.equal(humanDuration(0), '（未提供）')
  assert.equal(humanDuration(null), '（未提供）')
})

/* ── 4. Layer 2 — the result view (read-only) ─────────────────────────────── */

test('the result view reports what the runner returned, and nothing more', () => {
  const wo = sealReal().workOrder
  const v = buildAgentResultView({
    approvalId: wo.approvalId,
    workOrder: wo,
    result: { ok: true, cost: 0.02, latencyMs: 7500, output: { filesChanged: [CANARY], diffSummary: '-line 1.\n+line 2.', testResults: null, exit: 0, risks: [], warnings: [], branch: 'agent/appr_test01' } }
  })
  assert.equal(v.status, 'done')
  assert.ok(v.headline.includes('丟棄式副本'))
  assert.equal(v.scope.inScope, true)
  const txt = v.lines.join('\n')
  assert.ok(txt.includes('+line 2.'), 'the diff is shown')
  assert.ok(txt.includes('US$0.02'), 'the cost is shown as money')
  assert.ok(txt.includes('7.5 秒'), 'the real duration is shown')
  assert.ok(txt.includes('有守住範圍'))
  assert.ok(txt.includes('（這張工作單沒有測試指令）'))
  assert.ok(txt.includes('完全沒有被改動'), 'the real repo is stated untouched')
})

test('the result view flags an OUT-OF-SCOPE run instead of reporting success', () => {
  const wo = sealReal().workOrder
  const v = buildAgentResultView({ workOrder: wo, result: { ok: true, output: { filesChanged: [CANARY, 'src/app.js'], risks: [], warnings: [] } } })
  assert.equal(v.scope.inScope, false)
  assert.deepEqual(v.scope.outside, ['src/app.js'])
  assert.ok(v.lines.join('\n').includes('越界'))
  assert.ok(v.lines.join('\n').includes('不應採用'))
})

test('the result view never invents evidence it was not given', () => {
  const wo = sealReal().workOrder
  const pending = buildAgentResultView({ workOrder: wo, result: null })
  assert.equal(pending.status, 'pending')
  assert.ok(pending.headline.includes('仍未有結果'))

  const bare = buildAgentResultView({ workOrder: wo, result: { ok: true, output: {} } })
  const txt = bare.lines.join('\n')
  assert.ok(txt.includes('執行器沒有提供這項資料'), 'missing evidence is stated as missing')
  assert.ok(!txt.includes('有守住範圍'), 'no scope claim without filesChanged')

  const refused = buildAgentResultView({ workOrder: wo, result: { ok: false, error: 'refuse: hash_mismatch', output: { risks: [], warnings: [] } } })
  assert.equal(refused.status, 'refused')
  assert.ok(refused.lines.join('\n').includes('hash_mismatch'))

  const timedOut = buildAgentResultView({ workOrder: wo, result: { ok: false, output: { risks: ['timeout'], warnings: ['agent killed after 120s'] } } })
  assert.equal(timedOut.status, 'timeout')
  assert.ok(timedOut.headline.includes('超時'))
})
