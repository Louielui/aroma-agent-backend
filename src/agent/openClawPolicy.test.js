'use strict'

/**
 * openClawPolicy.test.js — P1..P6 and the bound pinning.
 *
 * The policy is the only thing standing between a non-cancellable executor and the
 * repository, so "looks restrictive" is not good enough: each denial is asserted by name
 * against the authoritative 37-tool registry recovered from the installed OpenClaw build.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c2b2b1-p-'))

const test = require('node:test')
const assert = require('node:assert')

const P = require('../agent/openClawPolicy')

const plan = () => P.buildAgentPolicyPlan('aroma-appr_x', 1)
const opOf = (pl, suffix) => pl.operations.find((o) => o.path.endsWith(suffix))

/* ══════════════ P1/P2 — exactly one tool ══════════════ */

test('P1. allowed tools are exactly ["read"]', () => {
  const pl = plan()
  assert.deepStrictEqual(pl.allow, ['read'])
  assert.deepStrictEqual(opOf(pl, 'tools.allow').value, ['read'])
})

test('P2. every other one of the 37 authoritative tools is denied, by name', () => {
  const pl = plan()
  const deny = opOf(pl, 'tools.deny').value

  assert.strictEqual(P.CORE_TOOLS.length, 37, 'the authoritative registry is 37 tools')
  assert.strictEqual(deny.length, 36)

  // named explicitly: a set-difference bug would still satisfy a count assertion
  for (const t of [
    'write', 'edit', 'apply_patch', 'exec', 'process', 'code_execution',
    'browser', 'canvas', 'message', 'sessions_send', 'sessions_spawn', 'subagents',
    'cron', 'gateway', 'nodes', 'update_plan', 'create_goal', 'update_goal',
    'skill_workshop', 'image_generate', 'music_generate', 'video_generate', 'tts',
    'memory_search', 'memory_get'
  ]) {
    assert.ok(deny.includes(t), `${t} must be denied`)
  }
  assert.ok(!deny.includes('read'), 'read is the one grant')
  assert.deepStrictEqual(
    P.CORE_TOOLS.filter((t) => !deny.includes(t)), ['read'],
    'nothing outside the allowlist may survive the denylist'
  )
})

test('P2b. the workspace confinement flag is set, and exec.mode is deliberately NOT', () => {
  const pl = plan()
  assert.strictEqual(opOf(pl, 'tools.fs.workspaceOnly').value, true)
  assert.strictEqual(pl.operations.some((o) => o.path.includes('tools.exec.mode')), false,
    'exec.mode=deny disables the Codex runtime itself — measured, not assumed')
  assert.deepStrictEqual(pl.omits, ['tools.exec.mode'])
})

/* ══════════════ P3 — skills ══════════════ */

test('P3. skills are exactly [] — the separate capability surface is closed too', () => {
  // 14 skills were injected into the system prompt during the C2-B2-A probe. Tools and
  // skills are different surfaces; closing one does not close the other.
  const pl = plan()
  assert.deepStrictEqual(opOf(pl, '.skills').value, [])
})

/* ══════════════ P4 — no network ══════════════ */

test('P4. ⛔ no network tool is granted, in any form', () => {
  const pl = plan()
  const deny = opOf(pl, 'tools.deny').value
  for (const t of P.NETWORK_TOOLS) {
    assert.ok(!pl.allow.includes(t), `${t} must not be allowed`)
    assert.ok(deny.includes(t), `${t} must be denied`)
  }
  assert.deepStrictEqual(P.NETWORK_TOOLS.slice(), ['web_search', 'web_fetch', 'x_search'])
})

/* ══════════════ P5/P6 — plugins, and inertness ══════════════ */

test('P5. the plugin allowlist plan is exactly ["openai","codex"]', () => {
  const g = P.buildGlobalPolicyPlan()
  const op = g.operations.find((o) => o.path === 'plugins.allow')
  assert.deepStrictEqual(op.value, ['openai', 'codex'])
  assert.deepStrictEqual(g.slotExceptions, ['memory-core'],
    'the bundled slot plugin that loads anyway is recorded, not hidden')
  assert.strictEqual(g.appliesToSharedState, true, 'plugins.allow is global — flagged as such')
})

