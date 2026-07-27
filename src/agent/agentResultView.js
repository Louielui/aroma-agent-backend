'use strict'

/**
 * agentResultView.js — LAYER 2 of the Owner's two-layer flow, READ-ONLY.
 *
 *   Layer 1 (the approval card) = "may 守燈 attempt this inside the throwaway copy?"
 *   Layer 2 (this)              = "here is what actually happened."
 *
 * For the canary there is no second approval: the work happened in a discarded copy and
 * the real repository was never touched, so there is nothing to authorize after the fact.
 * FUTURE GATE — once 守燈 can touch the real repo (commit / push / deploy), ADOPTING a
 * result becomes its own Owner decision and needs its own approval surface. That gate is
 * deliberately NOT built here.
 *
 * This module is pure: it reports what the runner returned and nothing else. It never
 * re-runs anything, never writes, and never asks a model to summarize. Where the runner
 * gave no evidence for something, the card says so rather than implying success.
 */

const { canonicalWorkOrder } = require('./workOrder')

const UNKNOWN = '（執行器沒有提供這項資料）'

// ── THE PROGRESS VOCABULARY (closed allowlist) ───────────────────────────────
// The Owner should see what is happening, but the agent's own output is NEVER the
// source: the CLI is invoked with --output-format json, so there is one blob at the end
// and no intermediate events to filter anyway. These phases are what the SERVER itself
// knows from its own control flow — no stdout parsing, no paths, no file contents, no
// prompt, no credential can ride along, because a phase is one of exactly these strings
// and nothing else is ever emitted.
const PHASES = Object.freeze({
  accepted: '已批准，正在排隊',
  preparing: '正在準備丟棄式副本',
  running: '守燈正在處理',
  verifying: '正在核對改動範圍',
  done: '完成',
  failed: '未成功'
})
const PHASE_NAMES = Object.freeze(Object.keys(PHASES))
/** True only for a value that is one of the fixed phase names. */
function isPhase (p) { return typeof p === 'string' && PHASE_NAMES.includes(p) }
/** Render a phase for the Owner. Unknown input yields null, never a passthrough. */
function phaseLabel (p) { return isPhase(p) ? PHASES[p] : null }

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
  // SCOPE AND CAPS COME FROM THE SNAPSHOT taken at hand-off — never re-derived from the
  // sealed Work Order, which expires after 10 minutes. Rebuilding them at read time is
  // what made a finished, perfectly in-scope run report 「越界…這份結果不應採用」 once the
  // order had expired: no order, empty allowlist, so every changed file looked foreign.
  // `input.facts` is the recorded truth. The workOrder fallback exists only for direct
  // callers that have one in hand at the time (and for the in-flight view); the router
  // always passes facts.
  const canonical = input.facts
    ? {
        allowedFiles: Array.isArray(input.facts.allowedFiles) ? input.facts.allowedFiles : [],
        allowedTestCommand: input.facts.allowedTestCommand == null ? null : input.facts.allowedTestCommand,
        timeoutSec: input.facts.timeoutSec == null ? null : input.facts.timeoutSec,
        costCapUsd: input.facts.costCapUsd == null ? null : input.facts.costCapUsd,
        branch: input.facts.branch == null ? null : input.facts.branch,
        approvalId: input.approvalId || null
      }
    : canonicalWorkOrder(input.workOrder || {})
  const raw = input.result || null
  const approvalId = input.approvalId || canonical.approvalId || null

  // NORMALIZE THE RUNNER'S SHAPE FIRST.
  // The runner returns the capability-adapter envelope — { ok, output: { filesChanged,
  // diffSummary, testResults, exit, risks, warnings, branch }, cost, latencyMs } — while
  // this view was reading filesChanged / diff / costUsd off the TOP level. The names and
  // the nesting were both wrong, so the first real canary reported "執行器沒有提供這項資料"
  // for every field even though the runner had reported all of it. Read the real shape.
  const r = raw == null
    ? null
    : (() => {
        const out = raw.output || {}
        const risks = Array.isArray(out.risks) ? out.risks : []
        return {
          ok: raw.ok === true,
          refused: typeof raw.error === 'string' && /^refuse:/.test(raw.error),
          timedOut: risks.includes('timeout'),
          reason: raw.error || null,
          filesChanged: Array.isArray(out.filesChanged) ? out.filesChanged : null,
          diff: (typeof out.diffSummary === 'string' && out.diffSummary.trim() !== '') ? out.diffSummary : null,
          exit: out.exit === undefined ? null : out.exit,
          branch: out.branch === undefined ? null : out.branch,
          risks,
          warnings: Array.isArray(out.warnings) ? out.warnings : [],
          testPassed: (out.testResults && typeof out.testResults.ok === 'boolean') ? out.testResults.ok : null,
          costUsd: Number.isFinite(raw.cost) ? raw.cost : null,
          durationMs: Number.isFinite(raw.latencyMs) ? raw.latencyMs : null
        }
      })()

  // status is derived ONLY from what the runner reported — never assumed. `running` comes
  // from the caller (a hand-off happened, no result yet), never invented here.
  let status
  if (r == null) status = input.running === true ? 'running' : 'pending'
  else if (r.refused === true) status = 'refused'
  else if (r.timedOut === true) status = 'timeout'
  else if (r.ok === true) status = 'done'
  else status = 'failed'

  const headline = {
    running: '守燈正在丟棄式副本內處理中…',
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

  const money = (n) => (n == null ? UNKNOWN : `US$${Number(n).toFixed(2)}`) // 0.5 -> US$0.50
  const costParts = []
  if (r && typeof r.costUsd === 'number') costParts.push(money(r.costUsd))
  // Duration: the MEASURED wall time of the run, recorded once at completion. Prefer the
  // execution record's own measurement over the worker's spawn latency, and never compute
  // it from "now" — that is what made the reported time grow forever after the run.
  const durationMs = Number.isFinite(input.durationMs) ? input.durationMs : (r && r.durationMs)
  if (Number.isFinite(durationMs)) costParts.push(`${(durationMs / 1000).toFixed(1)} 秒`)
  const capsText = (canonical.costCapUsd == null && canonical.timeoutSec == null)
    ? ''
    : `（上限 ${money(canonical.costCapUsd)} / ${canonical.timeoutSec == null ? UNKNOWN : canonical.timeoutSec + ' 秒'}）`
  const cost = costParts.length ? `${costParts.join(' · ')}${capsText}` : UNKNOWN

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
  // A failure the Owner can act on: say WHY, using the runner's own allowlisted warnings
  // (enums and short messages the worker composed — never agent output, never a path).
  if (status === 'failed' && r && r.warnings.length) {
    sections.splice(1, 0, { title: '失敗原因', body: r.warnings.join('\n') })
  }

  const lines = [`【執行結果 — ${approvalId == null ? '（無 approvalId）' : approvalId}】`, '']
  for (const s of sections) {
    lines.push(s.title)
    for (const l of String(s.body).split('\n')) lines.push('  ' + l)
    lines.push('')
  }

  return { status, headline, sections, lines, scope, approvalId }
}

module.exports = { buildAgentResultView, scopeVerdict, UNKNOWN, PHASES, PHASE_NAMES, isPhase, phaseLabel }
