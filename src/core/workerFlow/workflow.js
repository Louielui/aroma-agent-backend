'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const ACTIVE = new Set(['queued', 'checking', 'coding', 'reviewing'])
const SAFE_ERRORS = new Set(['provider_not_ready', 'subscription_login_required', 'subscription_limit_reached', 'subscription_unavailable', 'subscription_model_unavailable', 'sandbox_failed', 'scope_changed', 'baseline_not_red', 'claude_unavailable', 'claude_login_required', 'worker_timeout', 'invalid_worker_result', 'windows_sandbox_not_enabled', 'windows_restart_required', 'windows_virtualization_unavailable', 'windows_sandbox_cli_unavailable', 'windows_sandbox_unavailable', 'sandbox_unavailable', 'sandbox_stop_unconfirmed', 'acceptance_failed'])

// This first registered work order is deliberately concrete. Adding a real-repo
// recipe requires its own file scope and acceptance tests, not a browser path.
const WORK_ORDER = Object.freeze({ recipe: 'duration-v1', version: 1, capability: 'coding_then_review',
  goal: 'Implement formatDuration(seconds): finite nonnegative numbers become m:ss; floor fractional seconds; minutes may exceed 59; invalid inputs throw RangeError.',
  allowedFiles: ['duration.js'], protectedFiles: ['duration.test.js'],
  testCommand: ['node', '--test', '--test-reporter=tap', 'duration.test.js'], scope: 'offline_windows_sandbox_disposable_fixture',
  providers: ['codex', 'claude'], approval: 'owner_explicit', billing: 'subscriptions_no_api_fallback' })

function createWorkflow ({ dir, providers, enabled, onEvent = () => {} }) {
  let busy = false; let pending = Promise.resolve()
  fs.mkdirSync(dir, { recursive: true })
  const save = run => {
    const target = path.join(dir, run.id + '.json'); const temp = target + '.tmp'
    fs.writeFileSync(temp, JSON.stringify(run), { flag: 'w' }); fs.renameSync(temp, target)
  }
  const get = id => {
    if (typeof id !== 'string' || !ID.test(id)) return null
    try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }
  const list = () => fs.readdirSync(dir).filter(f => ID.test(f.slice(0, -5)) && f.endsWith('.json')).map(f => get(f.slice(0, -5))).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 10)
  for (const run of list()) if (ACTIVE.has(run.state)) { run.state = 'interrupted'; run.error = 'process_restarted'; save(run) }
  function record (run, stage, facts = {}) {
    run.events.push({ sequence: run.events.length + 1, at: new Date().toISOString(), stage, ...facts })
    save(run)
    try { onEvent({ id: run.id, stage, at: run.events[run.events.length - 1].at, state: run.state, recipe: run.workOrder.recipe, facts }) } catch (_) { /* The memory outbox reports persistence failures separately. */ }
  }
  async function execute (run, reviewOnly = false) {
    try {
      run.state = 'checking'; record(run, 'checking')
      if (!reviewOnly && providers.isolation) { const isolation = await providers.isolation(); if (!isolation.ready) throw Error(isolation.reason || 'sandbox_unavailable'); run.isolation = isolation }
      run.providers = await providers.status()
      if ((!reviewOnly && !run.providers.codex?.ready) || !run.providers.claude?.ready) throw Error('provider_not_ready')
      if (!reviewOnly) {
        run.state = 'coding'; record(run, 'coding', { provider: 'codex' })
        run.coding = await providers.code({ workOrder: run.workOrder, emit: (stage, facts) => record(run, stage, facts) })
      }
      if (!run.coding || !Number.isInteger(run.coding.tests?.exitCode) || typeof run.coding.after !== 'string') throw Error('invalid_worker_result')
      run.state = 'reviewing'; record(run, 'reviewing', { provider: 'claude' })
      run.review = await providers.review({ workOrder: run.workOrder, ...run.coding })
      if (!run.review || !['pass', 'changes_requested'].includes(run.review.verdict) || !Array.isArray(run.review.findings)) throw Error('invalid_worker_result')
      run.state = run.coding.tests.exitCode === 0 && run.review.verdict === 'pass' ? 'completed' : 'needs_attention'
      record(run, run.state)
    } catch (e) {
      run.state = 'failed'; run.error = SAFE_ERRORS.has(e.code || e.message) ? (e.code || e.message) : 'worker_unavailable'
      try { record(run, 'failed', { error: run.error }) } catch (_) { /* A failed audit write never permits another step. */ }
    } finally { busy = false }
  }
  function start (input) {
    if (!enabled()) throw Error('not_enabled')
    if (!input || Object.keys(input).some(k => !['recipe', 'approved'].includes(k)) || input.recipe !== WORK_ORDER.recipe) throw Error('invalid_work_order')
    if (input.approved !== true) throw Error('approval_required')
    if (busy) throw Error('worker_busy')
    const run = { id: randomUUID(), createdAt: new Date().toISOString(), state: 'queued', workOrder: WORK_ORDER, actor: 'owner', events: [], coding: null, review: null }
    record(run, 'approved', { actor: 'owner', recipe: WORK_ORDER.recipe })
    busy = true; pending = Promise.resolve().then(() => execute(run))
    return structuredClone(run)
  }
  function reviewAgain (input) {
    if (!enabled()) throw Error('not_enabled')
    if (!input || Object.keys(input).some(k => !['id', 'approved'].includes(k))) throw Error('invalid_work_order')
    if (input.approved !== true) throw Error('approval_required')
    if (busy) throw Error('worker_busy')
    const run = get(input.id)
    if (!run?.coding || !['failed', 'needs_attention', 'interrupted'].includes(run.state)) throw Error('invalid_work_order')
    run.state = 'queued'; delete run.error; run.review = null
    record(run, 'review_retry_approved', { actor: 'owner' })
    busy = true; pending = Promise.resolve().then(() => execute(run, true))
    return structuredClone(run)
  }
  return { start, reviewAgain, list, get, settled: () => pending, workOrder: WORK_ORDER, enabled }
}
module.exports = { createWorkflow, WORK_ORDER }
