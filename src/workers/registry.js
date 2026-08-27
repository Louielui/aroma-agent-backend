'use strict'

const { t } = require('../i18n/t')

/**
 * Worker Registry = Aroma's AI TEAM (an org chart, not a model list).
 *
 * Each worker is a replaceable EMPLOYEE defined by ROLE + CAPABILITIES + PROVIDER.
 * The provider (which model/tool currently fills the role) is swappable — replacing
 * it requires editing ONE field here, never the core. Adding a new employee (Gemini,
 * Cursor Agent, …) is one new entry here — zero core changes.
 *
 * 心燈 (Aroma) is NOT in this pool. She is the AI EXECUTIVE: she understands, plans,
 * dispatches, integrates and reports — she does not do specialist work herself.
 *
 * `engine`:
 *   'llm'      → the backend can drive this worker directly through the LLM adapter
 *                (today: the Architect, provider Claude, is connected & executes).
 *   'external' → needs its own connector; until connected, dispatches honestly wait.
 */

const EXECUTIVE = {
  id: 'aroma', get name () { return t('worker.aroma') }, role: 'AI Executive', provider: 'Claude',
  // ⛔ A GETTER, so `responsibilities` is still an array of STRINGS at every consumer while
  // being read at use time. A thunk would make every reader learn it is now a function.
  get responsibilities () {
    return [t('resp.understand'), t('resp.decompose'), t('resp.plan'), t('resp.dispatch'),
      t('resp.integrate'), t('resp.report'), t('resp.awaitApproval')]
  },
  connected: true
}

const WORKERS = [
  {
    id: 'architect', role: 'Architect / Designer', provider: 'Claude', engine: 'llm', connected: true,
    get responsibilities () { return [t('resp.systemDesign'), 'UI / UX', 'PRD', t('resp.docs'), t('resp.complexReasoning'), t('resp.architectureReview')] },
    capabilities: ['architecture', 'design', 'ui_ux', 'prd', 'documentation', 'reasoning', 'review', 'analysis', 'verification', 'planning', 'research', 'writing', 'product', 'ops']
  },
  {
    id: 'engineer', role: 'Software Engineer', provider: 'Claude Code', engine: 'external', connected: false,
    responsibilities: ['Coding', 'Refactor', 'Bug Fix', 'Test', 'Build', 'PR'],
    capabilities: ['coding', 'software', 'refactor', 'bugfix', 'test', 'build', 'pr']
  },
  {
    id: 'advisor', role: 'Technical Advisor / Strategy', provider: 'GPT', engine: 'external', connected: false,
    get responsibilities () { return [t('resp.techPlanning'), t('resp.productStrategy'), t('resp.architectureDiscussion'), t('resp.businessLogic')] },
    capabilities: ['strategy', 'product_strategy', 'business_logic', 'planning_technical']
  },
  {
    id: 'qa', role: 'Engineering QA', provider: 'Codex', engine: 'external', connected: false,
    get responsibilities () { return ['Code Review', t('resp.staticAnalysis'), t('resp.regressionRisk'), t('resp.suggestions')] },
    capabilities: ['code_review', 'static_analysis', 'regression', 'quality']
  },
  {
    id: 'automation', role: 'Automation Specialist', provider: 'Manus', engine: 'external', connected: false,
    get responsibilities () { return [t('resp.browserAutomation'), t('resp.longFlows'), t('resp.research'), t('resp.dataGathering'), t('resp.multiStep')] },
    capabilities: ['browser', 'web', 'research_web', 'data_collection', 'workflow']
  },
  {
    id: 'operator', role: 'Computer Operator', provider: 'Windows Agent', engine: 'external', connected: false,
    get responsibilities () { return ['Git', 'VS Code', t('resp.terminal'), t('resp.deploy'), t('resp.localCommands'), t('resp.fileOps')] },
    capabilities: ['git', 'terminal', 'deploy', 'file_ops', 'local_commands', 'execution', 'desktop', 'ssh']
  }
]

