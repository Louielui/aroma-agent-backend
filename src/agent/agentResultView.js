'use strict'

/**
 * agentResultView.js — LAYER 2 of the Owner's two-layer flow, READ-ONLY.
 *
 *   Layer 1 (the approval card) = "may 香香 attempt this inside the throwaway copy?"
 *   Layer 2 (this)              = "here is what actually happened."
 *
 * For the canary there is no second approval: the work happened in a discarded copy and
 * the real repository was never touched, so there is nothing to authorize after the fact.
 * FUTURE GATE — once 香香 can touch the real repo (commit / push / deploy), ADOPTING a
 * result becomes its own Owner decision and needs its own approval surface. That gate is
 * deliberately NOT built here.
 *
 * This module is pure: it reports what the runner returned and nothing else. It never
 * re-runs anything, never writes, and never asks a model to summarize. Where the runner
 * gave no evidence for something, the card says so rather than implying success.
 */

const { canonicalWorkOrder } = require('./workOrder')

const UNKNOWN = '（執行器沒有提供這項資料）'

/** Did the run stay inside the one file it was allowed to touch? */
function scopeVerdict (allowedFiles, filesChanged) {
  if (!Array.isArray(filesChanged)) return { known: false, inScope: null, outside: [] }
  const allowed = new Set((allowedFiles || []).map((f) => String(f).replace(/\\/g, '/').toLowerCase()))
  const outside = filesChanged
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => !allowed.has(f.toLowerCase()))
  return { known: true, inScope: outside.length === 0, outside }
}

/**
 * @param {{ approvalId: string, workOrder: object, result: object|null }} input
 *   `result` is whatever the agent runner returned: { ok, refused?, reason?, filesChanged?,
 *   diff?, diffStat?, testPassed?, testOutput?, timedOut?, costUsd?, branch? }
 * @returns {{ status, headline, sections, lines, scope }}
 */
function buildAgentResultView (input = {}) {
  const canonical = canonicalWorkOrder(input.workOrder || {})
  const r = input.result || null
  const approvalId = input.approvalId || canonical.approvalId || null

  // status is derived ONLY from what the runner reported — never assumed.
  let status
  if (r == null) status = 'pending'
  else if (r.refused === true) status = 'refused'
  else if (r.timedOut === true) status = 'timeout'
  else if (r.ok === true) status = 'done'
  else status = 'failed'

  const headline = {
    pending: '仍未有結果（這次批准未有執行，或執行器未回報）',
    refused: '執行器拒絕了這張工作單（沒有任何改動）',
    timeout: '超時中止 —— 測試副本已丟棄',
    done: '完成 —— 這是在丟棄式副本內的結果',
    failed: '未成功 —— 測試副本已丟棄'
  }[status]

  const scope = scopeVerdict(canonical.allowedFiles, r && r.filesChanged)

  const changed = (r && Array.isArray(r.filesChanged))
    ? (r.filesChanged.length ? r.filesChanged.join('\n') : '（沒有任何檔案被改動）')
    : UNKNOWN

  const scopeLine = !scope.known
    ? UNKNOWN
    : (scope.inScope
        ? `有守住範圍：只動過批准的 ${canonical.allowedFiles.join(', ')}。`
        : `越界：動過不在批准範圍內的檔案 —— ${scope.outside.join(', ')}。這份結果不應採用。`)

  const testLine = (r == null || r.testPassed === undefined || r.testPassed === null)
    ? (canonical.allowedTestCommand ? UNKNOWN : '（這張工作單沒有測試指令）')
    : (r.testPassed ? `測試通過：${canonical.allowedTestCommand}` : `測試失敗：${canonical.allowedTestCommand}`)

  const diff = (r && typeof r.diff === 'string' && r.diff.trim() !== '')
    ? r.diff
    : ((r && typeof r.diffStat === 'string' && r.diffStat.trim() !== '') ? r.diffStat : UNKNOWN)

  const cost = (r && typeof r.costUsd === 'number') ? `US$${r.costUsd}` : UNKNOWN

  const sections = [
    { title: '結果', body: headline },
    { title: '實際改動了甚麼', body: changed },
    { title: '有沒有超出批准範圍', body: scopeLine },
    { title: '測試', body: testLine },
    { title: '改動內容（diff）', body: diff },
    { title: '用了多少', body: cost },
    { title: '你的真實程式庫', body: '完全沒有被改動。這次操作只發生在丟棄式副本裡，副本已經(或即將)被刪除。' }
  ]
  if (status === 'refused' && r && r.reason) {
    sections.splice(1, 0, { title: '拒絕原因', body: String(r.reason) })
  }

  const lines = [`【執行結果 — ${approvalId == null ? '（無 approvalId）' : approvalId}】`, '']
  for (const s of sections) {
    lines.push(s.title)
    for (const l of String(s.body).split('\n')) lines.push('  ' + l)
    lines.push('')
  }

  return { status, headline, sections, lines, scope, approvalId }
}

module.exports = { buildAgentResultView, scopeVerdict, UNKNOWN }
