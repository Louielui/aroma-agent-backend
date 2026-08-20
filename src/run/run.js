'use strict'

/**
 * run.js — the Run and Run Timeline model for the Aroma OS backend.
 *
 * A Run is the single record of one governed piece of work moving through the
 * OS. Its timeline is an APPEND-ONLY log of stages: stages are never
 * overwritten, edited, or deleted. A correction is not an in-place edit — it is
 * a new, compensating stage appended to the end (e.g. ROLLED_BACK after an
 * APPLYING that went wrong).
 *
 * Because the timeline is the SINGLE SOURCE OF TRUTH, there is deliberately no
 * `status` field stored on a Run. Status is always DERIVED from the timeline by
 * a fold (deriveStatus). There is no status setter and no code path that writes
 * a status back onto the Run — so the log and the status can never disagree.
 *
 * Provenance: `owner` is supplied once, at creation, by the authenticated
 * caller. `approvedBy` is supplied by the authenticated caller on the APPLYING
 * stage. Neither is ever inferred, defaulted from other fields, or accepted from
 * a worker or language model — appendStage refuses to let facts carry `owner`,
 * and there is no other write path.
 *
 * Everything is in-memory: no file I/O, no network, no LLM.
 */

const { randomUUID } = require('node:crypto')

// The only workspace in M1. Runs default here rather than inventing a value.
const DEFAULT_WORKSPACE = 'default'

// Target projects a Run may act on. 'production' is intentionally absent: a Run
// never targets production directly — that is a separate, human-gated concern.
const TARGET_PROJECTS = ['backend', 'frontend']

// The exact, closed stage vocabulary. Any stage not in this set is unknown.
const STAGES = [
  'TASK_CREATED',
  'DISPATCH_CLAIMED',
  'WORKER_CLAIMED',
  // P1-C1c: the Agent Bridge lane's claim. The third and last member of the
  // mutually-exclusive claim family — see the one-lane invariant in run/store.js.
  'AGENT_CLAIMED',
  'POLICY_EVALUATED',
  'AGENT_SELECTED',
  'AGENT_RUNNING',
  'AGENT_FINISHED',
  'PATCH_READY',
  'PENDING_APPROVAL',
  'APPLYING',
  // P1-C1c: the executor-neutral success terminal. COMPLETED keeps its
  // Apply/backup meaning and its backupRef; a lane that never makes a backup
  // must not borrow it (see TERMINAL note below).
  'SUCCEEDED',
  'COMPLETED',
  'DENIED',
  'FAILED',
  'ROLLED_BACK',
  'REJECTED',
  // B2-11b recovery marks (startup reconcile — a MARK, never an action):
  'RECONCILED_PENDING',
  'RECONCILED_INTERRUPTED',
  'RECONCILED_SUCCEEDED',
  'RECONCILED_FAILED',
  // B2-11b retry: the seed of a NEW attempt (inert — never auto-dispatched):
  'RETRY_ATTEMPT'
]

// Once any of these lands, the Run is done: nothing more may be appended. The
// reconciled-terminal marks settle an interrupted/finished attempt; a retry
// creates a NEW Run rather than appending to a settled one.
const TERMINAL_STAGES = ['SUCCEEDED', 'COMPLETED', 'DENIED', 'FAILED', 'ROLLED_BACK', 'REJECTED',
  'RECONCILED_INTERRUPTED', 'RECONCILED_SUCCEEDED', 'RECONCILED_FAILED']

// Facts a stage MUST carry — only what the recording component actually knows.
// Stages not listed here have no mandatory facts (facts may still be supplied).
const REQUIRED_FACTS = {
  POLICY_EVALUATED: ['verdict', 'rule_id'],
  // P1-C1c: a claim that cannot say WHICH approval it belongs to is not evidence —
  // it is the same unlinked record that made an executed approval unrecoverable.
  AGENT_CLAIMED: ['approvalId', 'workOrderHash'],
  AGENT_SELECTED: ['agentId'],
  // P1-C1c: an executor-neutral success terminal must at least say WHICH executor
  // succeeded. On the Agent lane it must also name the approval — see AGENT_LANE_FACTS.
  SUCCEEDED: ['executor'],
  PATCH_READY: ['patchPath'],
  COMPLETED: ['backupRef'],
  FAILED: ['error']
}

/**
 * P1-C1c. Facts required ONLY on a Run the Agent Bridge lane has claimed. These are
 * the things recovery and the Owner's result surface cannot work without: the boolean
 * outcome the crash bridge carries, and the approval a terminal belongs to. They are
 * NOT demanded of the Develop or Worker lanes, which share these stage names and
 * predate this contract.
 */
