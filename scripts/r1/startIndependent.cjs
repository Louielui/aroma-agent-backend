'use strict'
// Manual synthetic-only demonstration entry. No .env, provider/connector login,
// service installation, persistent supervisor or automatic continuation.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
async function startIndependent({ root, password, cookieName, port = 0, enabled = true } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || [8081, 8090, 8091, 8888].includes(port)) throw Error('independent_port_invalid')
  // These are test adapters, not an alternate runtime framework or live clients.
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
  const instance = require('../../src/intake/independentOwner').createIndependentOwner({ root, password, cookieName, createContext, request, enabled })
  const server = http.createServer(instance.app)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { ...instance, server, calls, modelCalls, origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => {
      if (error) return reject(error)
      try { instance.releaseOwnership(); resolve() } catch (e) { reject(e) }
    })) }
}
if (require.main === module) {
  let text = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', data => { text += data; if (text.length > 8000) process.exit(2) })
  process.stdin.on('end', async () => {
    try {
      const options = JSON.parse(text), instance = await startIndependent(options)
      process.stdout.write(JSON.stringify({ event: 'ready', origin: instance.origin, mode: instance.mode, realModelInvocation: 'BLOCKED' }) + '\n')
    } catch (_) { process.stderr.write('independent_startup_refused\n'); process.exitCode = 1 }
  })
}
module.exports = { startIndependent }
