'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { code, sandboxPolicy, claudeArgs, readReview } = require('./providers')
test('coding uses a bounded workspace, protects tests, and measures tests outside model prose', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiang-provider-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let cwd; let config; let onToolCall; const calls = []; let testCount = 0
  const rpc = { events: new EventEmitter(), notify () {}, close () {}, request: async (method, params) => {
    calls.push({ method, params })
    if (method === 'account/read') return { account: { type: 'chatgpt' } }
    if (method === 'model/list') return { data: [{ model: 'gpt-6-astra' }] }
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 1 } } }
    if (method === 'config/read') return { config: { mcp_servers: { fixture: {} } } }
    if (method === 'mcpServerStatus/list') return { data: [] }
    if (method === 'command/exec') { cwd = params.cwd; if (params.command.includes('-e')) return { exitCode: 0 }; return { exitCode: testCount++ ? 0 : 1, stdout: testCount === 1 ? '# tests 5\n# pass 0\n# fail 5\n# skipped 0' : '# tests 5\n# pass 5\n# fail 0\n# skipped 0', stderr: '' } }
    if (method === 'thread/start') return { model: 'gpt-6-astra', modelProvider: 'openai', thread: { id: 'fixture' }, activePermissionProfile: { id: 'xiangxiang_fixture' }, approvalPolicy: 'never', cwd }
    if (method === 'turn/start') {
      const call = (tool, arguments_) => onToolCall({ threadId: 'fixture', tool, arguments: arguments_ })
      for (const file of ['../secret', 'C:/secret', 'duration.test.js']) assert.equal((await call('write_file', { file, content: 'bad' })).success, false)
      assert.equal((await call('read_file', { file: '../secret' })).success, false)
      assert.equal((await call('run_tests', { command: 'anything' })).success, false)
      assert.equal((await call('write_file', { file: 'duration.js', content: 'module.exports = { formatDuration: () => "0:00" }' })).success, true)
      assert.equal((await call('run_tests', {})).success, true)
      setImmediate(() => rpc.events.emit('notification', { method: 'turn/completed', params: { threadId: 'fixture', turn: { status: 'completed' } } }))
      return {}
    }
    return {}
  } }
  const result = await code({ root, connectFn: o => { config = o.config; onToolCall = o.onToolCall; return rpc }, executable: 'fake', emit () {} })
  assert.equal(result.tests.passed, 5)
  assert.equal(result.tests.exitCode, 0)
  assert.equal(result.baseline.exitCode, 1)
  assert.deepEqual(result.changedFiles, ['duration.js'])
  const turn = calls.find(c => c.method === 'turn/start').params
  assert.equal(turn.permissions, 'xiangxiang_fixture')
  assert.equal(config.permissions.xiangxiang_fixture.network.enabled, false)
  assert.equal(config.permissions.xiangxiang_fixture.filesystem[cwd], 'write')
  assert.equal(config['features.shell_tool'], false)
  assert.equal(config['features.unified_exec'], false)
  assert.equal(config['features.apply_patch_freeform'], false)
  const commands = calls.filter(c => c.method === 'command/exec').map(c => c.params.command)
  assert.ok(commands.every(c => c.includes('--permission') && c.includes('--allow-fs-read=' + cwd)))
  assert.ok(commands.filter(c => c.includes('--test')).every(c => c.includes('--test-isolation=none')))
  assert.equal(calls.find(c => c.method === 'thread/start').params.config['mcp_servers.fixture.enabled'], false)
  assert.equal(sandboxPolicy(cwd).filesystem[cwd], 'write')
})
test('reviewer has no tools, no discovery and no API-key authentication fallback', () => {
  const args = claudeArgs()
  assert.equal(args[args.indexOf('--tools') + 1], '')
  assert.ok(args.includes('--restricted'))
  assert.ok(args.includes('--strict-mcp-config'))
  assert.ok(!args.includes('--dangerously-skip-permissions'))
  assert.throws(() => readReview({ type: 'result', subtype: 'success', is_error: false, result: 'looks done' }), /invalid_worker_result/)
  assert.throws(() => readReview({ type: 'result', subtype: 'success', structured_output: { verdict: 'pass', summary: 'x', findings: ['bad'] } }), /invalid_worker_result/)
})
