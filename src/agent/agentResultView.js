'use strict'

/**
 * agentResultView.js — LAYER 2 of the Owner's two-layer flow, READ-ONLY.
 *
 *   Layer 1 (the approval card) = "may 心燈 attempt this inside the throwaway copy?"
 *   Layer 2 (this)              = "here is what actually happened."
 *
 * For the canary there is no second approval: the work happened in a discarded copy and
 * the real repository was never touched, so there is nothing to authorize after the fact.
 * FUTURE GATE — once 心燈 can touch the real repo (commit / push / deploy), ADOPTING a
 * result becomes its own Owner decision and needs its own approval surface. That gate is
 * deliberately NOT built here.
 *
 * This module is pure: it reports what the runner returned and nothing else. It never
 * re-runs anything, never writes, and never asks a model to summarize. Where the runner
 * gave no evidence for something, the card says so rather than implying success.
 */

const { canonicalWorkOrder } = require('./workOrder')
const { t } = require('../i18n/t')

const UNKNOWN = () => t('result.unknown')

// ── THE PROGRESS VOCABULARY (closed allowlist) ───────────────────────────────
// The Owner should see what is happening, but the agent's own output is NEVER the
// source: the CLI is invoked with --output-format json, so there is one blob at the end
// and no intermediate events to filter anyway. These phases are what the SERVER itself
// knows from its own control flow — no stdout parsing, no paths, no file contents, no
// prompt, no credential can ride along, because a phase is one of exactly these strings
// and nothing else is ever emitted.
/**
 * ⛔ THUNKS, NOT KEY STRINGS — `t(PHASES[name])` would be a DYNAMIC key (HR-48). The closed
 * allowlist is unchanged: a phase is one of exactly these six names and nothing else is emitted.
 */
const PHASES = Object.freeze({
  accepted: () => t('phase.accepted'),
  preparing: () => t('phase.preparing'),
  running: () => t('phase.running'),
  verifying: () => t('phase.verifying'),
  done: () => t('phase.done'),
  failed: () => t('phase.failed')
})
const PHASE_NAMES = Object.freeze(Object.keys(PHASES))
/** True only for a value that is one of the fixed phase names. */
function isPhase (p) { return typeof p === 'string' && PHASE_NAMES.includes(p) }
/** Render a phase for the Owner. Unknown input yields null, never a passthrough. */
/** ⛔ CALLS the thunk — PHASES holds functions now, so returning PHASES[p] would hand a
 *  FUNCTION to every caller that expects a sentence. Caught by uiStageA.test.js. */
