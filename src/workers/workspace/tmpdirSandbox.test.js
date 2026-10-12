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
