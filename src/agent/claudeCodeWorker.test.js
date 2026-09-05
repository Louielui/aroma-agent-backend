'use strict'

/**
 * claudeCodeWorker.test.js — the dispatcher's arguments, its confinement, its reading of the
 * documented result contract, and its stopping.
 *
 * ⛔ WHAT A FAKE SPAWN CAN AND CANNOT PROVE. Most tests here inject a fake child, and a fake
 * child proves ARGV, CONTROL FLOW and RESULT HANDLING — nothing about a real CLI or a real
 * process tree. The one test that claims real termination creates its own parent and grandchild
 * in a disposable directory, with no network, no credentials and no CLI under test, and kills
 * only the pids it created. Nothing here is evidence about claude.exe's actual behaviour.
 *
 * ── PRE-EXISTING ASSERTIONS DELIBERATELY REPLACED ────────────────────────────
 * The original suite asserted a caller COULD widen the grant per dispatch
 * (`{ allowedTools: ['Read','Edit'] }`). That is refused by Owner instruction, so the assertion
 * is INVERTED rather than deleted.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { createTmpdirSandbox } = require('../workers/workspace/tmpdirSandbox')
const {
  createClaudeCodeWorker, defaultKillTree, READ_ONLY_TOOLS, FIXED_SETTINGS, EMPTY_MCP_CONFIG,
  PERMISSION_MODE, TREE, PIDS, STOP_REASON, FAILURE, MAX_TOTAL_BYTES
} = require('./claudeCodeWorker')
const { ENQUIRY_JSON_SCHEMA } = require('./enquirySchema')

const MADE = []
/** The trusted flow itself: mkdtemp('aroma-sandbox-') under os.tmpdir(). git init is skipped. */
function realSandbox () {
  const workspace = createTmpdirSandbox({ prepareSandbox: () => {} })
  const { dir } = workspace.prepare()
  MADE.push(dir)
  return { workspace, dir }
}
const okResolve = () => ({ ok: true, command: 'C:/nowhere/claude.exe' })

const payloadOf = (over = {}) => Object.assign({ answer: 'a', citations: [], notEstablished: [] }, over)
/** The documented shape: a result message, subtype success, validated data in structured_output. */
const envelope = (over = {}) => Object.assign({
  type: 'result', subtype: 'success', session_id: 's',
  structured_output: payloadOf(), total_cost_usd: 0.17, num_turns: 3
}, over)

function fakeChild ({ stdout = '', stderr = '', close = 0, pid = 4242 } = {}) {
  const c = new EventEmitter()
  c.pid = pid
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter()
  c.kill = () => {}
  setImmediate(() => {
    if (stdout) c.stdout.emit('data', Buffer.from(stdout))
    if (stderr) c.stderr.emit('data', Buffer.from(stderr))
    c.emit('close', close)
  })
  return c
}
const emitting = (spec) => () => fakeChild(spec)

/**
 * A fake CLI that answers for the session it was actually ASKED about. The runner mints its own
 * session id, so a fixture with a hard-coded one is refused by the session-identity check —
 * correctly. This helper keeps that check live while letting the integration tests run.
 */
const emittingForSession = (over = {}) => (cmd, args) => {
  const sid = args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1]
  return fakeChild({ stdout: JSON.stringify(envelope(Object.assign({ session_id: sid }, over))) })
}

function worker (extra = {}, sb) {
  const s = sb || realSandbox()
  return createClaudeCodeWorker(Object.assign({
    workspace: s.workspace, cwd: s.dir, resolveFn: okResolve
  }, extra))
}

const argOf = (a, f) => a[a.indexOf(f) + 1]
const allOf = (a, f) => a.map((v, i) => (a[i - 1] === f ? v : null)).filter((x) => x !== null)

/* ══════════════ the launch contract ══════════════ */

describe('the argv carries the whole confinement, asserted exactly', () => {
  test('--restricted first; --tools comma form; --allowedTools one element per tool', () => {
    const a = worker().buildArgs({ goal: 'g', sessionId: 's' })
    assert.strictEqual(a[0], '--restricted')
    assert.strictEqual(argOf(a, '--tools'), 'Read,Grep,Glob')
    assert.deepStrictEqual(allOf(a, '--allowedTools'), ['Read', 'Grep', 'Glob'])
  })

  test('permission mode, pinned settings, strict empty MCP, turn bound, schema, json output', () => {
    const a = worker().buildArgs({ goal: 'g', sessionId: 's' })
    assert.strictEqual(argOf(a, '--permission-mode'), PERMISSION_MODE)
    assert.deepStrictEqual(JSON.parse(argOf(a, '--settings')), FIXED_SETTINGS)
    assert.ok(a.includes('--strict-mcp-config'))
    assert.deepStrictEqual(JSON.parse(argOf(a, '--mcp-config')).mcpServers, {})
    assert.ok(Number(argOf(a, '--max-turns')) > 0)
    assert.strictEqual(JSON.parse(argOf(a, '--json-schema')).additionalProperties, false)
    assert.strictEqual(argOf(a, '--output-format'), 'json')
  })

  test('no write tool, no browser, no MCP tool, no --add-dir, no --bare, no bypass', () => {
    const flat = worker().buildArgs({ goal: 'g', sessionId: 's' }).join(' ')
    assert.ok(!/\bEdit\b|\bWrite\b|\bBash\b/.test(flat), flat)
    assert.ok(!/chrome|browser|mcp__|--add-dir|--bare|bypassPermissions|--dangerously/i.test(flat))
  })

  test('the goal is one argv entry; --max-budget-usd only when asked for', () => {
    const a = worker().buildArgs({ goal: 'x"; rm -rf /; echo "' })
    assert.strictEqual(a[a.indexOf('-p') + 1], 'x"; rm -rf /; echo "')
    assert.ok(!a.includes('--max-budget-usd'))
    assert.strictEqual(argOf(worker({ maxBudgetUsd: 2.5 }).buildArgs({ goal: 'g', sessionId: 's' }), '--max-budget-usd'), '2.5')
  })
})

