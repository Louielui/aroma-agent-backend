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
  'POLICY_EVALUATED',
  'AGENT_SELECTED',
  'AGENT_RUNNING',
  'AGENT_FINISHED',
  'PATCH_READY',
  'PENDING_APPROVAL',
  'APPLYING',
  'COMPLETED',
  'DENIED',
  'FAILED',
  'ROLLED_BACK',
  'REJECTED'
]

// Once any of these lands, the Run is done: nothing more may be appended.
const TERMINAL_STAGES = ['COMPLETED', 'DENIED', 'FAILED', 'ROLLED_BACK', 'REJECTED']

// Facts a stage MUST carry — only what the recording component actually knows.
// Stages not listed here have no mandatory facts (facts may still be supplied).
const REQUIRED_FACTS = {
  POLICY_EVALUATED: ['verdict', 'rule_id'],
  AGENT_SELECTED: ['agentId'],
  PATCH_READY: ['patchPath'],
  COMPLETED: ['backupRef'],
  FAILED: ['error']
}

// Maps each stage to the status it implies. deriveStatus folds the timeline
// through this table, so the status is a pure function of the recorded stages.
const STAGE_STATUS = {
  TASK_CREATED: 'created',
  POLICY_EVALUATED: 'policy_evaluated',
  AGENT_SELECTED: 'agent_selected',
  AGENT_RUNNING: 'running',
  AGENT_FINISHED: 'agent_finished',
  PATCH_READY: 'patch_ready',
  PENDING_APPROVAL: 'pending_approval',
  APPLYING: 'applying',
  COMPLETED: 'completed',
  DENIED: 'denied',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
  REJECTED: 'rejected'
}

// The statuses that mean the Run has reached an end state.
const TERMINAL_STATUSES = ['completed', 'denied', 'failed', 'rolled_back', 'rejected']

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
  isTerminal
}
