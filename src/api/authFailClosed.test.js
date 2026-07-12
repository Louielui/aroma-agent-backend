'use strict'

/**
 * authFailClosed.test.js — B2-15. The service-token seam fails CLOSED: with no
 * configured token, privileged routes are refused (request-time 401) and the
 * production entry (index.js) refuses to start. A token for tests is provided
 * ONLY by explicit injection (createApp({ serviceToken })) — never a fallback.
 * Deterministic; no paid call, no real dispatch (flags off → confirm creates a
 * Run but schedules no worker).
 *
 *   Run: node --test src/api/authFailClosed.test.js
 */

process.env.LLM_PROVIDER = 'mock'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const { createApp } = require('../app')
const { TEST_SERVICE_TOKEN } = require('./_serviceTokenFixture')

const FORMER_STUB = 'svc-token-aroma-os' // the value that used to be accepted implicitly

async function seedProposal (built) {
  const developLlm = async () => ({ intent: 'develop', task: 'create hello.txt', targetProject: 'frontend' })
  const { proposal } = await built.locals.proposalStore.propose({ conversationId: 'c', message: 'add a field', llm: developLlm })
  return proposal.id
}

async function confirm (server, id, token) {
  const { port } = server.address()
  const headers = { 'content-type': 'application/json' }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/proposals/${id}/confirm`, { method: 'POST', headers, body: '{}' })
  return res.status
}

// Run body with HUB_TOKEN guaranteed UNSET, then restore whatever was there.
async function withUnsetHubToken (fn) {
  const saved = process.env.HUB_TOKEN
  delete process.env.HUB_TOKEN
  try { return await fn() } finally {
    if (saved === undefined) delete process.env.HUB_TOKEN
    else process.env.HUB_TOKEN = saved
  }
}

test('unset HUB_TOKEN + no injected token → privileged route 401 (NO stub fallback)', async () => {
  await withUnsetHubToken(async () => {
    const built = createApp({ dispatcher: async () => {}, proposalPersistence: false, runPersistence: false })
    const server = built.listen(0)
    try {
      const id = await seedProposal(built)
      // The FORMER stub must now be rejected — nothing is configured, so nothing passes.
      assert.equal(await confirm(server, id, FORMER_STUB), 401)
      assert.equal(await confirm(server, id, 'anything-else'), 401)
      assert.equal(await confirm(server, id, undefined), 401) // no header at all
    } finally { server.close() }
  })
})

test('explicit injected token → privileged route ACCEPTED (201)', async () => {
  const built = createApp({ serviceToken: TEST_SERVICE_TOKEN, dispatcher: async () => {}, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    const id = await seedProposal(built)
    assert.equal(await confirm(server, id, TEST_SERVICE_TOKEN), 201)
  } finally { server.close() }
})

test('the public stub is NOT special: a different configured token rejects Bearer svc-token-aroma-os', async () => {
  const built = createApp({ serviceToken: 'a-different-explicit-token', dispatcher: async () => {}, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  try {
    const id1 = await seedProposal(built)
    assert.equal(await confirm(server, id1, FORMER_STUB), 401) // stub no longer accepted
    const id2 = await seedProposal(built)
    assert.equal(await confirm(server, id2, 'a-different-explicit-token'), 201) // the configured one works
  } finally { server.close() }
})

test('read endpoints unaffected: /health and /proposals need no token even with HUB_TOKEN unset', async () => {
  await withUnsetHubToken(async () => {
    const built = createApp({ dispatcher: async () => {}, proposalPersistence: false, runPersistence: false })
    const server = built.listen(0)
    try {
      const { port } = server.address()
      assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200)
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/proposals`)).status, 200)
    } finally { server.close() }
  })
})

test('startup fail-fast: index.js refuses to start (exit 1) when HUB_TOKEN is unset', () => {
  const env = { ...process.env }
  delete env.HUB_TOKEN
  // dotenv.config() (app.js) loads `.env` from the CHILD's cwd. To genuinely
  // simulate "no HUB_TOKEN" regardless of what the real repo .env contains, we
  // spawn from an EMPTY temp dir with no .env — so dotenv finds no file and cannot
  // repopulate HUB_TOKEN. (index.js resolves its own modules by file location, not
  // cwd, so it still loads normally.) index.js then exits(1) in
  // assertServiceTokenConfigured() BEFORE app.listen — this never binds a port.
  const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-noenv-'))
  try {
    const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'index.js')], { cwd: emptyCwd, env, encoding: 'utf8', timeout: 20000 })
    assert.equal(res.status, 1, 'index.js must exit 1 when no token is configured')
    assert.match(String(res.stderr || ''), /FATAL/)
  } finally {
    fs.rmSync(emptyCwd, { recursive: true, force: true })
  }
})
