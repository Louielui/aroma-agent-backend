'use strict'

/**
 * claude-code.test.js — unit tests for the Claude Code Worker Adapter.
 *
 * These tests NEVER invoke the real Claude Code. Every case injects a fake
 * runner so no child process is ever spawned.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/adapters/
 */

const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const { EventEmitter } = require('node:events')

const { createClaudeCodeAdapter, defaultRunner } = require('./claude-code')
const { validateAdapter } = require('../capability/adapter')

/**
 * Build a fake runner that records every call and resolves to a canned result.
 * The runner is asynchronous (returns a Promise), mirroring the real contract
 * runner(command, argsArray) → Promise<{ status, stdout, stderr }>. The recorded
 * calls let tests assert on the ARGS ARRAY the adapter built.
 */
function makeFakeRunner (result) {
  const calls = []
  const runner = (command, argsArray) => {
    calls.push({ command, argsArray })
    return Promise.resolve(result)
  }
  return { runner, calls }
}

test('the claude-code adapter passes validateAdapter', () => {
  const { runner } = makeFakeRunner({ status: 0, stdout: '', stderr: '' })
  const adapter = createClaudeCodeAdapter({ runner })
  assert.equal(validateAdapter(adapter), adapter)
})

test("invoke('Develop', 1, ...) returns ok true and the parsed patchPath", async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'starting develop\npatch written to /tmp/patches/dev-123.zip\ndone',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Develop', 1, { task: 'add feature', target: 'dev' })
  assert.equal(result.ok, true)
  assert.equal(result.output.patchPath, '/tmp/patches/dev-123.zip')
  assert.equal(result.error, null)
})

test("invoke('Apply', 1, ...) returns ok true and the parsed backupRef", async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'applying\nbackupRef: backup/2026-07-08-abcd\nok',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Apply', 1, { patchPath: '/tmp/p.patch', target: 'dev' })
  assert.equal(result.ok, true)
  assert.equal(result.output.backupRef, 'backup/2026-07-08-abcd')
  assert.equal(result.error, null)
})

test('invoke rejects for an unknown capability id', async () => {
  const { runner } = makeFakeRunner({ status: 0, stdout: '', stderr: '' })
  const adapter = createClaudeCodeAdapter({ runner })
  await assert.rejects(() => adapter.invoke('Deploy', 1, { target: 'dev' }), /does not support capability/)
})

test('invoke rejects for version 2', async () => {
  const { runner } = makeFakeRunner({ status: 0, stdout: '', stderr: '' })
  const adapter = createClaudeCodeAdapter({ runner })
  await assert.rejects(() => adapter.invoke('Develop', 2, { task: 'x', target: 'dev' }), /version 2/)
})

test("invoke rejects when target is 'production'", async () => {
  const { runner } = makeFakeRunner({ status: 0, stdout: '', stderr: '' })
  const adapter = createClaudeCodeAdapter({ runner })
  await assert.rejects(
    () => adapter.invoke('Develop', 1, { task: 'x', target: 'production' }),
    /never touches production/
  )
})

