'use strict'
const { authorize } = require('./registry')
const clip = (v, n = 500) => typeof v === 'string' ? v.slice(0, n) : null
function safeLink (value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null } catch (_) { return null }
}
function rowView (row) {
  return { id: clip(row.sourceId || row.id, 160), title: clip(row.title), text: clip(row.content, 1000),
    date: clip(row.originalDate, 100), link: safeLink(row.link), approvalBy: clip(row.approvalBy, 100),
    approvedAt: clip(row.approvedAt, 100), memoryType: clip(row.memoryType, 40), taskState: clip(row.taskState, 40) }
}

// The local engine is an adapter, so another memory engine can implement recall()
// without changing workflows. Recall is explicitly advisory and cannot answer truth reads.
function createMemoryGateway ({ listDecisions, engine } = {}) {
  if (engine) return { engine: engine.engine, recall: query => engine.recall(query), retain: (id, text) => engine.retain(id, text), forget: id => engine.forget(id), list: () => engine.list() }
  return { engine: 'local_decisions', async recall () {
    if (typeof listDecisions !== 'function') throw Error('memory_not_connected')
    const records = await listDecisions()
    if (!Array.isArray(records)) throw Error('invalid_memory_result')
    return records.slice().reverse().slice(0, 10).map(r => ({ id: r.id, title: r.statement,
      content: r.rationale, originalDate: r.provenance && r.provenance.decided_at,
      approvalBy: r.provenance && r.provenance.approved_by }))
  } }
}

function createGateway ({ connector, connection, memory, tasks, proposals, clock = () => new Date().toISOString() } = {}) {
  async function read (actor, toolId, requestedLayer) {
    const permission = authorize(actor, toolId, requestedLayer)
    if (!permission.allowed) throw Error(permission.reason)
    const tool = permission.tool
    const checkedAt = clock()
    const base = { tool: tool.id, agent: tool.agent, source: tool.source, layer: tool.layer, domain: tool.domain, checkedAt, model: null, approval: tool.approval }
    try {
      let response
      if (toolId === 'memory.decisions') {
        response = { results: await memory.recall(), evidence: { completeWithinScope: false } }
      } else if (toolId === 'local.tasks') {
        const all = await tasks()
        if (!Array.isArray(all)) throw Error('invalid_tasks')
        response = { results: all.filter(r => r.state === 'todo').map(r => ({ id: r.id, title: r.title, content: r.note, originalDate: r.created_at })), evidence: { completeWithinScope: true } }
      } else if (toolId === 'local.approvals') {
        const all = await proposals()
        if (!Array.isArray(all)) throw Error('invalid_proposals')
        response = { results: all.filter(r => r.status === 'pending').map(r => ({ id: r.id, title: r.task, content: r.status, originalDate: r.createdAt, link: '/demo' })), evidence: { completeWithinScope: true } }
      } else {
        const status = connection ? await connection(tool.source) : null
        if (status && status.registered === false) {
          const reasons = ['master_disabled', 'source_disabled', 'credential_missing', 'governance_disabled', 'not_implemented', 'registration_failed']
          return { ...base, state: 'unavailable', availability: 'not_connected', reason: reasons.includes(status.reason) ? status.reason : 'registration_failed',
            count: null, rows: null, shownCount: null, complete: null, truncated: null, dataAsOf: null, scope: null, sourceTotal: null }
        }
        const params = toolId === 'calendar.agenda'
          ? { timeMin: checkedAt, timeMax: new Date(Date.parse(checkedAt) + 86400000).toISOString(), maxResults: 25 }
          : toolId === 'drive.documents' ? { pageSize: 10, orderBy: 'modifiedTime desc' } : {}
        response = await connector.read(tool.source, tool.method, params)
      }
      if (!response || response.trust === 'unavailable' || !Array.isArray(response.results) || response.results.some(r => !r || r.trust === 'unavailable')) throw Error('source_unavailable')
      const evidence = response.evidence || {}
      const count = response.results.length
      const rows = response.results.slice(0, 10).map(rowView)
      return { ...base, state: 'ok', availability: 'connected', reason: null, count, rows, shownCount: rows.length,
        complete: evidence.completeWithinScope === true && !response.truncatedCount && evidence.truncated !== true,
        truncated: (response.truncatedCount || 0) > 0 || evidence.truncated === true || count > rows.length,
        dataAsOf: clip(evidence.dataAsOf, 100), scope: evidence.queryScope && clip(evidence.queryScope.window, 200),
        scopeDeclaredBy: evidence.queryScope && clip(evidence.queryScope.declaredBy, 40),
        sourceTotal: Number.isFinite(evidence.sourceTotal) ? evidence.sourceTotal : null }
    } catch (_) {
      return { ...base, state: 'unavailable', availability: 'read_failed', reason: 'read_failed', count: null, rows: null, shownCount: null, complete: null,
        truncated: null, dataAsOf: null, scope: null, sourceTotal: null }
    }
  }
  return { read }
}
module.exports = { createGateway, createMemoryGateway, safeLink }
