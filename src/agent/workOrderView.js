'use strict'

/**
 * workOrderView.js — STEP 3. Renders a SEALED Work Order for Owner review.
 *
 * WYSIWYA (what you see is what you approve): the display is built from
 * canonicalWorkOrder(wo) — the exact same serialization that hashWorkOrder() digests.
 * There is no second projection, so a field cannot be shown-but-unhashed or
 * hashed-but-hidden. `canonicalJson` is returned alongside the hash precisely so a
 * test (and a reviewer) can verify the identity rather than trust it.
 *
 * The view is pure: no I/O, no model call, no mutation of the order.
 */

const { canonicalWorkOrder, canonicalWorkOrderJson, hashWorkOrder } = require('./workOrder')

/**
 * @param {object} workOrder  a sealed Work Order
 * @returns {{ canonical, canonicalJson, hash, display, lines }}
 */
function buildApprovalView (workOrder) {
  const canonical = canonicalWorkOrder(workOrder)
  const canonicalJson = canonicalWorkOrderJson(workOrder)
  const hash = hashWorkOrder(workOrder)
  const file = canonical.allowedFiles[0] || '(none)'
  const test = canonical.allowedTestCommand

  // Plain-language consequence statement. It describes what the system will ACTUALLY
  // do, which is bounded by the caps in the order itself — not an aspiration.
  const whatWillHappen = [
    `Claude Code 會在一個丟棄式的隔離複本(branch ${canonical.branch},已移除所有 remote)裡面,只改「${file}」這一個檔案。`,
    test ? `之後只會執行這一條測試指令:${test}。` : '不會執行任何測試指令。',
    '結果只會是一份 diff 交回給你過目 —— 不會 commit、不會 push、不會開 PR、不會 merge、不會部署。',
    `上限:最多 ${canonical.timeoutSec} 秒、最多 US$${canonical.costCapUsd};超時或超額即停。`
  ].join('\n')

  const worstCase = [
    `最壞情況:「${file}」在那個隔離複本裡被改壞,或測試失敗。`,
    '你的真實程式庫不受影響 —— 複本沒有 remote,改動無法回到 main;你只會看到一份不採用的 diff。',
    '如果之後發現需要改第二個檔案,這一張工作單會直接中止,必須重新建立一張新的工作單(沒有中途加檔案的機制)。'
  ].join('\n')

  const display = {
    goal: canonical.goal,
    allowedFile: file, // exactly one, by construction
    allowedTestCommand: test,
    forbiddenActions: canonical.forbiddenActions,
    timeoutSec: canonical.timeoutSec,
    costCapUsd: canonical.costCapUsd,
    branch: canonical.branch,
    approvalId: canonical.approvalId,
    hash,
    whatWillHappen,
    worstCase
  }

  const lines = [
    '【工作單 — 待你批准】',
    `目標          : ${canonical.goal}`,
    `可改檔案(1)  : ${file}`,
    `測試指令      : ${test || '(無)'}`,
    `禁止動作      : ${canonical.forbiddenActions.join(', ')}`,
    `上限          : ${canonical.timeoutSec}s / US$${canonical.costCapUsd}`,
    `分支          : ${canonical.branch}`,
    `approvalId    : ${canonical.approvalId}`,
    `hash          : ${hash}`,
    '',
    whatWillHappen,
    '',
    worstCase
  ]

  return { canonical, canonicalJson, hash, display, lines }
}

module.exports = { buildApprovalView }