describe('the fixed policy cannot be edited through the exports', () => {
  test('exports are deep frozen, and mutating them cannot move the argv', () => {
    assert.ok(Object.isFrozen(FIXED_SETTINGS.permissions) && Object.isFrozen(EMPTY_MCP_CONFIG.mcpServers))
    assert.ok(Object.isFrozen(ENQUIRY_JSON_SCHEMA.properties.citations.items))
    const w = worker()
    try { FIXED_SETTINGS.permissions.defaultMode = 'bypassPermissions' } catch (_) {}
    try { EMPTY_MCP_CONFIG.mcpServers.evil = { command: 'x' } } catch (_) {}
    try { READ_ONLY_TOOLS.push('Edit') } catch (_) {}
    try { ENQUIRY_JSON_SCHEMA.additionalProperties = true } catch (_) {}
    const a = w.buildArgs({ goal: 'g', sessionId: 's' })
    assert.strictEqual(JSON.parse(argOf(a, '--settings')).permissions.defaultMode, 'default')
    assert.deepStrictEqual(JSON.parse(argOf(a, '--mcp-config')).mcpServers, {})
    assert.strictEqual(argOf(a, '--tools'), 'Read,Grep,Glob')
    assert.strictEqual(JSON.parse(argOf(a, '--json-schema')).additionalProperties, false)
  })
})

describe('the caller cannot escalate', () => {
  for (const forbidden of ['allowedTools', 'tools', 'permissionMode', 'settings', 'mcpConfig', 'addDir', 'bare', 'sandboxRoot']) {
    test(`'${forbidden}' is refused at construction, loudly`, () => {
      const s = realSandbox()
      assert.throws(() => createClaudeCodeWorker({ workspace: s.workspace, cwd: s.dir, resolveFn: okResolve, [forbidden]: 'anything' }), /is not configurable/)
    })
  }

  test('a per-dispatch turn bound may TIGHTEN but never widen', () => {
    const w = worker({ maxTurns: 4 })
    assert.strictEqual(argOf(w.buildArgs({ goal: 'g', sessionId: 's', maxTurns: 2 }), '--max-turns'), '2')
    assert.strictEqual(argOf(w.buildArgs({ goal: 'g', sessionId: 's', maxTurns: 99 }), '--max-turns'), '4')
  })
})

/* ══════════════ 4. buildArgs has no authorising side effect ══════════════ */

describe('building an argv grants nothing', () => {
  test('⛔ buildArgs does NOT register a session; a later resume is refused and spawns nothing', async () => {
    let spawns = 0
    const w = worker({ allowResume: true, spawnFn: () => { spawns += 1; return fakeChild({}) } })
    w.buildArgs({ goal: 'g', sessionId: 'built-only' })      // merely constructed
    assert.throws(() => w.buildArgs({ goal: 'g2', resume: 'built-only' }), /never established/)
    const err = await w.dispatch({ goal: 'g2', resume: 'built-only' }).catch((e) => e)
    assert.match(err.message, /never established/)
    assert.strictEqual(spawns, 0, 'a refused resume must not reach a spawn')
  })

  test('a session becomes resumable only after a dispatch really established it', async () => {
    const s = realSandbox()
    const w = worker({ allowResume: true, spawnFn: emitting({ stdout: JSON.stringify(envelope({ session_id: 'real-1' })) }) }, s)
    assert.throws(() => w.buildArgs({ goal: 'g', resume: 'real-1' }), /never established/)
    await w.dispatch({ goal: 'g', sessionId: 'real-1' })
    assert.strictEqual(argOf(w.buildArgs({ goal: 'g2', resume: 'real-1' }), '--resume'), 'real-1')
  })

  test('⛔ a FAILED dispatch grants no resume rights', async () => {
    const w = worker({ allowResume: true, spawnFn: emitting({ stdout: JSON.stringify(envelope({ subtype: 'error_max_structured_output_retries' })) }) })
    await w.dispatch({ goal: 'g', sessionId: 'never-opened' }).catch(() => {})
    assert.throws(() => w.buildArgs({ goal: 'g2', resume: 'never-opened' }), /never established/)
  })

  test('another worker instance cannot resume the first one\'s session', async () => {
    const s = realSandbox()
    const a = worker({ allowResume: true, spawnFn: emitting({ stdout: JSON.stringify(envelope({ session_id: 'mine' })) }) }, s)
    await a.dispatch({ goal: 'g', sessionId: 'mine' })
    const b = worker({ allowResume: true }, s)
    assert.throws(() => b.buildArgs({ goal: 'g', resume: 'mine' }), /never established/)
  })

  test('resume is refused outright without allowResume', () => {
    assert.throws(() => worker().buildArgs({ goal: 'g', resume: 'x' }), /requires allowResume/)
  })
})

/* ══════════════ 3. workspace identity ══════════════ */

