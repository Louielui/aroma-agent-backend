'use strict'
const { randomUUID } = require('node:crypto')
const { TOOLS, authorize, registryView } = require('./registry')
const { createGateway, createMemoryGateway } = require('./gateway')
const { createActivityStore } = require('./activityStore')

const { createRunStore, createMemoryRunStore, ID } = require('./runStore')
const ACTIVE = new Set(['queued', 'running'])
const RETRYABLE = new Set(['partial', 'unavailable', 'failed', 'timed_out', 'cancelled', 'interrupted'])
function createManager ({ gateway, activity, runStore = createMemoryRunStore(), clock = () => new Date().toISOString(), stepTimeoutMs = 12000, runTimeoutMs = 60000, onFinish = () => {} }) {
  let loaded = false; let activeId = null; let lastFinishedAt = 0
  const runs = new Map(); const controls = new Map()
  const owner = actor => { if (!actor || actor.role !== 'owner' || actor.id !== 'owner') throw Error('permission_denied') }
  const copy = r => r ? structuredClone(r) : null
  function write (run, entry) {
    try { activity.append({ ...entry, runId: run.id, sequence: run.sequence++, at: clock(), actor: 'owner' }) } catch (_) { throw Error('audit_unavailable') }
    run.updatedAt = clock(); runStore.save(run); runs.set(run.id, run)
  }
  function load () {
    if (loaded) return
    for (const run of runStore.all()) {
      if (ACTIVE.has(run.state)) {
        run.state = 'interrupted'; run.reason = 'service_restarted'; run.finishedAt = clock(); run.activeTool = null
        for (const step of run.steps) if (ACTIVE.has(step.state)) step.state = 'interrupted'
        write(run, { result: 'interrupted' })
      }
      runs.set(run.id, run)
    }
    loaded = true
  }
  function get (id) {
    if (!ID.test(id || '')) throw Error('invalid_run_id'); load()
    const run = runs.get(id); if (!run) return null
    const child = [...runs.values()].find(r => r.retryOf === id)
    return { ...copy(run), retryId: child ? child.id : null }
  }
  function list () { load(); return [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100).map(r => ({ id: r.id, state: r.state, startedAt: r.startedAt, finishedAt: r.finishedAt, retryOf: r.retryOf })) }
  function finish (run, state, reason = null) {
    run.state = state; run.reason = reason; run.finishedAt = clock(); run.activeTool = null
    for (const step of run.steps) {
      if (step.state === 'running') { step.state = state; step.finishedAt = run.finishedAt }
      if (step.state === 'pending') step.state = 'not_run'
    }
    write(run, { result: state })
  }
  function boundedRead (actor, tool, signal, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false
      const end = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value) }
      const abort = () => end(Error('cancelled'))
      const timer = setTimeout(() => end(Error('timed_out')), Math.max(1, timeoutMs))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) return abort()
      // Existing adapters may finish an in-flight read. Its late result is discarded.
      Promise.resolve().then(() => gateway.read(actor, tool.id, tool.layer)).then(v => end(null, v), () => end(null, null))
    })
  }
  async function execute (run, actor, control) {
    const deadline = Date.now() + runTimeoutMs
    try {
      if (!ACTIVE.has(run.state)) return
      run.state = 'running'
      for (const [i, tool] of TOOLS.entries()) {
        if (control.abort.signal.aborted) throw Error('cancelled')
        if (Date.now() >= deadline) throw Error('timed_out')
        const step = run.steps[i]; step.state = 'running'; step.startedAt = clock(); run.activeTool = tool.id
        write(run, { agent: tool.agent, tool: tool.id, source: tool.source, layer: tool.layer, result: 'running' })
        let result = await boundedRead(actor, tool, control.abort.signal, Math.min(stepTimeoutMs, deadline - Date.now()))
        if (control.abort.signal.aborted) throw Error('cancelled')
        if (!result || !['ok', 'unavailable'].includes(result.state) || (result.state === 'ok' && (!Number.isInteger(result.count) || result.count < 0 || !Array.isArray(result.rows)))) {
          result = { state: 'unavailable', count: null, rows: null, shownCount: null, complete: null, checkedAt: clock() }
        }
        result = { ...result, tool: tool.id, agent: tool.agent, source: tool.source, layer: tool.layer }
        if (result.state === 'unavailable') result = { ...result, count: null, rows: null, shownCount: null, complete: null }
        step.state = result.state; step.count = result.count; step.finishedAt = clock(); run.sections.push(result)
        write(run, { agent: tool.agent, tool: tool.id, source: tool.source, layer: tool.layer, result: result.state, count: result.count })
      }
      finish(run, run.sections.every(s => s.state === 'ok') ? 'completed' : run.sections.every(s => s.state === 'unavailable') ? 'unavailable' : 'partial')
    } catch (e) {
      const state = ['cancelled', 'timed_out'].includes(e.message) ? e.message : 'failed'
      try { finish(run, state, state === 'failed' ? 'persistence_unavailable' : state) }
      catch (_) { run.state = 'failed'; run.reason = 'persistence_unavailable'; run.finishedAt = clock(); run.activeTool = null; runs.set(run.id, run) }
    } finally {
      try { onFinish(copy(run)) } catch (_) { /* Capture reports its own persistence state. */ }
      if (activeId === run.id) activeId = null
      lastFinishedAt = Date.now(); control.resolve(copy(run)); controls.delete(run.id)
    }
  }
  function start (actor, { requestId = randomUUID(), conversationId = null, retryOf = null } = {}) {
    owner(actor); if (!ID.test(requestId)) throw Error('invalid_request_id'); load()
    const previous = [...runs.values()].find(r => r.requestId === requestId)
    if (previous) { if (previous.conversationId !== conversationId) throw Error('request_conflict'); return { ...copy(previous), reused: true } }
    if (activeId) throw Error('briefing_busy')
    const run = { id: randomUUID(), requestId, conversationId, retryOf, workflow: 'daily_briefing', state: 'queued', reason: null,
      startedAt: clock(), updatedAt: clock(), finishedAt: null, activeTool: null, model: null, sequence: 0, sections: [],
      steps: TOOLS.map(tool => ({ tool: tool.id, source: tool.source, state: 'pending', count: null, startedAt: null, finishedAt: null })) }
    write(run, { result: 'started' })
    const control = { abort: new AbortController() }; control.done = new Promise(resolve => { control.resolve = resolve })
    controls.set(run.id, control); activeId = run.id
    setImmediate(() => execute(run, actor, control))
    return copy(run)
  }
  function cancel (actor, id) {
    owner(actor); const snapshot = get(id); if (!snapshot) throw Error('run_not_found')
    if (!ACTIVE.has(snapshot.state)) return snapshot
    const run = runs.get(id); const control = controls.get(id)
    if (!control) throw Error('run_not_active')
    control.abort.abort()
    // Final persistence is owned by execute; queued cancellation is handled here.
    if (run.state === 'queued') finish(run, 'cancelled', 'cancelled')
    return get(id)
  }
  function retry (actor, id) {
    owner(actor); const previous = get(id); if (!previous) throw Error('run_not_found')
    const child = [...runs.values()].find(r => r.retryOf === id); if (child) return copy(child)
    if (!RETRYABLE.has(previous.state)) throw Error('run_not_retryable')
    return start(actor, { conversationId: previous.conversationId, retryOf: id })
  }
  function wait (id) { const c = controls.get(id); return c ? c.done : Promise.resolve(get(id)) }
  async function briefing (actor) {
    owner(actor); if (activeId || Date.now() - lastFinishedAt < 10000) throw Error('briefing_busy')
    return wait(start(actor).id)
  }
  return { briefing, start, get, list, cancel, retry, wait, registry: registryView, activity: () => activity.list() }
}

