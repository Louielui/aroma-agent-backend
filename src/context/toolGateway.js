'use strict'
const { randomUUID } = require('node:crypto')
const OPS = Object.freeze(['search', 'list', 'get', 'readMetadata'])
const clone = value => JSON.parse(JSON.stringify(value))
function createToolGateway ({ connector, resources, audit, clock = () => new Date().toISOString() }) {
  const registry = new Map()
  for (const resource of resources) {
    if (registry.has(resource.id) || !resource.scope || !['public', 'company', 'private'].includes(resource.sensitivity)) throw Error('invalid_resource')
    for (const [op, spec] of Object.entries(resource.operations)) {
      if (!OPS.includes(op) || !/^(read|list|get|search)[A-Z]/.test(spec.method) || typeof spec.params !== 'function') throw Error('invalid_operation')
    }
    registry.set(resource.id, Object.freeze({ ...resource, operations: Object.freeze({ ...resource.operations }) }))
  }
  function describe () { return [...registry.values()].map(r => ({ id: r.id, source: r.source, scope: r.scope, sensitivity: r.sensitivity, operations: Object.keys(r.operations) })) }
  function record (entry) { try { audit.append(entry) } catch (_) { throw Error('audit_unavailable') } }
  async function call (op, actor, resourceId, input = {}) {
    if (!actor || actor.role !== 'owner') throw Error('permission_denied')
    const resource = registry.get(resourceId)
    if (!resource) throw Error('resource_not_connected')
    const spec = resource.operations[op]
    if (!spec) throw Error('operation_not_supported')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_request')
    const params = spec.params(input)
    const runId = randomUUID(), startedAt = clock()
    const layer = resource.layer || 'truth'
    const event = { runId, at: startedAt, actor: 'owner', agent: 'context', tool: resource.id + '.' + op, source: resource.source, layer }
    record({ ...event, sequence: 1, result: 'started' })
    const base = { version: 1, source: resource.source, sourceId: resource.scope, resource: resource.id, operation: op, layer,
      retrievedAt: startedAt, originalDate: null, link: resource.link || null, sensitivity: resource.sensitivity,
      access: { role: 'owner', scope: resource.scope }, contentPolicy: 'data_only', freshness: { state: 'retrieved', sourceUpdatedAt: null } }
    let result
    try {
      const value = await connector.read(resource.source, spec.method, params)
      if (!value || value.trust === 'unavailable' || !Array.isArray(value.results) || value.results.some(row => !row || row.source !== resource.source || row.trust !== 'live' || typeof row.sourceId !== 'string' || !row.sourceId || (resource.validateRow && !resource.validateRow(row)))) throw Error('source_unavailable')
      const content = value.results.map(row => ({ source: row.source, sourceId: row.sourceId, title: row.title,
        retrievedAt: value.asOf || startedAt, originalDate: row.originalDate || null, content: row.content,
        fields: clone(row.fields || {}), link: row.link || null, trust: 'source_data', truncated: row.truncated === true,
        freshness: { state: 'retrieved', sourceUpdatedAt: row.originalDate || null } }))
      const evidence = value.evidence || {}
      const truncated = value.truncatedCount > 0 || evidence.truncated === true || content.some(row => row.truncated)
      result = { ...base, retrievedAt: value.asOf || startedAt, state: 'ok', trust: 'source_data', count: content.length, content,
        coverage: { scope: evidence.queryScope?.window || resource.scope,
          complete: typeof evidence.completeWithinScope === 'boolean' ? evidence.completeWithinScope && !truncated : null,
          truncated, sourceTotal: Number.isInteger(evidence.sourceTotal) && evidence.sourceTotal >= 0 ? evidence.sourceTotal : null,
          revision: evidence.revision || null, excluded: Number.isInteger(evidence.excludedCount) && evidence.excludedCount >= 0 ? evidence.excludedCount : null }, error: null }
    } catch (_) {
      result = { ...base, state: 'unavailable', trust: 'unavailable', freshness: { state: 'unknown', sourceUpdatedAt: null }, count: null,
        content: null, coverage: { scope: resource.scope, complete: null, truncated: null, sourceTotal: null, revision: null }, error: 'source_unavailable' }
    }
    record({ ...event, at: clock(), sequence: 2, result: result.state, count: result.count })
    return result
  }
  return Object.freeze({ describe,
    search: (actor, id, params) => call('search', actor, id, params), list: (actor, id, params) => call('list', actor, id, params),
    get: (actor, id, params) => call('get', actor, id, params), readMetadata: (actor, id, params) => call('readMetadata', actor, id, params) })
}
module.exports = { createToolGateway }
