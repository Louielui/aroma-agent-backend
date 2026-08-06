'use strict'

/**
 * claudeCodeWorker.test.js — the real dispatcher's arguments and its fence.
 *
 * No test spawns a real CLI. What is asserted is the ARGUMENT ARRAY, because that array is
 * where the fence lives: `--allowedTools` is a grant made of absence, and the whole ruling is
 * that it must be per-dispatch rather than a widened default.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { createClaudeCodeWorker, READ_ONLY_TOOLS } = require('./claudeCodeWorker')

describe('session continuity is in the arguments', () => {
  test('round 1 opens a session with --session-id', () => {
    const w = createClaudeCodeWorker()
    const a = w.buildArgs({ goal: 'g', sessionId: 'uuid-1' })
    assert.ok(a.includes('--session-id'))
    assert.strictEqual(a[a.indexOf('--session-id') + 1], 'uuid-1')
    assert.ok(!a.includes('--resume'), 'round 1 must not resume')
  })

  test('later rounds RESUME and do not re-open', () => {
    const w = createClaudeCodeWorker()
    const a = w.buildArgs({ goal: 'g', resume: 'uuid-1' })
    assert.ok(a.includes('--resume'))
    assert.strictEqual(a[a.indexOf('--resume') + 1], 'uuid-1')
    assert.ok(!a.includes('--session-id'), 'resuming and re-opening are different operations')
  })

  test('the goal is an argument, never concatenated into a shell string', () => {
    const w = createClaudeCodeWorker()
    const a = w.buildArgs({ goal: 'x"; rm -rf /; echo "' })
    assert.strictEqual(a[0], '-p')
    assert.strictEqual(a[1], 'x"; rm -rf /; echo "', 'the goal must survive verbatim as ONE argv entry')
  })
})

describe('the grant is per dispatch, and read-only by default', () => {
  test('an enquiry gets READ tools only — it asks questions, it does not change files', () => {
    const w = createClaudeCodeWorker()
    const a = w.buildArgs({ goal: 'g' })
    const tools = a[a.indexOf('--allowedTools') + 1]
    assert.ok(!/Edit|Write/.test(tools), 'default grant must not include write tools, got: ' + tools)
    for (const t of READ_ONLY_TOOLS) assert.ok(tools.includes(t))
  })

  test('a wider grant must be asked for AT THE CALL SITE, per dispatch', () => {
    const w = createClaudeCodeWorker({ allowedTools: ['Read', 'Edit'] })
    const tools = w.buildArgs({ goal: 'g' })[
      w.buildArgs({ goal: 'g' }).indexOf('--allowedTools') + 1
    ]
    assert.ok(tools.includes('Edit'))
  })

  test('NO browser tool is reachable — measured TOOL_NOT_AVAILABLE, and never a default here', () => {
    const w = createClaudeCodeWorker()
    const tools = w.buildArgs({ goal: 'g' })[w.buildArgs({ goal: 'g' }).indexOf('--allowedTools') + 1]
    assert.ok(!/chrome|browser|mcp__/i.test(tools),
      'adding one string here is the cheapest edit and the fifth degradation this week')
  })
})

describe('failures are errors, not empty results', () => {
  test('unparsable CLI output rejects rather than resolving with nothing', async () => {
    const w = createClaudeCodeWorker({
      spawnFn: () => {
        const { EventEmitter } = require('node:events')
        const c = new EventEmitter()
        c.stdout = new EventEmitter(); c.stderr = new EventEmitter()
        setImmediate(() => { c.stdout.emit('data', 'not json at all'); c.emit('close', 1) })
        return c
      }
    })
    await assert.rejects(() => w.dispatch({ goal: 'g', sessionId: 's' }), /no parsable JSON/)
  })

  test('a parsed result carries cost and turns through', async () => {
    const w = createClaudeCodeWorker({
      spawnFn: () => {
        const { EventEmitter } = require('node:events')
        const c = new EventEmitter()
        c.stdout = new EventEmitter(); c.stderr = new EventEmitter()
        setImmediate(() => {
          c.stdout.emit('data', JSON.stringify({ result: 'ok', total_cost_usd: 0.17, num_turns: 3, session_id: 'S' }))
          c.emit('close', 0)
        })
        return c
      }
    })
    const r = await w.dispatch({ goal: 'g', sessionId: 'S' })
    assert.strictEqual(r.costUsd, 0.17)
    assert.strictEqual(r.numTurns, 3)
    assert.strictEqual(r.sessionId, 'S')
  })
})

describe('the CLI resolver returns an OBJECT, not a string', () => {
  test('an unresolvable CLI rejects with the resolver\'s own reason', async () => {
    // The first real enquiry FAILED here: resolveAgentCliCommand returns
    // { ok, command, reason } and treating it as a bare string produced a spawn error four
    // levels from the cause — which the report then relayed faithfully as 「中途失敗」 without
    // being able to say why. The report was honest; the message was useless.
    const w = createClaudeCodeWorker({ resolveFn: () => ({ ok: false, reason: 'no CLI here' }) })
    await assert.rejects(() => w.dispatch({ goal: 'g', sessionId: 's' }), /not resolvable — no CLI here/)
  })
})