const AGENT_LANE_FACTS = {
  AGENT_FINISHED: ['ok', 'approvalId'],
  SUCCEEDED: ['approvalId'],
  FAILED: ['approvalId']
}

/**
 * P1-C1c RULING 1. Agent-lane stages whose contract carries approval identity, and
 * which must therefore name THIS Run's approval — not merely some approval.
 *
 * Deliberately NOT every stage: AGENT_SELECTED and AGENT_RUNNING are progress marks
 * that answer 「what is happening」, not 「which decision authorised it」, and widening
 * the rule to them would be schema redesign rather than identity enforcement.
 */
const APPROVAL_IDENTITY_STAGES = ['AGENT_CLAIMED', 'AGENT_FINISHED', 'SUCCEEDED', 'FAILED']

// Maps each stage to the status it implies. deriveStatus folds the timeline
// through this table, so the status is a pure function of the recorded stages.
const STAGE_STATUS = {
  TASK_CREATED: 'created',
  // B2-11a: authorization succeeded and a real dispatch is about to spawn. A
  // durable, non-terminal marker (evidence for a future recovery) — not a result.
  DISPATCH_CLAIMED: 'dispatch_claimed',
  // B2-14: the SANDBOX-WORKER equivalent — the worker obtained the unique dispatch
  // claim and is about to spawn. Distinct from DISPATCH_CLAIMED (worker vs Develop
  // track); durable, non-terminal, immutable.
  WORKER_CLAIMED: 'worker_claimed',
  // P1-C1c: the Agent Bridge twin. Durable, non-terminal, immutable.
  AGENT_CLAIMED: 'agent_claimed',
  POLICY_EVALUATED: 'policy_evaluated',
  AGENT_SELECTED: 'agent_selected',
  AGENT_RUNNING: 'running',
  AGENT_FINISHED: 'agent_finished',
  PATCH_READY: 'patch_ready',
  PENDING_APPROVAL: 'pending_approval',
  APPLYING: 'applying',
  // P1-C1c: executor-neutral success. Distinct from COMPLETED, which still means
  // "applied, with a backup" and still demands backupRef.
  SUCCEEDED: 'succeeded',
  COMPLETED: 'completed',
  DENIED: 'denied',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
  REJECTED: 'rejected',
  // B2-11b recovered statuses (derived from durable evidence at startup):
  RECONCILED_PENDING: 'pending',
  RECONCILED_INTERRUPTED: 'interrupted',
  RECONCILED_SUCCEEDED: 'succeeded',
  RECONCILED_FAILED: 'failed',
  // A retried attempt is inert until a future dispatch (gated by B2-9):
  RETRY_ATTEMPT: 'retry_pending'
}

// The statuses that mean the Run has reached an end state. 'interrupted' and
// 'succeeded' (recovered) are terminal-for-this-attempt: an interrupted attempt
// is retried by creating a NEW Run, never by continuing the settled one.
const TERMINAL_STATUSES = ['completed', 'denied', 'failed', 'rolled_back', 'rejected',
  'interrupted', 'succeeded']

// The in-memory store. Runs live here for the life of the process only.
const runs = new Map()

/** True when a value is present and, if a string, not blank. */
function isProvided (value) {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

/** Deep-freeze an object graph so a returned copy cannot be mutated at all. */
function deepFreeze (value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) {
      deepFreeze(value[key])
    }
  }
  return value
}

/**
 * Create a new Run. `owner` is required and is the authenticated caller's
 * identity — it is never inferred. `targetProject` must be 'backend' or
 * 'frontend' and may never be 'production'. The rest of the fields are reserved
 * or optional; the timeline is seeded with the single TASK_CREATED stage that
 * this creation event represents.
 *
 * @param {{ owner: string, workspace?: string, conversationId?: (string|null),
 *           goal?: (string|null), task?: string, intent?: string,
 *           targetProject?: ('backend'|'frontend'), capabilityId?: string,
 *           version?: number }} input
 * @returns {object} a deeply-frozen deep copy of the stored Run
 * @throws {TypeError}  if owner is missing
 * @throws {RangeError} if targetProject is 'production' or otherwise invalid
 */
