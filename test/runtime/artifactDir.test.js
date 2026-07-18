'use strict'

/**
 * artifactDir.test.js — Runtime Foundation A4 (external runtime state).
 *
 * Proves AROMA_ARTIFACT_DIR redirects the artifact-store root outside the release,
 * fails closed on invalid explicit config, preserves the default when unset, keeps
 * import/startup/`/health` write-free, and that the backend boots from an external
 * config CWD (dotenv .env in CWD, absolute release entrypoint) binding only
 * 127.0.0.1. Also verifies the existing AROMA_DATA_DIR contract routes data writes
 * outside the release. Temp dirs only; every child is terminated and cleaned up.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const cp = require('node:child_process')
const { resolveArtifactDir, CODE } = require('../../src/runtime/artifactDir')
const { createArtifactStore } = require('../../src/store/artifactStore')
const { createApp } = require('../../src/app')

const BACKEND = path.resolve(__dirname, '../..')
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p || 'a4-'))
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {} }
const DEFAULT = 'C:\\some\\release\\.aroma'

// ---- 1-5. pure resolver matrix -------------------------------------------
test('property ABSENT -> existing default (source default)', () => {
  const r = resolveArtifactDir({}, DEFAULT); assert.equal(r.ok, true); assert.equal(r.dir, DEFAULT); assert.equal(r.source, 'default')
  // (env with no such own-property; also a null env defensively -> default)
  assert.equal(resolveArtifactDir(null, DEFAULT).source, 'default')
})
test('present-but-empty ("") -> ARTIFACT_DIR_INVALID (NOT default; no fallback, no dir returned)', () => {
  const r = resolveArtifactDir({ AROMA_ARTIFACT_DIR: '' }, DEFAULT)
  assert.equal(r.ok, false); assert.equal(r.code, CODE.INVALID); assert.equal(r.dir, undefined); assert.notEqual(r.dir, DEFAULT)
})
test('present whitespace-only -> ARTIFACT_DIR_INVALID', () => {
  for (const ws of ['   ', '\t', ' \r\n ']) {
    const r = resolveArtifactDir({ AROMA_ARTIFACT_DIR: ws }, DEFAULT)
    assert.equal(r.ok, false, JSON.stringify(ws)); assert.equal(r.code, CODE.INVALID); assert.equal(r.dir, undefined)
  }
})
test('present non-string -> ARTIFACT_DIR_INVALID', () => {
  assert.equal(resolveArtifactDir({ AROMA_ARTIFACT_DIR: 123 }, DEFAULT).ok, false)
})
test('explicit valid absolute Windows path -> used (normalized), source explicit', () => {
  const r = resolveArtifactDir({ AROMA_ARTIFACT_DIR: 'C:\\ProgramData\\AromaXiangXiang\\state\\artifacts' }, DEFAULT)
  assert.equal(r.ok, true); assert.equal(r.source, 'explicit'); assert.equal(r.dir, 'C:\\ProgramData\\AromaXiangXiang\\state\\artifacts')
  // UNC also allowed
  assert.equal(resolveArtifactDir({ AROMA_ARTIFACT_DIR: '\\\\srv\\share\\artifacts' }, DEFAULT).ok, true)
})
test('relative / drive-relative / non-drive-absolute paths -> deny (fail closed, no echo)', () => {
  for (const bad of ['artifacts', '.\\artifacts', '..\\artifacts', 'state/artifacts', 'C:artifacts', '/foo/bar', 'foo']) {
    const r = resolveArtifactDir({ AROMA_ARTIFACT_DIR: bad }, DEFAULT)
    assert.equal(r.ok, false, 'should deny ' + JSON.stringify(bad)); assert.equal(r.code, CODE.INVALID)
    assert.equal(r.dir, undefined); assert.equal(r.reason.includes(bad), false, 'reason must not echo raw value')
  }
})
test('malformed (nul byte / non-string) -> deny', () => {
  assert.equal(resolveArtifactDir({ AROMA_ARTIFACT_DIR: 'C:\\x\0y' }, DEFAULT).ok, false)
  assert.equal(resolveArtifactDir({ AROMA_ARTIFACT_DIR: 123 }, DEFAULT).ok, false)
})

// ---- explicit-empty / invalid -> createApp fails closed BEFORE store construction --
test('explicit-empty AROMA_ARTIFACT_DIR: createApp throws before store construction; default .aroma untouched; no raw echo', () => {
  const repoAroma = path.join(BACKEND, '.aroma')
  const existedBefore = fs.existsSync(repoAroma)
  const had = Object.prototype.hasOwnProperty.call(process.env, 'AROMA_ARTIFACT_DIR')
  const saved = process.env.AROMA_ARTIFACT_DIR
  try {
    // present-but-empty -> fail closed
    process.env.AROMA_ARTIFACT_DIR = ''
    let threw = false; let msg = ''
    try { createApp() } catch (e) { threw = true; msg = e.message }
    assert.equal(threw, true, 'createApp must fail closed on explicit-empty')
    assert.ok(msg.includes('ARTIFACT_DIR_INVALID'), msg)
    assert.equal(fs.existsSync(repoAroma), existedBefore, 'release-relative default .aroma must not be created')

    // an invalid NON-EMPTY explicit value must not be echoed in the diagnostic
    process.env.AROMA_ARTIFACT_DIR = 'relative\\not\\allowed'
    let msg2 = ''
    try { createApp() } catch (e) { msg2 = e.message }
    assert.ok(msg2.includes('ARTIFACT_DIR_INVALID'), msg2)
    assert.equal(msg2.includes('relative\\not\\allowed'), false, 'raw invalid value must be absent from the diagnostic')
    assert.equal(fs.existsSync(repoAroma), existedBefore, 'default .aroma still untouched')
  } finally {
    if (had) process.env.AROMA_ARTIFACT_DIR = saved; else delete process.env.AROMA_ARTIFACT_DIR
  }
})

// ---- 6. constructing the store creates NO directory (lazy) ---------------
test('createArtifactStore construction creates no directory', () => {
  const base = path.join(tmp('a4-noimport-'), 'artifacts')
  try {
    const store = createArtifactStore({ baseDir: base })
    assert.equal(typeof store.write, 'function')
    assert.equal(fs.existsSync(base), false) // not created merely by constructing
  } finally { rm(path.dirname(base)) }
})

// ---- 9 + 11. first real write creates only the external tree; release untouched --
test('first artifact write creates only the external artifact tree; release fixture untouched', () => {
  const ext = tmp('a4-ext-'); const release = tmp('a4-release-')
  try {
    const store = createArtifactStore({ baseDir: path.join(ext, 'artifacts') })
    assert.equal(fs.existsSync(path.join(ext, 'artifacts')), false)
    store.write('tasks', { id: 't1', createdAt: '2026-01-01T00:00:00.000Z' })
    assert.ok(fs.existsSync(path.join(ext, 'artifacts', 'tasks')), 'external tree created')
    assert.equal(fs.readdirSync(path.join(ext, 'artifacts', 'tasks')).length, 1)
    assert.deepEqual(fs.readdirSync(release), [], 'release fixture must have zero writes')
  } finally { rm(ext); rm(release) }
})

// ---- 10. explicit AROMA_DATA_DIR routes data writes outside the release ---
test('explicit AROMA_DATA_DIR routes proposal data writes to the external dir (not the release)', () => {
  const extData = tmp('a4-extdata-')
  const releaseData = path.join(BACKEND, 'data')
  const before = fs.existsSync(releaseData) ? fs.readdirSync(releaseData).sort() : null
  const script = 'const fs=require("fs"),path=require("path");' +
    'const {createProposalStore}=require(' + JSON.stringify(path.join(BACKEND, 'src/coo/proposal')) + ');' +
    'const store=createProposalStore({runStore:{startRun:()=>({})}});' +
    'store.propose({conversationId:"c",message:"build a widget",llm:async()=>({intent:"develop",task:"build widget",targetProject:"backend"})})' +
    '.then(r=>{console.log(JSON.stringify({intent:r.intent,ext:fs.existsSync(path.join(process.env.AROMA_DATA_DIR,"aroma-proposals.json"))}))});'
  const env = Object.assign({}, process.env, { AROMA_DATA_DIR: extData }); delete env.PERSONA_SOURCE
  try {
    const res = cp.spawnSync(process.execPath, ['-e', script], { cwd: BACKEND, env, encoding: 'utf8', timeout: 15000 })
    const out = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
    const j = JSON.parse(out)
    assert.equal(j.intent, 'develop')
    assert.equal(j.ext, true, 'data written to the external AROMA_DATA_DIR')
    // release data dir unchanged (no new proposals file created there by this run)
    const after = fs.existsSync(releaseData) ? fs.readdirSync(releaseData).sort() : null
    assert.deepEqual(after, before, 'release data dir must be unchanged')
  } finally { rm(extData) }
})

// ---- 7,8,12,13,14,15. external-CWD boot; write-free startup/health; loopback --
function localBindsFor (port) {
  let s = ''; try { s = cp.execSync('netstat -ano -p tcp', { encoding: 'utf8' }) } catch (e) {}
  return s.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((t) => t[0] === 'TCP' && t[3] && /LISTEN/i.test(t[3]) && new RegExp('[.:]' + port + '$').test(t[1])).map((t) => t[1])
}
function httpGet (port, p) {
  return new Promise((resolve) => { const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 4000 }, (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, body: b })) }); req.on('error', (e) => resolve({ status: 0, err: e.code })); req.on('timeout', () => { req.destroy(); resolve({ status: 0, err: 'timeout' }) }) })
}
test('boots from an external config CWD (dotenv .env in CWD) with external artifact/data; write-free startup + /health; loopback only', async () => {
  const PORT = '18241'
  const cfg = tmp('a4-cfg-') // external config / working directory
  const state = tmp('a4-state-')
  const artifactDir = path.join(state, 'artifacts') // non-existent -> must stay absent at startup
  const dataDir = path.join(state, 'data') // non-existent -> must stay absent at startup
  fs.writeFileSync(path.join(cfg, '.env'), 'HUB_TOKEN=dummy-a4-token\nLLM_PROVIDER=claude\n') // dummy, non-secret
  const env = Object.assign({}, process.env, {
    AROMA_PROCESS_ROLE: 'primary', AROMA_BIND_HOST: '127.0.0.1',
    AROMA_ARTIFACT_DIR: artifactDir, AROMA_DATA_DIR: dataDir,
    PORT, CONVERSATION_DEMO: 'off'
  })
  delete env.PERSONA_SOURCE; delete env.AROMA_CORE_DIR; delete env.HUB_TOKEN // HUB_TOKEN must come from cfg/.env (proves external-CWD dotenv)
  // absolute entrypoint in the (separate) release dir = the repo; cwd = external cfg dir
  const child = cp.spawn(process.execPath, [path.join(BACKEND, 'src', 'index.js')], { cwd: cfg, env })
  try {
    const r = await new Promise((resolve) => {
      let out = ''
      const on = (d) => { out += String(d); if (out.includes('Listening on 127.0.0.1:' + PORT)) resolve({ ok: true, out }) }
      child.stdout.on('data', on); child.stderr.on('data', on)
      child.on('exit', () => resolve({ ok: out.includes('Listening on 127.0.0.1:' + PORT), out }))
      setTimeout(() => resolve({ ok: out.includes('Listening on 127.0.0.1:' + PORT), out }), 15000)
    })
    assert.equal(r.ok, true, r.out) // started -> proves module load + .env(HUB_TOKEN) from external CWD
    assert.ok(r.out.includes('persona source: legacy'), r.out) // PERSONA_SOURCE absent -> legacy
    assert.ok(r.out.includes('PRIMARY_LEGACY_ALLOWED (memory-free)'), r.out)
    const health = await httpGet(PORT, '/health'); assert.equal(health.status, 200)
    // loopback-only
    const binds = localBindsFor(PORT)
    assert.ok(binds.length > 0 && binds.every((x) => x.startsWith('127.0.0.1:')) && !binds.some((x) => /^(0\.0\.0\.0|\[::\]|::):/.test(x)), 'binds: ' + JSON.stringify(binds))
    // write-free startup + /health: external state dirs never created
    assert.equal(fs.existsSync(artifactDir), false, 'artifact dir must not be created at startup/health')
    assert.equal(fs.existsSync(dataDir), false, 'data dir must not be created at startup/health')
  } finally { try { child.kill('SIGKILL') } catch (e) {} rm(cfg); rm(state) }
})
