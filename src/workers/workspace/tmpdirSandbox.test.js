'use strict'

/**
 * tmpdirSandbox.test.js — B2-7 WorkspaceProvider extraction equivalence.
 *
 * Proves the provider reproduces B2-1 behaviour byte-for-byte: the containment
 * brake, permission mode, add-dir set, no-op cleanup, and the re-export that
 * keeps claudeWorker's public brake identical. No paid calls.
 *
 *   Run: node --test src/workers/workspace/tmpdirSandbox.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createTmpdirSandbox, assertSandboxUnderTmpdir } = require('./tmpdirSandbox')
const claudeWorker = require('../claudeWorker')

test('containmentCheck === assertSandboxUnderTmpdir (canonical) and rejects a non-tmp path', () => {
  const ws = createTmpdirSandbox()
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-ws-'))
  try {
    assert.equal(ws.containmentCheck(sandbox), assertSandboxUnderTmpdir(sandbox))
    assert.throws(() => ws.containmentCheck(process.cwd()), /not under os\.tmpdir/)
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
})

test('claudeWorker re-exports the SAME brake function (back-compat)', () => {
  assert.equal(claudeWorker.assertSandboxUnderTmpdir, assertSandboxUnderTmpdir)
})

test('permissionMode + addDirs match B2-1', () => {
  const ws = createTmpdirSandbox()
  assert.equal(ws.permissionMode(), 'bypassPermissions')
  assert.deepEqual(ws.addDirs('/some/dir'), ['/some/dir'])
})

test('buildArgs is byte-for-byte the B2-1 spike command', () => {
  const args = claudeWorker.buildArgs('do x', '/tmp/sbx')
  assert.deepEqual(args, ['-p', 'do x', '--add-dir', '/tmp/sbx', '--permission-mode', 'bypassPermissions', '--output-format', 'json'])
})

test('cleanup is a NO-OP — returns undefined and does not remove the dir (B2-1 preserved sandboxes)', () => {
  const ws = createTmpdirSandbox()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-ws-keep-'))
  try {
    assert.equal(ws.cleanup(dir), undefined)
    assert.equal(fs.existsSync(dir), true) // not reaped
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('prepare mints a sandbox under tmpdir and runs the injected init', () => {
  let inited = null
  const ws = createTmpdirSandbox({ prepareSandbox: (d) => { inited = d } })
  const { dir } = ws.prepare()
  try {
    assert.equal(inited, dir)                       // init ran on the minted dir
    assert.equal(ws.containmentCheck(dir), assertSandboxUnderTmpdir(dir)) // it's contained
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

/* ══════════════ 2026-09-05: the mint register (workspace provenance) ══════════════ */

const { assertMintedWorkspace } = require('./tmpdirSandbox')

