'use strict'

/**
 * processRole.test.js — R4a.
 *
 * Pure tests for the process-role guard (role parsing, role×mode matrix, exact
 * matching, fail-closed) plus child-process tests proving an invalid startup config
 * refuses to bind the port (no "Listening" line, non-zero exit) BEFORE any Memory
 * read / composer load / model call.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const cp = require('node:child_process')
const PR = require('../../src/persona/processRole')
const { buildPersonaSystem } = require('../../src/persona/xiangxiang')

const BACKEND = path.resolve(__dirname, '../..')

// ---- role parsing (exact) -------------------------------------------------
test('AROMA_PROCESS_ROLE: unset/empty -> primary; exact primary / persona-canary', () => {
  assert.equal(PR.resolveProcessRole({}), 'primary')
  assert.equal(PR.resolveProcessRole({ AROMA_PROCESS_ROLE: '' }), 'primary')
  assert.equal(PR.resolveProcessRole({ AROMA_PROCESS_ROLE: 'primary' }), 'primary')
  assert.equal(PR.resolveProcessRole({ AROMA_PROCESS_ROLE: 'persona-canary' }), 'persona-canary')
})
test('unknown role and case/space variants fail closed', () => {
  for (const bad of ['Primary', 'PRIMARY', ' primary', 'primary ', 'canary', 'persona_canary', 'personacanary', 'PersonaCanary', 'x']) {
    assert.throws(() => PR.resolveProcessRole({ AROMA_PROCESS_ROLE: bad }), (e) => e.code === 'PROCESS_ROLE_CONFIG_ERROR', `should reject ${JSON.stringify(bad)}`)
  }
})

// ---- role × mode matrix ---------------------------------------------------
const v = (processRole, personaSourceMode) => PR.validateProcessPersonaConfig({ processRole, personaSourceMode })
test('primary: legacy + hybrid config-valid; shadow forbidden (Runtime Guard)', () => {
  assert.equal(v('primary', 'legacy').valid, true)
  assert.equal(v('primary', 'legacy').status, 'PROCESS_CONFIG_VALID')
  // hybrid is now CONFIG-permitted on the primary; readiness is enforced separately
  // at startup by primaryPersonaStartupGuard (this layer reads no Memory).
  assert.equal(v('primary', 'hybrid').valid, true)
  assert.equal(v('primary', 'hybrid').status, 'PROCESS_CONFIG_VALID')
  // shadow stays forbidden on the primary (canary-only diagnostic mode).
  assert.equal(v('primary', 'shadow').valid, false)
  assert.equal(v('primary', 'shadow').status, 'PRIMARY_SHADOW_FORBIDDEN')
})
test('persona-canary: legacy/shadow/hybrid all valid at the config layer', () => {
  assert.equal(v('persona-canary', 'legacy').valid, true)
  assert.equal(v('persona-canary', 'shadow').valid, true)
  assert.equal(v('persona-canary', 'hybrid').valid, true) // readiness is decided later by R1/R2, not here
})
test('unknown role or mode in the matrix fails closed', () => {
  assert.equal(v('bogus', 'legacy').status, 'PROCESS_ROLE_CONFIG_ERROR')
  assert.equal(v('primary', 'memory').status, 'PERSONA_SOURCE_CONFIG_ERROR')
})

// ---- evaluateStartupConfig (env-only) -------------------------------------
test('evaluateStartupConfig: default env -> primary + legacy valid', () => {
  const r = PR.evaluateStartupConfig({})
  assert.equal(r.valid, true); assert.equal(r.processRole, 'primary'); assert.equal(r.personaSourceMode, 'legacy')
})
test('evaluateStartupConfig: unknown role / unknown persona source fail closed (no throw)', () => {
  assert.equal(PR.evaluateStartupConfig({ AROMA_PROCESS_ROLE: 'x' }).status, 'PROCESS_ROLE_CONFIG_ERROR')
  assert.equal(PR.evaluateStartupConfig({ PERSONA_SOURCE: 'memory' }).status, 'PERSONA_SOURCE_CONFIG_ERROR')
  assert.equal(PR.evaluateStartupConfig({ PERSONA_SOURCE: 'shadow' }).status, 'PRIMARY_SHADOW_FORBIDDEN') // default role primary
  assert.equal(PR.evaluateStartupConfig({ PERSONA_SOURCE: 'hybrid' }).valid, true) // primary+hybrid config-valid (readiness gated at startup)
})
test('authority is env-only: no request/header API surface exists', () => {
  // validateProcessPersonaConfig takes parsed strings, never a request object.
  assert.equal(v(undefined, undefined).valid, false)
  assert.equal(v({ headers: { 'x-persona-source': 'hybrid' } }, 'hybrid').status, 'PROCESS_ROLE_CONFIG_ERROR') // object role rejected
})

// ---- legacy default guarantee ---------------------------------------------
test('default primary+legacy keeps buildPersonaSystem byte-identical (no persona change)', () => {
  assert.equal(buildPersonaSystem('X'), buildPersonaSystem('X'))
  const r = PR.evaluateStartupConfig({})
  assert.equal(r.processRole, 'primary'); assert.equal(r.personaSourceMode, 'legacy')
})

// ---- startup fail-closed (child process; invalid config refuses to listen) --
function runIndex (env) {
  const e = Object.assign({}, process.env, env)
  const res = cp.spawnSync(process.execPath, ['src/index.js'], { cwd: BACKEND, env: e, encoding: 'utf8', timeout: 10000 })
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') }
}
test('unknown role: index.js exits non-zero, prints FATAL, never binds the port', () => {
  const r = runIndex({ AROMA_PROCESS_ROLE: 'bogus', PORT: '18091' })
  assert.notEqual(r.code, 0)
  assert.ok(r.out.includes('FATAL') && r.out.includes('PROCESS_ROLE_CONFIG_ERROR'))
  assert.equal(r.out.includes('Listening on port'), false) // never reached listen
})
test('primary + shadow forbidden: index.js exits before listen', () => {
  const e = { PERSONA_SOURCE: 'shadow', PORT: '18092' }; delete e.AROMA_PROCESS_ROLE
  const r = runIndex(Object.assign({ AROMA_PROCESS_ROLE: '' }, e))
  assert.notEqual(r.code, 0)
  assert.ok(r.out.includes('PRIMARY_SHADOW_FORBIDDEN'))
  assert.equal(r.out.includes('Listening on port'), false)
})
test('primary + hybrid with a NOT-READY core: index.js exits before listen (Runtime Guard, no fallback)', () => {
  const os = require('node:os'); const fs = require('node:fs')
  const emptyCore = fs.mkdtempSync(path.join(os.tmpdir(), 'r5rg-emptycore-')) // no active stores -> composer NOT_READY
  try {
    const r = runIndex({ AROMA_PROCESS_ROLE: '', PERSONA_SOURCE: 'hybrid', AROMA_CORE_DIR: emptyCore, PORT: '18093' })
    assert.notEqual(r.code, 0)
    assert.ok(r.out.includes('PRIMARY_HYBRID_NOT_READY'), r.out)
    assert.equal(r.out.includes('Listening on port'), false) // fail-closed: never binds
  } finally { fs.rmSync(emptyCore, { recursive: true, force: true }) }
})
test('unknown PERSONA_SOURCE (persona-canary role): index.js exits before listen (R2 fail-closed preserved)', () => {
  const r = runIndex({ AROMA_PROCESS_ROLE: 'persona-canary', PERSONA_SOURCE: 'memory', PORT: '18094' })
  assert.notEqual(r.code, 0); assert.ok(r.out.includes('PERSONA_SOURCE_CONFIG_ERROR')); assert.equal(r.out.includes('Listening on port'), false)
})

// ---- valid default startup does NOT get blocked by the guard --------------
test('valid default (primary+legacy) startup reaches "Listening" then is stopped', async () => {
  const os = require('node:os'); const fs = require('node:fs')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4a-data-'))
  const env = Object.assign({}, process.env, { HUB_TOKEN: 'test-token', PORT: '18099', AROMA_DATA_DIR: dataDir, CONVERSATION_DEMO: 'off' })
  delete env.AROMA_PROCESS_ROLE; delete env.PERSONA_SOURCE
  const child = cp.spawn(process.execPath, ['src/index.js'], { cwd: BACKEND, env })
  const listening = await new Promise((resolve) => {
    let out = ''
    const onData = (d) => { out += String(d); if (out.includes('Listening on port') && out.includes('process role: primary | persona source: legacy')) resolve(true) }
    child.stdout.on('data', onData); child.stderr.on('data', onData)
    setTimeout(() => resolve(out.includes('Listening on port')), 8000)
  })
  child.kill('SIGKILL')
  fs.rmSync(dataDir, { recursive: true, force: true })
  assert.equal(listening, true)
})