test('the adapter builds an arguments ARRAY, never a concatenated shell string', async () => {
  const { runner, calls } = makeFakeRunner({
    status: 0,
    stdout: 'patchPath: /tmp/x.patch',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  await adapter.invoke('Develop', 1, { task: 'ship it', target: 'dev' })

  assert.equal(calls.length, 1)
  const { command, argsArray } = calls[0]

  // The command is a bare executable, not a shell line.
  assert.equal(command, 'node')
  assert.ok(!command.includes(' '))

  // The args are passed as a real array, each element separate — the task with
  // its space stays a SINGLE element and is never split or concatenated.
  assert.ok(Array.isArray(argsArray))
  assert.ok(argsArray.includes('--task'))
  assert.ok(argsArray.includes('ship it'))
  assert.ok(argsArray.includes('--target'))
  assert.ok(argsArray.includes('dev'))

  // Nothing was flattened into a single concatenated command string.
  assert.ok(!argsArray.some(a => typeof a === 'string' && a.includes('--task ship it')))
})

test('buildDevelopArgs places --backend as its own element immediately before the task when targetProject is backend', async () => {
  const { runner, calls } = makeFakeRunner({
    status: 0,
    stdout: 'patch: /tmp/patches/dev-1.zip',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner, targetProject: 'backend' })

  await adapter.invoke('Develop', 1, { task: 'add backend feature', target: 'dev' })

  const { argsArray } = calls[0]
  // --backend is present as its own separate array element...
  assert.ok(argsArray.includes('--backend'))
  // ...never concatenated into another element (e.g. the task string).
  assert.ok(!argsArray.some(a => typeof a === 'string' && a !== '--backend' && a.includes('--backend')))
  // ...and it sits immediately before the task string.
  const taskIndex = argsArray.indexOf('add backend feature')
  assert.equal(argsArray[taskIndex - 1], '--backend')
})

test('buildDevelopArgs omits --backend when targetProject is frontend', async () => {
  const { runner, calls } = makeFakeRunner({
    status: 0,
    stdout: 'patch: /tmp/patches/dev-1.zip',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner, targetProject: 'frontend' })

  await adapter.invoke('Develop', 1, { task: 'add frontend feature', target: 'dev' })

  const { argsArray } = calls[0]
  assert.ok(!argsArray.includes('--backend'))
  // The task string is still passed as a single, separate element.
  assert.ok(argsArray.includes('add frontend feature'))
})

test('invoke Develop with input.targetProject frontend produces no --backend element, even on a backend-constructed adapter', async () => {
  const { runner, calls } = makeFakeRunner({
    status: 0,
    stdout: 'patch: /tmp/patches/dev-1.zip',
    stderr: ''
  })
  // The adapter was constructed to default to backend, but the per-invocation
  // input names the frontend — the input must win so the Run is not misdirected.
  const adapter = createClaudeCodeAdapter({ runner, targetProject: 'backend' })

  await adapter.invoke('Develop', 1, { task: 'add frontend feature', target: 'dev', targetProject: 'frontend' })

  const { argsArray } = calls[0]
  assert.ok(!argsArray.includes('--backend'))
  // The task string is still passed as a single, separate element.
  assert.ok(argsArray.includes('add frontend feature'))
})

test('invoke Develop with input.targetProject backend produces --backend as its own element before the task, even on a frontend-constructed adapter', async () => {
  const { runner, calls } = makeFakeRunner({
    status: 0,
    stdout: 'patch: /tmp/patches/dev-1.zip',
    stderr: ''
  })
  // The adapter was constructed for the frontend, but the per-invocation input
  // names the backend — the input must win.
  const adapter = createClaudeCodeAdapter({ runner, targetProject: 'frontend' })

  await adapter.invoke('Develop', 1, { task: 'add backend feature', target: 'dev', targetProject: 'backend' })

  const { argsArray } = calls[0]
  // --backend is present as its own separate array element...
  assert.ok(argsArray.includes('--backend'))
  // ...never concatenated into another element (e.g. the task string).
  assert.ok(!argsArray.some(a => typeof a === 'string' && a !== '--backend' && a.includes('--backend')))
  // ...and it sits immediately before the task string.
  const taskIndex = argsArray.indexOf('add backend feature')
  assert.equal(argsArray[taskIndex - 1], '--backend')
})

test('buildDevelopArgs defaults to backend and includes --backend when targetProject is not given', async () => {
  const { runner, calls } = makeFakeRunner({
    status: 0,
    stdout: 'patch: /tmp/patches/dev-1.zip',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  await adapter.invoke('Develop', 1, { task: 'default target', target: 'dev' })

  assert.ok(calls[0].argsArray.includes('--backend'))
})

test('health returns up when the runner is callable', () => {
  const { runner } = makeFakeRunner({ status: 0, stdout: '', stderr: '' })
  const adapter = createClaudeCodeAdapter({ runner })
  const h = adapter.health()
  assert.equal(h.availability, 'up')
  assert.equal(typeof h.latencyMs, 'number')
})

test('a failing runner status yields ok false with an error', async () => {
  const { runner } = makeFakeRunner({ status: 1, stdout: '', stderr: 'boom' })
  const adapter = createClaudeCodeAdapter({ runner })
  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'boom')
})

test('Develop with no patch path in stdout returns ok false and patchPath null', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'starting develop\nthinking hard\ndone',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })
  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.output.patchPath, null)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
})

test('Develop whose stdout says no files were changed returns ok false', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'starting develop\nno files were changed\ndone',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })
  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.output.patchPath, null)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
})

test('Develop with a valid patch path returns ok true with that exact patchPath', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'work done\nartifact: /var/aroma/patches/run-42.zip\nfinished',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })
  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, true)
  assert.equal(result.output.patchPath, '/var/aroma/patches/run-42.zip')
})

test('Develop with a cost figure in stdout yields that number in cost', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'patch: /tmp/patches/dev-9.zip\ncost: $0.42\ndone',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })
  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, true)
  assert.equal(result.cost, 0.42)
})

test('Develop with no cost figure yields cost null and never zero', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'patch: /tmp/patches/dev-9.zip\ndone',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })
  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, true)
  assert.equal(result.cost, null)
  assert.notEqual(result.cost, 0)
})

test('Apply with no backup reference in stdout returns ok false', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'applying patch\nnothing to report\n',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })
  const result = await adapter.invoke('Apply', 1, { patchPath: '/tmp/p.zip', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.output.backupRef, null)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
})