// capability -> employee. FAIL CLOSED: an unmatched capability resolves to null.
//
// This used to end `|| WORKERS.find(w => w.id === 'architect')`. The Architect is the only
// worker with connected:true and engine:'llm', so EVERY capability no employee declares
// became work the Architect would actually EXECUTE — silently, and upward. Every capability
// of a worker that is not connected yet (OpenClaw's, today) took exactly that path.
//
// The second default `(cap || 'ops')` is gone for the same reason: 'ops' IS a declared
// Architect capability, so an ABSENT capability was quietly promoted into real Architect
// work at this boundary. Ordinary unclassified work is unaffected — enrichTasks in
// intakeService.js already defaults it to 'ops' UPSTREAM, where it reaches the Architect by
// declaration rather than by fallback.
//
// Callers must handle null. The dispatcher does, and fails the dispatch closed.

/**
 * The ONE normalization. Routing lookup and uniqueness checking must agree exactly, or
 * 'Research' and ' research ' would be one capability to the index and two to the router.
 * @returns {string|null} the normalized capability, or null if it is not a usable one
 */
function normalizeCapability (cap) {
  if (typeof cap !== 'string') return null
  const c = cap.trim().toLowerCase()
  return c === '' ? null : c
}

/** Describe a bad value for an error message without ever dumping a whole object. */
function describeValue (v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return 'string ' + JSON.stringify(v)
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/**
 * The registry SHAPE gate. Runs before either index is built.
 *
 * ⛔ WHY `capabilities` MUST BE A REAL ARRAY, not merely iterable.
 * The first version of this iterated `(w && w.capabilities) || []`. A string is iterable,
 * so `capabilities: 'ops'` did not fail — it enumerated CHARACTERS and produced three
 * routable capabilities 'o', 'p', 's', with module initialization reporting success. A typo
 * that dropped one pair of brackets would have silently created authority that no worker
 * ever declared. Missing and null were worse in a quieter way: `|| []` turned them into a
 * worker with no capabilities and no complaint.
 *
 * A malformed declaration is never coerced or defaulted here. It is a source error.
 *
 * ⛔ WHY WORKER IDs ARE VALIDATED AT THE SAME BOUNDARY.
 * Capability routing is only half the round trip. createDispatchesForTasks PERSISTS
 * worker.id, and executeDispatch later re-resolves that stored id through getWorker(). Two
 * workers sharing an id would make the second half of that round trip order-dependent even
 * when their capability sets are completely disjoint — reintroducing array-order authority
 * at the EXECUTION boundary, which is the more dangerous of the two. Ids are compared
 * exactly: getWorker has always been an exact `w.id === id` match, and inventing
 * case-insensitive worker identity here would change unrelated behaviour.
 *
 * An empty capabilities array stays legal. No current invariant says every worker must
 * declare one, and inventing that rule is not this tranche's business.
 *
 * @param {Array} workers the registry (never mutated)
 */
function assertRegistryShape (workers) {
  if (!Array.isArray(workers)) throw new Error('refuse: worker registry must be an array')
  const errors = []

  workers.forEach((w, i) => {
    const at = 'worker at index ' + i
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      errors.push(at + ' is not a worker object (' + describeValue(w) + ')')
      return
    }
    const idOk = typeof w.id === 'string' && w.id.trim() !== ''
    if (!idOk) errors.push(at + ' has no usable id (' + describeValue(w.id) + ')')
    const label = idOk ? JSON.stringify(w.id) : at
    if (!Array.isArray(w.capabilities)) {
      errors.push('worker ' + label + ' declares capabilities that are not an array (' +
                  describeValue(w.capabilities) + ')')
    }
  })

  if (errors.length > 0) throw new Error('refuse: invalid worker registry — ' + errors.join('; '))
}

/**
 * worker id -> worker, with GLOBAL ID UNIQUENESS ENFORCED.
 * This is the index getWorker() resolves through, so the execution-side re-resolution of a
 * persisted worker_id is structurally order-independent rather than a first-match scan.
 * @param {Array} workers the registry (never mutated)
 * @returns {Map<string, object>} id -> the single worker holding it
 */
