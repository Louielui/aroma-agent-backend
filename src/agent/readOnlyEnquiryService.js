'use strict'

/**
 * readOnlyEnquiryService.js — an APPROVED read-only order becomes ONE enquiry, and its result
 * becomes something the Owner can read back.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THIS IS A LANE BEHIND THE EXISTING APPROVAL, NOT A SECOND DOOR.
 *
 * The first version of this file took a sealed order plus a nonce and ran. That skipped the
 * typed confirmation, the proposal state transition, the authorization matrix and the durable
 * claim — every condition the code-change lane has to satisfy — and it did so through an
 * endpoint of its own. A second endpoint that can switch the SAME approved card into a
 * different kind of execution is not a lane; it is a bypass.
 *
 * So the entry point is gone. `confirmService.confirmProposalAction` calls this, after the
 * Owner has typed EXECUTE, after the nonce and hash checks, after the proposal is confirmed and
 * after the Run is durably claimed — and only when the SEALED order's own `taskKind` says
 * read_only_enquiry. Which lane runs is part of what the Owner approved, because `taskKind` is
 * inside the canonical hash his card was built from.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ OFF BY DEFAULT, AND OFF MEANS NOTHING IS CONSTRUCTED. The flag is a peer in
 * `authorizeExecution` — two lanes on is a configuration_conflict and zero execution — and
 * app.js only builds this service when the flag is on. `run()` re-checks anyway: source,
 * workspace and worker are created after that check, never before it.
 */

const { runEnquiry: defaultRunEnquiry } = require('./enquiryRunner')
const { createClaudeCodeWorker: defaultWorkerFactory } = require('./claudeCodeWorker')
const { createTmpdirSandbox } = require('../workers/workspace/tmpdirSandbox')

/** Strict 'on' only. Unset, empty or anything else is off — an invalid flag never opens a gate. */
function resolveReadOnlyEnquiry (env = process.env) {
  return (env && env.READONLY_ENQUIRY) === 'on' ? 'on' : 'off'
}

/**
 * ⛔ THE TURN CAP IS THE SERVICE'S, NOT THE ORDER'S.
 *
 * The first version read `order.maxTurns`. That field is in no canonical form, no validator and
 * no approval card — so it was an unapproved, unvalidated number deciding how long a model runs,
 * arriving on the same object as the approved values and indistinguishable from them. A cap the
 * Owner never saw is not a cap he set.
 *
 * It is fixed here instead, and the record says where it came from. Making it Owner-settable is
 * a real option, but it means adding the field to `canonicalWorkOrder`, `validateWorkOrder` and
 * the approval view together — never to this file alone.
 */
const SERVICE_MAX_TURNS = 25
const SERVICE_MAX_ROUNDS = 1

const PHASE = Object.freeze({
  AUTHORIZING: 'authorizing',
  PREPARING_SOURCE: 'preparing_source',
  BUILDING_WORKER: 'building_worker',
  RUNNING: 'running',
  SAVING: 'saving'
})

const REFUSAL = Object.freeze({
  DISABLED: 'disabled',
  NOT_AUTHORIZED: 'not_authorized',
  WRONG_TASK_KIND: 'wrong_task_kind',
  STORE_UNAVAILABLE: 'result_store_unavailable',
  SOURCE_UNAVAILABLE: 'source_provider_unavailable',
  SOURCE_FAILED: 'source_preparation_failed',
  WORKSPACE_FAILED: 'workspace_preparation_failed',
  WORKER_FAILED: 'worker_construction_failed'
})

const UNREADABLE = 'unavailable (the error value could not be read safely)'

/**
 * ⛔ DESCRIBING A FAILURE MUST NOT ITSELF FAIL. Whatever is thrown here is not guaranteed to be
 * an Error: it can be null, undefined, a bare string, an object whose `message` getter throws, or
 * a revoked Proxy where every operation throws. This runs on the path that exists to keep a
 * completed round, so nothing touches the value without a guard.
 */
function safeErrorText (value, cap = 300) {
  try {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return value.slice(0, cap)
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      const m = value.message
      if (typeof m === 'string') return m.slice(0, cap)
    } catch (_) { /* a throwing getter is not a reason to lose the record */ }
    const s = String(value)
    return typeof s === 'string' ? s.slice(0, cap) : UNREADABLE
  } catch (_) { return UNREADABLE }
}