test('a non-zero exit status returns ok false regardless of stdout', async () => {
  const { runner } = makeFakeRunner({
    status: 3,
    stdout: 'patch: /tmp/patches/dev-9.zip\ncost: $1.00\n',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })
  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, false)
})

// --- Non-blocking, asynchronous execution -------------------------------------
// The adapter must never block the event loop while a worker runs. These tests
// prove the default runner spawns asynchronously with an argument array (and no
// shell), that invoke is Promise-returning, that a slow runner does not block,
// and that a rejecting runner becomes an honest ok:false result.

test('the default runner is built with child_process.spawn, shell false, and an arguments ARRAY — no real process is spawned', async () => {
  const calls = []
  const fakeChild = new EventEmitter()
  fakeChild.stdout = new EventEmitter()
  fakeChild.stderr = new EventEmitter()
  // Real child streams expose setEncoding; the fake stubs it out.
  fakeChild.stdout.setEncoding = () => {}
  fakeChild.stderr.setEncoding = () => {}

  mock.method(childProcess, 'spawn', (command, argsArray, opts) => {
    calls.push({ command, argsArray, opts })
    // Drive the fake child asynchronously — a real process is never spawned.
    setImmediate(() => {
      fakeChild.stdout.emit('data', 'hello ')
      fakeChild.stderr.emit('data', 'warn')
      fakeChild.emit('close', 0)
    })
    return fakeChild
  })

  try {
    const result = await defaultRunner('node', ['selfexec/develop.js', '--task', 'do it'])

    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, 'node')
    // The arguments are passed as a real ARRAY, never concatenated into a string.
    assert.ok(Array.isArray(calls[0].argsArray))
    assert.deepEqual(calls[0].argsArray, ['selfexec/develop.js', '--task', 'do it'])
    // The shell is EXPLICITLY disabled — no shell string is ever built.
    assert.equal(calls[0].opts.shell, false)
    // stdout/stderr are collected and the exit status is surfaced as a number.
    assert.equal(result.status, 0)
    assert.equal(result.stdout, 'hello ')
    assert.equal(result.stderr, 'warn')
  } finally {
    mock.restoreAll()
  }
})

test('adapter.invoke returns a Promise and awaiting it yields the same result shape as before', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'artifact: /tmp/patches/dev-shape.zip\ncost: $0.10\n',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const promise = adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.ok(promise instanceof Promise)

  const result = await promise
  // Exactly the classic normalized result fields — nothing added, nothing lost.
  assert.deepEqual(Object.keys(result).sort(), ['cost', 'error', 'latencyMs', 'ok', 'output'])
  assert.equal(result.ok, true)
  assert.equal(result.output.patchPath, '/tmp/patches/dev-shape.zip')
  assert.equal(result.error, null)
  assert.equal(result.cost, 0.1)
  assert.equal(typeof result.latencyMs, 'number')
})

test('a runner that resolves after a delay does not block: an independent task completes first', async () => {
  const order = []
  // This runner resolves only on a LATER turn of the event loop (a macrotask).
  const slowRunner = () => new Promise((resolve) => {
    setImmediate(() => {
      order.push('runner-resolved')
      resolve({ status: 0, stdout: 'artifact: /tmp/patches/slow.zip\n', stderr: '' })
    })
  })
  const adapter = createClaudeCodeAdapter({ runner: slowRunner })

  const invokePromise = adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })

  // A second, independent asynchronous task runs to completion BEFORE the delayed
  // runner resolves — proof that invoke did not block the event loop.
  await Promise.resolve().then(() => order.push('independent-task'))

  const result = await invokePromise
  assert.equal(result.ok, true)
  assert.deepEqual(order, ['independent-task', 'runner-resolved'])
})

test('a runner that rejects yields ok false with an error, not an unhandled rejection', async () => {
  const rejectingRunner = () => Promise.reject(new Error('spawn ENOENT'))
  const adapter = createClaudeCodeAdapter({ runner: rejectingRunner })

  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.output.patchPath, null)
  assert.ok(typeof result.error === 'string' && result.error.includes('spawn ENOENT'))
  // An unprovable cost stays null on the error path, never a false zero.
  assert.equal(result.cost, null)
})

test('a rejecting runner on Apply also yields ok false with an error', async () => {
  const rejectingRunner = () => Promise.reject(new Error('apply child died'))
  const adapter = createClaudeCodeAdapter({ runner: rejectingRunner })

  const result = await adapter.invoke('Apply', 1, { patchPath: '/tmp/p.zip', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.output.backupRef, null)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
})

// --- Patch/backup path parsing: extract the PATH, never the labelled line -----
// The develop/apply scripts may print a localized (non-English) label before the
// path. The adapter must return the bare path itself — no label, prefix, quotes
// or trailing whitespace — never the whole line that contains it.

test('Develop: a non-English label before a Windows patches path yields exactly the bare path', async () => {
  // A real run printed a Chinese "補丁 :" label immediately before the path.
  const barePath = 'C:\\Users\\louis\\Downloads\\aroma-selfexec\\patches\\aroma-dev-2026-07-09T21-33-08-836Z.zip'
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: `starting\n補丁 :${barePath}\ndone`,
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, true)
  // The bare path only — the "補丁 :" label and its colon are stripped.
  assert.equal(result.output.patchPath, barePath)
})

