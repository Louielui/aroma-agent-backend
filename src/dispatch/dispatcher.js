'use strict'

/**
 * dispatcher.js — the real Worker Dispatcher.
 *
 *  1. identify capability  → 2. select worker  → 3. create dispatch request
 *  4. (connected worker) execute for real      → 5. review  → 6. report status
 *
 * Honesty rules (Louie's v1):
 *  - Workers that are NOT connected NEVER "run". Their dispatch stays "waiting_connection".
 *  - Only 心燈 (Claude), the one connected worker, executes — and only KNOWLEDGE tasks
 *    (analysis / review / planning / checklists / writing). It never touches files,
 *    code, or production. Red-line content is never sent out (→ waiting_approval).
 *  - Every status transition is persisted.
 */

const store = require('../store/store')
const { t } = require('../i18n/t')
const { workerForCapability } = require('../workers/registry')
const { checkRedLine } = require('../intake/redlinePolicy')

const STATUS_LABEL = {
  // ⛔ Thunks, not key strings — a table lookup handed to t() is a DYNAMIC key (HR-48).
  queued: () => t('dispatch.queued'),
  assigned: () => t('dispatch.assigned'),
  running: () => t('dispatch.running'),
  completed: () => t('dispatch.completed'),
  failed: () => t('dispatch.failed'),
  waiting_connection: () => t('dispatch.waitingConnection'),
  waiting_approval: () => t('dispatch.waitingApproval')
}
function statusLabel (s) { return STATUS_LABEL[s] || s }

// An unroutable capability, shaped like a worker so no caller can crash on it.
// workerForCapability returns null when NO employee declares the capability. Returning that
// null straight to callers would move the failure rather than close it: intakeService reads
// `worker.connected` unconditionally, so the fail-closed path would throw inside the intake
// pipeline. This record answers `connected:false` / `engine:null` to every existing and
// future reader, which is both true and safe.
const UNASSIGNED_WORKER = Object.freeze({
  id: null, role: null, provider: null, engine: null, connected: false, capabilities: Object.freeze([])
})

/** Create a dispatch per task; connected → queued, not-connected → waiting_connection. */
function createDispatchesForTasks (tasks, decisionId) {
  return tasks.map(t => {
    const worker = workerForCapability(t.capability)

    // NO EMPLOYEE DECLARES THIS CAPABILITY. It is not waiting for a connection — there is no
    // worker to connect — so 'waiting_connection' would be a lie that reads as 'coming later'.
    // 'failed' is the honest existing status: this work was not dispatched and will not be.
    if (!worker) {
      const failed = store.createDispatch({
        task_id: t.id, decision_id: decisionId, capability: t.capability || null,
        worker_id: null, worker_name: null, worker_role: null, status: 'failed'
      })
      // createDispatch has a fixed shape and always writes error:null, so the REASON is
      // recorded here. A 'failed' with no reason repeats the original defect's real harm:
      // the record not saying that the capability was unmatched.
      //
      // `status` is re-stated deliberately. It is already 'failed' above — created that way so
      // the dispatch is never executable for an instant — but updateDispatch only emits the
      // 'dispatch.failed' EVENT when a status is present in the patch, and a refusal that
      // never reaches the event stream is a refusal nobody can observe.
      const withReason = store.updateDispatch(failed.id, {
        status: 'failed',
        error: 'no_employee_declares_capability: ' + (t.capability || '(absent)')
      })
      return { dispatch: withReason || failed, task: t, worker: UNASSIGNED_WORKER }
    }

    const status = worker.connected ? 'queued' : 'waiting_connection'
    const d = store.createDispatch({
      task_id: t.id, decision_id: decisionId, capability: t.capability || 'ops',
      worker_id: worker.id, worker_name: worker.provider, worker_role: worker.role, status
    })
    return { dispatch: d, task: t, worker }
  })
}

/** Execute one dispatch with the connected knowledge worker (心燈/Claude). Real, not simulated. */
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
    store.updateDispatch(dispatchId, { status: 'waiting_approval', error: t('dispatch.sensitiveHeld') })
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
