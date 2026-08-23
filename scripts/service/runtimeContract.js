'use strict'
/**
 * runtimeContract.js — WHAT THE RESIDENT SERVER MUST BE RUN WITH, IN ONE PLACE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS FILE EXISTS: THE OLD SERVICE SET FOUR VALUES AND THE LAUNCHER SET
 *    TWENTY-FOUR.
 *
 * The installed `AromaXiangXiangBackend` service declared exactly four environment
 * values. The interactive launcher that actually runs production sets twenty-four.
 * Nineteen of the difference are the flags that decide whether 香香 can read anything
 * at all — READ_ACCESS, every CONTEXT_*, GOAL_DECOMPOSER, A4_KNOWLEDGE_ROUTING — plus
 * the provider, the model pin and the port. A service started from that config would
 * have come up healthy, answered /health, and been a different assistant.
 *
 * ⛔ SO OWNERSHIP MAY CHANGE; IDENTITY MAY NOT. Moving the server from an interactive
 * process to a Windows service is a question about WHO HOLDS THE PORT. It is not a
 * chance to re-specify what the application is. Every value below is transcribed from
 * the launcher that is running production right now, and `runtimeContract.test.js`
 * fails if the two ever stop agreeing.
 *
 * ⛔ AND SECRETS ARE NOT HERE. Three values are supplied at INSTALL time through the
 * service-only environment seam and never appear in git: the two credentials, and
 * CLAUDE_CHAT_MODEL — which is an intentional, uncommitted launcher canary. Writing
 * the canary down here would quietly promote a live experiment into committed truth,
 * which is the one thing it was set up not to be.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** The production repository. The service runs THE SAME tree production already advances. */
const PRODUCTION_REPO = String.raw`C:\Aroma\aroma-agent-backend`

/**
 * ⛔ STABLE, NON-SECRET, AND EXACTLY THE LAUNCHER'S. Not a superset, not a subset.
 * Sorted, frozen, and compared key-by-key against the launcher body by the contract test.
 */
const STABLE_ENV = Object.freeze({
  A4_KNOWLEDGE_ROUTING: 'on',
  AGENT_BRIDGE: 'on',
  AROMA_BIND_HOST: '127.0.0.1',
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  CONTEXT_AROMA_SYSTEM: 'on',
  CONTEXT_CALENDAR: 'on',
  CONTEXT_DRIVE: 'on',
  CONTEXT_GITHUB: 'on',
  CONTEXT_GMAIL: 'on',
  CONTEXT_PUBLIC_KNOWLEDGE: 'on',
  CONVERSATION_CONTRACT: 'on',
  CONVERSATION_DEMO: 'on',
  CONVERSATION_RECALL: 'on',
  DECISION_RECALL: 'on',
  GOAL_DECOMPOSER: 'on',
  LLM_PROVIDER: 'claude',
  MULTI_AI_ROUTER: 'on',
  PORT: '8090',
  READ_ACCESS: 'on',
  TURN_ROUTER: 'on',
  XIANGXIANG_ARCHIVE: 'on'
})

/**
 * ⛔ SUPPLIED AT INSTALL TIME, NEVER COMMITTED. Names only — this list exists so the
 * preflight can say WHICH value is missing without ever reading one.
 *
 * CLAUDE_CHAT_MODEL sits here deliberately. It is the Opus chat-lane canary and lives
 * as an uncommitted edit in the running launcher; the moment it is written into a
 * tracked file it stops being a canary and becomes a fact nobody decided.
 */
const INSTALL_TIME_REQUIRED = Object.freeze(['ANTHROPIC_API_KEY', 'HUB_TOKEN', 'CLAUDE_CHAT_MODEL'])

/**
 * ⛔ VALUES THE OLD SERVICE SET THAT THIS ONE MUST NOT. Each one silently relocated the
 * application away from production: a second data store, a second artifact tree, and a
 * process role the live runtime never needed. Named so the test can prove their absence
 * rather than trusting that nobody re-adds them.
 */
const FORBIDDEN_ENV = Object.freeze(['AROMA_DATA_DIR', 'AROMA_ARTIFACT_DIR', 'AROMA_PROCESS_ROLE'])

/** Paths from the superseded 464c078 install that must appear in no v2 artifact. */
const FORBIDDEN_PATHS = Object.freeze([
  '464c07843a21ea0b31e53676436f7ba4a8378e0d',
  String.raw`C:\Aroma\releases\aroma-m1-backend`,
  String.raw`C:\ProgramData\AromaXiangXiang\state`
])

module.exports = { PRODUCTION_REPO, STABLE_ENV, INSTALL_TIME_REQUIRED, FORBIDDEN_ENV, FORBIDDEN_PATHS }
