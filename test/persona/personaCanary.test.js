'use strict'

/**
 * personaCanary.test.js — R4b.
 *
 * Child-process tests for the isolated persona-canary entrypoint: binds only to
 * 127.0.0.1 on the canary port, defaults PERSONA_SOURCE=shadow inside the entrypoint,
 * requires a separate AROMA_CANARY_TOKEN, and fails closed (exit non-zero, no listen)
 * on missing token / wrong role / port-in-use. No canary process is left running.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const http = require('node:http')
const cp = require('node:child_process')
const PR = require('../../src/persona/processRole')
const op = require('../../src/core/memory/shadow/operatingPrinciplesShadow')
const idShadow = require('../../src/core/memory/shadow/identityShadow')
const { PERSONA_IDENTITY: P } = require('../../src/persona/xiangxiang')
const { createRev, ev } = require('../core/memory/_helpers')

const BACKEND = path.resolve(__dirname, '../..')

// Seed a production-frozen-shaped core dir: identity active + OP review_ready + no
// personality. Returns the dir (caller cleans up).
function seedProdFrozenCore () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'r4cf1-core-'))
  const id = createRev(base, 'identity', idShadow.IDENTITY_RECORD_ID, { payload: { format: 'verbatim', section: 'identity', text: P.slice(0, 807) } })
  ev(base, 'identity', idShadow.IDENTITY_RECORD_ID, id.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  ev(base, 'identity', idShadow.IDENTITY_RECORD_ID, id.revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'Louie', decision: 'approved' } })
  ev(base, 'identity', idShadow.IDENTITY_RECORD_ID, id.revisionId, 'ACTIVATED', 'approved')
  const o = createRev(base, op.OP_STORE, op.OP_RECORD_ID, { payload: op.buildOperatingPrinciplesPayload(P) })
  ev(base, op.OP_STORE, op.OP_RECORD_ID, o.revisionId, 'SUBMITTED_FOR_REVIEW', 'new') // stays review_ready
  return base
}

function baseEnv (extra) {
  const e = Object.assign({}, process.env, extra)
  delete e.AROMA_PROCESS_ROLE // start from unset unless the case sets it
  delete e.PERSONA_SOURCE
  return e
}
function spawnCanary (extra) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-data-'))
  const env = baseEnv(Object.assign({ AROMA_DATA_DIR: dataDir, CONVERSATION_DEMO: 'off' }, extra))
  const child = cp.spawn(process.execPath, ['src/personaCanary.js'], { cwd: BACKEND, env })
  child._dataDir = dataDir
  return child
}
function cleanupChild (child) { try { child.kill('SIGKILL') } catch (e) {} try { fs.rmSync(child._dataDir, { recursive: true, force: true }) } catch (e) {} }
function waitFor (child, needle, ms) {
  return new Promise((resolve) => {
    let out = ''
    const on = (d) => { out += String(d); if (out.includes(needle)) resolve({ matched: true, out, exitCode: null }) }
    child.stdout.on('data', on); child.stderr.on('data', on)
    child.on('exit', (code) => resolve({ matched: out.includes(needle), out, exitCode: code }))
    setTimeout(() => resolve({ matched: out.includes(needle), out, timedOut: true }), ms)
  })
}
function httpGet (port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 4000 }, (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, body: b })) })
    req.on('error', reject); req.on('timeout', () => { req.destroy(new Error('timeout')) })
  })
}

// ---- valid startup: binds 127.0.0.1:port, shadow, serves /health ----------
test('valid canary startup binds 127.0.0.1 on the canary port with shadow default; /health 200', async () => {
  const PORT = '18102'
  const child = spawnCanary({ AROMA_CANARY_TOKEN: 'canary-secret', AROMA_CANARY_PORT: PORT })
  try {
    const r = await waitFor(child, 'persona-canary listening on 127.0.0.1:' + PORT, 20000)
    assert.equal(r.matched, true, r.out)
    assert.ok(r.out.includes('persona source: shadow'))
    assert.ok(r.out.includes('process role: persona-canary'))
    const health = await httpGet(PORT, '/health')
    assert.equal(health.status, 200)
  } finally { cleanupChild(child) }
})

// ---- missing token fails closed before listen -----------------------------
test('missing AROMA_CANARY_TOKEN -> exit non-zero, no listener', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-data-'))
  const env = baseEnv({ AROMA_CANARY_PORT: '18103', AROMA_DATA_DIR: dataDir }); delete env.AROMA_CANARY_TOKEN
  const res = cp.spawnSync(process.execPath, ['src/personaCanary.js'], { cwd: BACKEND, env, encoding: 'utf8', timeout: 15000 })
  fs.rmSync(dataDir, { recursive: true, force: true })
  const out = (res.stdout || '') + (res.stderr || '')
  assert.notEqual(res.status, 0)
  assert.ok(out.includes('CANARY_TOKEN_MISSING'))
  assert.equal(out.includes('listening on'), false)
})

// ---- explicit non-canary role rejected ------------------------------------
test('AROMA_PROCESS_ROLE=primary passed to the canary entrypoint -> fail closed', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-data-'))
  const env = Object.assign({}, process.env, { AROMA_PROCESS_ROLE: 'primary', AROMA_CANARY_TOKEN: 'x', AROMA_CANARY_PORT: '18104', AROMA_DATA_DIR: dataDir }); delete env.PERSONA_SOURCE
  const res = cp.spawnSync(process.execPath, ['src/personaCanary.js'], { cwd: BACKEND, env, encoding: 'utf8', timeout: 15000 })
  fs.rmSync(dataDir, { recursive: true, force: true })
  const out = (res.stdout || '') + (res.stderr || '')
  assert.notEqual(res.status, 0)
  assert.ok(out.includes('PROCESS_ROLE_CONFIG_ERROR') || out.includes('persona-canary'))
  assert.equal(out.includes('listening on'), false)
})

// ---- unknown persona source fails closed (R2 preserved) -------------------
test('explicit unknown PERSONA_SOURCE -> fail closed before listen', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-data-'))
  const env = Object.assign({}, process.env, { PERSONA_SOURCE: 'memory', AROMA_CANARY_TOKEN: 'x', AROMA_CANARY_PORT: '18105', AROMA_DATA_DIR: dataDir }); delete env.AROMA_PROCESS_ROLE
  const res = cp.spawnSync(process.execPath, ['src/personaCanary.js'], { cwd: BACKEND, env, encoding: 'utf8', timeout: 15000 })
  fs.rmSync(dataDir, { recursive: true, force: true })
  const out = (res.stdout || '') + (res.stderr || '')
  assert.notEqual(res.status, 0)
  assert.ok(out.includes('PERSONA_SOURCE_CONFIG_ERROR'))
  assert.equal(out.includes('listening on'), false)
})

// ---- port-in-use fails closed ---------------------------------------------
test('port already in use -> second canary exits non-zero without binding', async () => {
  const PORT = '18106'
  const first = spawnCanary({ AROMA_CANARY_TOKEN: 'a', AROMA_CANARY_PORT: PORT })
  try {
    const up = await waitFor(first, 'listening on 127.0.0.1:' + PORT, 20000)
    assert.equal(up.matched, true, up.out)
    const second = spawnCanary({ AROMA_CANARY_TOKEN: 'b', AROMA_CANARY_PORT: PORT })
    try {
      const r = await waitFor(second, 'FATAL', 15000)
      assert.notEqual(r.exitCode, 0)
      assert.ok(/EADDRINUSE|cannot bind/.test(r.out))
    } finally { cleanupChild(second) }
  } finally { cleanupChild(first) }
})

// ---- primary default unchanged (pure) -------------------------------------
test('primary default is unaffected: evaluateStartupConfig({}) stays primary + legacy', () => {
  const r = PR.evaluateStartupConfig({})
  assert.equal(r.processRole, 'primary'); assert.equal(r.personaSourceMode, 'legacy'); assert.equal(r.valid, true)
})

// ---- R4c-F1: end-to-end, real entrypoint serves the canary endpoints -------
test('e2e: real personaCanary entrypoint serves /persona-canary/health and /readiness (200, safe)', async () => {
  const PORT = '18107'
  const core = seedProdFrozenCore()
  const child = spawnCanary({ AROMA_CANARY_TOKEN: 'canary-secret', AROMA_CANARY_PORT: PORT, AROMA_CORE_DIR: core })
  try {
    const up = await waitFor(child, 'listening on 127.0.0.1:' + PORT, 20000)
    assert.equal(up.matched, true, up.out)
    // health -> 200 CANARY_ALIVE
    const h = await httpGet(PORT, '/persona-canary/health')
    assert.equal(h.status, 200)
    const hj = JSON.parse(h.body)
    assert.equal(hj.status, 'CANARY_ALIVE'); assert.equal(hj.processRole, 'persona-canary'); assert.equal(hj.personaSourceMode, 'shadow')
    // readiness -> 200 SHADOW_READY (prod-frozen shape: OP review_ready, personality absent)
    const rd = await httpGet(PORT, '/persona-canary/readiness')
    assert.equal(rd.status, 200)
    const rj = JSON.parse(rd.body)
    assert.equal(rj.status, 'SHADOW_READY'); assert.equal(rj.ready, true); assert.equal(rj.hybridComposerReady, false)
    assert.match(rj.reason, /NOT_READY|NOT_ACTIVE/)
    // terminal 404 still handles unknown paths on the canary app
    const nf = await httpGet(PORT, '/no-such-route')
    assert.equal(nf.status, 404)
    // no leakage in either response
    const all = h.body + rd.body
    for (const leak of ['canary-secret', '香香', '思考順序', P.slice(0, 807), P.slice(886, 952), '/Users/', 'AromaCore', 'Error:', 'HUB_TOKEN', 'ANTHROPIC']) assert.equal(all.includes(leak), false, 'leak: ' + leak)
  } finally { cleanupChild(child); fs.rmSync(core, { recursive: true, force: true }) }
})
