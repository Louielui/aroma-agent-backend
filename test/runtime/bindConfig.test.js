'use strict'

/**
 * bindConfig.test.js — Runtime Foundation A1 (loopback-only bind).
 *
 * Pure resolver matrix (unset/empty/127.0.0.1 allow; everything else fail-closed) plus
 * child-process boot tests proving the primary binds ONLY 127.0.0.1, refuses to start
 * on an invalid bind config, and fails closed (BACKEND_LISTEN_FAILED / EADDRINUSE) with
 * a non-zero exit when the port is occupied. No test opens a port on a LAN interface;
 * every child is reliably terminated with no lingering process/listener.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const path = require('node:path')
const cp = require('node:child_process')
const { resolveBindHost, LOOPBACK, CODE } = require('../../src/runtime/bindConfig')
const op = require('../../src/core/memory/shadow/operatingPrinciplesShadow')
const ps = require('../../src/core/memory/shadow/personalityShadow')
const idShadow = require('../../src/core/memory/shadow/identityShadow')
const { PERSONA_IDENTITY: P } = require('../../src/persona/xiangxiang')
const { createRev, ev } = require('../core/memory/_helpers')

const BACKEND = path.resolve(__dirname, '../..')

// ---- 1-7. pure resolver matrix -------------------------------------------
test('AROMA_BIND_HOST unset -> 127.0.0.1', () => {
  const r = resolveBindHost({}); assert.equal(r.ok, true); assert.equal(r.host, LOOPBACK); assert.equal(r.source, 'default')
})
test('AROMA_BIND_HOST empty -> 127.0.0.1', () => {
  assert.equal(resolveBindHost({ AROMA_BIND_HOST: '' }).host, LOOPBACK)
})
test('exact 127.0.0.1 -> allow', () => {
  const r = resolveBindHost({ AROMA_BIND_HOST: '127.0.0.1' }); assert.equal(r.ok, true); assert.equal(r.host, LOOPBACK); assert.equal(r.source, 'explicit')
})
test('non-loopback / malformed values all fail closed (and never echo the value)', () => {
  for (const bad of ['0.0.0.0', '::', '::1', 'localhost', '127.0.0.2', '192.168.1.10', '10.0.0.5', '1.1.1.1', 'AromaBrain', '127.0.0.1 ', ' 127.0.0.1', 'not-an-ip', ' ', '*']) {
    const r = resolveBindHost({ AROMA_BIND_HOST: bad })
    assert.equal(r.ok, false, 'should deny ' + JSON.stringify(bad))
    assert.equal(r.code, CODE.INVALID); assert.equal(r.host, null)
    // fixed safe reason string — proves the raw value is never echoed back
    assert.equal(r.reason, 'only 127.0.0.1 is permitted')
  }
})

// ---- child-process boot helpers ------------------------------------------
function spawnIndex (extra, prep) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1bind-data-'))
  const env = Object.assign({}, process.env, { HUB_TOKEN: 'test-token', AROMA_DATA_DIR: dataDir, CONVERSATION_DEMO: 'off' }, extra)
  delete env.AROMA_PROCESS_ROLE; if (!('PERSONA_SOURCE' in extra)) delete env.PERSONA_SOURCE
  const child = cp.spawn(process.execPath, ['src/index.js'], { cwd: BACKEND, env })
  child._dataDir = dataDir
  return child
}
function cleanupChild (child, extraDir) {
  try { child.kill('SIGKILL') } catch (e) {}
  try { fs.rmSync(child._dataDir, { recursive: true, force: true }) } catch (e) {}
  if (extraDir) try { fs.rmSync(extraDir, { recursive: true, force: true }) } catch (e) {}
}
function waitFor (child, needle, ms) {
  return new Promise((resolve) => {
    let out = ''
    const on = (d) => { out += String(d); if (out.includes(needle)) resolve({ matched: true, out, code: null }) }
    child.stdout.on('data', on); child.stderr.on('data', on)
    child.on('exit', (code) => resolve({ matched: out.includes(needle), out, code }))
    setTimeout(() => resolve({ matched: out.includes(needle), out, timedOut: true }), ms)
  })
}
// Return the LOCAL addresses of LISTENING sockets on `port` (netstat columns:
// Proto | LocalAddress | ForeignAddress | State | PID — we read LocalAddress only, so
// the remote "0.0.0.0:0" column can never be mistaken for a wildcard bind).
function localBindsFor (port) {
  let netstat = ''
  try { netstat = cp.execSync('netstat -ano -p tcp', { encoding: 'utf8' }) } catch (e) { netstat = '' }
  return netstat.split(/\r?\n/).map((l) => l.trim().split(/\s+/))
    .filter((t) => t[0] === 'TCP' && t[3] && /LISTEN/i.test(t[3]) && new RegExp('[.:]' + port + '$').test(t[1]))
    .map((t) => t[1])
}
function assertLoopbackOnly (port) {
  const l = localBindsFor(port)
  assert.ok(l.length > 0, 'expected a listener on ' + port + '; got ' + JSON.stringify(l))
  assert.ok(l.every((x) => x.startsWith('127.0.0.1:')), 'local binds must all be 127.0.0.1: ' + JSON.stringify(l))
  assert.ok(!l.some((x) => /^(0\.0\.0\.0|\[::\]|::):/.test(x)), 'must not bind a wildcard interface: ' + JSON.stringify(l))
}

function seedActive (base, storeName, recordId, payload) {
  const rev = createRev(base, storeName, recordId, { payload })
  ev(base, storeName, recordId, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  ev(base, storeName, recordId, rev.revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'Louie', decision: 'approved' } })
  ev(base, storeName, recordId, rev.revisionId, 'ACTIVATED', 'approved')
  return rev
}
function seedTriple (base) {
  seedActive(base, 'identity', idShadow.IDENTITY_RECORD_ID, { format: 'verbatim', section: 'identity', text: P.slice(0, 807) })
  seedActive(base, op.OP_STORE, op.OP_RECORD_ID, op.buildOperatingPrinciplesPayload(P))
  seedActive(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, ps.buildPersonalityPayload(P))
}

// ---- 8. valid legacy startup -> ONLY a 127.0.0.1 listener ----------------
test('legacy startup binds only 127.0.0.1 (never 0.0.0.0/[::])', async () => {
  const PORT = '18211'
  const child = spawnIndex({ PORT }) // AROMA_BIND_HOST unset -> default loopback
  try {
    const r = await waitFor(child, 'Listening on 127.0.0.1:' + PORT, 15000)
    assert.equal(r.matched, true, r.out)
    assert.ok(r.out.includes('persona source: legacy'))
    assertLoopbackOnly(PORT)
  } finally { cleanupChild(child) }
})

// ---- 9. valid primary+hybrid READY startup -> ONLY 127.0.0.1 -------------
test('primary+hybrid READY startup binds only 127.0.0.1', async () => {
  const PORT = '18212'
  const core = fs.mkdtempSync(path.join(os.tmpdir(), 'a1bind-core-'))
  seedTriple(core)
  const child = spawnIndex({ PORT, PERSONA_SOURCE: 'hybrid', AROMA_CORE_DIR: core })
  try {
    const r = await waitFor(child, 'Listening on 127.0.0.1:' + PORT, 15000)
    assert.equal(r.matched, true, r.out)
    assert.ok(r.out.includes('PRIMARY_HYBRID_READY'), r.out)
    assertLoopbackOnly(PORT)
  } finally { cleanupChild(child, core) }
})

// ---- 10. invalid bind config -> non-zero exit, NO listener ---------------
test('AROMA_BIND_HOST=0.0.0.0 -> FATAL BIND_HOST_INVALID, exits, no listener', async () => {
  const PORT = '18213'
  const child = spawnIndex({ PORT, AROMA_BIND_HOST: '0.0.0.0' })
  try {
    const r = await waitFor(child, 'BIND_HOST_INVALID', 8000)
    assert.equal(r.matched, true, r.out)
    assert.notEqual(r.code, 0)
    assert.equal(r.out.includes('Listening on'), false) // never bound
    assert.equal(localBindsFor(PORT).length, 0)
  } finally { cleanupChild(child) }
})

// ---- 11. port occupied -> BACKEND_LISTEN_FAILED / EADDRINUSE, no alt port -
test('port occupied -> BACKEND_LISTEN_FAILED (EADDRINUSE), non-zero exit, no alternative port', async () => {
  const PORT = 18214
  const blocker = net.createServer()
  await new Promise((resolve) => blocker.listen(PORT, '127.0.0.1', resolve)) // occupy the loopback port
  const child = spawnIndex({ PORT: String(PORT) })
  try {
    const r = await waitFor(child, 'BACKEND_LISTEN_FAILED', 10000)
    assert.equal(r.matched, true, r.out)
    assert.ok(r.out.includes('EADDRINUSE'), r.out)
    assert.notEqual(r.code, 0)
    assert.equal(r.out.includes('Listening on'), false) // no half-started listener, no alternative port
  } finally { cleanupChild(child); await new Promise((resolve) => blocker.close(resolve)) }
})
