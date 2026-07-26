'use strict'

/**
 * uiStageA.test.js — the 香香 UI rebuild (Stage A).
 *
 * The UI moved out of a template literal into real asset files. Two things must hold:
 *   1. the page keeps every static-safety property it had (no markup-from-strings, no
 *      code-from-strings, no external request, no browser-side persistence, no token);
 *   2. the new live-progress channel cannot become a leak — the Owner sees a fixed
 *      vocabulary of phase names and nothing the agent produced.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { DEMO_HTML, buildDemoHtml, ASSET_DIR } = require('./demoHtml')
const { PHASES, PHASE_NAMES, isPhase, phaseLabel, buildAgentResultView } = require('../agent/agentResultView')
const { createOwnerApprovalStore } = require('../agent/ownerApprovalStore')

/* ── the page is assembled from real files, and stays one self-contained doc ── */

test('the page is built from asset files and inlines them — one same-origin document', () => {
  for (const f of ['index.html', 'app.css', 'app.js']) {
    assert.ok(fs.existsSync(path.join(ASSET_DIR, f)), 'asset exists: ' + f)
  }
  // the placeholders are gone, so nothing is fetched at runtime
  assert.ok(!DEMO_HTML.includes('INLINE_CSS') && !DEMO_HTML.includes('INLINE_JS'), 'placeholders replaced')
  assert.equal(DEMO_HTML.match(/<script>/g).length, 1, 'exactly one inline script')
  assert.equal(DEMO_HTML.match(/<style>/g).length, 1, 'exactly one inline style')
  assert.ok(!/<script[^>]+src=/.test(DEMO_HTML), 'no external script')
  assert.ok(!/<link[^>]+href=/.test(DEMO_HTML), 'no external stylesheet')
  assert.ok(!/<img/.test(DEMO_HTML), 'no image request')
  // and it is deterministic
  assert.equal(buildDemoHtml(), DEMO_HTML)
})

test('the inline script is valid JavaScript (a broken page used to fail silently)', () => {
  const m = DEMO_HTML.match(/<script>([\s\S]*?)<\/script>/)
  assert.doesNotThrow(() => new Function(m[1]), 'inline script must parse') // eslint-disable-line no-new-func
})

