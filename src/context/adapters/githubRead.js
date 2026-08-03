'use strict'

/**
 * githubRead.js — READ-ONLY GitHub adapter (@octokit/rest). Only list/get read
 * methods; NO create/update/merge/delete surface exists. The token is a read-only
 * PAT from env (GITHUB_READ_TOKEN); if absent the adapter is not ready and every
 * call fails-closed to trust:'unavailable' (never blocks startup). `@octokit/rest`
 * is lazy-required so the module loads before the dep is installed / in tests.
 */

const { makeContextResult, ENTITY_TYPES } = require('../contextResult')

function loadOctokit () { return require('@octokit/rest').Octokit } // lazy — only when live

/** Build a real read-only Octokit client from a PAT. Live use only. */
function createGithubReadClient ({ token }) {
  const Octokit = loadOctokit()
  return new Octokit({ auth: token })
}

/**
 * @param {{ client?, token?, clock? }} options
 *   client — an injected Octokit (fake in tests). If absent and a token is given a
 *   real client is built lazily. If neither, the adapter is not ready.
 */
function createGithubReadAdapter (options = {}) {
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  let client = options.client || null
  function ensure () {
    if (client) return client
    if (options.token) { client = createGithubReadClient({ token: options.token }); return client }
    throw new Error('github client unavailable (no read token configured)')
  }

  const methods = {
    async listPullRequests ({ owner, repo, state = 'open', per_page = 25 } = {}) {
      const r = await ensure().pulls.list({ owner, repo, state, per_page })
      return (r.data || []).map((pr) => makeContextResult({ source: 'github', sourceId: `${owner}/${repo}#${pr.number}`, title: pr.title, originalDate: pr.created_at, content: pr.body || '', link: pr.html_url, retrievedAt: now(), entityType: ENTITY_TYPES.PULL_REQUEST, fields: { number: pr.number, state: pr.state || null, createdAt: pr.created_at || null } }))
    },
    async getPullRequest ({ owner, repo, number } = {}) {
      const r = await ensure().pulls.get({ owner, repo, pull_number: number })
      const pr = r.data
      return makeContextResult({ source: 'github', sourceId: `${owner}/${repo}#${pr.number}`, title: pr.title, originalDate: pr.created_at, content: pr.body || '', link: pr.html_url, retrievedAt: now(), entityType: ENTITY_TYPES.PULL_REQUEST, fields: { number: pr.number, state: pr.state || null, createdAt: pr.created_at || null } })
    },
    async listBranches ({ owner, repo, per_page = 25 } = {}) {
      const r = await ensure().repos.listBranches({ owner, repo, per_page })
      return (r.data || []).map((b) => makeContextResult({ source: 'github', sourceId: `${owner}/${repo}@${b.name}`, title: b.name, content: (b.commit && b.commit.sha) || '', link: null, retrievedAt: now(), entityType: 'branch', fields: { name: b.name } }))
    },
    async listCommits ({ owner, repo, sha, per_page = 25 } = {}) {
      const r = await ensure().repos.listCommits({ owner, repo, sha, per_page })
      return (r.data || []).map((c) => makeContextResult({ source: 'github', sourceId: c.sha, title: (c.commit && c.commit.message ? c.commit.message.split('\n')[0] : c.sha), originalDate: c.commit && c.commit.author ? c.commit.author.date : null, content: (c.commit && c.commit.message) || '', link: c.html_url, retrievedAt: now(), entityType: ENTITY_TYPES.COMMIT, fields: { sha: c.sha, authoredAt: (c.commit && c.commit.author ? c.commit.author.date : null) } }))
    },
    async getFileAtRef ({ owner, repo, path, ref } = {}) {
      const r = await ensure().repos.getContent({ owner, repo, path, ref })
      const d = r.data
      const content = d && d.content ? Buffer.from(d.content, 'base64').toString('utf8') : ''
      return makeContextResult({ source: 'github', sourceId: `${owner}/${repo}:${path}@${ref || 'HEAD'}`, title: path, content, link: (d && d.html_url) || null, retrievedAt: now(), entityType: 'file_content', fields: { path } })
    }
  }

  return { source: 'github', methods, ready: () => !!(client || options.token) }
}

module.exports = { createGithubReadAdapter, createGithubReadClient }
