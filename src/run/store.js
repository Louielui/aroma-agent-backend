'use strict'

/**
 * store.js — the Run Store for the Aroma OS backend.
 *
 * The Run Store is the thin, asynchronous seam between an HTTP request and the
 * governed worker. It owns three responsibilities and NOTHING else:
 *
 *   1. Validate the little a caller may supply, then create a Run (via run.js).
 *   2. Return the new run id IMMEDIATELY — the caller never waits for the worker.
 *   3. Drive the dispatch in the BACKGROUND, on a later event-loop turn, feeding
 *      every milestone the dispatcher observes into that Run's append-only
 *      timeline so Louie can watch the run unfold while it happens.
 *
 * The Run itself is modelled entirely by run.js: the timeline is append-only and
 * there is deliberately NO stored status — status is always DERIVED by
 * run.deriveStatus. This store never writes a status and never mutates a
 * timeline except through run.appendStage.
 *
 * Provenance: `owner` is the authenticated caller's identity. It is supplied by
 * the SERVER (via resolveOwner), never read from caller input — see startRun,
 * which reads only a known-safe set of fields and never touches input.owner.
 * `approvedBy` is governed the same way: it is set only by approveRun, from the
 * server's authenticated context, and can never be supplied by a caller, worker,
 * or language model — approveRun is the ONLY place in the codebase that may
 * construct an Approval object.
 *
 * Everything is in-memory: no file I/O, no network, no LLM in this file.
 */

const path = require('node:path')
const run = require('./run')
const { load: loadRunsFile, save: saveRunsFile } = require('./runPersistence')

// The single authenticated local owner for M1. A real deployment would resolve
// the owner from an auth context; this constant stands in for that until then.
// It is intentionally a SERVER-side value — a client can never influence it.
const LOCAL_OWNER = 'louie'

// B2-10 durable Run store. The file mirrors store.js's data dir (and its
// AROMA_DATA_DIR override) so all truth files live together. `data/` is gitignored.
const DATA_DIR = process.env.AROMA_DATA_DIR || path.resolve(__dirname, '../../data')
const DEFAULT_RUNS_FILE = path.join(DATA_DIR, 'aroma-runs.json')

