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
      { id: 'hindsight', state: 'partial', number: '10', phase: 4 },
      { id: 'memory_postgresql', state: 'foundation', number: '11', phase: 4 },
      { id: 'memory_pgvector', state: 'foundation', number: '12', phase: 4 },
      { id: 'business_write', state: 'not_enabled', phase: 5 },
      { id: 'qbo', state: 'not_connected', number: '13', phase: 6 },
      { id: '7shifts', state: 'not_connected', number: '14', phase: 6 },
      { id: 'google_business', state: 'not_connected', number: '15', phase: 6 },
      { id: 'pos', state: 'not_connected', number: '16', phase: 6 },
      { id: 'cloudflare', state: 'not_connected', number: '17', phase: 6 },
      { id: 'make', state: 'not_connected', number: '18', phase: 6 },
      { id: 'whatsapp', state: 'not_connected', number: '19', phase: 6 },
      { id: 'sms', state: 'not_connected', number: '20', phase: 6 },
      { id: 'costco', state: 'not_connected', number: '21', deferred: true },
      { id: 'wholesale_club', state: 'not_connected', number: '22', deferred: true },
      { id: 'amazon', state: 'not_connected', number: '23', deferred: true },
      { id: 'supplier_portals', state: 'not_connected', number: '24', deferred: true },
      { id: 'manus', state: 'not_connected', deferred: true },
      { id: 'grok', state: 'not_connected', deferred: true }
    ] }
}
module.exports = { TOOLS, authorize, registryView }
