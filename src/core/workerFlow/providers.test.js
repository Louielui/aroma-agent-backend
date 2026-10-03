'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { code, claudeArgs, readReview, runClaude } = require('./providers')
const { SOURCE, TESTS } = require('./fixture')
test('registered workbench delegates executable bytes only to the offline executor and protects tests', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiang-provider-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls = []; let models = 0
  const executor = { readiness: async () => ({ ready: true }), isBusy: () => false, run: async pack => {
    calls.push(pack); assert.equal(pack.files['duration.test.js'], TESTS)
    return { exitCode: calls.length === 1 ? 1 : 0, total: 5, passed: calls.length === 1 ? 0 : 5, failed: calls.length === 1 ? 5 : 0, skipped: 0, cancelled: 0, stdout: 'unit mock', stderr: '', engine: 'windows-sandbox-offline-v1' }
  } }
  const provider = { preflight: async o => assert.equal(o.model, 'gpt-6.1-sol'), complete: async (prompt, o) => {
    models++; const packet = JSON.parse(prompt); assert.deepEqual(packet.editable, ['duration.js']); assert.equal(packet.files['duration.js'], SOURCE)
    assert.deepEqual(o.responseFormat.schema.properties.changes.items.properties.file.enum, ['duration.js'])
    return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ changes: [{ file: 'duration.js', content: 'module.exports = { formatDuration: () => "0:00" }' }], summary: 'unit mock' }) }
  } }
  const result = await code({ root, executor, provider, emit () {} })
  assert.equal(models, 1); assert.equal(calls.length, 2); assert.equal(calls[0].files['duration.js'], SOURCE)
  assert.equal(result.tests.passed, 5); assert.equal(result.tests.exitCode, 0); assert.equal(result.baseline.exitCode, 1)
  assert.deepEqual(result.changedFiles, ['duration.js']); assert.equal(result.execution, 'windows_sandbox_offline'); assert.equal(result.appliedToLive, false)
})
test('an unavailable OS boundary refuses workbench coding before subscription use', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiang-provider-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let calls = 0
  await assert.rejects(code({ root, executor: { readiness: async () => ({ ready: false, reason: 'windows_restart_required' }), isBusy: () => false, run: async () => { calls++ } }, provider: { preflight: async () => { calls++ }, complete: async () => { calls++ } } }), /windows_restart_required/)
  assert.equal(calls, 0)
})
test('reviewer has no tools, no discovery and no API-key authentication fallback', () => {
  const args = claudeArgs()
  assert.equal(args[args.indexOf('--tools') + 1], ''); assert.ok(args.includes('--restricted')); assert.ok(args.includes('--strict-mcp-config')); assert.ok(!args.includes('--dangerously-skip-permissions'))
  assert.equal(args[args.indexOf('--max-turns') + 1], '6')
  assert.match(args[args.indexOf('--system-prompt') + 1], /StructuredOutput response formatter is allowed solely/)
  assert.match(args[args.indexOf('--system-prompt') + 1], /Filesystem, shell, network and external tools are disabled/)
  assert.throws(() => readReview({ type: 'result', subtype: 'success', is_error: false, result: 'looks done' }), /invalid_worker_result/)
  assert.throws(() => readReview({ type: 'result', subtype: 'success', structured_output: { verdict: 'pass', summary: 'x', findings: ['bad'] } }), /invalid_worker_result/)
})
test('large multi-file review is streamed through stdin, never expanded into command arguments', async () => {
  const { EventEmitter } = require('node:events'), { PassThrough, Writable } = require('node:stream')
  const packet = JSON.stringify({ files: { 'one.js': 'a'.repeat(40000), 'two.js': 'b'.repeat(40000) } }), calls = []
  const value = await runClaude(claudeArgs(['one.js', 'two.js']), { input: packet, resolveCommand: () => ({ ok: true, command: 'fixture' }), spawnImpl: (exe, args, options) => {
    calls.push({ exe, args, options }); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); let input = ''
    child.stdin = new Writable({ write (chunk, encoding, done) { input += chunk.toString(); done() }, final (done) { assert.equal(input, packet); done(); process.nextTick(() => { child.stdout.end(JSON.stringify({ type: 'result', subtype: 'success' })); child.emit('close', 0) }) } }); child.kill = () => {}
    return child
  } })
  assert.equal(value.subtype, 'success'); assert.equal(calls.length, 1); assert.ok(calls[0].args.join(' ').length < 5000); assert.equal(calls[0].args.includes(packet), false); assert.equal(calls[0].options.shell, false); assert.deepEqual(calls[0].options.stdio, ['pipe', 'pipe', 'pipe']); assert.equal(calls[0].options.env.ANTHROPIC_API_KEY, undefined)
  await assert.rejects(runClaude([], { input: 'x'.repeat(1000001) }), /invalid_worker_result/)
})

test('review failures retain bounded diagnostic enums and byte counts without raw output', async () => {
  const { EventEmitter } = require('node:events'), { PassThrough, Writable } = require('node:stream')
  for (const subtype of ['error_max_turns', 'error_max_structured_output_retries', 'unexpected-sensitive-value']) {
    await assert.rejects(runClaude([], { input: 'packet', resolveCommand: () => ({ ok: true, command: 'fixture' }), spawnImpl: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}
      child.stdin = new Writable({ write (c, e, done) { done() }, final (done) { done(); process.nextTick(() => {
        child.stdout.end(JSON.stringify({ subtype, errors: ['private source and credentials'] })); child.stderr.end('secret credential'); child.emit('close', 1)
      }) } }); return child
    } }), error => {
      assert.equal(error.message, subtype === 'error_max_turns' ? 'claude_max_turns' : subtype === 'error_max_structured_output_retries' ? 'claude_invalid_structured_output' : 'claude_unavailable')
      assert.deepEqual(Object.keys(error.safeDiagnostics).sort(), ['exitCode', 'parsedJson', 'stderrBytes', 'stdoutBytes', 'subtype'])
      assert.equal(error.safeDiagnostics.subtype, subtype.startsWith('error_max_') ? subtype : 'unknown')
      assert.equal(error.safeDiagnostics.exitCode, 1); assert.equal(error.safeDiagnostics.parsedJson, true); assert.ok(error.safeDiagnostics.stderrBytes > 0)
      assert.equal(JSON.stringify(error.safeDiagnostics).includes('credential'), false); assert.equal(JSON.stringify(error.safeDiagnostics).includes('private'), false)
      return true
    })
  }
})
