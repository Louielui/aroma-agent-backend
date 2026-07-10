'use strict'

/**
 * dispatcher.js — the real Worker Dispatcher.
 *
 *  1. identify capability  → 2. select worker  → 3. create dispatch request
 *  4. (connected worker) execute for real      → 5. review  → 6. report status
 *
 * Honesty rules (Louie's v1):
 *  - Workers that are NOT connected NEVER "run". Their dispatch stays "waiting_connection".
 *  - Only 香香 (Claude), the one connected worker, executes — and only KNOWLEDGE tasks
 *    (analysis / review / planning / checklists / writing). It never touches files,
 *    code, or production. Red-line content is never sent out (→ waiting_approval).
 *  - Every status transition is persisted.
 */

const store = require('../store/store')
const { workerForCapability } = require('../workers/registry')
const { checkRedLine } = require('../intake/redlinePolicy')

const STATUS_LABEL = {
  queued: '已排入佇列', assigned: '已指派', running: '執行中',
  completed: '已完成', failed: '失敗', waiting_connection: '等待接入', waiting_approval: '待批准'
}
function statusLabel (s) { return STATUS_LABEL[s] || s }

/** Create a dispatch per task; connected → queued, not-connected → waiting_connection. */
function createDispatchesForTasks (tasks, decisionId) {
  return tasks.map(t => {
    const worker = workerForCapability(t.capability)
    const status = worker.connected ? 'queued' : 'waiting_connection'
    const d = store.createDispatch({
      task_id: t.id, decision_id: decisionId, capability: t.capability || 'ops',
      worker_id: worker.id, worker_name: worker.provider, worker_role: worker.role, status
    })
    return { dispatch: d, task: t, worker }
  })
}

/** Execute one dispatch with the connected knowledge worker (香香/Claude). Real, not simulated. */
async function executeDispatch (dispatchId, adapter, context = {}) {
  const d = store.getDispatch(dispatchId)
  if (!d) return
  const { getWorker } = require('../workers/registry')
  const worker = getWorker(d.worker_id)
  if (!worker || !worker.connected || worker.engine !== 'llm') return // only connected LLM-driven employees execute; others honestly wait

  const task = store.listTasks().find(t => t.id === d.task_id)
  const taskText = task ? `${task.title}. ${task.note || ''}` : ''

  // Red-line guard: never send sensitive content to an external model.
  const rl = checkRedLine(taskText)
  if (rl && rl.blocked) {
    store.updateDispatch(dispatchId, { status: 'waiting_approval', error: '含敏感資訊,需人工處理,未送外部模型' })
    return
  }

  store.updateDispatch(dispatchId, { status: 'running' })
  try {
    const system = `你是「香香」,Louie 的 AI 營運長,正在親自完成一個知識型任務。
只產出「知識型成果」(分析、檢查清單、計畫、審查意見、草稿)。
你【不能】也【不會】真的動檔案、改程式或碰 production——只給出可用的文字成果。
用繁體中文,簡潔、具體、可直接使用。最後用一行「自我檢查:」總結你對這份成果的信心與提醒。`
    const prompt = `任務:${task ? task.title : ''}\n背景:${task ? task.note : ''}\n相關決定:${context.decisionStatement || ''}\n\n請完成這個任務並給出成果。`
    const out = await adapter.complete(prompt, { system, maxTokens: 700 })
    store.recordLLMUsage({ model: out.model, totalTokens: out.usage && out.usage.totalTokens, latencyMs: out.latencyMs, blocked: false })
    store.updateDispatch(dispatchId, { status: 'completed', result: (out.text || '').trim() })
  } catch (err) {
    store.updateDispatch(dispatchId, { status: 'failed', error: err.message })
  }
}

module.exports = { createDispatchesForTasks, executeDispatch, statusLabel }