test('static safety: no markup-from-strings, no code-from-strings, no persistence, no token', () => {
  for (const forbidden of [
    'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write',
    'eval(', 'new Function',
    'localStorage', 'sessionStorage', 'document.cookie',
    'http://', 'https://', '//cdn', 'fonts.googleapis',
    'HUB_TOKEN', 'Authorization', 'Bearer'
  ]) {
    assert.ok(!DEMO_HTML.includes(forbidden), 'the page must not contain: ' + forbidden)
  }
  // every fetch is a same-origin absolute path
  const urls = DEMO_HTML.match(/fetch\('([^']+)'/g) || []
  assert.ok(urls.length > 0, 'the page does fetch')
  for (const u of urls) assert.ok(/fetch\('\//.test(u), 'same-origin path only: ' + u)
})

/* ── the progress vocabulary is CLOSED ───────────────────────────────────── */

test('a phase is one of a fixed set — anything else is refused, never passed through', () => {
  assert.deepEqual(PHASE_NAMES, ['accepted', 'preparing', 'running', 'verifying', 'done', 'failed'])
  for (const p of PHASE_NAMES) {
    assert.equal(isPhase(p), true)
    assert.equal(typeof phaseLabel(p), 'string')
  }
  // anything that could carry information out is not a phase
  for (const hostile of [
    'src/store/store.js', 'C:/Users/louis/.claude/.credentials.json', 'sk-ant-xxx',
    'reading file src/app.js', '<script>', '', null, undefined, 42, {}, ['running']
  ]) {
    assert.equal(isPhase(hostile), false, 'must not be a phase: ' + String(hostile))
    assert.equal(phaseLabel(hostile), null, 'must not render: ' + String(hostile))
  }
})

test('the store refuses to record anything outside the vocabulary', () => {
  const s = createOwnerApprovalStore()
  assert.equal(s.recordPhase('a1', 'running').ok, true)
  for (const hostile of ['src/app.js', 'sk-ant-leak', 'done ', 'DONE', '', null]) {
    const r = s.recordPhase('a1', hostile)
    assert.equal(r.ok, false, 'refused: ' + String(hostile))
    assert.equal(r.reason, 'unknown_phase')
  }
  const got = s.getPhases('a1')
  assert.equal(got.length, 1, 'only the legitimate phase was stored')
  assert.equal(got[0].phase, 'running')
  // the stored record carries a name and a time — nothing else
  assert.deepEqual(Object.keys(got[0]).sort(), ['at', 'phase'])
})

test('no phase label leaks a path, a prompt, a credential or agent output', () => {
  const blob = JSON.stringify(PHASES)
  for (const bad of ['/', '\\', '.js', '.md', 'sk-', 'token', 'key', 'src', 'prompt']) {
    assert.ok(!blob.toLowerCase().includes(bad), 'phase labels must not contain: ' + bad)
  }
  // the labels are short human sentences, not data
  for (const name of PHASE_NAMES) assert.ok(PHASES[name].length <= 20, name + ' label stays short')
})

/* ── the result view reads the runner's REAL shape ───────────────────────── */

const WO = Object.freeze({
  goal: 'canary', allowedFiles: ['docs/canary/agent-canary.md'], allowedTestCommand: null,
  forbiddenActions: ['commit'], timeoutSec: 120, costCapUsd: 0.5,
  branch: 'agent/appr_x', approvalId: 'appr_x'
})

test('the view reads output.filesChanged / output.diffSummary / cost / latencyMs', () => {
  // The first real canary reported "no data provided" for every field because the view
  // read a flat shape the runner never produces. This is that shape, correctly.
  const v = buildAgentResultView({
    approvalId: 'appr_x',
    workOrder: WO,
    result: {
      ok: true,
      cost: 0.0123,
      latencyMs: 7500,
      output: {
        filesChanged: ['docs/canary/agent-canary.md'],
        diffSummary: ' docs/canary/agent-canary.md | 2 +-',
        exit: 0, risks: [], warnings: [], branch: 'agent/appr_x', testResults: null
      }
    }
  })
  assert.equal(v.status, 'done')
  const txt = v.lines.join('\n')
  assert.ok(txt.includes('docs/canary/agent-canary.md'), 'the changed file is reported')
  assert.ok(txt.includes('2 +-'), 'the diff summary is reported')
  assert.ok(txt.includes('US$0.01'), 'cost is money-formatted')
  assert.ok(txt.includes('7.5 秒'), 'duration is reported')
  assert.ok(txt.includes('US$0.50'), 'the cap is money-formatted too')
  assert.ok(!txt.includes('執行器沒有提供這項資料'), 'nothing is falsely reported as missing')
  assert.equal(v.scope.inScope, true)
})

test('a run still in flight is reported as running, not as "nothing happened"', () => {
  const v = buildAgentResultView({ approvalId: 'appr_x', workOrder: WO, result: null, running: true })
  assert.equal(v.status, 'running')
  assert.ok(v.headline.includes('處理中'))
  // and with no hand-off at all it stays honest
  assert.equal(buildAgentResultView({ workOrder: WO, result: null }).status, 'pending')
})

test('a failure explains itself using the runner\'s own warnings', () => {
  const v = buildAgentResultView({
    workOrder: WO,
    result: { ok: false, output: { risks: ['files_outside_allowlist'], warnings: ['changed outside allowlist: src/app.js'], filesChanged: ['src/app.js'] } }
  })
  assert.equal(v.status, 'failed')
  const txt = v.lines.join('\n')
  assert.ok(txt.includes('失敗原因'))
  assert.ok(txt.includes('越界'), 'an out-of-scope run is called out')
  assert.ok(txt.includes('不應採用'))
})

/* ── the page's polling contract ─────────────────────────────────────────── */

test('the page POLLS the result endpoint instead of asking once', () => {
  assert.ok(DEMO_HTML.includes('function watchProgress ('), 'there is a progress watcher')
  assert.ok(DEMO_HTML.includes('setTimeout(tick, POLL_MS)'), 'it re-asks on a timer')
  assert.ok(DEMO_HTML.includes('POLL_MS = 1500'), 'a sane interval')
  // it stops on a terminal state rather than polling forever
  assert.ok(DEMO_HTML.includes("b.status === 'done'") && DEMO_HTML.includes("b.status === 'failed'"), 'terminal states end the poll')
  assert.ok(DEMO_HTML.includes('POLL_GRACE_MS'), 'and it gives up past the cap instead of spinning forever')
  // the result fetch is a pure READ — no method, no body, no nonce
  const m = DEMO_HTML.match(/fetch\('\/api\/v1\/owner\/results\/'[\s\S]{0,200}/)[0]
  assert.ok(!/method:/.test(m), 'plain GET')
  assert.ok(!/nonce/.test(m), 'no nonce is spent to read a result')
  assert.ok(!/body:/.test(m), 'no body')
})

test('elapsed time is shown against the cap the Owner approved', () => {
  assert.ok(DEMO_HTML.includes('已用 ') && DEMO_HTML.includes('上限 '), 'elapsed vs cap is rendered')
  assert.ok(DEMO_HTML.includes('b.capSec'), 'the cap comes from the server, not the page')
})

/* ── the approval contract is untouched by the redesign ──────────────────── */

test('the approval payload is still EXACTLY four fields', () => {
  const m = DEMO_HTML.match(/\/api\/v1\/owner\/approve[\s\S]*?JSON\.stringify\(\{([\s\S]*?)\}\)/)
  const keys = (m[1].match(/^\s*(\w+):/gm) || []).map((s) => s.trim().replace(':', '')).sort()
  assert.deepEqual(keys, ['approvalId', 'nonce', 'typedConfirmation', 'workOrderHash'])
  // Compare KEY NAMES, not substrings — `workOrderHash` legitimately contains
  // `workOrder`, and a substring scan would fail on the one field that must be there.
  for (const f of ['workOrder', 'allowedFiles', 'timeoutSec', 'costCapUsd', 'branch', 'forbiddenActions', 'goal', 'who']) {
    assert.ok(!keys.includes(f), 'no Work Order field travels from the browser: ' + f)
  }
})

test('the card is still a viewer: server-built sections, exact typed confirmation', () => {
  assert.ok(DEMO_HTML.includes('sealed.card'), 'sections come from the server')
  assert.ok(DEMO_HTML.includes('sealed.technicalLines'), 'technical detail comes from the server')
  assert.ok(!/sealed\.(goal|allowedFiles|timeoutSec|costCapUsd)\b/.test(DEMO_HTML), 'the page never re-composes fields')
  assert.ok(DEMO_HTML.includes('go.disabled = (typed.value !== sealed.typedConfirmationRequired)'), 'exact match only')
  assert.ok(DEMO_HTML.includes("createElement('details')"), 'technical detail stays collapsed by default')
})