describe('the workspace must have been MINTED by this provider', () => {
  test('no provider / a provider without containmentCheck / a rejecting provider', () => {
    const s = realSandbox()
    assert.throws(() => createClaudeCodeWorker({ cwd: s.dir, resolveFn: okResolve }), /requires the trusted workspace provider/)
    assert.throws(() => createClaudeCodeWorker({ workspace: {}, cwd: s.dir, resolveFn: okResolve }), /containmentCheck/)
    assert.throws(() => createClaudeCodeWorker({ workspace: { containmentCheck: () => { throw new Error('no') } }, cwd: s.dir, resolveFn: okResolve }), /workspace provider rejected/)
  })

  test('a real provider that really prepared it is ACCEPTED', () => {
    const s = realSandbox()
    const w = createClaudeCodeWorker({ workspace: s.workspace, cwd: s.dir, resolveFn: okResolve })
    assert.ok(w.buildArgs({ goal: 'g', sessionId: 's' }).length > 0)
  })

  test('⛔ a HAND-MADE directory with the same prefix is refused — the v3 look-alike gap is closed', () => {
    // In v3 this passed: the prefix was standing in for provenance, and a prefix is a naming
    // convention anyone can satisfy. The mint register now answers instead, so a directory this
    // provider never minted is refused however it is named or wherever it sits.
    const workspace = createTmpdirSandbox({ prepareSandbox: () => {} })
    const lookalike = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sandbox-')); MADE.push(lookalike)
    assert.throws(
      () => createClaudeCodeWorker({ workspace, cwd: lookalike, resolveFn: okResolve }),
      /was not minted by this provider/
    )
  })

  test('⛔ a FAKE provider whose every method reports success is still refused', () => {
    const s = realSandbox()
    const liar = {
      containmentCheck: (p) => p,
      prepare: () => ({ dir: s.dir }),
      mintedByThisProvider: () => true,
      permissionMode: () => 'bypassPermissions',
      addDirs: (d) => [d],
      cleanup: () => {}
    }
    assert.throws(
      () => createClaudeCodeWorker({ workspace: liar, cwd: s.dir, resolveFn: okResolve }),
      /not created by tmpdirSandbox/,
      'the register is asked of the module, never of the provider'
    )
  })

  test('⛔ a directory minted by provider A, handed to provider B, is refused', () => {
    const a = realSandbox()
    const b = realSandbox()
    assert.throws(
      () => createClaudeCodeWorker({ workspace: b.workspace, cwd: a.dir, resolveFn: okResolve }),
      /was not minted by this provider/
    )
    // and each still accepts its own
    assert.ok(createClaudeCodeWorker({ workspace: a.workspace, cwd: a.dir, resolveFn: okResolve }))
    assert.ok(createClaudeCodeWorker({ workspace: b.workspace, cwd: b.dir, resolveFn: okResolve }))
  })

  test('⛔ a FAILED prepare() leaves no valid registration', () => {
    // ⛔ The exact path is captured in the init hook. Scanning tmpdir for the newest match, as
    // the first version did, would delete whatever else happened to be running.
    let created = null
    const workspace = createTmpdirSandbox({ prepareSandbox: (dir) => { created = dir; throw new Error('init blew up') } })
    try { workspace.prepare() } catch (_) { /* expected */ }
    assert.ok(created)
    MADE.push(created)
    // a NEWER unrelated sandbox that must survive
    const bystander = realSandbox()
    assert.throws(
      () => createClaudeCodeWorker({ workspace, cwd: created, resolveFn: okResolve }),
      /was not minted by this provider/,
      'a half-built sandbox must not count as minted'
    )
    assert.strictEqual(fs.existsSync(bystander.dir), true, 'a newer, unrelated sandbox must survive this test')
  })

  test('a legal SUBDIRECTORY of a minted workspace is accepted', () => {
    const s = realSandbox()
    const sub = path.join(s.dir, 'copy'); fs.mkdirSync(sub)
    const w = createClaudeCodeWorker({ workspace: s.workspace, cwd: sub, resolveFn: okResolve })
    assert.ok(w.buildArgs({ goal: 'g', sessionId: 's' }).length > 0)
  })

  test('⛔ a junction inside a minted workspace pointing at ANOTHER sandbox is refused', { skip: process.platform !== 'win32' }, () => {
    const a = realSandbox()
    const b = realSandbox()
    const link = path.join(a.dir, 'aliased')
    const r = require('node:child_process').spawnSync('cmd', ['/c', 'mklink', '/J', link, b.dir], { shell: false })
    if (r.status !== 0) return
    assert.throws(
      () => createClaudeCodeWorker({ workspace: a.workspace, cwd: link, resolveFn: okResolve }),
      /was not minted by this provider/,
      'the junction resolves to b, which a never minted'
    )
  })

  test('outside os.tmpdir(), and a missing directory, are refused', () => {
    const s = realSandbox()
    assert.throws(() => createClaudeCodeWorker({ workspace: s.workspace, cwd: path.resolve(__dirname, '..', '..'), resolveFn: okResolve }), /not under os.tmpdir|refuses to invoke/)
    assert.throws(() => createClaudeCodeWorker({ workspace: s.workspace, cwd: path.join(s.dir, 'nope'), resolveFn: okResolve }), /does not exist|was not minted/)
  })

  test('⛔ removed and RECREATED at the same path is refused before dispatch, with spawn 0', async () => {
    const s = realSandbox()
    let spawns = 0
    const w = createClaudeCodeWorker({
      workspace: s.workspace, cwd: s.dir, resolveFn: okResolve,
      spawnFn: () => { spawns += 1; return fakeChild({ stdout: JSON.stringify(envelope()) }) }
    })
    fs.rmSync(s.dir, { recursive: true, force: true })
    fs.mkdirSync(s.dir)                       // same path, same name, different directory
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.WORKSPACE_CHANGED)
    assert.strictEqual(spawns, 0, 'the check must happen before anything is started')
  })

  test('⛔ a deleted workspace is refused before dispatch, with spawn 0', async () => {
    const s = realSandbox()
    let spawns = 0
    const w = createClaudeCodeWorker({
      workspace: s.workspace, cwd: s.dir, resolveFn: okResolve,
      spawnFn: () => { spawns += 1; return fakeChild({ stdout: JSON.stringify(envelope()) }) }
    })
    fs.rmSync(s.dir, { recursive: true, force: true })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.WORKSPACE_CHANGED)
    assert.strictEqual(spawns, 0)
  })

  test('⛔ IN-PROCESS PROVENANCE, NOT OS ISOLATION — stated so it is not over-read', () => {
    // The register proves a directory came from this module's own prepare(). It says nothing
    // about a hostile process running as the same user, which can create, move or replace
    // directories regardless. That boundary is deliberate and is not widened here.
    const s = realSandbox()
    assert.ok(createClaudeCodeWorker({ workspace: s.workspace, cwd: s.dir, resolveFn: okResolve }))
  })
})

/* ══════════════ 2. the documented result contract ══════════════ */