test('Develop: a POSIX patches path yields exactly that path', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'patch écrit: /home/aroma/selfexec/patches/aroma-dev-99.zip\nfini',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, true)
  assert.equal(result.output.patchPath, '/home/aroma/selfexec/patches/aroma-dev-99.zip')
})

test('Develop: a patches path surrounded by quotes and trailing whitespace yields the trimmed bare path', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: '補丁 : "/tmp/patches/quoted-run.zip"   \n',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, true)
  // No wrapping quotes, no trailing spaces.
  assert.equal(result.output.patchPath, '/tmp/patches/quoted-run.zip')
})

test('Develop: two candidate patches paths yield the last one', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'first: /tmp/patches/one.zip\nsecond: /tmp/patches/two.zip\ndone',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, true)
  assert.equal(result.output.patchPath, '/tmp/patches/two.zip')
})

test('Develop: stdout with no patches path still yields ok false with patchPath null', async () => {
  const { runner } = makeFakeRunner({
    // A .zip that is NOT under a patches directory is not evidence of a patch.
    status: 0,
    stdout: '補丁 : C:\\Users\\louis\\Downloads\\artifacts\\build-1.zip\ndone',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Develop', 1, { task: 'x', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.output.patchPath, null)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
})

test('Apply: a non-English label before the backup reference yields the bare reference', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'applying\n備份 :backup/2026-07-09-xyz\nok',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Apply', 1, { patchPath: '/tmp/p.zip', target: 'dev' })
  assert.equal(result.ok, true)
  // The "備份 :" label is stripped; only the reference itself remains.
  assert.equal(result.output.backupRef, 'backup/2026-07-09-xyz')
})

test('Apply: stdout with no backup reference still yields ok false', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'applying patch\n備份 : (aucune)\nrien à signaler\n',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Apply', 1, { patchPath: '/tmp/p.zip', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.output.backupRef, null)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
})

// --- Apply argument construction ----------------------------------------------
// The apply script reads the patch zip as a bare positional argument and accepts
// only the optional `--yes` flag (which skips its interactive prompt). It does
// not understand `--patch` or `--target`. buildApplyArgs must therefore build
// exactly three elements: the script path, `--yes`, then the patch path.

test('buildApplyArgs produces exactly three elements: the script path, then --yes, then the patch path', async () => {
  const { runner, calls } = makeFakeRunner({
    status: 0,
    stdout: 'backup/2026-07-09-abc\n',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  await adapter.invoke('Apply', 1, { patchPath: '/tmp/patches/run-7.zip', target: 'dev' })

  const { argsArray } = calls[0]
  assert.equal(argsArray.length, 3)
  // Element 0 is the apply script path (its own separate element).
  assert.ok(argsArray[0].endsWith('apply.js'))
  // Element 1 is the --yes flag, required for non-interactive execution.
  assert.equal(argsArray[1], '--yes')
  // Element 2 is the patch path, taken verbatim from input.patchPath.
  assert.equal(argsArray[2], '/tmp/patches/run-7.zip')
})

test('the Apply arguments array contains no --patch element and no --target element', async () => {
  const { runner, calls } = makeFakeRunner({
    status: 0,
    stdout: 'backup/2026-07-09-abc\n',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  await adapter.invoke('Apply', 1, { patchPath: '/tmp/patches/run-7.zip', target: 'dev' })

  const { argsArray } = calls[0]
  assert.ok(!argsArray.includes('--patch'))
  assert.ok(!argsArray.includes('--target'))
})

test('Apply returns ok false when the fake stdout carries no backup reference', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'applying patch\nall quiet\n',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Apply', 1, { patchPath: '/tmp/patches/run-7.zip', target: 'dev' })
  assert.equal(result.ok, false)
  assert.equal(result.output.backupRef, null)
})

test('Apply returns ok true and the parsed backupRef, tolerating a non-English label before it', async () => {
  const { runner } = makeFakeRunner({
    status: 0,
    stdout: 'applying\n備份 :backups/2026-07-09-xyz\nok',
    stderr: ''
  })
  const adapter = createClaudeCodeAdapter({ runner })

  const result = await adapter.invoke('Apply', 1, { patchPath: '/tmp/patches/run-7.zip', target: 'dev' })
  assert.equal(result.ok, true)
  // The "備份 :" label is stripped; only the bare reference remains.
  assert.equal(result.output.backupRef, 'backups/2026-07-09-xyz')
})