// Wiring is lazy so viewing the page never fetches business data or starts a model.
function createRuntimeManager ({ proposalStore, env = process.env, memoryCapture } = {}) {
  const store = require('../../store/store')
  const activity = createActivityStore()
  let manager
  const memory = env.XIANGXIANG_MEMORY === 'on' && !process.env.NODE_TEST_CONTEXT
    ? require('./briefingMemory').createBriefingMemory({ gateway: require('../../memory/runtime').runtime().gateway, getRun: id => manager.get(id) })
    : createMemoryGateway({ listDecisions: store.listDecisions })
  const gateway = createGateway({
    connection: source => require('../../context/connectionState').projectConnections(env).find(r => r.key === source),
    connector: { read: async (...args) => require('../../context/liveClients').createLiveReadConnector({ env }).connector.read(...args) },
    memory, tasks: store.listTasks,
    proposals: () => { if (!proposalStore) throw Error('proposals_not_connected'); return proposalStore.listProposals() }
  })
  manager = createManager({ gateway, activity, runStore: createRunStore(), onFinish: run => memoryCapture && memoryCapture.safe(() => memoryCapture.run(run)) })
  return Object.assign(manager, { proposeMemory: (actor, id, input) => {
    if (!memory.propose) throw Error('memory_not_connected')
    return memory.propose(actor, id, input)
  } })
}
module.exports = { TOOLS, authorize, createGateway, createMemoryGateway, createManager, createRuntimeManager, createActivityStore }
