'use strict'

/**
 * patchStore.test.js — the deliverable actually reaches the Owner, and nothing else does.
 *
 * Without the patch file a run ends with "3 files changed, tests pass" and nothing to
 * apply, so the Owner would still make the change himself and three copy-pastes would
 * become four. These tests are about that file existing, being applyable, and living
 * somewhere it can never become a repo change by accident.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { writePatch, applyHint, patchDir, DEFAULT_DIR, MAX_PATCH_BYTES } = require('./patchStore')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'patchstore-'))
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }) } catch (_) {} }

const PATCH = [
  'diff --git a/docs/canary/agent-canary.md b/docs/canary/agent-canary.md',
  'index 1111111..2222222 100644',
  '--- a/docs/canary/agent-canary.md',
  '+++ b/docs/canary/agent-canary.md',
  '@@ -1,2 +1,2 @@',
  '-canary target — safe to modify. line 1.',
  '+canary target — safe to modify. line 1. edited by the agent.',
  ''
].join('\n')

test('*** a patch is written, and the bytes are the patch ***', () => {
  const dir = tmp()
  try {
    const r = writePatch('appr_canary1', PATCH, { dir, now: () => '2026-08-03T01:02:03.000Z' })
    assert.equal(r.ok, true)
    assert.equal(fs.readFileSync(r.path, 'utf8'), PATCH, 'byte-identical — not a rendering')
    assert.match(path.basename(r.path), /^2026-08-03T01-02-03_appr_canary1\.patch$/,
      'named by time and approval, so two runs never collide')
    assert.equal(r.bytes, Buffer.byteLength(PATCH, 'utf8'))
  } finally { rm(dir) }
})

test('*** the default location is OUTSIDE the repo ***', () => {
  // A patch inside the working tree would show in `git status` and could be committed by
  // accident — the agent's proposal must not be able to become a repo change by sitting
  // in the wrong folder.
  assert.equal(DEFAULT_DIR.toLowerCase().includes('aroma-agent-backend'), false)
  assert.equal(patchDir({ env: {} }), DEFAULT_DIR)
  assert.equal(patchDir({ env: { AGENT_PATCH_DIR: 'D:\\elsewhere' } }), 'D:\\elsewhere')
})

test('*** a run that changed nothing says so, and writes no empty file ***', () => {
  const dir = tmp()
  try {
    for (const empty of ['', '   ', '\n']) {
      const r = writePatch('appr_x', empty, { dir })
      assert.equal(r.ok, false)
      assert.equal(r.reason, 'no_changes', 'a legitimate outcome, not a failure')
    }
    assert.deepEqual(fs.readdirSync(dir), [], 'and nothing on disk for the Owner to open and find blank')
  } finally { rm(dir) }
})

test('*** an unsafe approvalId cannot steer the filename ***', () => {
  const dir = tmp()
  try {
    for (const bad of ['../escape', 'a/b', 'x'.repeat(65), '', 'a b', 'C:\\evil']) {
      const r = writePatch(bad, PATCH, { dir })
      assert.equal(r.ok, false, JSON.stringify(bad) + ' must be refused')
      assert.equal(r.reason, 'unsafe_approval_id')
    }
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally { rm(dir) }
})

test('*** a runaway patch is refused rather than written ***', () => {
  const dir = tmp()
  try {
    const r = writePatch('appr_big', 'x'.repeat(MAX_PATCH_BYTES + 1), { dir })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'patch_too_large')
  } finally { rm(dir) }
})

test('*** an unwritable directory is reported, never thrown ***', () => {
  // The run already happened. Losing the file is a smaller loss than losing the report.
  const r = writePatch('appr_x', PATCH, { dir: '\u0000not-a-path' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'write_failed')
})

test('*** the hint gives the exact apply command ***', () => {
  const h = applyHint('C:\\Aroma\\AgentPatches\\p.patch', 'C:\\Aroma\\aroma-agent-backend')
  assert.match(h, /git -C "C:\\Aroma\\aroma-agent-backend" apply "C:\\Aroma\\AgentPatches\\p\.patch"/)
  assert.equal(applyHint(null), null)
})

test('*** the module cannot apply anything — v1 writes and stops ***', () => {
  // CODE ONLY — comments AND string literals removed. The first version scanned for the
  // substring 'git ' and tripped on applyHint's message, which is the sentence the Owner
  // reads, not a command this module runs. A guard that cannot tell an instruction from a
  // description will eventually be silenced rather than fixed.
  const src = fs.readFileSync(path.join(__dirname, 'patchStore.js'), 'utf8')
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')

  assert.equal(/applyHint/.test(src), true, 'the hint text really is in this file')
  assert.equal(/git /.test(code), false, 'and it is only ever text, never a command')
  for (const forbidden of ['child_process', 'spawn', 'exec(', 'execFile']) {
    assert.equal(code.includes(forbidden), false, 'patchStore must not be able to run ' + forbidden)
  }
})