function createRun (input = {}) {
  if (!isProvided(input.owner)) {
    throw new TypeError('createRun requires an authenticated owner')
  }

  const targetProject = input.targetProject == null ? 'backend' : input.targetProject
  if (targetProject === 'production') {
    throw new RangeError('targetProject must never be production')
  }
  if (!TARGET_PROJECTS.includes(targetProject)) {
    throw new RangeError(`targetProject must be one of ${TARGET_PROJECTS.join('|')} (got ${targetProject})`)
  }

  const now = new Date().toISOString()
  const run = {
    id: 'run_' + randomUUID().slice(0, 8),
    owner: input.owner,
    workspace: input.workspace == null ? DEFAULT_WORKSPACE : input.workspace,
    conversationId: input.conversationId == null ? null : input.conversationId,
    // P1-C1c THE DURABLE OWNER-APPROVAL LINK. Set ONCE here, by the server, and never
    // again — appendStage has no path to it and no caller may supply it later. It is
    // written at CREATION rather than at claim time on purpose: the Run is created
    // before the Agent hand-off, and a crash in that window used to leave a durable
    // Run whose approval identity could not be recovered from anything on disk.
    // Absent for every non-agent caller, which is why it is optional and nullable.
    approvalId: (typeof input.approvalId === 'string' && input.approvalId !== '') ? input.approvalId : null,
    goal: input.goal == null ? null : input.goal,
    task: input.task == null ? '' : input.task,
    intent: input.intent == null ? null : input.intent,
    targetProject,
    capabilityId: input.capabilityId == null ? null : input.capabilityId,
    version: input.version == null ? null : input.version,
    // Seed the timeline with the creation event itself. Append-only from here.
    timeline: [{ stage: 'TASK_CREATED', at: now, facts: {} }],
    createdAt: now
    // NOTE: there is intentionally no `status` field. Status is derived.
  }

  runs.set(run.id, run)
  return snapshot(run)
}

/**
 * Append a stage to a Run's timeline. This is the ONLY mutation path for a Run.
 *
 * Enforced invariants:
 *   - the stage name must be part of the closed vocabulary;
 *   - nothing may be appended once a terminal stage has landed;
 *   - APPLYING requires a prior PENDING_APPROVAL AND a recorded approval
 *     (facts.approvedBy, an authenticated approver supplied by the caller);
 *   - a stage's required facts must be present (e.g. POLICY_EVALUATED needs
 *     verdict and rule_id, COMPLETED needs backupRef, FAILED needs error);
 *   - facts may never carry `owner` — provenance is set only at creation.
 *
 * @param {string} runId
 * @param {string} stage
 * @param {object} [facts]  only what the recording component actually knows
 * @returns {object} a deeply-frozen deep copy of the updated Run
 */
