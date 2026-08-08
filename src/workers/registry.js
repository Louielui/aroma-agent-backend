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

// capability -> employee; unknown/general falls to the Architect (knowledge default).
function workerForCapability (cap) {
  const c = (cap || 'ops').toLowerCase()
  return WORKERS.find(w => w.capabilities.includes(c)) || WORKERS.find(w => w.id === 'architect')
}

function listWorkers () {
  return WORKERS.map(w => ({
    id: w.id, role: w.role, provider: w.provider, engine: w.engine,
    responsibilities: w.responsibilities, capabilities: w.capabilities, connected: w.connected
  }))
}
function getWorker (id) { return WORKERS.find(w => w.id === id) || null }
function getExecutive () { return { ...EXECUTIVE } }

module.exports = { EXECUTIVE, WORKERS, workerForCapability, listWorkers, getWorker, getExecutive }