test('a workspace this provider really prepared is accepted, root and subdirectory alike', () => {
  const ws = createTmpdirSandbox({ prepareSandbox: () => {} })
  const { dir } = ws.prepare()
  const sub = path.join(dir, 'copy'); fs.mkdirSync(sub)
  try {
    assert.equal(assertMintedWorkspace(ws, dir).path, fs.realpathSync(dir))
    assert.equal(assertMintedWorkspace(ws, sub).root, fs.realpathSync(dir))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('⛔ a HAND-MADE directory with the same prefix is refused — a name is not a provenance', () => {
  const ws = createTmpdirSandbox({ prepareSandbox: () => {} })
  const lookalike = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sandbox-'))
  try {
    assert.throws(() => assertMintedWorkspace(ws, lookalike), /was not minted by this provider/)
  } finally { fs.rmSync(lookalike, { recursive: true, force: true }) }
})

test('⛔ a directory minted by provider A is refused for provider B', () => {
  const a = createTmpdirSandbox({ prepareSandbox: () => {} })
  const b = createTmpdirSandbox({ prepareSandbox: () => {} })
  const { dir } = a.prepare()
  try {
    assert.equal(assertMintedWorkspace(a, dir).path, fs.realpathSync(dir))
    assert.throws(() => assertMintedWorkspace(b, dir), /was not minted by this provider/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('⛔ an object that is not one of our providers has no register at all', () => {
  const impostor = { containmentCheck: (p) => p, mintedByThisProvider: () => true, prepare: () => ({ dir: os.tmpdir() }) }
  const ws = createTmpdirSandbox({ prepareSandbox: () => {} })
  const { dir } = ws.prepare()
  try {
    assert.throws(() => assertMintedWorkspace(impostor, dir), /not created by tmpdirSandbox/)
    assert.throws(() => assertMintedWorkspace(null, dir), /not created by tmpdirSandbox/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('⛔ a FAILED prepare registers nothing — a half-built sandbox is not a workspace', () => {
  // ⛔ THE TEST CLEANS UP WHAT IT MADE, AND ONLY THAT.
  // The first version scanned all of os.tmpdir() for aroma-sandbox-* and deleted the NEWEST —
  // which is someone else's directory the moment anything else is running. The exact path is
  // captured inside prepareSandbox, which is the only place that knows it.
  let created = null
  const ws = createTmpdirSandbox({ prepareSandbox: (dir) => { created = dir; throw new Error('init blew up') } })
  assert.throws(() => ws.prepare(), /init blew up/)
  assert.ok(created, 'the init hook must have seen the directory')

  // A NEWER sandbox from an unrelated provider — it must survive this test untouched.
  const bystander = createTmpdirSandbox({ prepareSandbox: () => {} })
  const other = bystander.prepare().dir
  try {
    assert.throws(() => assertMintedWorkspace(ws, created), /was not minted by this provider/)
    fs.rmSync(created, { recursive: true, force: true })
    assert.equal(fs.existsSync(other), true, 'a newer, unrelated sandbox must NOT be deleted by this test')
    assert.ok(assertMintedWorkspace(bystander, other), 'and it is still a valid minted workspace')
  } finally {
    try { fs.rmSync(created, { recursive: true, force: true }) } catch (_) {}
    fs.rmSync(other, { recursive: true, force: true })
  }
})

test('⛔ a root deleted and RECREATED at the same path is no longer the minted directory', () => {
  const ws = createTmpdirSandbox({ prepareSandbox: () => {} })
  const { dir } = ws.prepare()
  assert.equal(assertMintedWorkspace(ws, dir).path, fs.realpathSync(dir))
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir)
  try {
    assert.throws(() => assertMintedWorkspace(ws, dir), /identity changed|was not minted/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a deleted root is refused rather than reported as merely absent', () => {
  const ws = createTmpdirSandbox({ prepareSandbox: () => {} })
  const { dir } = ws.prepare()
  fs.rmSync(dir, { recursive: true, force: true })
  assert.throws(() => assertMintedWorkspace(ws, dir), /no longer exists|was not minted/)
})

test('⛔ IN-PROCESS PROVENANCE ONLY — not OS isolation, and not claimed to be', () => {
  // The register proves a directory came from this module's prepare(). It says nothing about a
  // hostile process running as the same user; such a process can create, move or replace
  // directories regardless. The boundary is deliberate and stated so it is not over-read.
  const ws = createTmpdirSandbox({ prepareSandbox: () => {} })
  const { dir } = ws.prepare()
  try { assert.ok(assertMintedWorkspace(ws, dir)) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a sandbox minted OUTSIDE os.tmpdir() still returns normally, but is not registered', () => {
  // Back-compat: runWorkerInBackground may pass its own sandboxRoot. prepare() must behave
  // exactly as before; the only consequence is that provenance cannot be claimed for it.
  const root = fs.mkdtempSync(path.join(process.cwd(), 'aroma-outside-'))
  try {
    const ws = createTmpdirSandbox({ sandboxRoot: root, prepareSandbox: () => {} })
    const { dir } = ws.prepare()
    assert.equal(fs.existsSync(dir), true, 'prepare must not have thrown')
    assert.throws(() => assertMintedWorkspace(ws, dir), /was not minted by this provider/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