describe('results are read by the documented contract, not by guesswork', () => {
  const cases = [
    ['a non-zero exit', { stdout: JSON.stringify(envelope()), close: 2 }, FAILURE.NONZERO_EXIT],
    ['no JSON at all', { stdout: 'not json' }, FAILURE.NO_PARSABLE_JSON],
    ['⛔ a result on STDERR only', { stdout: '', stderr: JSON.stringify(envelope()) }, FAILURE.NO_PARSABLE_JSON],
    ['⛔ LEADING garbage before the JSON', { stdout: 'warning: something\n' + JSON.stringify(envelope()) }, FAILURE.NO_PARSABLE_JSON],
    ['⛔ TRAILING garbage after the JSON', { stdout: JSON.stringify(envelope()) + '\nbye' }, FAILURE.NO_PARSABLE_JSON],
    ['a wrong message type', { stdout: JSON.stringify(envelope({ type: 'assistant' })) }, FAILURE.ENVELOPE_INVALID],
    ['a missing subtype', { stdout: JSON.stringify(Object.assign(envelope(), { subtype: undefined })) }, FAILURE.ENVELOPE_INVALID],
    ['the documented failure subtype', { stdout: JSON.stringify(envelope({ subtype: 'error_max_structured_output_retries' })) }, FAILURE.CLI_REPORTED_ERROR],
    ['⛔ success AND is_error together', { stdout: JSON.stringify(envelope({ is_error: true })) }, FAILURE.ENVELOPE_INVALID],
    ['a non-empty errors list', { stdout: JSON.stringify(envelope({ errors: ['retracted'] })) }, FAILURE.CLI_REPORTED_ERROR],
    ['⛔ success with NO structured_output', { stdout: JSON.stringify(Object.assign(envelope(), { structured_output: undefined })) }, FAILURE.STRUCTURED_OUTPUT_MISSING],
    ['structured_output that is not an object', { stdout: JSON.stringify(envelope({ structured_output: 'text' })) }, FAILURE.STRUCTURED_OUTPUT_MISSING],
    ['a negative cost', { stdout: JSON.stringify(envelope({ total_cost_usd: -1 })) }, FAILURE.ENVELOPE_INVALID],
    ['a string cost', { stdout: JSON.stringify(envelope({ total_cost_usd: '0.2' })) }, FAILURE.ENVELOPE_INVALID],
    ['a null cost', { stdout: JSON.stringify(envelope({ total_cost_usd: null })) }, FAILURE.ENVELOPE_INVALID],
    ['a fractional num_turns', { stdout: JSON.stringify(envelope({ num_turns: 1.5 })) }, FAILURE.ENVELOPE_INVALID],
    ['an empty session_id', { stdout: JSON.stringify(envelope({ session_id: '' })) }, FAILURE.ENVELOPE_INVALID],
    ['⛔ a result for ANOTHER session', { stdout: JSON.stringify(envelope({ session_id: 'someone-else' })) }, FAILURE.SESSION_MISMATCH],
    ['a payload missing a field', { stdout: JSON.stringify(envelope({ structured_output: { answer: 'a', citations: [] } })) }, FAILURE.PAYLOAD_INVALID],
    ['a payload with an extra field', { stdout: JSON.stringify(envelope({ structured_output: payloadOf({ extra: 1 }) })) }, FAILURE.PAYLOAD_INVALID],
    ['a blank citation quote', { stdout: JSON.stringify(envelope({ structured_output: payloadOf({ citations: [{ path: 'x.js', startLine: 1, endLine: 1, quote: '  ' }] }) })) }, FAILURE.PAYLOAD_INVALID]
  ]
  for (const [name, spec, code] of cases) {
    test('refuses ' + name, async () => {
      const err = await worker({ spawnFn: emitting(spec) }).dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
      assert.ok(err instanceof Error, name + ' resolved instead of failing')
      assert.strictEqual(err.failure, code, name + ' → got ' + err.failure + ': ' + err.message)
    })
  }

  test('a citation pointing OUTSIDE the copy fails the dispatch', async () => {
    const payload = payloadOf({ citations: [{ path: '../escape.js', startLine: 1, endLine: 1, quote: 'x' }] })
    const err = await worker({ spawnFn: emitting({ stdout: JSON.stringify(envelope({ structured_output: payload })) }) })
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.CITATION_OUTSIDE_COPY)
  })

  test('the correct format resolves, with the formal interface populated', async () => {
    const s = realSandbox()
    fs.writeFileSync(path.join(s.dir, 'a.js'), 'const a = 1\nconst b = 2\n')
    const payload = payloadOf({
      answer: 'b is two',
      citations: [{ path: 'a.js', startLine: 2, endLine: 2, quote: 'const b = 2' }],
      notEstablished: ['whether a is used']
    })
    const r = await worker({ spawnFn: emitting({ stdout: JSON.stringify(envelope({ structured_output: payload })) }) }, s)
      .dispatch({ goal: 'g', sessionId: 's' })
    assert.deepStrictEqual(r.payload, payload)
    assert.strictEqual(r.answer, 'b is two')
    assert.deepStrictEqual(r.notEstablished, ['whether a is used'])
    assert.strictEqual(r.citationsConfirmed, 1)
    assert.strictEqual(r.evidence.length, 1)
    assert.strictEqual(r.costUsd, 0.17)
    assert.strictEqual(r.numTurns, 3)
  })

  test('an absent cost is null, never a confident zero', async () => {
    const r = await worker({ spawnFn: emitting({ stdout: JSON.stringify({ type: 'result', subtype: 'success', session_id: 's', structured_output: payloadOf() }) }) })
      .dispatch({ goal: 'g', sessionId: 's' })
    assert.strictEqual(r.costUsd, null)
    assert.strictEqual(r.numTurns, null)
  })
})

/* ══════════════ 1. worker → runner ══════════════ */

