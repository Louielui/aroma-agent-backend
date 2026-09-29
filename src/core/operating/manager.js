'use strict'
const { randomUUID } = require('node:crypto')
const { TOOLS, authorize, registryView } = require('./registry')
const { createGateway, createMemoryGateway } = require('./gateway')
const { createActivityStore } = require('./activityStore')

function createManager ({ gateway, activity, clock = () => new Date().toISOString() }) {
  let busy = false
  let lastFinishedAt = 0
  async function briefing (actor) {
    if (!actor || actor.role !== 'owner' || actor.id !== 'owner') throw Error('permission_denied')
    if (busy || Date.now() - lastFinishedAt < 10000) throw Error('briefing_busy')
    busy = true
    const id = randomUUID()
    const startedAt = clock()
    let sequence = 0
    const audit = entry => {
      try { activity.append({ ...entry, runId: id, sequence: sequence++, at: clock(), actor: actor.id }) }
      catch (_) { throw Error('audit_unavailable') }
    }
    try {
      audit({ result: 'started' })
      const sections = []
      for (const tool of TOOLS) {
        const result = await gateway.read(actor, tool.id, tool.layer)
        audit({ agent: tool.agent, tool: tool.id, source: tool.source, layer: tool.layer, result: result.state, count: result.count })
        sections.push(result)
      }
      const state = sections.every(s => s.state === 'ok') ? 'completed' : sections.every(s => s.state === 'unavailable') ? 'unavailable' : 'partial'
      audit({ result: state })
      lastFinishedAt = Date.now()
      return { id, workflow: 'daily_briefing', state, startedAt, finishedAt: clock(), model: null, sections }
    } finally { busy = false }
  }
  return { briefing, registry: registryView, activity: () => activity.list() }
}

// Wiring is lazy so viewing the page never fetches business data or starts a model.
function createRuntimeManager ({ proposalStore, env = process.env } = {}) {
  const store = require('../../store/store')
  const activity = createActivityStore()
  const memory = createMemoryGateway({ listDecisions: store.listDecisions })
  const gateway = createGateway({
    connector: { read: async (...args) => require('../../context/liveClients').createLiveReadConnector({ env }).connector.read(...args) },
    memory, tasks: store.listTasks,
    proposals: () => { if (!proposalStore) throw Error('proposals_not_connected'); return proposalStore.listProposals() }
  })
  return createManager({ gateway, activity })
}
module.exports = { TOOLS, authorize, createGateway, createMemoryGateway, createManager, createRuntimeManager, createActivityStore }