test('P6. ⛔ the policy module cannot mutate anything: it plans, it does not execute', () => {
  // The strongest available guarantee that this tranche wrote no real OpenClaw config is
  // that the module has no way to. No process spawning, no fs writing, no wsl launcher.
  // Comments are stripped first. The header explains WHY there is no child_process import,
  // so a naive scan of the whole file would be caught by the very sentence documenting the
  // guarantee — a check that fails on its own documentation teaches people to delete the
  // documentation.
  const raw = fs.readFileSync(path.join(__dirname, 'openClawPolicy.js'), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  // Matched as call shapes, not substrings: 'sessions_spawn' is a TOOL NAME in the registry
  // data, and a substring scan would flag the denylist that disarms it.
  const banned = [
    /child_process/, /\bspawnSync\b/, /\bspawn\s*\(/, /\bexecSync\b/, /\bexec\s*\(/,
    /wsl\.exe/, /writeFileSync/, /openclaw\.json/
  ]
  for (const re of banned) {
    assert.ok(!re.test(code), `openClawPolicy must not reference ${re} in code`)
  }
  assert.ok(!/require\s*\(/.test(code.replace(/module\.exports[\s\S]*$/, '')),
    'the policy module requires nothing at all')
  // and what it returns is inert data
  const pl = plan()
  for (const op of pl.operations) {
    assert.strictEqual(typeof op.path, 'string')
    assert.ok('value' in op)
    assert.strictEqual(typeof op.apply, 'undefined', 'no operation carries an executor')
  }
})

test('P6b. the shared main agent is never a policy target', () => {
  assert.throws(() => P.buildAgentPolicyPlan('main', 0), /main agent is never a policy target/)
  for (const bad of ['', 'a b', '../x', 'x'.repeat(65)]) {
    assert.throws(() => P.buildAgentPolicyPlan(bad, 1), /safe agentId/)
  }
  assert.throws(() => P.buildAgentPolicyPlan('aroma-x', -1), /agents.list index/)
  assert.throws(() => P.buildAgentPolicyPlan('aroma-x', 'one'), /agents.list index/)
})

/* ══════════════ B1/B2 — the bounds ══════════════ */

test('B1. ⛔ setting only runRetries.max does NOT lower the ceiling — min floors it', () => {
  // The installed algorithm is:
  //   maxLimit = Math.max(minLimit, cfg.max ?? 160)
  // so a policy that set max alone would read as bounded at 8 and actually be bounded at 32.
  // This is the trap; the plan avoids it by writing base, min and max together.
  assert.strictEqual(P.effectiveRunLoopCeiling({ max: 8 }), 32,
    'max alone is silently floored back up to the default min')
  assert.strictEqual(P.effectiveRunLoopCeiling({ min: 8, max: 8 }), 8,
    'lowering min as well is what actually lowers the ceiling')
  assert.strictEqual(P.effectiveRunLoopCeiling({}), 32, 'installed default for one profile candidate')
  assert.strictEqual(P.effectiveRunLoopCeiling({}, 20), 160, 'and is capped at the installed 160')
})

test('B1b. the plan writes base, min AND max, and its stated ceiling is the real one', () => {
  const pl = plan()
  for (const k of ['runRetries.base', 'runRetries.min', 'runRetries.max']) {
    assert.strictEqual(opOf(pl, k).value, P.RUN_RETRY_CEILING, `${k} must be pinned`)
  }
  assert.strictEqual(pl.ceiling, P.RUN_RETRY_CEILING)

  // recomputed through the installed algorithm, for any number of fallback profiles
  const cfg = { base: P.RUN_RETRY_CEILING, min: P.RUN_RETRY_CEILING, max: P.RUN_RETRY_CEILING, perProfile: 0 }
  for (const candidates of [1, 2, 5, 20]) {
    assert.strictEqual(P.effectiveRunLoopCeiling(cfg, candidates), P.RUN_RETRY_CEILING,
      `the ceiling must not scale with ${candidates} fallback profiles`)
  }
  assert.ok(P.RUN_RETRY_CEILING < P.INSTALLED_RUN_RETRY_DEFAULTS.max, 'a real reduction from 160')
})

test('B2. maxTokens and the request timeout are pinned to fixed trusted values', () => {
  const g = P.buildGlobalPolicyPlan()
  const tokens = g.operations.find((o) => o.path.endsWith('maxTokens'))
  const timeout = g.operations.find((o) => o.path.endsWith('timeoutSeconds'))
  assert.strictEqual(tokens.value, P.MAX_OUTPUT_TOKENS)
  assert.strictEqual(timeout.value, P.REQUEST_TIMEOUT_SECONDS)
  assert.ok(Number.isInteger(tokens.value) && tokens.value > 0)
  assert.ok(Number.isInteger(timeout.value) && timeout.value > 0)

  // the COST statement this supports, stated as arithmetic rather than as a hope
  assert.strictEqual(P.RUN_RETRY_CEILING * P.MAX_OUTPUT_TOKENS, 24 * 8000,
    'one turn cannot emit more than ceiling x maxTokens output tokens')
})
