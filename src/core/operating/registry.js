'use strict'

// Roles, providers and tools are separate contracts. Only declared read tools are
// routable in this first workflow; this registry grants no execution authority.
const TOOLS = Object.freeze([
  { id: 'aroma.replenishment', agent: 'purchasing', source: 'aroma_system', method: 'listOrderPlanning', layer: 'truth', domain: 'business' },
  { id: 'aroma.invoices', agent: 'accounting', source: 'aroma_system', method: 'listInvoices', layer: 'truth', domain: 'business' },
  { id: 'calendar.agenda', agent: 'calendar', source: 'calendar', method: 'listEvents', layer: 'truth', domain: 'calendar' },
  { id: 'drive.documents', agent: 'knowledge', source: 'drive', method: 'listFiles', layer: 'knowledge', domain: 'documents' },
  { id: 'local.tasks', agent: 'coordinator', source: 'xiangxiang', method: null, layer: 'truth', domain: 'workflow' },
  { id: 'local.approvals', agent: 'coordinator', source: 'xiangxiang', method: null, layer: 'truth', domain: 'workflow' },
  { id: 'memory.decisions', agent: 'memory', source: 'local_decisions', method: null, layer: 'memory', domain: 'experience' }
].map(t => Object.freeze({ ...t, action: 'read', approval: 'not_required' })))

function authorize (actor, toolId, requestedLayer) {
  const tool = TOOLS.find(t => t.id === toolId)
  if (!actor || actor.role !== 'owner') return { allowed: false, reason: 'permission_denied' }
  if (!tool) return { allowed: false, reason: 'tool_not_registered' }
  if (requestedLayer && tool.layer !== requestedLayer) return { allowed: false, reason: 'layer_mismatch' }
  return { allowed: true, tool }
}

function registryView () {
  const roles = [...new Set(TOOLS.map(t => t.agent))].map(id => ({ id, engine: 'deterministic', model: null, tools: TOOLS.filter(t => t.agent === id).map(t => t.id) }))
  return { version: 1, workflow: 'daily_briefing', agents: roles, tools: TOOLS,
    integrations: [
      { id: 'hindsight', state: 'not_connected' }, { id: 'memory_postgresql', state: 'not_connected' },
      { id: 'memory_pgvector', state: 'not_connected' },
      { id: 'qbo', state: 'not_connected' }, { id: '7shifts', state: 'not_connected' },
      { id: 'business_write', state: 'not_enabled' }
    ] }
}
module.exports = { TOOLS, authorize, registryView }