function phaseLabel (p) { return isPhase(p) ? PHASES[p]() : null }

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
          durationMs: Number.isFinite(raw.latencyMs) ? raw.latencyMs : null,
          // THE PATCH, AS A POINTER — never its contents. The Owner reads the stat here
          // and the patch in an editor; a full diff pasted into a chat card is something
          // nobody reads, which is the same as not showing it while pretending otherwise.
          patchFile: typeof out.patchFile === 'string' ? out.patchFile : null,
          patchStatus: typeof out.patchStatus === 'string' ? out.patchStatus : null,
          applyHint: typeof out.applyHint === 'string' ? out.applyHint : null,
          // Expiry facts only. publicCredentialFacts already stripped everything else.
          credential: (out.credential && typeof out.credential === 'object') ? out.credential : null
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
    running: () => t('result.running'),
    pending: () => t('result.pending'),
    refused: () => t('result.refused'),
    timeout: () => t('result.timeout'),
    done: () => t('result.doneHeadline'),
    failed: () => t('result.failedHeadline')
  }[status]()

  const scope = scopeVerdict(canonical.allowedFiles, r && r.filesChanged)

  const changed = (r && Array.isArray(r.filesChanged))
    ? (r.filesChanged.length ? r.filesChanged.join('\n') : t('result.noFilesChanged'))
    : UNKNOWN()

  const scopeLine = !scope.known
    ? UNKNOWN()
    : (scope.inScope
        ? t('result.inScope', { files: canonical.allowedFiles.join(', ') })
        : t('result.outOfScope', { files: scope.outside.join(', ') }))

  const testLine = (r == null || r.testPassed === undefined || r.testPassed === null)
    ? (canonical.allowedTestCommand ? UNKNOWN() : t('result.noTestCommand'))
    : (r.testPassed
        ? t('result.testPassed', { cmd: canonical.allowedTestCommand })
        : t('result.testFailed', { cmd: canonical.allowedTestCommand }))

  const diff = (r && typeof r.diff === 'string' && r.diff.trim() !== '')
    ? r.diff
    : ((r && typeof r.diffStat === 'string' && r.diffStat.trim() !== '') ? r.diffStat : UNKNOWN())

  const money = (n) => (n == null ? UNKNOWN() : `US$${Number(n).toFixed(2)}`) // 0.5 -> US$0.50
  const costParts = []
  if (r && typeof r.costUsd === 'number') costParts.push(money(r.costUsd))
  // Duration: the MEASURED wall time of the run, recorded once at completion. Prefer the
  // execution record's own measurement over the worker's spawn latency, and never compute
  // it from "now" — that is what made the reported time grow forever after the run.
  const durationMs = Number.isFinite(input.durationMs) ? input.durationMs : (r && r.durationMs)
  if (Number.isFinite(durationMs)) costParts.push(t('result.durationSec', { n: (durationMs / 1000).toFixed(1) }))
  const capsText = (canonical.costCapUsd == null && canonical.timeoutSec == null)
    ? ''
    : t('result.capsText', {
        money: money(canonical.costCapUsd),
        time: canonical.timeoutSec == null ? UNKNOWN() : t('result.capSeconds', { n: canonical.timeoutSec })
      })
  const cost = costParts.length ? costParts.join(t('punct.bulletSep')) + capsText : UNKNOWN()

  /**
   * WHERE THE WORK WENT. The clone is thrown away, so without a file the Owner is told
   * what changed and has nothing to apply. The path and the apply command go here; the
   * patch body never does.
   */
  // ABSENT STAYS ABSENT. A result carrying no patch fields at all — a run from before this
  // existed, or one that never reached the worker — has nothing to say about a patch, and
  // a section reading "資料不明" would claim we looked and could not tell. The section is
  // omitted instead.
  const patchLine = (r && r.patchStatus)
    ? (r.patchStatus === 'written' && r.applyHint
        ? r.applyHint
        : (r.patchStatus === 'no_changes'
            ? t('result.noPatchNoChange')
            : (r.patchStatus === 'patch_too_large'
                ? t('result.patchTooBig')
                : t('result.patchFailed', { status: r.patchStatus }))))
    : null

  const sections = [
    { title: t('result.secResult'), body: headline },
    { title: t('result.secChanged'), body: changed },
    { title: t('result.secScope'), body: scopeLine },
    { title: t('result.secTest'), body: testLine },
    { title: t('result.secDiff'), mono: true, body: diff },
    { title: t('result.secCost'), body: cost },
    { title: t('result.secPatch'), body: patchLine },
    { title: t('result.secYourRepo'), body: t('result.yourRepoBody') }
  ]
  // Inserted only when there is something to say (see patchLine).
  if (patchLine) sections.splice(sections.length - 1, 0, { title: t('result.secPatch'), body: patchLine })

  if (status === 'refused' && r && r.reason) {
    sections.splice(1, 0, { title: t('result.secRefusedReason'), body: String(r.reason) })
  }
  // A failure the Owner can act on: say WHY, using the runner's own allowlisted warnings
  // (enums and short messages the worker composed — never agent output, never a path).
  if (status === 'failed' && r && r.warnings.length) {
    sections.splice(1, 0, { title: t('result.secFailedReason'), body: r.warnings.join('\n') })
  }

  const lines = [t('result.title', { id: approvalId == null ? t('result.noApprovalId') : approvalId }), '']
  for (const s of sections) {
    lines.push(s.title)
    for (const l of String(s.body).split('\n')) lines.push('  ' + l)
    lines.push('')
  }

  return { status, headline, sections, lines, scope, approvalId }
}

module.exports = { buildAgentResultView, scopeVerdict, UNKNOWN, PHASES, PHASE_NAMES, isPhase, phaseLabel }
