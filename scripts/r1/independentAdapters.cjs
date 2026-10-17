'use strict'
// Closed synthetic adapters. No transport, connector or executable can be supplied by a request.
const fs = require('node:fs'), path = require('node:path')
function createSyntheticAdapters() {
  const calls = [], modelCalls = []
  const request = async (route, input) => {
    let result = {}
    if (route === '/complete') {
      if (input.system.startsWith('Select one relevant advertised SEARCH')) result = { id: null, evidence: null }
      else if (input.system.startsWith('You are an independent evidence paraphrase')) {
        const data = JSON.parse(input.prompt.split('\nDATA:\n')[1].split('\nOUTPUT_SCHEMA:')[0])
        result = { reviews: data.claims.map(c => ({ id: c.claim.id, decision: 'supported', reason: 'matches_reference' })) }
      } else if (input.system.includes('Synthesize a useful')) {
        const catalog = JSON.parse(input.prompt).catalog
        result = { claims: catalog.sections.flatMap(s => s.records.slice(0, 1).map((r, i) => ({ id: 'c' + (catalog.sections.indexOf(s) + i + 1),
          text: r.fields.content, kind: 'observation', evidenceState: 'supported', temporalScope: 'historical',
          references: [{ sourceId: s.sourceId, recordId: r.recordId, field: 'content', value: r.fields.content }] }))) }
      } else result = { kind: 'read', outcome: 'Summarize the synthetic tea record', capability: null,
        tools: [{ id: 'drive.company_files.search', arguments: { query: 'tea' } }], dependency: { from: 0, id: 'drive.company_files.get', result: 'sourceId' } }
    } else if (route !== '/status') throw Error('offline_model_route_unavailable')
    const response = { model: input.model, billing: 'chatgpt-subscription', text: JSON.stringify(result), stopReason: 'end_turn', actualModel: 'synthetic_fixture' }
    modelCalls.push({ route, input: structuredClone(input), response, execution: 'simulated_model', billingIdentity: 'not_verified' })
    return response
  }
  const createContext = ({ registry, audit, roots }) => {
    const source = registry.snapshot({ readOnly: true }).sources.find(s => s.id === 'company-drive')
    if (!source || source.rootId !== 'synthetic_root' || source.driveId !== source.rootId) throw Error('synthetic_source_required')
    const scope = require('../../src/context/driveScope').createOwnerDriveScope({ registry,
      env: { READ_ACCESS: 'on', CONTEXT_DRIVE: 'on' }, credentials: () => ({ client: true, token: true, revision: 'synthetic-no-credentials' }) })
    const resources = require('../../src/context/driveContext').driveResources(source)
    const connector = require('../../src/context/readConnector').createReadConnector({ env: { READ_ACCESS: 'on', CONTEXT_DRIVE: 'on' } })
    const methods = {}
    for (const resource of resources) for (const [operation, spec] of Object.entries(resource.operations)) methods[spec.method] = async input => {
      calls.push({ operation, input: structuredClone(input), execution: 'synthetic_source_adapter' })
      const file = path.join(roots.config, 'synthetic-source.json'), s = fs.lstatSync(file)
      if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 10000) throw Error('synthetic_source_invalid')
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (data.mode !== 'synthetic_fixture' || data.sourceId !== 'synthetic_tea' || typeof data.content !== 'string') throw Error('synthetic_source_invalid')
      const selected = operation === 'get' ? input.fileId === data.sourceId : operation === 'search' ? /tea/i.test(input.query) : false
      return { results: selected ? [require('../../src/context/contextResult').makeContextResult({ source: 'drive', sourceId: data.sourceId,
        title: 'Synthetic tea record', link: 'https://drive.google.com/file/d/' + data.sourceId + '/view',
        content: operation === 'get' ? data.content : 'Synthetic tea discovery record', fields: { contentState: operation === 'get' ? 'text' : 'metadata_only', synthetic: true } })] : [],
        evidence: { completeWithinScope: true, truncated: false, provenance: 'synthetic_disposable_fixture' } }
    }
    connector.register({ source: 'drive', methods })
    const gateway = require('../../src/context/toolGateway').createToolGateway({ connector, resources, audit })
    return { drive: require('../../src/context/driveContextService').createDriveContextService({ scope, gateway }) }
  }

  return { calls, modelCalls, request, createContext }
}
module.exports = { createSyntheticAdapters }

