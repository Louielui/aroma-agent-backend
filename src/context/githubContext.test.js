'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
let api = {}; try { api = require('./githubContext') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
const sha = 'a'.repeat(40)
const at = '2026-10-01T18:00:00.000Z'
const repo = 'owner/repo'
function client (calls, change = {}) { return { request: async (route, args) => {
  calls.push({ route, args })
  const data = route.endsWith('/check-runs') ? { total_count: 1, check_runs: [{ id: 2, name: 'test', head_sha: sha, status: 'completed', conclusion: 'success', completed_at: at, html_url: 'https://github.com/owner/repo/actions/runs/2' }] }
    : route.endsWith('/status') ? { sha, total_count: 0, state: 'pending', statuses: [] }
      : route.includes('/search/') ? { total_count: 1, incomplete_results: false, items: [{ number: 1, title: 'Memory', html_url: 'https://github.com/owner/repo/pull/1', created_at: at }] }
        : route.endsWith('/pulls') ? [{ number: 1, title: 'Memory', html_url: 'https://github.com/owner/repo/pull/1', created_at: at, head: { sha }, base: { ref: 'main' } }]
          : route.includes('/commits') ? (route.endsWith('/{ref}') ? { sha, commit: { message: 'Latest', committer: { date: at } }, html_url: 'https://github.com/owner/repo/commit/' + sha } : [{ sha, commit: { message: 'Latest', committer: { date: at } }, html_url: 'https://github.com/owner/repo/commit/' + sha }])
            : { full_name: repo, private: false, default_branch: 'main', html_url: 'https://github.com/owner/repo', ...change }
  return { data, headers: {} }
} } }
test('GitHub context performs only closed GET routes against the fixed public repo', async () => {
  const calls = []; const adapter = api.createGithubContextAdapter({ repository: repo, client: client(calls), clock: () => at })
  const meta = await adapter.methods.readRepository({}); assert.equal(meta.results[0].fields.defaultBranch, 'main')
  assert.equal((await adapter.methods.listRecentCommits({ branch: 'main' })).results[0].sourceId, sha)
  await adapter.methods.listRecentPullRequests({ branch: 'main' })
  await adapter.methods.listCheckRuns({ sha }); await adapter.methods.readCommitStatus({ sha })
  await adapter.methods.getCommit({ sha }); await adapter.methods.searchPullRequests({ query: 'Memory' })
  assert.equal(calls.length, 7)
  assert.equal(calls.length, Object.keys(adapter.methods).length)
  assert.ok(calls.every(c => c.route.startsWith('GET ')))
  assert.ok(calls.every(c => c.args.owner === 'owner' && c.args.repo === 'repo'))
  assert.doesNotMatch(JSON.stringify(calls), /Authorization|token|password|SECRET/)
  assert.match(calls.at(-1).args.q, /repo:owner\/repo is:pr in:title "Memory"/)
})
test('provider rate-limit reset is respected without another network call', async () => {
  let calls = 0, time = Date.parse(at)
  const adapter = api.createGithubContextAdapter({ repository: repo, clock: () => new Date(time).toISOString(), client: { request: async () => {
    calls++
    const error = Error('provider'); error.status = 403; error.response = { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((time + 3600000) / 1000) } }; throw error
  } } })
  await assert.rejects(adapter.methods.readRepository({}), /source_rate_limited/)
  time += 300000
  await assert.rejects(adapter.methods.readRepository({}), /source_rate_limited/)
  assert.equal(calls, 1)
})
test('private repository, foreign hash and query syntax are refused before exposing data', async () => {
  const calls = []
  const privateAdapter = api.createGithubContextAdapter({ repository: repo, client: client(calls, { private: true }) })
  await assert.rejects(privateAdapter.methods.readRepository({}), /public_scope_unconfirmed/)
  await assert.rejects(privateAdapter.methods.readCommitStatus({ sha: 'HEAD' }), /invalid_request/)
  await assert.rejects(privateAdapter.methods.searchPullRequests({ query: 'repo:other/private OR all' }), /invalid_request/)
  assert.equal(calls.length, 1)
})
test('checks preserve the inspected SHA and measured empty statuses are not successful tests', async () => {
  const adapter = api.createGithubContextAdapter({ repository: repo, client: client([]), clock: () => at })
  const checks = await adapter.methods.listCheckRuns({ sha })
  assert.equal(checks.results[0].fields.sha, sha); assert.equal(checks.evidence.sourceTotal, 1)
  const statuses = await adapter.methods.readCommitStatus({ sha })
  assert.deepEqual(statuses.results, []); assert.equal(statuses.evidence.sourceTotal, 0)
  assert.equal(statuses.evidence.completeWithinScope, true)
})