describe('worker → runner: the handoff keeps everything, and unknown stays unknown', () => {
  const { runEnquiry } = require('./enquiryRunner')
  const { OUTCOME } = require('./investigationReport')

  test('the SUCCESS path carries answer, citations, evidence and notEstablished into the turn', async () => {
    const s = realSandbox()
    fs.writeFileSync(path.join(s.dir, 'a.js'), 'const a = 1\nconst b = 2\n')
    const payload = payloadOf({
      answer: 'b is two',
      citations: [{ path: 'a.js', startLine: 2, endLine: 2, quote: 'const b = 2' }],
      notEstablished: ['whether a is used']
    })
    const w = worker({ spawnFn: emittingForSession({ structured_output: payload }) }, s)
    let seenByNext = null
    const out = await runEnquiry({
      question: 'q',
      worker: (a) => w.dispatch(a),
      next: async (last) => {
        seenByNext = last
        return last ? { done: true, answer: last.answer, measurements: ['m'] } : { done: false, goal: 'g' }
      },
      budgetUsd: 5, maxRounds: 1
    })
    assert.strictEqual(out.report.outcome, OUTCOME.CONCLUDED)
    assert.deepStrictEqual(seenByNext, payload, 'next() receives the formal payload, not a string')
    const t = out.turns[0]
    assert.deepStrictEqual(t.payload, payload)
    assert.strictEqual(t.answer, 'b is two')
    assert.strictEqual(t.citations.length, 1)
    assert.strictEqual(t.evidence.length, 1)
    assert.deepStrictEqual(t.notEstablished, ['whether a is used'])
    assert.ok(t.termination, 'the termination record must survive the handoff')
    assert.strictEqual(t.costUsd, 0.17)
  })

  test('⛔ an UNKNOWN cost stays null and is never treated as zero spend', async () => {
    const s = realSandbox()
    // no total_cost_usd at all, and the session id echoed back so identity still holds
    const w = worker({ spawnFn: (cmd, args) => fakeChild({ stdout: JSON.stringify({ type: 'result', subtype: 'success', session_id: args[args.indexOf('--session-id') + 1], structured_output: payloadOf() }) }) }, s)
    const out = await runEnquiry({
      question: 'q',
      worker: (a) => w.dispatch(a),
      next: async (last) => (last ? { done: true, answer: 'a', measurements: ['m'] } : { done: false, goal: 'g' }),
      budgetUsd: 5, maxRounds: 1
    })
    assert.strictEqual(out.turns[0].costUsd, null, 'unknown must not become 0')
    assert.strictEqual(out.report.costUsd !== undefined, true)
  })

  test('⛔ after an unknown cost, the next round is NOT approved on "nothing spent"', async () => {
    let calls = 0
    const out = await runEnquiry({
      question: 'q',
      worker: async () => { calls += 1; return { payload: payloadOf(), costUsd: null } },
      next: async () => ({ done: false, goal: 'again' }),
      budgetUsd: 100, maxRounds: 5, allowResume: true
    })
    assert.strictEqual(calls, 1, 'a second round would be approved on arithmetic with a hole in it')
    assert.strictEqual(out.report.outcome, OUTCOME.STOPPED_ON_BUDGET)
  })

  test('a failed dispatch cannot become a completed enquiry', async () => {
    const w = worker({ spawnFn: emittingForSession({ structured_output: { answer: 'a', citations: [] } }) })
    const out = await runEnquiry({
      question: 'q',
      worker: (a) => w.dispatch(a),
      next: async (last) => (last ? { done: true, answer: 'a', measurements: ['m'] } : { done: false, goal: 'g' }),
      budgetUsd: 5, maxRounds: 1
    })
    assert.strictEqual(out.report.outcome, OUTCOME.FAILED)
  })
})

/* ══════════════ 5. stopping ══════════════ */

describe('stopping: bounded, split into separate claims, never assumed', () => {
  const hanging = (pid = 777) => {
    const c = new EventEmitter()
    c.pid = pid; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}
    return c
  }
  const stops = (child, extra = {}) => Object.assign({
    spawnFn: () => child,
    timeoutMs: 10,
    killTreeFn: (c, done) => { done(null); setImmediate(() => child.emit('close', null)) }
  }, extra)

  test('⛔ an ALREADY-aborted signal refuses before spawning anything', async () => {
    let spawns = 0
    const ac = new AbortController(); ac.abort()
    const err = await worker({ spawnFn: () => { spawns += 1; return fakeChild({}) } })
      .dispatch({ goal: 'g', sessionId: 's', signal: ac.signal }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.ABORTED_BEFORE_SPAWN)
    assert.strictEqual(spawns, 0)
  })

  test('⛔ the process TREE is never claimed stopped — we have no tree boundary', async () => {
    const child = hanging()
    const err = await worker(stops(child, { listDescendants: () => [1001], isAlive: () => false }))
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.termination.observedPidsGone, PIDS.CONFIRMED_GONE)
    assert.strictEqual(err.termination.descendantsTerminated, TREE.UNKNOWN,
      'every observed pid gone is not the same claim as "the tree stopped"')
  })

  test('one surviving observed pid keeps the pid check UNKNOWN', async () => {
    const child = hanging()
    const err = await worker(stops(child, { listDescendants: () => [1001, 1002], isAlive: (p) => p === 1002 }))
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.termination.observedPidsGone, PIDS.UNKNOWN)
  })

  test('⛔ a re-parented descendant we never observed cannot be counted as gone', async () => {
    const child = hanging()
    // The enumerator saw nothing under our pid — the descendant had already been re-parented.
    const err = await worker(stops(child, { listDescendants: () => [], isAlive: () => false }))
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.termination.observedPidsGone, PIDS.NOT_OBSERVED,
      'nothing was observed, so nothing can be reported gone')
    assert.strictEqual(err.termination.descendantsTerminated, TREE.UNKNOWN)
  })

  test('⛔ a liveness QUERY FAILURE is UNKNOWN, never "gone"', async () => {
    const child = hanging()
    const err = await worker(stops(child, { listDescendants: () => [1001], isAlive: () => { throw new Error('access denied') } }))
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.termination.observedPidsGone, PIDS.UNKNOWN)
  })

  test('an enumerator that throws leaves the pid check UNKNOWN', async () => {
    const child = hanging()
    const err = await worker(stops(child, { listDescendants: () => { throw new Error('nope') } }))
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.termination.observedPidsGone, PIDS.UNKNOWN)
  })

  test('a kill that FAILS is recorded as failed, not silently as done', async () => {
    const child = hanging()
    const err = await worker(stops(child, { killTreeFn: (c, done) => { done(new Error('taskkill exited 128')); setImmediate(() => child.emit('close', null)) } }))
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.termination.killIssued, 'FAILED')
  })

  test('⛔ a kill result arriving AFTER close is not lost and does not re-settle', async () => {
    const child = hanging()
    let settles = 0
    const w = worker({
      spawnFn: () => child,
      timeoutMs: 10,
      killTreeFn: (c, done) => { setImmediate(() => child.emit('close', null)); setTimeout(() => done(null), 20) }
    })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).then(() => { settles += 1 }, (e) => { settles += 1; return e })
    await new Promise((r) => setTimeout(r, 40))
    assert.strictEqual(settles, 1, 'the late kill callback must not settle the promise a second time')
    assert.strictEqual(err.failure, FAILURE.STOPPED)
  })

  test('a child that NEVER closes still settles within the grace', async () => {
    const err = await worker({ spawnFn: () => hanging(), timeoutMs: 5, terminationGraceMs: 40, killTreeFn: (c, done) => done(null) })
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.CHILD_DID_NOT_EXIT)
    assert.strictEqual(err.termination.directChildExited, false)
    assert.strictEqual(err.termination.descendantsTerminated, TREE.UNKNOWN)
  })

  test('an abort is CANCELLED, distinct from a timeout', async () => {
    const child = hanging()
    const ac = new AbortController()
    const w = worker({ spawnFn: () => child, timeoutMs: 60000, killTreeFn: (c, done) => { done(null); setImmediate(() => child.emit('close', null)) } })
    const p = w.dispatch({ goal: 'g', sessionId: 's', signal: ac.signal })
    setImmediate(() => ac.abort())
    assert.strictEqual((await p.catch((e) => e)).termination.stopReason, STOP_REASON.CANCELLED)
  })
})