/** Build an Error carrying an HTTP-appropriate statusCode for the router. */
function fail (statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

/**
 * Resolve the injectable persistence config into a bound { load, save } backend,
 * or null for in-memory-only. `false`/`null` → in-memory (no disk); a string →
 * that file path; `{ path }` → that file path; `undefined` → the default file.
 */
function resolvePersistence (config) {
  if (config === false || config === null) return null
  const filePath = typeof config === 'string'
    ? config
    : (config && typeof config.path === 'string' ? config.path : DEFAULT_RUNS_FILE)
  return {
    path: filePath,
    load: () => loadRunsFile(filePath),
    save: (data) => saveRunsFile(filePath, data)
  }
}

/**
 * Normalize a Run record read from disk WITHOUT fabricating data. Genuinely-absent
 * optional fields default to null (they are absent, not invented). Records we
 * wrote ourselves already carry every field, so a clean round-trip is untouched.
 * `id` and `timeline` are guaranteed present by runPersistence's shape validation.
 */
function normalizeLoaded (rec) {
  const out = { ...rec }
  for (const k of ['owner', 'workspace', 'conversationId', 'goal', 'task', 'intent', 'targetProject', 'capabilityId', 'version', 'createdAt']) {
    if (!(k in out)) out[k] = null
  }
  return out
}

/**
 * Create a Run Store.
 *
 * @param {{ dispatcher: function, resolveOwner?: function }} options
 *   dispatcher — an async function called ONCE per run, in the background, as
 *     `dispatcher({ run, runContext })`:
 *       • run        — a frozen snapshot of the freshly-created Run (task,
 *                      capabilityId, version, intent, targetProject, …), so the
 *                      dispatcher knows what work to route.
 *       • runContext — a sink exposing appendStage(stage, facts) that writes
 *                      into THIS Run's timeline. The dispatcher records each
 *                      governance/routing milestone it actually observes here.
 *     Its resolved value is ignored. Any error it throws (or rejects with) is
 *     caught by the store and recorded as a FAILED stage — it is NEVER left as
 *     an unhandled rejection and NEVER crashes the process.
 *   resolveOwner — optional function returning the authenticated owner. Defaults
 *     to the single local owner. NEVER derives the owner from caller input.
 * @returns {{ startRun: function, getRun: function, listRuns: function,
 *             approveRun: function, rejectRun: function }}
 */
function createRunStore (options = {}) {
  const opts = options || {}
  const dispatcher = opts.dispatcher
  if (typeof dispatcher !== 'function') {
    throw new TypeError('createRunStore requires a dispatcher function')
  }
  const resolveOwner = typeof opts.resolveOwner === 'function'
    ? opts.resolveOwner
    : () => LOCAL_OWNER

  // B2-9 flag-scope containment. An optional authorization predicate, evaluated
  // AT DISPATCH TIME. When it returns false, scheduleDispatch does NOT invoke the
  // dispatcher at all (the gate returns before invocation). Default is `() => true`
  // so existing callers/tests that construct a store without it are unchanged.
  const authorizeDispatch = typeof opts.authorizeDispatch === 'function'
    ? opts.authorizeDispatch
    : () => true

  // The runs this store owns, in creation order. run.js holds the Runs
  // themselves (keyed by id); we track ordering here so listRuns can return the
  // most recent runs this store created, most-recent-first.
  const order = []
  const owned = new Set()

  // B2-10 durable backend, or null for in-memory-only. Repopulate from disk at
  // construct via the PURE run.rehydrate path (never createRun/startRun/
  // scheduleDispatch), so LOADING RUNS TRIGGERS NO DISPATCH — preserving B2-9
  // (confirm ≠ execution authorization; flag-off = 0 execution). A corrupt file
  // THROWS here (RunStoreCorruptError) rather than starting on silently-empty
  // state. Slice scope: this loads Runs faithfully and stops — no recovery, no
  // reconcile, no Interrupted marking (that is slice 2).
  const persistence = resolvePersistence(opts.persistence)
  if (persistence) {
    const disk = persistence.load()
    for (const id of disk.order) {
      run.rehydrate(normalizeLoaded(disk.runs[id]))
      order.push(id)
      owned.add(id)
    }
  }

  /** Persist the whole { order, runs } envelope after a mutation via the safe
   *  temp+rename write. No-op in memory-only mode. One synchronous write per
   *  mutation makes this store the single writer of its file — no partially
   *  written file is ever observed. */
  function flush () {
    if (!persistence) return
    const runs = {}
    for (const id of order) {
      const rec = run.getRun(id) // frozen deep clone — safe to serialize
      if (rec) runs[id] = rec
    }
    persistence.save({ order: [...order], runs })
  }

  /** Append a stage to a Run AND persist. Every stage mutation in this store goes
   *  through here (directly or via makeRunContext), so no timeline change is ever
   *  left unpersisted. Returns run.appendStage's snapshot, exactly as before. */
  function appendAndFlush (id, stage, facts) {
    const snap = run.appendStage(id, stage, facts)
    flush()
    return snap
  }

  /**
   * Create a Run and begin dispatching it in the background.
   *
   * The dispatch is scheduled for a LATER event-loop turn (setImmediate), so it
   * begins only AFTER startRun has already returned — the caller therefore never
   * waits for the worker. startRun returns the new run id synchronously.
   *
   * @param {{ task?: string, targetProject?: ('backend'|'frontend'),
   *           capabilityId?: string, version?: number, intent?: string,
   *           conversationId?: (string|null), goal?: (string|null) }} input
   * @returns {string} the new run id
   * @throws {RangeError} if targetProject is 'production' (or otherwise invalid)
   */
  function startRun (input = {}) {
    const src = input || {}

    // Fail fast and loud on the one target a Run may never have. run.createRun
    // enforces this too, but asserting it here makes startRun's contract explicit.
    if (src.targetProject === 'production') {
      throw new RangeError('targetProject must never be production')
    }

    // Owner is authenticated server-side. We read ONLY the known-safe fields
    // from caller input and deliberately IGNORE any input.owner — a client
    // cannot set the owner of a Run.
    const created = run.createRun({
      owner: resolveOwner(),
      task: src.task,
      intent: src.intent,
      targetProject: src.targetProject,
      capabilityId: src.capabilityId,
      version: src.version,
      conversationId: src.conversationId,
      goal: src.goal
    })

    const id = created.id
    order.push(id)
    owned.add(id)
    flush() // persist the newly-created Run at its seed TASK_CREATED stage

    // TASK_CREATED is already the seed stage of the Run (see run.createRun).
    // Kick off the dispatch on a future turn so this call returns first.
    scheduleDispatch(id, created)

    return id
  }

  /** A timeline sink bound to one run, for a dispatcher to write milestones. */
  function makeRunContext (id) {
    return {
      appendStage (stage, facts) {
        return appendAndFlush(id, stage, facts)
      }
    }
  }

  /**
   * Schedule the background dispatch for one run. The runContext writes into
   * THIS run's timeline. Any throw/rejection from the dispatcher is caught and
   * recorded as FAILED — never left dangling as an unhandled rejection.
   */
  function scheduleDispatch (id, snapshot) {
    // B2-9 AUTHORIZATION GATE — decides FIRST. If dispatch is not authorized, the
    // dispatcher is NEVER invoked (not even an inert floor): we do not schedule at
    // all. The Run keeps only its seed TASK_CREATED stage (derived status
    // 'created') — no fabricated develop/completed stage, no side-effect.
    if (!authorizeDispatch()) return

    // B2-11a DURABLE DISPATCH CLAIM. Written ONLY here — AFTER the B2-9 gate has
    // authorized this dispatch and IMMEDIATELY BEFORE the real dispatcher spawns
    // (synchronously, before the setImmediate turn). The unauthorized / conflict /
    // no-dispatcher branch returned above, so a claim can NEVER exist for a
    // dispatch that does not happen (B2-9: flag-off = 0 execution = 0 claim). It is
    // flushed to disk (B2-10), so after a restart a "claimed-but-no-execution" Run
    // is distinguishable from a "never-claimed" (confirmed-only) Run — the evidence
    // a future recovery (B2-11b) needs. This slice ONLY records evidence; it does
    // not recover, retry, or mark Interrupted.
    appendAndFlush(id, 'DISPATCH_CLAIMED', { runId: id, attempt: 1, ts: new Date().toISOString() })

    const runContext = makeRunContext(id)

    setImmediate(() => {
      // Promise.resolve().then(...) so a synchronous throw inside the dispatcher
      // becomes a rejection we can catch, exactly like an async rejection.
      Promise.resolve()
        .then(() => dispatcher({ run: snapshot, runContext, phase: 'develop' }))
        // A successful Develop that produced a patch stops at PATCH_READY; the
        // store then parks it for a human decision. Anything else is left as-is.
        .then(() => promoteToPendingApproval(id))
        .catch(err => recordFailure(id, err))
    })
  }

  /**
   * After a successful Develop, promote a patch-ready Run to PENDING_APPROVAL so
   * its derived status becomes 'pending_approval' and it waits for Louie. This
   * fires ONLY when the Run's status is exactly 'patch_ready' (a PATCH_READY
   * stage with nothing terminal after it); every other outcome is untouched.
   */
  function promoteToPendingApproval (id) {
    const current = run.getRun(id)
    if (!current) return
    if (run.deriveStatus(current) !== 'patch_ready') return
    const patchReady = [...current.timeline].reverse().find(e => e.stage === 'PATCH_READY')
    if (!patchReady) return
    appendAndFlush(id, 'PENDING_APPROVAL', { patchPath: patchReady.facts.patchPath })
  }

  /**
   * Record a background-dispatch failure as a FAILED stage. Best-effort and
   * never throwing: if the run has already reached a terminal stage (for
   * example the dispatcher recorded its own FAILED/DENIED), there is nothing to
   * append and we leave the timeline untouched.
   */
  function recordFailure (id, err) {
    const current = run.getRun(id)
    if (!current) return
    if (run.isTerminal(run.deriveStatus(current))) return
    const error = err && err.message ? err.message : String(err)
    try {
      appendAndFlush(id, 'FAILED', { error })
    } catch (_) {
      // A concurrent terminal stage (or any other append guard) may have landed
      // first. Recording the failure is best-effort; never let it throw into the
      // event loop.
    }
  }

  // NOTE for pollers: a Run whose derived status is terminal (see run.isTerminal)
  // is FINAL — its timeline will never gain another stage. A client polling this
  // Run must stop polling once it observes a terminal status; continuing to poll a
  // terminal Run only repeats identical responses forever. (The frontend has a
  // bug where it keeps polling after a terminal status; that is a frontend fix and
  // is deliberately NOT worked around here.)

  /**
   * Return one of this store's Runs by id — including its full timeline and
   * (via run.deriveStatus) a derivable status — as a frozen snapshot, or null.
   *
   * @param {string} id
   * @returns {object|null}
   */
  function getRun (id) {
    if (!owned.has(id)) return null
    return run.getRun(id)
  }

  /**
   * List this store's most recent Runs, most-recent-first, as frozen snapshots.
   *
   * @param {number} [limit=50] maximum number of runs to return
   * @returns {object[]}
   */
  function listRuns (limit = 50) {
    const n = Number.isInteger(limit) && limit >= 0 ? limit : 50
    const ids = order.slice(Math.max(0, order.length - n)).reverse()
    return ids.map(id => run.getRun(id)).filter(Boolean)
  }

  /**
   * Approve a pending-approval Run and apply its frontend patch.
   *
   * This is the ONE and ONLY place in the codebase that constructs an Approval.
   * No worker, language model, conversation turn, or request body reaches here —
   * `approvedBy` is the server's authenticated identity (defaulting to
   * resolveOwner), exactly as `owner` is, and a caller can never set it.
   *
   * The endpoint is deliberately narrow and structurally incapable of anything
   * else: it dispatches Apply@1 with target 'dev' and an explicit approval, and
   * NOTHING else — never Deploy, never target production.
   *
   *   - rejects unless the derived status is 'pending_approval' (a completed,
   *     failed, denied or already-rejected Run can never be approved after the
   *     fact);
   *   - rejects unless targetProject is 'frontend' — a backend patch is refused
   *     because applying it restarts the backend process that owns this
   *     in-memory Run, destroying the Run before it completes;
   *   - on success records the approval, appends APPLYING, dispatches Apply@1,
   *     then appends COMPLETED (backupRef) on success or ROLLED_BACK (error) on
   *     failure.
   *
   * @param {string} runId
   * @param {string} [approvedBy] the authenticated approver, supplied by the
   *   server; defaults to resolveOwner(). Never sourced from caller input.
   * @returns {Promise<object>} the updated Run snapshot
   */
  async function approveRun (runId, approvedBy) {
    const current = getRun(runId)
    if (!current) throw fail(404, `unknown run: ${runId}`)

    const status = run.deriveStatus(current)
    if (status !== 'pending_approval') {
      throw fail(409, `run ${runId} is not pending approval (status: ${status}); ` +
        'only a pending-approval run can be approved')
    }

    if (current.targetProject !== 'frontend') {
      throw fail(422, 'backend patches cannot be applied from this endpoint: ' +
        'applying a backend patch restarts the backend process that owns the ' +
        'in-memory Run, which would destroy the Run before it completes. This ' +
        'limit is deliberate and must not be worked around.')
    }

    // The approver is resolved server-side — a caller can never supply it.
    const approver = typeof approvedBy === 'string' && approvedBy.trim()
      ? approvedBy
      : resolveOwner()

    // The patch to apply is the artifact the successful Develop recorded — read
    // straight from the PATCH_READY stage, never from caller input.
    const patchReady = [...current.timeline].reverse().find(e => e.stage === 'PATCH_READY')
    const patchPath = patchReady && patchReady.facts ? patchReady.facts.patchPath : undefined

    // Construct the Approval object — the single privileged act of this endpoint.
    const approval = { approved: true, approvedBy: approver, approvedAt: new Date().toISOString() }

    // Record the approval on the Run and move it into APPLYING. appendStage
    // enforces that APPLYING can only follow a PENDING_APPROVAL carrying an
    // approver, so an unapproved Run can never reach here.
    appendAndFlush(runId, 'APPLYING', {
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
      patchPath
    })

    // Dispatch Apply@1 — and ONLY Apply@1 — with the explicit approval. The
    // capability, version and target are all fixed here: this call can never be
    // steered to Deploy or to production.
    let result
    try {
      result = await dispatcher({
        run: current,
        phase: 'apply',
        request: {
          capabilityId: 'Apply',
          version: 1,
          target: 'dev',
          input: { patchPath, target: 'dev' }
        },
        approval
      })
    } catch (err) {
      const error = err && err.message ? err.message : String(err)
      appendAndFlush(runId, 'ROLLED_BACK', { error })
      return getRun(runId)
    }

    if (result && result.status === 'ok') {
      const backupRef = (result.output && result.output.backupRef) || result.backupRef
      appendAndFlush(runId, 'COMPLETED', { backupRef })
    } else {
      const error = (result && (result.error || result.reason)) || 'apply failed'
      appendAndFlush(runId, 'ROLLED_BACK', { error })
    }
    return getRun(runId)
  }

  /**
   * Reject a pending-approval Run. Terminal, and dispatches NOTHING — the human
   * declined, so no worker is ever asked to apply the patch.
   *
   * @param {string} runId
   * @param {string} [rejectedBy] the authenticated rejecter, supplied by the
   *   server; defaults to resolveOwner().
   * @param {string} [reason] an optional human-readable reason
   * @returns {object} the updated Run snapshot
   */
  function rejectRun (runId, rejectedBy, reason) {
    const current = getRun(runId)
    if (!current) throw fail(404, `unknown run: ${runId}`)

    const status = run.deriveStatus(current)
    if (status !== 'pending_approval') {
      throw fail(409, `run ${runId} is not pending approval (status: ${status}); ` +
        'only a pending-approval run can be rejected')
    }

    const rejecter = typeof rejectedBy === 'string' && rejectedBy.trim()
      ? rejectedBy
      : resolveOwner()
    const facts = { rejectedBy: rejecter }
    if (typeof reason === 'string' && reason.trim()) facts.reason = reason

    appendAndFlush(runId, 'REJECTED', facts)
    return getRun(runId)
  }

  return { startRun, getRun, listRuns, approveRun, rejectRun }
}

module.exports = { createRunStore, LOCAL_OWNER }