function buildWorkerIndex (workers) {
  assertRegistryShape(workers)
  const byId = new Map()
  const errors = []
  for (const w of workers) {
    if (byId.has(w.id)) {
      errors.push('worker id ' + JSON.stringify(w.id) + ' is declared by more than one worker')
      continue
    }
    byId.set(w.id, w)
  }
  if (errors.length > 0) throw new Error('refuse: ambiguous worker registry — ' + errors.join('; '))
  return byId
}

/**
 * capability -> worker, built once, with GLOBAL UNIQUENESS ENFORCED.
 *
 * Routing used to be `WORKERS.find(w => w.capabilities.includes(c))` — first match wins,
 * so the ANSWER DEPENDED ON ARRAY ORDER. Today that is invisible: 42 declarations, 42
 * distinct capabilities, no overlap. It stops being invisible the moment a second worker
 * declares a capability someone already owns, and the silent winner would be whoever sits
 * earlier in the array — which is the Architect, at index 0, holding 14 capabilities and
 * holding the only connected:true. That is the same upward, silent escalation Step A closed,
 * arriving through a different door. OpenClaw is a browser/web/execution-shaped worker, so
 * its capabilities are exactly the ones that would collide with automation and operator.
 *
 * A duplicate is a CONFIGURATION ERROR in developer-authored source, not a runtime event to
 * arbitrate. So this throws at module load rather than choosing: an ambiguous authority table
 * must never become executable production truth, and a startup failure is the honest shape of
 * 'this table does not say who is responsible'. Tests and the deploy gate should stop such a
 * source error long before production; if one ever got through, the process refuses to start
 * instead of quietly routing someone's work to the wrong employee.
 *
 * Deliberately NOT here: any tie-break. No priority table, no 'prefer connected', no 'prefer
 * Architect', no first/last match. Every one of those would make an ambiguous table look
 * answerable, which is the property being removed.
 *
 * @param {Array} workers the registry (never mutated)
 * @returns {Map<string, object>} normalized capability -> the single worker that declares it
 */
function buildCapabilityIndex (workers) {
  const index = new Map()
  assertRegistryShape(workers)
  const errors = []

  for (const w of workers) {
    const seenInWorker = new Set()
    for (const raw of w.capabilities) {
      const c = normalizeCapability(raw)
      if (c === null) {
        errors.push('worker ' + JSON.stringify(w.id) + ' declares an unusable capability ' + describeValue(raw))
        continue
      }
      if (seenInWorker.has(c)) {
        errors.push('capability ' + JSON.stringify(c) + ' is declared twice by the same worker ' + JSON.stringify(w.id))
        continue
      }
      seenInWorker.add(c)

      const owner = index.get(c)
      if (owner) {
        errors.push('capability ' + JSON.stringify(c) + ' is declared by more than one worker: ' +
                    JSON.stringify(owner.id) + ' and ' + JSON.stringify(w.id))
        continue
      }
      index.set(c, w)
    }
  }

  if (errors.length > 0) {
    throw new Error('refuse: ambiguous worker registry — ' + errors.join('; '))
  }
  return index
}

// Both built at load. If the registry is malformed or ambiguous in EITHER dimension —
// capability ownership or worker identity — requiring this module throws and nothing runs.
const WORKER_BY_ID = buildWorkerIndex(WORKERS)
const CAPABILITY_INDEX = buildCapabilityIndex(WORKERS)

function workerForCapability (cap) {
  const c = normalizeCapability(cap)
  if (c === null) return null
  return CAPABILITY_INDEX.get(c) || null
}

function listWorkers () {
  return WORKERS.map(w => ({
    id: w.id, role: w.role, provider: w.provider, engine: w.engine,
    responsibilities: w.responsibilities, capabilities: w.capabilities, connected: w.connected
  }))
}
// Exact-match id lookup, unchanged in semantics, resolved through the uniqueness-checked
// index. executeDispatch re-resolves a PERSISTED worker_id through here, so this is the
// execution boundary: a first-match scan would restore array-order authority at the exact
// point where work is about to run.
function getWorker (id) { return WORKER_BY_ID.get(id) || null }
function getExecutive () { return { ...EXECUTIVE } }

module.exports = { EXECUTIVE, WORKERS, workerForCapability, listWorkers, getWorker, getExecutive, buildCapabilityIndex, normalizeCapability, buildWorkerIndex, assertRegistryShape }