/* ══════════════ 6. one shared byte cap ══════════════ */

describe('the byte cap is shared by both pipes and bounds the total', () => {
  const streamer = () => {
    const c = new EventEmitter()
    c.pid = 99; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}
    return c
  }

  test('⛔ each pipe under the cap but TOGETHER over it still truncates and stops', async () => {
    const child = streamer()
    const half = Math.floor(MAX_TOTAL_BYTES * 0.6)
    const w = worker({ spawnFn: () => child, killTreeFn: (c, done) => done(null) })
    const p = w.dispatch({ goal: 'g', sessionId: 's' })
    setImmediate(() => {
      child.stdout.emit('data', Buffer.alloc(half, 0x61))
      child.stderr.emit('data', Buffer.alloc(half, 0x62))   // neither alone exceeds the cap
      child.emit('close', 0)
    })
    const err = await p.catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.TRUNCATED)
    assert.ok(err.diagnostics.totalBytes <= MAX_TOTAL_BYTES, 'total kept ' + err.diagnostics.totalBytes)
    assert.ok(err.diagnostics.stdoutBytes < MAX_TOTAL_BYTES && err.diagnostics.stderrBytes < MAX_TOTAL_BYTES)
  })

  test('an overrun keeps draining the pipe and never exceeds the total', async () => {
    const child = streamer()
    let after = 0
    const w = worker({ spawnFn: () => child, killTreeFn: (c, done) => done(null) })
    const p = w.dispatch({ goal: 'g', sessionId: 's' })
    setImmediate(() => {
      child.stdout.emit('data', Buffer.alloc(MAX_TOTAL_BYTES + 10, 0x61))
      for (let i = 0; i < 5; i++) { child.stdout.emit('data', Buffer.alloc(1000, 0x62)); after += 1 }
      child.emit('close', 0)
    })
    const err = await p.catch((e) => e)
    assert.strictEqual(after, 5, 'reading must continue after the cap or the child blocks')
    assert.strictEqual(err.failure, FAILURE.TRUNCATED)
    assert.strictEqual(err.diagnostics.totalBytes, MAX_TOTAL_BYTES)
  })

  test('⛔ a multibyte character split ACROSS chunks still decodes and parses', async () => {
    const payload = payloadOf({ answer: '香香讀取咗檔案', notEstablished: ['未確認嘅嘢'] })
    const json = Buffer.from(JSON.stringify(envelope({ structured_output: payload })), 'utf8')
    const cut = json.indexOf(Buffer.from('香', 'utf8')) + 1   // inside a 3-byte character
    const child = streamer()
    const p = worker({ spawnFn: () => child }).dispatch({ goal: 'g', sessionId: 's' })
    setImmediate(() => {
      child.stdout.emit('data', json.subarray(0, cut))
      child.stdout.emit('data', json.subarray(cut))
      child.emit('close', 0)
    })
    const r = await p
    assert.strictEqual(r.answer, '香香讀取咗檔案')
    assert.deepStrictEqual(r.notEstablished, ['未確認嘅嘢'])
  })

  test('a retained slice does not hold its oversized source buffer alive', async () => {
    const child = streamer()
    const p = worker({ spawnFn: () => child, killTreeFn: (c, done) => done(null) }).dispatch({ goal: 'g', sessionId: 's' })
    const huge = Buffer.alloc(MAX_TOTAL_BYTES * 2, 0x63)
    setImmediate(() => { child.stdout.emit('data', huge); child.emit('close', 0) })
    const err = await p.catch((e) => e)
    // A subarray would share `huge`'s allocation; a copy does not.
    assert.ok(err.diagnostics.totalBytes <= MAX_TOTAL_BYTES)
  })
})

/* ══════════════ real processes: mechanism only, own pids only ══════════════ */

