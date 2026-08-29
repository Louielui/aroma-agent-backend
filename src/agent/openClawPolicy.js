'use strict'

/**
 * openClawPolicy.js — THE CAPABILITY BOUNDARY, WRITTEN DOWN AND INERT.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * A deterministic SPECIFICATION plus a PLANNER. It computes the exact configuration a
 * future ephemeral OpenClaw agent must carry, and returns it as data. It executes nothing,
 * spawns nothing, and touches no OpenClaw config: there is deliberately no child_process
 * import in this file, so it cannot become an execution surface by a later edit that
 * "just needed to run one command".
 *
 * ── WHY POLICY AND NOT PROMPTING ────────────────────────────────────────────
 * C2-B2-A established that model-visible tools can be restricted mechanically:
 * `tools.allow` is documented as an ABSOLUTE allowlist that replaces profile-derived
 * defaults, and `tools.deny` blocks a tool even where a profile or provider would grant it.
 * That is a real boundary. An instruction in a brief is not one, and post-hoc git inspection
 * cannot prove a write-then-restore never happened. So the write tools are never granted.
 *
 * ── WHY tools.exec.mode IS NOT SET ──────────────────────────────────────────
 * Measured, not assumed: setting `tools.exec.mode = 'deny'` made every model call on this
 * installation fail with
 *   "Codex app-server local execution is not available when tools.exec.mode=deny"
 * because the only configured provider routes through the Codex app-server, which needs
 * local execution to start. That setting governs OPENCLAW'S OWN RUNTIME, not the model's
 * tool surface. The model is disarmed by allow/deny; the runtime is left able to boot.
 * Conflating the two disables the product rather than the agent.
 */

const CORE_TOOLS = Object.freeze([
  // fs
  'read', 'write', 'edit', 'apply_patch',
  // runtime
  'exec', 'process', 'code_execution',
  // web
  'web_search', 'web_fetch', 'x_search',
  // memory
  'memory_search', 'memory_get',
  // sessions
  'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'sessions_yield',
  'subagents', 'session_status',
  // ui
  'browser', 'canvas',
  // messaging
  'message',
  // automation
  'heartbeat_respond', 'cron', 'gateway',
  // nodes
  'nodes',
  // agents
  'agents_list', 'get_goal', 'create_goal', 'update_goal', 'update_plan', 'skill_workshop',
  // media
  'image', 'image_generate', 'music_generate', 'video_generate', 'tts'
])

/** The initial production lane: local repository reading, and nothing else. */
const REPO_REVIEW_ALLOW = Object.freeze(['read'])

/**
 * ⛔ NETWORK IS WITHHELD DELIBERATELY, NOT INCIDENTALLY.
 * A non-cancellable executor holding repository read access AND outbound web tools is an
 * exfiltration channel we would have no way to interrupt — C2-B2-A proved we cannot stop a
 * turn once it starts. Read and network are therefore not combined in the first lane.
 */
const NETWORK_TOOLS = Object.freeze(['web_search', 'web_fetch', 'x_search'])

/** Only these two plugins are required by the configured openai-via-codex runtime. */
const PLUGIN_ALLOW = Object.freeze(['openai', 'codex'])

/**
 * ⛔ plugins.allow IS NOT A COMPLETE LOADER GATE.
 * Measured: with plugins.allow = ["openai","codex"] the enabled surface fell from 48/65 to
 * 3/65 — the third being bundled `memory-core`, which loads through plugins.slots despite
 * not being listed. Recorded here rather than glossed, because a future reader would
 * otherwise reasonably believe the allowlist is exhaustive. Its tools (memory_search,
 * memory_get) are denied, so it grants the model nothing.
 */
const PLUGIN_SLOT_EXCEPTIONS = Object.freeze(['memory-core'])

/* ══════════════ the run-loop ceiling ══════════════ */

/**
 * The installed OpenClaw defaults, read from dist/selection-*.js:
 *
 *   const BASE_RUN_RETRY_ITERATIONS = 24
 *   const RUN_RETRY_ITERATIONS_PER_PROFILE = 8
 *   const MIN_RUN_RETRY_ITERATIONS = 32
 *   const MAX_RUN_RETRY_ITERATIONS = 160
 */
const INSTALLED_RUN_RETRY_DEFAULTS = Object.freeze({ base: 24, perProfile: 8, min: 32, max: 160 })

/**
 * A faithful reimplementation of the installed resolveMaxRunRetryIterations, so the ceiling
 * we intend can be computed and asserted here rather than hoped for.
 *
 *   const minLimit = Math.max(1, cfg.min ?? 32)
 *   const maxLimit = Math.max(minLimit, cfg.max ?? 160)
 *   const scaled   = base + Math.max(1, profileCandidateCount) * perProfile
 *   return Math.min(maxLimit, Math.max(minLimit, scaled))
 *
 * ⛔ THE TRAP THIS EXPOSES: `maxLimit` is floored at `minLimit`. Setting only `max` to a
 * small number therefore does NOT lower the ceiling — it is silently raised back to `min`
 * (32 by default). A policy that set max alone would look bounded and be bounded at 32.
 * `min` must be lowered too, which is why the plan always writes base, min AND max.
 */
