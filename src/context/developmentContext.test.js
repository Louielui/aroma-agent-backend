'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
let api = {}; try { api = require('./developmentContext') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
const OWNER = { id: 'owner', role: 'owner' }
const remote = 'a'.repeat(40), deployed = 'b'.repeat(40), running = 'c'.repeat(40)
const at = '2026-10-01T18:00:00.000Z'
function fixture () {
  let reads = 0
  const pack = (resource, content, total = content.length) => ({ resource, source: 'github', sourceId: 'owner/repo', state: 'ok', count: content.length, content, retrievedAt: at, coverage: { complete: true, truncated: false, sourceTotal: total } })
  const gateway = {
    readMetadata: async () => { reads++; return pack('github.repository', [{ fields: { defaultBranch: 'main' } }]) },
    list: async (actor, resource) => { reads++; return pack(resource, resource === 'github.commits' ? [{ sourceId: remote, title: 'Latest', fields: { sha: remote }, link: 'https://github.com/owner/repo/commit/' + remote }] : []) }
  }
  const service = api.createDevelopmentContext({ gateway, repository: 'owner/repo', runtime: () => ({ deployedCommit: deployed, bootCommit: running, bootedAt: at }), clock: () => at, cacheMs: 300000 })
  return { service, reads: () => reads }
}
test('development report separates remote, deployed and running commits and empty test coverage', async () => {
  const { service } = fixture(); const result = await service.read(OWNER)
  assert.equal(result.repository, 'owner/repo'); assert.equal(result.remoteCommit, remote)
  assert.equal(result.runtime.deployedCommit, deployed); assert.equal(result.runtime.bootCommit, running)
  assert.equal(result.runtime.restartRequired, true); assert.equal(result.tests.state, 'not_published')
  assert.equal(result.modelCalls, 0); assert.equal(result.tests.sha, remote)
})
test('repeated and overlapping requests share source reads but refresh local running evidence', async () => {
  const { service, reads } = fixture()
  const [a,b] = await Promise.all([service.read(OWNER), service.read(OWNER)])
  assert.equal(a.remoteCommit, b.remoteCommit); assert.equal(reads(), 5)
  const cached = await service.read(OWNER); assert.equal(cached.cached, true); assert.equal(reads(), 5)
  await assert.rejects(service.read({ role: 'staff' }), /permission_denied/); assert.equal(reads(), 5)
})
test('explicit progress intent excludes negation, quotations, business scope and execution', () => {
  for (const message of ['香香，現在開發進度怎樣？','目前香香開發到哪？','show development progress']) assert.equal(api.isDevelopmentRequest(message), true, message)
  for (const message of ['不要查開發進度','如果我說「現在開發進度怎樣」','Aroma System 現在開發到哪？','現在開發進度怎樣，然後部署','幫我改 GitHub']) assert.equal(api.isDevelopmentRequest(message), false, message)
})
test('worker evidence refresh bypasses the UI cache twice and exposes a current access check', async () => {
  const { service, reads } = fixture()
  await service.read(OWNER); await service.read(OWNER)
  assert.equal(reads(), 5)
  assert.equal((await service.read(OWNER, { refresh: true })).cached, false); assert.equal(reads(), 10)
  await service.read(OWNER, { refresh: true }); assert.equal(reads(), 15)
  assert.equal(typeof service.verify, 'function'); assert.throws(() => service.verify({ role: 'staff' }), /permission_denied/)
})
test('disabling a source blocks cached results and a late in-flight result', async () => {
  let enabled = true, reads = 0, finish
  const gateway = { readMetadata: () => { reads++; return new Promise(resolve => { finish = resolve }) } }
  const service = api.createDevelopmentContext({ gateway, repository: 'owner/repo', enabled: () => enabled, runtime: () => ({}), clock: () => at })
  const pending = service.read(OWNER); enabled = false
  finish({ state: 'unavailable', content: null })
  await assert.rejects(pending, /read_access_disabled/)
  await assert.rejects(service.read(OWNER), /read_access_disabled/)
  assert.equal(reads, 1)
})