function createReadOnlyEnquiryService (deps = {}) {
  const enquiryStore = deps.enquiryStore
  const sourceProvider = typeof deps.sourceProvider === 'function' ? deps.sourceProvider : null
  const workspaceFactory = typeof deps.workspaceFactory === 'function'
    ? deps.workspaceFactory
    : () => createTmpdirSandbox({ prepareSandbox: () => {} })
  const workerFactory = typeof deps.workerFactory === 'function' ? deps.workerFactory : defaultWorkerFactory
  const runEnquiryFn = typeof deps.runEnquiry === 'function' ? deps.runEnquiry : defaultRunEnquiry
  const env = deps.env || process.env
  const now = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString()
  // Optional sinks. Absent → the lane still runs and simply has no card to update.
  const recordPhase = typeof deps.recordPhase === 'function' ? deps.recordPhase : () => {}
  let workersConstructed = 0

  function enabled () { return resolveReadOnlyEnquiry(env) === 'on' }

  /** Everything a caller needs to know, in a shape that never claims more than it did. */
  const refuse = (reason, phase, detail) => ({
    ok: false,
    dispatched: false,
    stoppedAt: phase,
    reason,
    detail: detail === undefined ? null : detail,
    enquiryId: null,
    saved: false
  })

  /**
   * Run ONE read-only enquiry for an already-approved, already-claimed order.
   *
   * @param {{ workOrder: object, approvalId: string, authorized: boolean }} input
   *   `workOrder` is the SEALED order — the caller has already verified the hash the Owner read.
   *   `authorized` is confirmService's decision from the flag matrix; this service will not run
   *   without it and does not compute its own.
   */
  async function run (input = {}) {
    const order = input.workOrder
    const approvalId = input.approvalId

    // ── phase: authorizing ────────────────────────────────────────────────
    if (!enabled()) return refuse(REFUSAL.DISABLED, PHASE.AUTHORIZING)
    // ⛔ NOT SELF-GRANTED. The matrix decision is made once, by confirmService, and passed in.
    if (input.authorized !== true) return refuse(REFUSAL.NOT_AUTHORIZED, PHASE.AUTHORIZING)
    // The lane is chosen by the APPROVED order, not by which function was called.
    if (!order || order.taskKind !== 'read_only_enquiry') return refuse(REFUSAL.WRONG_TASK_KIND, PHASE.AUTHORIZING)
    // ⛔ NO STORE, NO RUN. Refused BEFORE anything executes, because a completed enquiry whose
    // result cannot be kept is a model call spent on nothing the Owner can ever read.
    if (!enquiryStore || typeof enquiryStore.save !== 'function') {
      return refuse(REFUSAL.STORE_UNAVAILABLE, PHASE.AUTHORIZING)
    }
    if (!sourceProvider) return refuse(REFUSAL.SOURCE_UNAVAILABLE, PHASE.AUTHORIZING)

    // ── phase: preparing the workspace and the approved source ────────────
    let workspace, dir
    try {
      workspace = workspaceFactory()
      dir = workspace.prepare().dir
    } catch (e) {
      return refuse(REFUSAL.WORKSPACE_FAILED, PHASE.PREPARING_SOURCE, safeErrorText(e))
    }
    let source
    try {
      source = await sourceProvider({
        dir,
        projectId: order.projectId,
        repoFullName: order.repoFullName,
        expectedSha: order.expectedSha,
        allowedFiles: order.allowedFiles
      })
    } catch (e) {
      return refuse(REFUSAL.SOURCE_FAILED, PHASE.PREPARING_SOURCE, safeErrorText(e))
    }
    if (!source || source.ok !== true) {
      return refuse(REFUSAL.SOURCE_FAILED, PHASE.PREPARING_SOURCE, safeErrorText((source && source.reason) || 'source provider refused'))
    }

    // ── phase: building the worker ────────────────────────────────────────
    let worker
    try {
      worker = workerFactory({
        workspace,
        cwd: dir,
        maxTurns: SERVICE_MAX_TURNS,
        timeoutMs: Math.round(Number(order.timeoutSec) * 1000),
        allowResume: false
      })
      workersConstructed++
    } catch (e) {
      return refuse(REFUSAL.WORKER_FAILED, PHASE.BUILDING_WORKER, safeErrorText(e))
    }

    // ── phase: running ────────────────────────────────────────────────────
    try { recordPhase(approvalId, 'running') } catch (_) {}
    const question = order.goal
    const startedAt = now()
    let out = null
    let thrown = null
    try {
      out = await runEnquiryFn({
        question,
        worker: (a) => worker.dispatch(a),
        next: async (last) => (last
          ? { done: true, answer: last.answer, measurements: [], notEstablished: last.notEstablished }
          : { done: false, goal: question }),
        // ⛔ A PRE-ROUND CHECK, NOT A BILLING LIMIT. The runner refuses to START a round it
        // expects to exceed this; it cannot stop a round already running, and nothing here
        // enforces a charge. Reporting it as a hard cap would be a promise this code cannot keep.
        budgetUsd: order.costCapUsd,
        maxRounds: SERVICE_MAX_ROUNDS,
        maxTurns: SERVICE_MAX_TURNS,
        allowResume: false
      })
    } catch (e) { thrown = e }
    const finishedAt = now()

    const record = buildEnquiryRecord({ out, thrown, order, approvalId, question, startedAt, finishedAt, source })

    // ── phase: saving ─────────────────────────────────────────────────────
    // ⛔ A SAVE THAT DID NOT HAPPEN IS NOT A DELIVERY. The model outcome and the persistence
    // outcome are two facts and are reported as two fields; a caller that reads `ok` alone is
    // never told the result is retrievable when it is not.
    let saved = false
    let saveError = null
    try {
      const written = enquiryStore.save(record)
      saved = !!written
      if (!written) saveError = 'store returned nothing'
    } catch (e) {
      saveError = safeErrorText(e)
    }

    return {
      // `ok` means: it ran, it concluded, AND the result is retrievable. All three.
      ok: record.outcome === 'CONCLUDED' && saved,
      dispatched: true,
      stoppedAt: null,
      // the enquiry's own outcome, kept separate from whether it could be stored
      outcome: record.outcome,
      saved,
      saveError,
      enquiryId: saved ? record.enquiryId : null,
      // ⛔ null when it was not saved: handing back an id that resolves to nothing is a promise
      // the read-back interface cannot keep.
      verification: record.verification,
      costUsd: record.costUsd,
      costKnown: record.costKnown,
      reportFailure: record.reportFailure,
      turnCapSource: 'service_fixed',
      maxTurns: SERVICE_MAX_TURNS,
      sandbox: dir
    }
  }

  /**
   * ⛔ WHAT IS SAVED, AND WHAT IS NEVER IMPLIED.
   * `verification` counts what the citation checker could confirm. There is no field meaning
   * 「fully checked」, and `allConfirmed` is false whenever anything is unconfirmed OR nothing was
   * cited — zero citations is not 「all confirmed」. A finished process and a verified answer are
   * different facts and are stored as different fields.
   */
  function buildEnquiryRecord ({ out, thrown, order, approvalId, question, startedAt, finishedAt, source }) {
    const turn = (out && out.turns && out.turns[0]) || {}
    const citations = Array.isArray(turn.citations) ? turn.citations : []
    const confirmed = citations.filter((c) => c && c.status === 'CONFIRMED').length

    return {
      enquiryId: (out && out.enquiryId) || ('enq_' + String(approvalId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20)),
      approvalId,
      taskKind: order.taskKind,
      question,
      source: {
        projectId: order.projectId,
        repoFullName: order.repoFullName,
        expectedSha: order.expectedSha,
        allowedFiles: [...(order.allowedFiles || [])],
        preparedFiles: (source && Number.isFinite(source.fileCount)) ? source.fileCount : null
      },
      limits: {
        // ⛔ Where each bound CAME FROM, recorded rather than implied.
        timeoutSec: order.timeoutSec,
        timeoutSource: 'approved_order',
        costCapUsd: order.costCapUsd,
        costCapSource: 'approved_order',
        costCapKind: 'pre_round_check_only',
        maxRounds: SERVICE_MAX_ROUNDS,
        maxTurns: SERVICE_MAX_TURNS,
        turnCapSource: 'service_fixed'
      },
      outcome: out ? out.outcome : 'FAILED',
      startedAt,
      finishedAt,
      payload: turn.payload || null,
      citations,
      verification: {
        cited: citations.length,
        confirmed,
        unverified: citations.length - confirmed,
        allConfirmed: citations.length > 0 && confirmed === citations.length
      },
      evidence: Array.isArray(turn.evidence) ? turn.evidence : [],
      notEstablished: Array.isArray(turn.notEstablished) ? turn.notEstablished : [],
      termination: turn.termination || null,
      diagnostics: turn.diagnostics || null,
      // null means UNKNOWN and stays null; a genuine zero stays 0. Different answers.
      costUsd: turn.costUsd === undefined ? null : turn.costUsd,
      costKnown: typeof turn.costUsd === 'number' && Number.isFinite(turn.costUsd),
      numTurns: turn.numTurns === undefined ? null : turn.numTurns,
      failure: turn.failure || null,
      reportFailure: (out && out.reportFailure) || null,
      report: (out && out.report) || null,
      thrown: thrown ? safeErrorText(thrown) : null,
      turns: (out && out.turns) || []
    }
  }

  return {
    enabled,
    run,
    resolveFlag: () => resolveReadOnlyEnquiry(env),
    workersConstructed: () => workersConstructed,
    SERVICE_MAX_TURNS
  }
}

module.exports = {
  createReadOnlyEnquiryService,
  resolveReadOnlyEnquiry,
  REFUSAL,
  PHASE,
  SERVICE_MAX_TURNS,
  safeErrorText
}
