'use strict'

/**
 * cardFace.test.js — what the Owner cannot miss, without restoring the eight-段 card.
 *
 * He described this card from memory as "four negations plus the isolation scope on one
 * screen". It was not. The negations sat behind 詳細, and he had been approving on a belief
 * about the card rather than on the card — the exact failure the card exists to prevent.
 *
 * ── WHY THE THREE-段 RULING SURVIVES THIS ────────────────────────────────────
 * The face does not have to LIST all nine forbidden actions to be complete about them,
 * because they fall into two kinds and the face already carries one of them:
 *
 *   FILE SCOPE  cred-edit, env-edit, gate-edit, audit-edit
 *               — covered by 「只修改 X 一個檔案」, section 1. Naming them again would be
 *                 saying the same guarantee twice, which is how a card becomes unreadable.
 *   EXECUTION   commit, push, PR, merge, deploy
 *               — NOT implied by anything else on the face. This is the gap, and it is 24
 *                 characters.
 *
 * So the face grows by ONE line, not by five sections. That is an honest trade, not a
 * squeeze — and if a tenth action is ever added that belongs to neither kind, the coverage
 * test below fails rather than letting the face quietly become a partial list.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildApprovalView, EXECUTION, FILE_SCOPE } = require('./workOrderView')
const { FORBIDDEN_ACTIONS, MUST_FORBID } = require('./workOrder')

const ORDER = (over = {}) => Object.assign({
  approvalId: 'a1',
  goal: '把 README 的第一行改成新的標題',
  branch: 'main',
  allowedFiles: ['README.md'],
  allowedTestCommand: null,
  forbiddenActions: [...FORBIDDEN_ACTIONS],
  timeoutSec: 120,
  costCapUsd: 0.5,
  approvalTtlSec: 900,
  currentExcerpt: 'old',
  currentExcerptTruncated: false,
  intendedChange: 'new'
}, over)

const face = (v) => v.card.sections.map((s) => s.body).join('\n')

/* ═══ 1. THE THINGS HE MUST NOT MISS ═════════════════════════════════════ */

test('*** every execution action is on the VISIBLE FACE, not behind 詳細 ***', () => {
  const v = buildApprovalView(ORDER())
  const f = face(v)
  for (const w of ['不會提交', '不會上傳', '不會開 PR', '不會合併', '不會部署']) {
    assert.ok(f.includes(w), 'behind a disclosure: ' + w + '\n--- face ---\n' + f)
  }
})

test('*** the isolation statement is on the visible face ***', () => {
  const f = face(buildApprovalView(ORDER()))
  assert.ok(f.includes('只改副本'), f)
  assert.ok(f.includes('你的程式庫不受影響'), f)
})

test('*** the one-file scope is STATED on the face, not just implied by a filename ***', () => {
  // It used to print the bare path 「README.md」. A filename is data; 「只修改 X 一個檔案」
  // is the promise, and it is what makes the four file-scope actions covered.
  const f = face(buildApprovalView(ORDER()))
  assert.ok(/只修改 README\.md 一個檔案/.test(f), f)
})

/* ═══ 2. AND THE THREE-段 RULING STILL HOLDS ═════════════════════════════ */

test('*** still three sections, and the face stays short ***', () => {
  const v = buildApprovalView(ORDER())
  assert.equal(v.card.sections.length, 3, 'the Owner ruled three; this is not a re-litigation')
  const bodyLines = face(v).split('\n').filter((l) => l.trim())
  assert.ok(bodyLines.length <= 5, 'the face grew into a wall of text: ' + bodyLines.length + '\n' + face(v))
})

/* ═══ 3. THE FACE CAN NEVER SILENTLY BECOME A PARTIAL LIST ═══════════════ */

test('*** every forbidden action is covered by one of the two kinds ***', () => {
  // THE STRUCTURAL GUARANTEE. Add a tenth action to FORBIDDEN_ACTIONS that is neither
  // execution nor file-scope and this fails — forcing a decision about where it is shown,
  // instead of the face quietly promising less than the order enforces.
  const covered = new Set([...EXECUTION, ...FILE_SCOPE])
  for (const a of FORBIDDEN_ACTIONS) {
    assert.ok(covered.has(a), 'not covered by the face OR by 只修改一個檔案: ' + a)
  }
  for (const a of MUST_FORBID) assert.ok(EXECUTION.includes(a), 'must-forbid must be on the face: ' + a)
})

test('*** the face sentence is DERIVED — drop an action and it disappears ***', () => {
  const without = buildApprovalView(ORDER({ forbiddenActions: ['commit', 'push', 'PR', 'merge'] }))
  assert.equal(face(without).includes('不會部署'), false, 'the face claimed a guarantee the order does not make')
  assert.ok(face(without).includes('不會合併'))
})

test('the file-scope actions stay in 詳細 — saying them twice is what made the card unreadable', () => {
  const v = buildApprovalView(ORDER())
  assert.equal(face(v).includes('改憑證'), false, 'covered by 只修改一個檔案 on the face')
  const details = v.card.details.find((d) => d.title === '不會發生')
  assert.ok(details.body.includes('改憑證'), 'but never dropped — still stated in full')
  assert.ok(details.body.includes('不會開 PR'), 'and the full list stays complete')
})

/* ═══ 4. NOTHING THAT WAS THERE IS LOST ══════════════════════════════════ */

test('the collapsed sections keep every promise they had', () => {
  const text = buildApprovalView(ORDER({ currentExcerptTruncated: true })).lines.join('\n')
  for (const [needle, why] of [
    ['仍未執行', 'intent is not result'],
    ['已截斷', 'what you are shown may be partial'],
    ['逾時自動失效', 'approval expires'],
    ['必須重新建立一張新的工作單', 'no mid-flight scope growth'],
    ['已移除所有 remote', 'isolation, mechanically'],
    ['最長 2 分鐘', 'the caps'],
    ['要修改的內容', 'the goal is still readable']
  ]) assert.ok(text.includes(needle), 'LOST: ' + why + ' — ' + needle)
})