function effectiveRunLoopCeiling (runRetries = {}, profileCandidateCount = 1) {
  const d = INSTALLED_RUN_RETRY_DEFAULTS
  const base = Math.max(1, runRetries.base ?? d.base)
  const perProfile = Math.max(0, runRetries.perProfile ?? d.perProfile)
  const minLimit = Math.max(1, runRetries.min ?? d.min)
  const maxLimit = Math.max(minLimit, runRetries.max ?? d.max)
  const scaled = base + Math.max(1, profileCandidateCount) * perProfile
  return Math.min(maxLimit, Math.max(minLimit, scaled))
}

/**
 * The bound this programme intends to hold an OpenClaw turn to.
 *
 * 24 model requests, not 160. Chosen to be a real reduction while still permitting a
 * genuine read-only audit of several files; a value low enough to be dramatic would make
 * the lane useless and would be tuned back up under pressure, which is a worse outcome
 * than a modest bound that survives contact with real work. Tunable at the activation gate.
 */
const RUN_RETRY_CEILING = 24
const MAX_OUTPUT_TOKENS = 8000
const REQUEST_TIMEOUT_SECONDS = 120

/**
 * Build the exact configuration plan for one ephemeral agent.
 * Returns DATA. Nothing here applies it.
 *
 * @param {string} agentId the ephemeral agent id (never the shared 'main' agent)
 * @param {number} agentIndex position in agents.list[], resolved by the caller at apply time
 */
function buildAgentPolicyPlan (agentId, agentIndex) {
  if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(agentId)) {
    throw new Error('policy requires a safe agentId ([A-Za-z0-9_-]{1,64})')
  }
  if (agentId === 'main') throw new Error('refuse: the shared main agent is never a policy target')
  if (!Number.isInteger(agentIndex) || agentIndex < 0) {
    throw new Error('policy requires the agents.list index of the ephemeral agent')
  }

  const deny = CORE_TOOLS.filter((t) => !REPO_REVIEW_ALLOW.includes(t))
  const p = (suffix) => `agents.list[${agentIndex}].${suffix}`

  return {
    agentId,
    allow: REPO_REVIEW_ALLOW.slice(),
    deny,
    operations: [
      { path: p('tools.allow'), value: REPO_REVIEW_ALLOW.slice() },
      { path: p('tools.deny'), value: deny },
      { path: p('tools.fs.workspaceOnly'), value: true },
      // skills are a capability surface SEPARATE from tools: 14 were injected into the
      // system prompt during the C2-B2-A probe. [] means none, and an explicit per-agent
      // list replaces the default rather than merging with it.
      { path: p('skills'), value: [] },
      // all three of base/min/max, because max alone is floored at min — see above
      { path: p('runRetries.base'), value: RUN_RETRY_CEILING },
      { path: p('runRetries.min'), value: RUN_RETRY_CEILING },
      { path: p('runRetries.max'), value: RUN_RETRY_CEILING },
      { path: p('runRetries.perProfile'), value: 0 }
    ],
    // NOTE: tools.exec.mode is deliberately absent. See the header.
    omits: ['tools.exec.mode'],
    ceiling: effectiveRunLoopCeiling(
      { base: RUN_RETRY_CEILING, min: RUN_RETRY_CEILING, max: RUN_RETRY_CEILING, perProfile: 0 }
    )
  }
}

/**
 * Global (non-agent) settings the lane depends on. Separated because these touch SHARED
 * state — plugins.allow in particular is global, and applying it is an activation-gate
 * decision, not something this tranche does.
 */
function buildGlobalPolicyPlan () {
  return {
    operations: [
      { path: 'plugins.allow', value: PLUGIN_ALLOW.slice() },
      { path: 'models.providers.openai.maxTokens', value: MAX_OUTPUT_TOKENS },
      { path: 'models.providers.openai.timeoutSeconds', value: REQUEST_TIMEOUT_SECONDS }
    ],
    slotExceptions: PLUGIN_SLOT_EXCEPTIONS.slice(),
    appliesToSharedState: true
  }
}

module.exports = {
  CORE_TOOLS,
  REPO_REVIEW_ALLOW,
  NETWORK_TOOLS,
  PLUGIN_ALLOW,
  PLUGIN_SLOT_EXCEPTIONS,
  INSTALLED_RUN_RETRY_DEFAULTS,
  RUN_RETRY_CEILING,
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_SECONDS,
  effectiveRunLoopCeiling,
  buildAgentPolicyPlan,
  buildGlobalPolicyPlan
}