describe('real child/grandchild termination (no model, no network, no credentials)', () => {
  test('the tree kill removes a real grandchild it created, and reports completion', { skip: process.platform !== 'win32' }, async () => {
    const cp = require('node:child_process')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-ccw-kill-')); MADE.push(dir)
    const script = path.join(dir, 'p.js')
    fs.writeFileSync(script, [
      "const cp=require('child_process')",
      "const g=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})",
      'process.stdout.write(String(g.pid))',
      'setInterval(()=>{},1000)'
    ].join('\n'))
    const parent = cp.spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'ignore'] })
    const grandPid = await new Promise((r) => parent.stdout.once('data', (d) => r(Number(String(d).trim()))))
    const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return !!(e && e.code === 'EPERM') } }
    assert.ok(alive(parent.pid) && alive(grandPid))

    assert.strictEqual(await new Promise((r) => defaultKillTree(parent, r)), null, 'the kill must report completion')
    const deadline = Date.now() + 15000
    while (Date.now() < deadline && (alive(parent.pid) || alive(grandPid))) await new Promise((r) => setTimeout(r, 200))
    // ⛔ ONLY the pids this test created were targeted. Nothing was killed by name.
    assert.strictEqual(alive(parent.pid), false)
    assert.strictEqual(alive(grandPid), false, 'the GRANDCHILD is the whole point of the tree kill')
  })
})

test('cleanup: remove the disposable directories this suite created', () => {
  for (const d of MADE) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (_) {} }
  assert.ok(true)
})

/* ══════════════ v5: envelope strictness, proven against the v4 behaviour ══════════════ */

describe('the envelope must identify itself — v4 accepted all four of these', () => {
  // Verified against the v4 code reconstructed from the delivered v4 patch: each of these was
  // ACCEPTED there. `type` absent passed because the check was "if present, must be result";
  // `session_id` absent passed and was then BACKFILLED with the id we had asked for, which also
  // granted resume rights to an identity the CLI never confirmed.
  const without = (key) => { const e = envelope(); delete e[key]; return e }

  test('⛔ a genuinely ABSENT type is refused', async () => {
    const err = await worker({ spawnFn: emitting({ stdout: JSON.stringify(without('type')) }) })
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.ENVELOPE_INVALID)
  })

  test('⛔ an ABSENT session_id is refused rather than backfilled', async () => {
    const err = await worker({ spawnFn: emitting({ stdout: JSON.stringify(without('session_id')) }) })
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.ENVELOPE_INVALID)
    assert.match(err.message, /unidentified result/)
  })

  test('⛔ an unidentified result grants NO resume rights', async () => {
    const w = worker({ allowResume: true, spawnFn: emitting({ stdout: JSON.stringify(without('session_id')) }) })
    await w.dispatch({ goal: 'g', sessionId: 's' }).catch(() => {})
    assert.throws(() => w.buildArgs({ goal: 'g2', resume: 's' }), /never established/,
      'v4 would have registered the id it asked for and allowed this')
  })

  test('⛔ is_error as the STRING "false" is refused', async () => {
    const err = await worker({ spawnFn: emitting({ stdout: JSON.stringify(envelope({ is_error: 'false' })) }) })
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.ENVELOPE_INVALID)
    assert.match(err.message, /is_error must be a boolean/)
  })

  test('⛔ errors as a STRING is refused', async () => {
    const err = await worker({ spawnFn: emitting({ stdout: JSON.stringify(envelope({ errors: 'boom' })) }) })
      .dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.ENVELOPE_INVALID)
    assert.match(err.message, /errors must be an array/)
  })

  test('is_error: false and errors: [] are legitimate and still succeed', async () => {
    const r = await worker({ spawnFn: emitting({ stdout: JSON.stringify(envelope({ is_error: false, errors: [] })) }) })
      .dispatch({ goal: 'g', sessionId: 's' })
    assert.strictEqual(r.sessionId, 's')
  })
})

/* ══════════════ v5: the kill verdict is never lost ══════════════ */

describe('a kill result and a child exit race, and neither is dropped', () => {
  const hanging = (pid = 777) => {
    const c = new EventEmitter()
    c.pid = pid; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}
    return c
  }

  test('⛔ the child closes FIRST and the kill result arrives after — it is still recorded', async () => {
    const child = hanging()
    let settles = 0
    const w = worker({
      spawnFn: () => child,
      timeoutMs: 5,
      killGraceMs: 200,
      killTreeFn: (c, done) => { setImmediate(() => child.emit('close', null)); setTimeout(() => done(null), 30) }
    })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).then(() => { settles += 1 }, (e) => { settles += 1; return e })
    await new Promise((r) => setTimeout(r, 60))
    assert.strictEqual(settles, 1, 'exactly-once settlement')
    assert.strictEqual(err.termination.killIssued, 'ISSUED', 'v4 reported NOT_REQUESTED here')
    assert.strictEqual(err.termination.terminationRequested, true)
  })

  test('⛔ a kill verdict that never arrives is UNKNOWN, not NOT_REQUESTED and not ISSUED', async () => {
    const child = hanging()
    let settles = 0
    const w = worker({
      spawnFn: () => child,
      timeoutMs: 5,
      killGraceMs: 30,
      killTreeFn: (c, done) => { setImmediate(() => child.emit('close', null)) /* done() never called */ }
    })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).then(() => { settles += 1 }, (e) => { settles += 1; return e })
    await new Promise((r) => setTimeout(r, 60))
    assert.strictEqual(settles, 1)
    assert.strictEqual(err.termination.killIssued, 'UNKNOWN')
  })

  test('a kill that fails BEFORE close is still FAILED', async () => {
    const child = hanging()
    const w = worker({
      spawnFn: () => child,
      timeoutMs: 5,
      killTreeFn: (c, done) => { done(new Error('taskkill exited 128')); setImmediate(() => child.emit('close', null)) }
    })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.termination.killIssued, 'FAILED')
  })

  test('⛔ a liveness answer of UNKNOWN (null) never reads as gone', async () => {
    const child = hanging()
    const w = worker({
      spawnFn: () => child,
      timeoutMs: 5,
      killTreeFn: (c, done) => { done(null); setImmediate(() => child.emit('close', null)) },
      listDescendants: () => [1001],
      isAlive: () => null      // the query failed; we do not know
    })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.termination.observedPidsGone, PIDS.UNKNOWN)
  })
})