function appendStage (runId, stage, facts = {}) {
  const run = runs.get(runId)
  if (!run) {
    throw new RangeError(`unknown run: ${runId}`)
  }

  if (!STAGES.includes(stage)) {
    throw new RangeError(`unknown stage: ${stage}`)
  }

  if (facts == null || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new TypeError('facts must be a plain object')
  }

  // Provenance guard: owner is authenticated-at-creation only. No worker or
  // language model may smuggle an owner in through a stage's facts.
  if (Object.prototype.hasOwnProperty.call(facts, 'owner')) {
    throw new TypeError('facts must not carry owner — owner is set only at creation')
  }

  // ── P1-C1c: LANE-AWARE FACTS ────────────────────────────────────────────────
  // AGENT_FINISHED and SUCCEEDED are SHARED vocabulary. AGENT_FINISHED already
  // belonged to the Develop dispatcher, which appends it with no facts at all, so
  // demanding `ok` from every caller would not have tightened the Agent lane — it
  // would have broken Develop, whose semantics this tranche must leave alone.
  //
  // So the requirement follows the LANE, identified by the durable claim the Run
  // already carries. On an Agent-claimed Run the crash bridge must be able to state
  // its outcome and name its approval; elsewhere the stage keeps its old contract.
  //
  // ⛔ AND CARRYING *AN* approvalId IS NOT ENOUGH — IT MUST BE *THIS RUN'S*.
  // Requiring the field only proved a stage had been given some approval identity;
  // nothing checked it was the one the Run was created for. Evidence naming a
  // different approval is worse than evidence naming none: it reads as a link, is
  // stored as a link, and points at the wrong governed decision. Exact equality,
  // and nothing else — no case folding, no trimming, no alias, no guess.
  //
  // AGENT_CLAIMED is the stage that OPENS the lane, so it cannot be recognised by
  // the lane it is about to create; it is handled explicitly here.
  if (stage === 'AGENT_CLAIMED' && !isProvided(run.approvalId)) {
    throw new Error('AGENT_CLAIMED requires the run to carry an approvalId — a claim on a Run with no approval identity could never be reconciled')
  }
  const agentLane = run.timeline.some(entry => entry.stage === 'AGENT_CLAIMED') || stage === 'AGENT_CLAIMED'
  if (agentLane) {
    for (const key of (AGENT_LANE_FACTS[stage] || [])) {
      if (!isProvided(facts[key])) {
        throw new Error(`stage ${stage} on an agent-claimed run requires fact '${key}'`)
      }
    }
    if (APPROVAL_IDENTITY_STAGES.includes(stage) && facts.approvalId !== run.approvalId) {
      throw new Error(`stage ${stage} carries approvalId '${String(facts.approvalId)}' which is not this run's approval`)
    }
  }

  // Whatever the lane, `ok` is the value recovery folds into succeeded-vs-failed. A
  // truthy-but-not-boolean value (the string 'false', a 0, an object) would become a
  // confident outcome the evidence never stated, so the TYPE is enforced for anyone
  // who supplies it — and recovery additionally ignores an absent one.
  if (stage === 'AGENT_FINISHED' && facts.ok !== undefined && typeof facts.ok !== 'boolean') {
    throw new TypeError('AGENT_FINISHED facts.ok must be a boolean when supplied')
  }

  // Terminal means terminal: a compensating stage is appended BEFORE the end
  // state, never after it.
  const last = run.timeline[run.timeline.length - 1]
  if (last && TERMINAL_STAGES.includes(last.stage)) {
    throw new Error(`run ${runId} is terminal (${last.stage}); nothing may be appended`)
  }

  if (stage === 'APPLYING') {
    const hasPendingApproval = run.timeline.some(entry => entry.stage === 'PENDING_APPROVAL')
    if (!hasPendingApproval) {
      throw new Error('APPLYING requires a prior PENDING_APPROVAL stage')
    }
    if (!isProvided(facts.approvedBy)) {
      throw new Error('APPLYING requires a recorded approval (facts.approvedBy)')
    }
  }

  const required = REQUIRED_FACTS[stage] || []
  for (const key of required) {
    if (!isProvided(facts[key])) {
      throw new Error(`stage ${stage} requires fact '${key}'`)
    }
  }

  run.timeline.push({ stage, at: new Date().toISOString(), facts: { ...facts } })
  return snapshot(run)
}

/**
 * Derive the Run's status by folding its timeline. This is the ONLY source of
 * status — it is computed, never stored and never set.
 *
 * @param {object} run
 * @returns {string} the derived status ('unknown' for an empty timeline)
 */
function deriveStatus (run) {
  const timeline = run && Array.isArray(run.timeline) ? run.timeline : []
  return timeline.reduce((status, entry) => STAGE_STATUS[entry.stage] || status, 'unknown')
}

/**
 * Return a Run by id as a deeply-frozen deep copy, so a caller can read the
 * timeline but cannot mutate the stored Run through the returned reference.
 *
 * @param {string} runId
 * @returns {object|null}
 */
function getRun (runId) {
  const run = runs.get(runId)
  return run ? snapshot(run) : null
}

/** List every stored Run as deeply-frozen deep copies. */
function listRuns () {
  return [...runs.values()].map(snapshot)
}

/**
 * Rehydrate a Run record into the store from durable storage (B2-10). PURE DATA:
 * it stores the record verbatim and does NOTHING else — it never generates an id,
 * never appends a stage, never derives or dispatches anything. This is the ONLY
 * load path; it must never route through createRun (which seeds TASK_CREATED and
 * mints a new id) or any dispatch, so loading Runs can never trigger execution
 * (preserving B2-9). The record is stored MUTABLE (not frozen) so a later
 * appendStage can push onto its timeline exactly as for a live Run.
 *
 * @param {object} record a Run record read from disk (must carry a string id and
 *   a timeline array — the persistence layer validates this before we are called)
 */
function rehydrate (record) {
  runs.set(record.id, record)
}

/**
 * Whether a derived status is a terminal (end) state.
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal (status) {
  return TERMINAL_STATUSES.includes(status)
}

/** Deep copy + deep freeze — the shape callers always receive. */
function snapshot (run) {
  return deepFreeze(structuredClone(run))
}

module.exports = {
  DEFAULT_WORKSPACE,
  TARGET_PROJECTS,
  STAGES,
  TERMINAL_STAGES,
  TERMINAL_STATUSES,
  createRun,
  appendStage,
  deriveStatus,
  getRun,
  listRuns,
  rehydrate,
  isTerminal
}
