'use strict'
const { makeContextResult } = require('./contextResult')
const { createGithubReadClient } = require('./adapters/githubRead')
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SHA = /^[a-f0-9]{40}$/
const ROUTES = Object.freeze({ metadata: 'GET /repos/{owner}/{repo}', commits: 'GET /repos/{owner}/{repo}/commits',
  commit: 'GET /repos/{owner}/{repo}/commits/{ref}', pulls: 'GET /repos/{owner}/{repo}/pulls',
  checks: 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs', statuses: 'GET /repos/{owner}/{repo}/commits/{ref}/status',
  search: 'GET /search/issues' })
function exact (input, keys) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) throw Error('invalid_request') }
function revision (input) { exact(input, ['sha']); if (!SHA.test(input.sha || '')) throw Error('invalid_request'); return input.sha }
function branch (input) { exact(input, ['branch']); if (typeof input.branch !== 'string' || !input.branch || input.branch.length > 200 || /[\x00-\x20]/.test(input.branch)) throw Error('invalid_request'); return input.branch }
function query (input) { exact(input, ['query']); if (typeof input.query !== 'string' || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(input.query) || !input.query.trim()) throw Error('invalid_request'); return input.query.trim() }
function createGithubContextAdapter ({ repository, client, clock = () => new Date().toISOString() }) {
  if (!REPOSITORY.test(repository || '')) throw Error('repository_not_configured')
  const [owner, repo] = repository.split('/'), root = 'https://github.com/' + repository
  // This context lane has no credential argument. An injected client is for tests;
  // the live client is anonymous even when an Owner PAT exists elsewhere.
  let sdk = client
  let retryAt = 0
  async function read (route, params = {}) {
    if (Date.parse(clock()) < retryAt) throw Error('source_rate_limited')
    if (!sdk) sdk = createGithubReadClient({ token: undefined })
    try { return await sdk.request(route, { owner, repo, ...params, request: { timeout: 9000 }, headers: { accept: 'application/vnd.github+json' } }) }
    catch (error) {
      const headers = error.response?.headers || {}
      if (error.status === 429 || (error.status === 403 && (headers['x-ratelimit-remaining'] === '0' || headers['retry-after']))) {
        const reset = /^\d+$/.test(headers['x-ratelimit-reset'] || '') ? Number(headers['x-ratelimit-reset']) * 1000 : 0
        const delay = /^\d+$/.test(headers['retry-after'] || '') ? Number(headers['retry-after']) * 1000 : 60000
        retryAt = Math.max(Number.isFinite(reset) ? reset : 0, Date.parse(clock()) + (Number.isFinite(delay) ? delay : 60000))
        throw Error('source_rate_limited')
      }
      throw error
    }
  }
  function row (id, title, fields, date = null, link = null, content = '') {
    return makeContextResult({ source: 'github', sourceId: String(id), title, originalDate: date, content, link, retrievedAt: clock(), fields })
  }
  function pack (response, rows, scope, { total = null, complete = null, sha = null } = {}) {
    const next = /rel="next"/.test(response.headers?.link || '')
    return { results: rows, evidence: { queryScope: { window: scope, declaredBy: 'adapter' }, sourceTotal: total,
      completeWithinScope: complete === null ? !next : complete && !next, truncated: next, revision: sha } }
  }
  function commitRow (c) {
    if (!SHA.test(c.sha || '')) throw Error('invalid_source_revision')
    return row(c.sha, c.commit?.message?.split('\n')[0] || c.sha, { sha: c.sha }, c.commit?.committer?.date || null, root + '/commit/' + c.sha, c.commit?.message || '')
  }
  function prRow (p) {
    if (!Number.isInteger(p.number) || p.number < 1 || typeof p.html_url !== 'string' || !p.html_url.startsWith(root + '/pull/')) throw Error('foreign_source')
    return row(repository + '#' + p.number, p.title, { number: p.number, state: p.state || null, headSha: p.head?.sha || null, baseBranch: p.base?.ref || null }, p.updated_at || p.created_at || null, root + '/pull/' + p.number, p.body || '')
  }
  const methods = {
    async readRepository (input = {}) {
      exact(input, []); const r = await read(ROUTES.metadata)
      if (r.data.private !== false || r.data.full_name?.toLowerCase() !== repository.toLowerCase() || typeof r.data.default_branch !== 'string') throw Error('public_scope_unconfirmed')
      return pack(r, [row(repository, repository, { defaultBranch: r.data.default_branch, public: true }, r.data.updated_at || null, root)], 'public repository metadata', { total: 1, complete: true })
    },
    async listRecentCommits (input) {
      const value = branch(input), r = await read(ROUTES.commits, { sha: value, per_page: 10, page: 1 })
      if (!Array.isArray(r.data)) throw Error('invalid_source')
      return pack(r, r.data.map(commitRow), 'latest 10 commits on ' + value, { sha: r.data[0]?.sha || null })
    },
    async getCommit (input) {
      const sha = revision(input), r = await read(ROUTES.commit, { ref: sha })
      if (r.data.sha !== sha) throw Error('foreign_source_revision')
      return pack(r, [commitRow(r.data)], 'commit ' + sha, { total: 1, complete: true, sha })
    },
    async listRecentPullRequests (input) {
      const value = branch(input), r = await read(ROUTES.pulls, { state: 'all', base: value, sort: 'updated', direction: 'desc', per_page: 10, page: 1 })
      if (!Array.isArray(r.data)) throw Error('invalid_source')
      return pack(r, r.data.map(prRow), 'latest 10 pull requests targeting ' + value)
    },
    async searchPullRequests (input) {
      const value = query(input), r = await read(ROUTES.search, { q: 'repo:' + repository + ' is:pr in:title "' + value + '"', per_page: 10, page: 1 })
      if (!Array.isArray(r.data.items) || !Number.isInteger(r.data.total_count)) throw Error('invalid_source')
      const rows = r.data.items.map(prRow)
      return pack(r, rows, 'pull request title search within ' + repository, { total: r.data.total_count, complete: r.data.incomplete_results === false && rows.length === r.data.total_count })
    },
    async listCheckRuns (input) {
      const sha = revision(input), r = await read(ROUTES.checks, { ref: sha, filter: 'latest', per_page: 20, page: 1 })
      if (!Array.isArray(r.data.check_runs) || !Number.isInteger(r.data.total_count)) throw Error('invalid_source')
      const rows = r.data.check_runs.map(c => {
        if (c.head_sha !== sha || !Number.isInteger(c.id)) throw Error('foreign_source_revision')
        const link = typeof c.html_url === 'string' && c.html_url.startsWith(root + '/') ? c.html_url : null
        return row(repository + ':check:' + c.id, c.name, { sha, status: c.status || null, conclusion: c.conclusion || null }, c.completed_at || c.started_at || null, link)
      })
      return pack(r, rows, 'latest check runs for commit ' + sha, { total: r.data.total_count, complete: rows.length === r.data.total_count, sha })
    },
    async readCommitStatus (input) {
      const sha = revision(input), r = await read(ROUTES.statuses, { ref: sha, per_page: 20, page: 1 })
      if (r.data.sha !== sha || !Array.isArray(r.data.statuses) || !Number.isInteger(r.data.total_count)) throw Error('foreign_source_revision')
      const rows = r.data.statuses.map(s => row(repository + ':status:' + s.id, s.context, { sha, status: s.state || null }, s.updated_at || s.created_at || null, root + '/commit/' + sha))
      return pack(r, rows, 'commit statuses for ' + sha, { total: r.data.total_count, complete: rows.length === r.data.total_count, sha })
    }
  }
  return Object.freeze({ source: 'github', methods: Object.freeze(methods), ready: () => true })
}
function githubResources (repository) {
  if (!REPOSITORY.test(repository || '')) throw Error('repository_not_configured')
  const resource = (id, operations) => ({ id: 'github.' + id, source: 'github', scope: repository, link: 'https://github.com/' + repository, sensitivity: 'public', operations,
    validateRow: row => !row.link || row.link === 'https://github.com/' + repository || row.link.startsWith('https://github.com/' + repository + '/') })
  const pass = (check, keys) => input => { check(input); return Object.fromEntries(keys.map(k => [k, input[k]])) }
  return [resource('repository', { readMetadata: { method: 'readRepository', params: input => { exact(input, []); return {} } } }),
    resource('commits', { list: { method: 'listRecentCommits', params: pass(branch, ['branch']) }, get: { method: 'getCommit', params: pass(revision, ['sha']) } }),
    resource('pull_requests', { list: { method: 'listRecentPullRequests', params: pass(branch, ['branch']) }, search: { method: 'searchPullRequests', params: pass(query, ['query']) } }),
    resource('checks', { list: { method: 'listCheckRuns', params: pass(revision, ['sha']) } }),
    resource('statuses', { list: { method: 'readCommitStatus', params: pass(revision, ['sha']) } })]
}
module.exports = { createGithubContextAdapter, githubResources, REPOSITORY, SHA }