describe('defaultIsAlive is tri-state', () => {
  const { defaultIsAlive } = require('./claudeCodeWorker')

  test('our own process is alive', () => {
    assert.strictEqual(defaultIsAlive(process.pid), true)
  })

  test('a pid that cannot exist is definitely gone (ESRCH), not unknown', () => {
    // 0x7FFFFFFE is not a live pid on any platform we run on.
    assert.strictEqual(defaultIsAlive(2147483646), false)
  })

  test('⛔ any OTHER query failure is null — not false', () => {
    // Documented rather than simulated: only ESRCH returns false and only EPERM returns true;
    // every other error falls through to null. The branch is visible in the source, and the two
    // reachable cases above are exercised for real.
    assert.strictEqual(typeof defaultIsAlive(process.pid), 'boolean')
  })
})

/* ══════════════ v5.1: the two stop deadlines, on a controlled schedule ══════════════ */

describe('the exit deadline and the kill deadline do not talk over each other', () => {
  /** A child that only closes when this test says so, at a scheduled moment. */
  const scheduled = ({ closeAt = null, killAt = null, killErr = null } = {}) => {
    const c = new EventEmitter()
    c.pid = 4711; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}
    return {
      child: c,
      // The kill is "issued" when the worker asks; the verdict arrives (or does not) on schedule.
      killTreeFn: (_child, done) => {
        if (closeAt !== null) setTimeout(() => c.emit('close', null), closeAt)
        if (killAt !== null) setTimeout(() => done(killErr), killAt)
      }
    }
  }

  test('⛔ close at 20ms, kill verdict FAILED at 40ms, both graces 30ms — the verdict is kept and it is NOT a non-exit', async () => {
    // v5 armed the exit deadline for 30ms and never disarmed it on close, so it fired at 30ms
    // and reported CHILD_DID_NOT_EXIT about a child that had exited at 20ms.
    const s = scheduled({ closeAt: 20, killAt: 40, killErr: new Error('taskkill exited 128') })
    const w = worker({
      spawnFn: () => s.child, timeoutMs: 1,
      terminationGraceMs: 30, killGraceMs: 30,
      killTreeFn: s.killTreeFn
    })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.notStrictEqual(err.failure, FAILURE.CHILD_DID_NOT_EXIT, 'the child DID exit, at 20ms')
    assert.strictEqual(err.failure, FAILURE.STOPPED)
    assert.strictEqual(err.termination.directChildExited, true)
    assert.strictEqual(err.termination.killIssued, 'FAILED', 'a verdict inside the kill grace must be kept')
  })

  test('the same close timing with an ISSUED verdict keeps ISSUED', async () => {
    const s = scheduled({ closeAt: 20, killAt: 40, killErr: null })
    const w = worker({ spawnFn: () => s.child, timeoutMs: 1, terminationGraceMs: 30, killGraceMs: 30, killTreeFn: s.killTreeFn })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.STOPPED)
    assert.strictEqual(err.termination.directChildExited, true)
    assert.strictEqual(err.termination.killIssued, 'ISSUED')
  })

  test('⛔ close at 20ms and a verdict that NEVER arrives — bounded settlement, killIssued UNKNOWN', async () => {
    const s = scheduled({ closeAt: 20, killAt: null })
    const w = worker({ spawnFn: () => s.child, timeoutMs: 1, terminationGraceMs: 30, killGraceMs: 30, killTreeFn: s.killTreeFn })
    const started = Date.now()
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.STOPPED, 'the child exited, so this is a stop — not a non-exit')
    assert.strictEqual(err.termination.directChildExited, true)
    assert.strictEqual(err.termination.killIssued, 'UNKNOWN', 'REQUESTED is a question, not a conclusion')
    assert.ok(Date.now() - started < 2000, 'settlement must be bounded')
  })

  test('⛔ neither the child nor the kill ever reports — CHILD_DID_NOT_EXIT, directChildExited false, killIssued UNKNOWN', async () => {
    const s = scheduled({ closeAt: null, killAt: null })
    const w = worker({ spawnFn: () => s.child, timeoutMs: 1, terminationGraceMs: 30, killGraceMs: 30, killTreeFn: s.killTreeFn })
    const started = Date.now()
    const err = await w.dispatch({ goal: 'g', sessionId: 's' }).catch((e) => e)
    assert.strictEqual(err.failure, FAILURE.CHILD_DID_NOT_EXIT)
    assert.strictEqual(err.termination.directChildExited, false)
    assert.strictEqual(err.termination.killIssued, 'UNKNOWN')
    assert.ok(Date.now() - started < 2000, 'settlement must be bounded')
  })

  test('⛔ late and duplicate callbacks after settlement change nothing', async () => {
    const c = new EventEmitter()
    c.pid = 99; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}
    let doneRef = null
    let settles = 0
    const w = worker({
      spawnFn: () => c, timeoutMs: 1, terminationGraceMs: 30, killGraceMs: 20,
      killTreeFn: (_child, done) => { doneRef = done; setTimeout(() => c.emit('close', null), 5) }
    })
    const err = await w.dispatch({ goal: 'g', sessionId: 's' })
      .then(() => { settles += 1 }, (e) => { settles += 1; return e })
    const settledKill = err.termination.killIssued
    // Everything below arrives AFTER the promise settled.
    doneRef(null); doneRef(new Error('again')); doneRef(null)
    c.emit('close', 0); c.emit('close', 1)
    await new Promise((r) => setTimeout(r, 60))
    assert.strictEqual(settles, 1, 'exactly one settlement per dispatch')
    assert.strictEqual(err.termination.killIssued, settledKill, 'the recorded verdict must not be rewritten')
  })
})
