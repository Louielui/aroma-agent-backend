'use strict'

/**
 * Worker Registry = Aroma's AI TEAM (an org chart, not a model list).
 *
 * Each worker is a replaceable EMPLOYEE defined by ROLE + CAPABILITIES + PROVIDER.
 * The provider (which model/tool currently fills the role) is swappable — replacing
 * it requires editing ONE field here, never the core. Adding a new employee (Gemini,
 * Cursor Agent, …) is one new entry here — zero core changes.
 *
 * 香香 (Aroma) is NOT in this pool. She is the AI EXECUTIVE: she understands, plans,
 * dispatches, integrates and reports — she does not do specialist work herself.
 *
 * `engine`:
 *   'llm'      → the backend can drive this worker directly through the LLM adapter
 *                (today: the Architect, provider Claude, is connected & executes).
 *   'external' → needs its own connector; until connected, dispatches honestly wait.
 */

const EXECUTIVE = {
  id: 'aroma', name: '香香', role: 'AI Executive', provider: 'Claude',
  responsibilities: ['理解需求', '拆解任務', '制定計畫', '派工', '整合成果', '向 Louie 回報', '等待批准'],
  connected: true
}

const WORKERS = [
  {
    id: 'architect', role: 'Architect / Designer', provider: 'Claude', engine: 'llm', connected: true,
    responsibilities: ['系統設計', 'UI / UX', 'PRD', '文件', '複雜推理', '架構審查'],
    capabilities: ['architecture', 'design', 'ui_ux', 'prd', 'documentation', 'reasoning', 'review', 'analysis', 'verification', 'planning', 'research', 'writing', 'product', 'ops']
  },
  {
    id: 'engineer', role: 'Software Engineer', provider: 'Claude Code', engine: 'external', connected: false,
    responsibilities: ['Coding', 'Refactor', 'Bug Fix', 'Test', 'Build', 'PR'],
    capabilities: ['coding', 'software', 'refactor', 'bugfix', 'test', 'build', 'pr']
  },
  {
    id: 'advisor', role: 'Technical Advisor / Strategy', provider: 'GPT', engine: 'external', connected: false,
    responsibilities: ['技術規劃', '產品策略', '架構討論', '商業邏輯分析'],
    capabilities: ['strategy', 'product_strategy', 'business_logic', 'planning_technical']
  },
  {
    id: 'qa', role: 'Engineering QA', provider: 'Codex', engine: 'external', connected: false,
    responsibilities: ['Code Review', '靜態分析', '回歸風險', '改進建議'],
    capabilities: ['code_review', 'static_analysis', 'regression', 'quality']
  },
  {
    id: 'automation', role: 'Automation Specialist', provider: 'Manus', engine: 'external', connected: false,
    responsibilities: ['瀏覽器自動化', '長流程', '研究', '資料蒐集', '多步驟執行'],
    capabilities: ['browser', 'web', 'research_web', 'data_collection', 'workflow']
  },
  {
    id: 'operator', role: 'Computer Operator', provider: 'Windows Agent', engine: 'external', connected: false,
    responsibilities: ['Git', 'VS Code', '終端機', '部署', '本機指令', '檔案操作'],
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
