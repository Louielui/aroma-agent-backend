'use strict'

/**
 * readOnlyEnquiryService.js — the missing middle: an APPROVED order becomes ONE read-only
 * enquiry, and its result becomes something the Owner can read back.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * EVERYTHING HERE ALREADY EXISTED EXCEPT THE JOIN.
 *
 *   entry / approval card   routes/workRequestRoute.js + routes/ownerApprovalRouter.js
 *   sealed order + nonce    agent/ownerApprovalStore.js
 *   the order and its hash  agent/workOrder.js
 *   the dispatcher          agent/claudeCodeWorker.js + agent/enquiryRunner.js
 *   the workspace           workers/workspace/tmpdirSandbox.js
 *   the result store        agent/enquiryStore.js
 *   the read-back API       routes/enquiryRoutes.js   (already mounted)
 *
 * Nothing above is re-implemented. This file is the wire between them, and it is the only
 * new authority in the chain — which is why it is fail-closed at every step.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ OFF BY DEFAULT, AND OFF MEANS NOTHING IS CONSTRUCTED.
 * The flag is checked before the workspace, the worker or the source copy exist. 「Disabled」
 * must not mean 「built it, then declined to run it」 — a constructed worker is a spawn waiting
 * for a caller, and this is the file that would be blamed for it.
 *
 * ⛔ THE ORDER IS THE ONLY INPUT. The caller supplies identifiers — approvalId, nonce, the hash
 * it displayed, the session — and nothing else. The question, the source revision, the readable
 * scope and the limits are read from the SEALED order every time. A caller cannot substitute a
 * different question, point the run at another revision, widen the scope or raise a cap, because
 * none of those values ever comes from the caller.
 *
 * ⛔ AND A BOOLEAN IS NOT AN APPROVAL. There is no `approved: true` parameter, and there never
 * may be: the approval is a sealed order plus an unconsumed nonce whose hash matches what the
 * Owner actually read.
 */

const { validateWorkOrder, hashWorkOrder } = require('./workOrder')
const { runEnquiry: defaultRunEnquiry } = require('./enquiryRunner')
const { createClaudeCodeWorker: defaultWorkerFactory } = require('./claudeCodeWorker')
const { createTmpdirSandbox } = require('../workers/workspace/tmpdirSandbox')

/** Strict 'on' only. Unset, empty or anything else is off — an invalid flag never opens a gate. */
function resolveReadOnlyEnquiry (env = process.env) {
  const raw = env && env.READONLY_ENQUIRY
  if (raw === 'on') return 'on'
  return 'off'
}

/**
 * Why a submission did not run. Every one of these means ZERO dispatch and zero worker
 * construction; they are distinguished so the Owner is told which gate stopped it rather than a
 * single unhelpful 「refused」.
 */
const REFUSAL = Object.freeze({
  DISABLED: 'disabled',
  SESSION_INVALID: 'session_invalid',
  APPROVAL_UNKNOWN: 'unknown_approval_id',
  APPROVAL_EXPIRED: 'expired',
  HASH_MISMATCH: 'hash_mismatch',
  NONCE: 'nonce_refused',
  ORDER_INVALID: 'work_order_invalid',
  ALREADY_DISPATCHED: 'already_dispatched',
  SOURCE_UNAVAILABLE: 'source_provider_unavailable',
  SOURCE_FAILED: 'source_preparation_failed'
})

/**
 * ⛔ THE SOURCE COPY IS INJECTED, AND ITS ABSENCE IS A REFUSAL — NOT A FALLBACK.
 * Nothing in this repository resolves a machine-local repoRoot on purpose (`projectRegistry`
 * and `repositoryIdentity` both say so in their headers), so this file must not invent one. A
 * caller that cannot supply a verified copy of the approved revision gets a refusal, because
 * the alternative — running against whatever happens to be on disk — is precisely the failure
 * the expectedSha exists to prevent.
 */
