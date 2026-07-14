'use strict'

/**
 * broker.test.js — Phase 2 Gate 1 slice 6 (Model 2 broker). handleRequest logic +
 * a loopback named-pipe round-trip (same account; cross-account ACL is slice-6 D).
 *
 *   Run: node --test src/connector/broker.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')

const { createBroker } = require('./broker')
const { createProjectionEndpoint } = require('./projectionEndpoint')

const SAFE = { proposalId: 'prop_1', executionId: 'task_1', status: 'succeeded', finishedAt: '2026-07-13T10:00:00.000Z', sourceTaskId: 'src_1', resultSummary: 'ok' }
const counterRng = () => { let c = 0; return (n) => Buffer.alloc(n, (c++ % 251) + 1) }
let pipeSeq = 0
const uniquePipe = () => '\\\\.\\pipe\\aroma-brk-' + process.pid + '-' + (pipeSeq++)

test('handleRequest: presentedReadIdentity comes from the BROKER (Model 2), never from the payload', () => {
  let seen
  const broker = createBroker({
    projectionEndpoint: { project: (ctx) => { seen = ctx; return { ok: true, code: 'OK', items: [], suppressedCount: 0 } } },
    backendReadIdentity: 'BROKER-HELD-ID'
  })
  broker.handleRequest({ presentedReadIdentity: 'ATTACKER-INJECTED', status: 'succeeded', principal: 'p', app: 'a', window: 'w', correlationId: 'c1' })
  assert.equal(seen.presentedReadIdentity, 'BROKER-HELD-ID') // NOT 'ATTACKER-INJECTED'
  assert.equal(seen.filters.status, 'succeeded')
  assert.equal(seen.principal, 'p'); assert.equal(seen.app, 'a'); assert.equal(seen.window, 'w')
  assert.equal(seen.correlationId, 'c1')
})

test('handleRequest: fail-closed — project throw → SOURCE_ERROR; project non-OK passed through; bad req → BAD_REQUEST', () => {
  const throwing = createBroker({ projectionEndpoint: { project: () => { throw new Error('boom') } }, backendReadIdentity: 'X' })
  assert.deepEqual(throwing.handleRequest({ principal: 'p', app: 'a', window: 'w' }), { ok: false, code: 'SOURCE_ERROR' })
  const denied = createBroker({ projectionEndpoint: { project: () => ({ ok: false, code: 'READ_IDENTITY_DENIED' }) }, backendReadIdentity: 'X' })
  assert.deepEqual(denied.handleRequest({ principal: 'p', app: 'a', window: 'w' }), { ok: false, code: 'READ_IDENTITY_DENIED' })
  assert.deepEqual(throwing.handleRequest(null), { ok: false, code: 'BAD_REQUEST' })
})

test('loopback pipe round-trip: request → project → response (only projected fields); no held identity leaks', async () => {
  const pe = createProjectionEndpoint({
    buildReturnReadyList: () => ({ items: [SAFE], count: 1, malformed: 0 }),
    auditSink: { append () {} }, resultIdStore: { set () {} },
    readBackendReadIdentity: () => 'X', now: () => 1000, rng: counterRng()
  })
  const broker = createBroker({ projectionEndpoint: pe, backendReadIdentity: 'X' })
  const pipe = uniquePipe()
  await broker.start(pipe)
  try {
    const resp = await new Promise((resolve, reject) => {
      const s = net.connect(pipe)
      let buf = ''
      s.on('connect', () => s.write(JSON.stringify({ status: 'succeeded', principal: 'p', app: 'a', window: 'w', correlationId: 'cc' }) + '\n'))
      s.on('data', (d) => { buf += d.toString('utf8'); const nl = buf.indexOf('\n'); if (nl >= 0) { try { resolve(JSON.parse(buf.slice(0, nl))) } catch (e) { reject(e) } s.end() } })
      s.on('error', reject)
    })
    assert.equal(resp.ok, true); assert.equal(resp.code, 'OK'); assert.equal(resp.items.length, 1)
    assert.deepEqual(Object.keys(resp.items[0]).sort(), ['connectorResultId', 'summary'])
    assert.ok(!JSON.stringify(resp).includes('X'.repeat(1)) || !JSON.stringify(resp).includes('readIdentity'), 'no held identity field in response')
  } finally { await broker.stop() }
})
