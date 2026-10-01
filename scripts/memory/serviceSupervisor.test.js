'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events')
const { run, startOwned } = require('./serviceSupervisor.cjs')
test('the entrypoint test fence prevents config reads and live startup', async () => {
  await assert.rejects(run('bridge'), /supervisor_test_fence/)
})
test('tree cleanup targets only the exact owned process and never an exited handle', async () => {
  const calls = [], child = Object.assign(new EventEmitter(), { pid: 987 })
  const launch = (file, args, options) => {
    calls.push({ file, args, options })
    if (calls.length === 1) return child
    const cleanup = new EventEmitter(); queueMicrotask(() => cleanup.emit('exit', 0)); return cleanup
  }
  const owned = startOwned({ entry: 'C:/fixture/entry.js', cwd: 'C:/fixture', launch, platform: 'win32' })
  assert.equal(owned.running(), true)
  await owned.stop()
  assert.deepEqual(calls[1].args, ['/PID', '987', '/T', '/F'])
  assert.equal(calls[0].options.windowsHide, true)
  assert.equal(calls[1].options.windowsHide, true)
  child.emit('exit', 0)
  assert.equal(owned.running(), false)
  await owned.stop()
  assert.equal(calls.length, 2)
})

test('owned runtime receives the configured data root used by supervisor probes', () => {
  const child = Object.assign(new EventEmitter(), { pid: 987 })
  const env = { AROMA_DATA_DIR: 'C:/fixture/owner-data', PATH: 'C:/fixture/runtime' }
  let launched
  startOwned({ entry: 'C:/fixture/entry.js', cwd: 'C:/fixture', env,
    launch: (file, args, options) => { launched = options; return child } })
  assert.equal(launched.env?.AROMA_DATA_DIR, 'C:/fixture/owner-data')
  assert.equal(launched.env?.PATH, 'C:/fixture/runtime')
})