function createReadOnlyEnquiryService (deps = {}) {
  const approvalStore = deps.approvalStore
  const enquiryStore = deps.enquiryStore
  const sourceProvider = typeof deps.sourceProvider === 'function' ? deps.sourceProvider : null
  const workspaceFactory = typeof deps.workspaceFactory === 'function'
    ? deps.workspaceFactory
    : () => createTmpdirSandbox({ prepareSandbox: () => {} })
  const workerFactory = typeof deps.workerFactory === 'function' ? deps.workerFactory : defaultWorkerFactory
  const runEnquiryFn = typeof deps.runEnquiry === 'function' ? deps.runEnquiry : defaultRunEnquiry
  const env = deps.env || process.env
  const now = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString()
  // Counted so a test can prove that a refused submission built nothing at all.
  let workersConstructed = 0

  function enabled () { return resolveReadOnlyEnquiry(env) === 'on' }

  const refuse = (reason, detail) => ({ ok: false, dispatched: false, reason, detail: detail || null })

  async function submit (input = {}) {
    const { sessionId, approvalId, nonce, displayedHash } = input

    // 1 ── the flag, FIRST. Nothing below this line runs while it is off.
    if (!enabled()) return refuse(REFUSAL.DISABLED)

    // 2 ── the Owner's session, by the existing store's own rule.
    if (!approvalStore || !approvalStore.validSession(sessionId)) return refuse(REFUSAL.SESSION_INVALID)

    // 3 ── the sealed order. Unknown and expired are different answers and stay different.
    const sealed = approvalStore.loadSealed(approvalId)
    if (!sealed.ok) {
      return refuse(sealed.reason === 'expired' ? REFUSAL.APPROVAL_EXPIRED : REFUSAL.APPROVAL_UNKNOWN)
    }
    const order = sealed.record.workOrder

    // 4 ── WYSIWYA: the hash of the sealed order must equal what the Owner was shown. This is
    // checked BEFORE the nonce so a mismatch is reported as a mismatch rather than as a
    // consumed nonce.
    const trueHash = hashWorkOrder(order)
    if (typeof displayedHash !== 'string' || displayedHash !== trueHash) {
      return refuse(REFUSAL.HASH_MISMATCH, { expected: trueHash })
    }

    // 5 ── the nonce: single-use, bound to this approval, hash and session. The store consumes
    // it on EVERY outcome, so a double-click's second request finds it already used — that is
    // the first of the two reasons a repeated submission cannot dispatch twice.
    const spent = approvalStore.consumeNonce({ nonce, approvalId, displayedHash, sessionId })
    if (!spent.ok) return refuse(REFUSAL.NONCE, { reason: spent.reason })

    // 6 ── the order must still be structurally valid. It was validated when sealed; validating
    // again costs nothing and means this file never trusts an earlier check it cannot see.
    const structural = validateWorkOrder(order)
    if (!structural.ok) return refuse(REFUSAL.ORDER_INVALID, { errors: structural.errors })

    // 7 ── the second idempotency lock, and the durable one. recordExecutionStart is write-once
    // per approval, so even a caller that somehow presented two valid nonces cannot start a
    // second run. It also snapshots the scope and caps AT HAND-OFF, which is what stops a
    // finished run being judged later against an expired order.
    const started = approvalStore.recordExecutionStart(approvalId, {
      allowedFiles: order.allowedFiles,
      timeoutSec: order.timeoutSec,
      costCapUsd: order.costCapUsd,
      allowedTestCommand: null,      // a read-only enquiry runs no command
      branch: order.branch || null
    })
    if (!started.ok) return refuse(REFUSAL.ALREADY_DISPATCHED, { reason: started.reason })

    // 8 ── the disposable copy of the APPROVED revision. Not the live checkout: the worker
    // refuses a cwd containing this repository, and a real minted provider is required.
    if (!sourceProvider) return refuse(REFUSAL.SOURCE_UNAVAILABLE)
    const workspace = workspaceFactory()
    const { dir } = workspace.prepare()
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
      return refuse(REFUSAL.SOURCE_FAILED, { message: String((e && e.message) || 'source provider threw') })
    }
    if (!source || source.ok !== true) {
      return refuse(REFUSAL.SOURCE_FAILED, { reason: (source && source.reason) || 'source provider refused' })
    }

    // 9 ── ONE dispatch, read-only, bounded by the approved caps. The worker's own fixed policy
    // supplies the tools; nothing here can widen them.
    const worker = workerFactory({
      workspace,
      cwd: dir,
      maxTurns: order.maxTurns || 25,
      timeoutMs: Math.round(order.timeoutSec * 1000),
      allowResume: false
    })
    workersConstructed++

    const question = order.goal
    let out = null
    let thrown = null
    const startedAt = now()
    try {
      out = await runEnquiryFn({
        question,
        worker: (a) => worker.dispatch(a),
        next: async (last) => (last
          ? { done: true, answer: last.answer, measurements: [], notEstablished: last.notEstablished }
          : { done: false, goal: question }),
        budgetUsd: order.costCapUsd,
        maxRounds: 1,
        maxTurns: order.maxTurns || 25,
        allowResume: false
      })
    } catch (e) { thrown = e }
    const finishedAt = now()

    const record = buildEnquiryRecord({ out, thrown, order, approvalId, question, startedAt, finishedAt, source })

    // 10 ── save BEFORE reporting. A result that was never recorded cannot be checked later,
    // and the store is the surface `GET /api/v1/demo/enquiries/:id` already reads.
    let saved = null
    try { saved = enquiryStore ? enquiryStore.save(record) : null } catch (e) {
      record.storeError = String((e && e.message) || 'save failed')
    }

    // 11 ── and tell the approval card that something happened, honestly. filesChanged is an
    // empty array because a read-only enquiry changes nothing — that is a fact, not a
    // formality — and the enquiryId is carried so the card can point at the real result.
    try {
      approvalStore.recordResult(approvalId, {
        ok: record.outcome === 'CONCLUDED',
        kind: 'read_only_enquiry',
        enquiryId: record.enquiryId,
        outcome: record.outcome,
        filesChanged: [],
        costUsd: record.costUsd,
        verification: record.verification
      })
    } catch (_) { /* the enquiry is already saved; a card update failure must not lose it */ }

    return {
      ok: record.outcome === 'CONCLUDED',
      dispatched: true,
      enquiryId: record.enquiryId,
      outcome: record.outcome,
      verification: record.verification,
      costUsd: record.costUsd,
      saved: !!saved,
      sandbox: dir
    }
  }

  /**
   * ⛔ WHAT IS SAVED, AND WHAT IS NEVER IMPLIED.
   * `verification` counts what the citation checker could confirm. It carries NO field meaning
   * 「fully checked」, and `allConfirmed` is false whenever anything is unconfirmed OR nothing was
   * cited at all — zero citations is not 「all confirmed」. A finished process and a verified
   * answer are different facts and are stored as different fields.
   */
  function buildEnquiryRecord ({ out, thrown, order, approvalId, question, startedAt, finishedAt, source }) {
    const turn = (out && out.turns && out.turns[0]) || {}
    const citations = Array.isArray(turn.citations) ? turn.citations : []
    const confirmed = citations.filter((c) => c && c.status === 'CONFIRMED').length
    const outcome = out ? out.outcome : 'FAILED'

    return {
      enquiryId: (out && out.enquiryId) || ('enq_' + String(approvalId).replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'enq_unknown'),
      approvalId,
      question,
      // WHICH CONTENT was read — the approved revision and scope, recorded at the time.
      source: {
        projectId: order.projectId,
        repoFullName: order.repoFullName,
        expectedSha: order.expectedSha,
        allowedFiles: [...(order.allowedFiles || [])],
        preparedFiles: (source && Number.isFinite(source.fileCount)) ? source.fileCount : null
      },
      limits: { timeoutSec: order.timeoutSec, costCapUsd: order.costCapUsd, maxRounds: 1, maxTurns: order.maxTurns || 25 },
      outcome,
      startedAt,
      finishedAt,
      // The formal result and everything needed to check it.
      payload: turn.payload || null,
      citations,
      verification: {
        cited: citations.length,
        confirmed,
        unverified: citations.length - confirmed,
        // ⛔ never true for an empty list, and never true while anything is unconfirmed
        allConfirmed: citations.length > 0 && confirmed === citations.length
      },
      evidence: Array.isArray(turn.evidence) ? turn.evidence : [],
      notEstablished: Array.isArray(turn.notEstablished) ? turn.notEstablished : [],
      termination: turn.termination || null,
      diagnostics: turn.diagnostics || null,
      // ⛔ null means UNKNOWN and is stored as null. A genuine zero is stored as 0. They are
      // different answers and nothing downstream may collapse them.
      costUsd: turn.costUsd === undefined ? null : turn.costUsd,
      costKnown: typeof turn.costUsd === 'number' && Number.isFinite(turn.costUsd),
      numTurns: turn.numTurns === undefined ? null : turn.numTurns,
      failure: turn.failure || null,
      // Why the REPORT could not be produced, when that is what went wrong. Kept apart from
      // `failure`, which is the worker's own.
      reportFailure: (out && out.reportFailure) || null,
      report: (out && out.report) || null,
      thrown: thrown ? String((thrown && thrown.message) || 'dispatch threw') : null,
      turns: (out && out.turns) || []
    }
  }

  return { enabled, submit, resolveFlag: () => resolveReadOnlyEnquiry(env), workersConstructed: () => workersConstructed }
}

module.exports = { createReadOnlyEnquiryService, resolveReadOnlyEnquiry, REFUSAL }
