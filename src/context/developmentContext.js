'use strict'
const { SHA, REPOSITORY } = require('./githubContext')
const copy = value => JSON.parse(JSON.stringify(value))
function isDevelopmentRequest (message) {
  if (typeof message !== 'string') return false
  const value = message.trim().replace(/[。！!？?]+$/, '').trim()
  return /^(?:香香[，,\s]*)?(?:請|幫我)?(?:查看|查詢)?(?:現在|目前)(?:香香)?(?:的)?開發(?:進度(?:怎樣|如何)?|到哪)(?:裡|裏)?$/u.test(value) || /^(?:please )?(?:show )?(?:xiangxiang )?development progress$/i.test(value)
}
function testState (checks, statuses) {
  if ([checks, statuses].some(p => p?.state !== 'ok')) return 'unavailable'
  const rows = [...checks.content, ...statuses.content]
  if (!rows.length) return 'not_published'
  if (rows.some(r => ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'].includes(r.fields?.conclusion) || ['failure', 'error'].includes(r.fields?.status))) return 'failed'
  if (rows.some(r => !['completed', 'success'].includes(r.fields?.status))) return 'pending'
  if ([checks, statuses].some(p => p.coverage?.complete !== true) || rows.some(r => r.fields?.status === 'completed' && r.fields?.conclusion !== 'success')) return 'incomplete'
  return 'published_success'
}
function createDevelopmentContext ({ gateway, repository, runtime, clock = () => new Date().toISOString(), cacheMs = 300000, enabled = () => true }) {
  let cache = null, active = null
  async function retrieve (actor) {
    const metadata = await gateway.readMetadata(actor, 'github.repository')
    if (metadata.state !== 'ok' || !metadata.content[0]?.fields.defaultBranch) return { state: 'unavailable', metadata, packs: [metadata], remoteCommit: null, branch: null, tests: { state: 'unavailable', sha: null } }
    const branch = metadata.content[0].fields.defaultBranch
    const commits = await gateway.list(actor, 'github.commits', { branch })
    const sha = commits.state === 'ok' ? commits.content[0]?.fields.sha : null
    const prs = await gateway.list(actor, 'github.pull_requests', { branch })
    let checks, statuses
    if (SHA.test(sha || '')) [checks, statuses] = await Promise.all([gateway.list(actor, 'github.checks', { sha }), gateway.list(actor, 'github.statuses', { sha })])
    const packs = [metadata, commits, prs, checks, statuses].filter(Boolean)
    return { state: packs.length === 5 && packs.every(p => p.state === 'ok') ? 'ok' : 'partial', branch, remoteCommit: SHA.test(sha || '') ? sha : null,
      packs, tests: { state: testState(checks, statuses), sha: SHA.test(sha || '') ? sha : null },
      counts: { commits: commits.count, pullRequests: prs.count, checks: checks?.count ?? null, statuses: statuses?.count ?? null } }
  }
  async function read (actor) {
    if (!actor || actor.role !== 'owner') throw Error('permission_denied')
    if (!enabled()) throw Error('read_access_disabled')
    const now = Date.parse(clock())
    const cached = !!cache && now - cache.at >= 0 && now - cache.at < cacheMs
    if (!cached && !active) {
      active = retrieve(actor).then(result => { cache = { at: Date.parse(clock()), retrievedAt: clock(), result }; return result }).finally(() => { active = null })
    }
    const result = cached ? cache.result : await active
    if (!enabled()) throw Error('read_access_disabled')
    const local = runtime()
    const deployedCommit = SHA.test(local?.deployedCommit || '') ? local.deployedCommit : null
    const bootCommit = SHA.test(local?.bootCommit || '') ? local.bootCommit : null
    return { version: 1, repository, checkedAt: clock(), retrievedAt: cache.retrievedAt, cached, cacheMaxAgeSeconds: cacheMs / 1000,
      ...copy(result), modelCalls: 0, runtime: { deployedCommit, bootCommit, bootedAt: local?.bootedAt || null,
        restartRequired: deployedCommit && bootCommit ? deployedCommit !== bootCommit : null,
        remoteMatchesDeployed: result.remoteCommit && deployedCommit ? result.remoteCommit === deployedCommit : null } }
  }
  return Object.freeze({ read, capabilities: () => gateway.describe ? gateway.describe() : [] })
}
function createRuntimeDevelopmentContext ({ env = process.env, runtime } = {}) {
  const { createReadConnector } = require('./readConnector')
  const { createToolGateway } = require('./toolGateway')
  const { createActivityStore } = require('../core/operating/activityStore')
  const path = require('node:path')
  const repository = REPOSITORY.test(env.GITHUB_READ_REPO || '') ? env.GITHUB_READ_REPO : null
  const connector = createReadConnector({ env, caps: { timeoutMs: 10000, maxResults: 20 } })
  const resources = repository ? require('./githubContext').githubResources(repository) : []
  if (repository) connector.register(require('./githubContext').createGithubContextAdapter({ repository }))
  const audit = createActivityStore({ dir: path.join(require('../store/dataDir').resolveDataDir(), 'context-activity'), workflow: 'development_context', reason: 'owner_requested_context' })
  const gateway = createToolGateway({ connector, resources, audit })
  const service = createDevelopmentContext({ gateway, repository, runtime, enabled: () => require('./flags').readAccessEnabled(env, 'github') })
  return Object.freeze({ ...service, activity: () => audit.list() })
}
module.exports = { createDevelopmentContext, createRuntimeDevelopmentContext, isDevelopmentRequest, testState }
