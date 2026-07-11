'use strict'

/**
 * claudeWorker.test.js — B2-1 Step 2. Unit tests with a STUB runner (no real
 * claude, no cost). Proves: the exact spike command shape, the claude JSON
 * result parse, and — hardest — the sandbox brake (tightening 1): any target not
 * strictly under os.tmpdir() is refused BEFORE the runner is ever called.
 *
 *   Run: node --test src/workers/claudeWorker.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createClaudeWorker, assertSandboxUnderTmpdir } = require('./claudeWorker')

// A stub runner that records every call and returns a canned success payload.
function spyRunner (payload) {
  const calls = []
  const runner = async (command, args) => {
    calls.push({ command, args })
    return payload
  }
  return { runner, calls }
}

const SUCCESS_JSON = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'created hello.txt and committed',
  session_id: 'sess_1',
  total_cost_usd: 0.0031,
  num_turns: 2
})

function freshSandbox () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sandbox-'))
}

// --- command shape ---------------------------------------------------------

test('builds the EXACT spike command: -p <task> --add-dir <sandbox> --permission-mode bypassPermissions --output-format json', async () => {
  const sandbox = freshSandbox()
  try {
    const { runner, calls } = spyRunner({ status: 0, stdout: SUCCESS_JSON, stderr: '' })
    const worker = createClaudeWorker({ runner })
    await worker.invoke('Invoke', 1, { task: 'create hello.txt and commit', sandbox })

    assert.equal(calls.length, 1)
    const { command, args } = calls[0]
    assert.equal(command, 'claude')
    const expectedSandbox = assertSandboxUnderTmpdir(sandbox) // canonical form the adapter uses
    assert.deepEqual(args, [
      '-p', 'create hello.txt and commit',
      '--add-dir', expectedSandbox,
      '--permission-mode', 'bypassPermissions',
      '--output-format', 'json'
    ])
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
})

// --- result parse ----------------------------------------------------------

test('parses claude success JSON into a clean Result (ok, result text, cost, relay 0/0/0)', async () => {
  const sandbox = freshSandbox()
  try {
    const { runner } = spyRunner({ status: 0, stdout: SUCCESS_JSON, stderr: '' })
    const r = await createClaudeWorker({ runner }).invoke('Invoke', 1, { task: 'do x', sandbox })

    assert.equal(r.ok, true)
    assert.equal(r.cost, 0.0031)
    assert.equal(r.output.exit, 0)
    assert.equal(r.output.subtype, 'success')
    assert.equal(r.output.isError, false)
    assert.equal(r.output.result, 'created hello.txt and committed')
    assert.deepEqual(r.output.relay, { toUser: 0, fromUser: 0, manual: 0 })
    assert.equal(r.error, null)
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
})

test('is_error:true or a non-zero exit yields ok:false with an error', async () => {
  const sandbox = freshSandbox()
  try {
    const errJson = JSON.stringify({ subtype: 'error_during_execution', is_error: true, result: 'boom' })
    const a = await createClaudeWorker({ runner: spyRunner({ status: 0, stdout: errJson, stderr: '' }).runner })
      .invoke('Invoke', 1, { task: 't', sandbox })
    assert.equal(a.ok, false)
    assert.match(a.error, /boom/)

    const b = await createClaudeWorker({ runner: spyRunner({ status: 1, stdout: SUCCESS_JSON, stderr: 'crashed' }).runner })
      .invoke('Invoke', 1, { task: 't', sandbox })
    assert.equal(b.ok, false)
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
})

test('unparseable worker output yields ok:false, not a throw', async () => {
  const sandbox = freshSandbox()
  try {
    const r = await createClaudeWorker({ runner: spyRunner({ status: 0, stdout: 'not json', stderr: '' }).runner })
      .invoke('Invoke', 1, { task: 't', sandbox })
    assert.equal(r.ok, false)
    assert.match(r.error, /not valid JSON/)
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
})

// --- THE BRAKE: refuse-outside-sandbox (runner NEVER called) ----------------

test('refuses any target not under os.tmpdir() and NEVER calls the runner', async () => {
  const outside = [
    process.cwd(),                                   // the real repo
    path.join(os.tmpdir(), '..', 'evil'),            // '..' escape
    os.homedir(),                                    // absolute real path outside tmpdir
    os.tmpdir(),                                     // tmpdir ITSELF (need a subdir)
    'relative/path',                                 // relative, resolves under cwd (repo), not tmpdir
    ''                                               // empty
  ]
  for (const sandbox of outside) {
    const { runner, calls } = spyRunner({ status: 0, stdout: SUCCESS_JSON, stderr: '' })
    const worker = createClaudeWorker({ runner })
    await assert.rejects(
      () => worker.invoke('Invoke', 1, { task: 'do x', sandbox }),
      /refuses to invoke|not under os\.tmpdir/,
      `expected refusal for sandbox=${JSON.stringify(sandbox)}`
    )
    assert.equal(calls.length, 0, `runner must NOT be called for sandbox=${JSON.stringify(sandbox)}`)
  }
})

test('assertSandboxUnderTmpdir: accepts a real tmp subdir, rejects escapes/symlink-out', () => {
  const sandbox = freshSandbox()
  try {
    // accepts and returns a canonical path under tmpdir
    const ok = assertSandboxUnderTmpdir(sandbox)
    const rel = path.relative(fs.realpathSync(os.tmpdir()), ok)
    assert.ok(rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel))

    // '..' collapse cannot escape
    assert.throws(() => assertSandboxUnderTmpdir(path.join(sandbox, '..', '..', 'escape')), /not under os\.tmpdir/)

    // a symlink inside tmpdir pointing OUT must be rejected (skip if symlink not permitted)
    const link = path.join(sandbox, 'out')
    let linked = false
    try { fs.symlinkSync(os.homedir(), link, 'junction'); linked = true } catch (_) {
      try { fs.symlinkSync(os.homedir(), link); linked = true } catch (_) { /* no symlink perms; skip */ }
    }
    if (linked) {
      assert.throws(() => assertSandboxUnderTmpdir(path.join(link, 'x')), /not under os\.tmpdir/)
    }
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
})

// --- capability guard ------------------------------------------------------

test('rejects an unsupported capability or version, and an empty task', async () => {
  const sandbox = freshSandbox()
  try {
    const worker = createClaudeWorker({ runner: spyRunner({ status: 0, stdout: SUCCESS_JSON, stderr: '' }).runner })
    await assert.rejects(() => worker.invoke('Deploy', 1, { task: 't', sandbox }), /does not support capability/)
    await assert.rejects(() => worker.invoke('Invoke', 2, { task: 't', sandbox }), /does not support Invoke version/)
    await assert.rejects(() => worker.invoke('Invoke', 1, { task: '   ', sandbox }), /non-empty task/)
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
})
