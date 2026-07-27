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

/* ── Stage A.1: the composer ─────────────────────────────────────────────── */

test('the composer and the message column share ONE centre axis', () => {
  // The Owner's complaint: messages centred, input jammed bottom-left. Both are now
  // constrained by the same custom property and both centre with auto margins.
  assert.ok(/--col:\s*\d+px/.test(DEMO_HTML), 'a shared column width exists')
  assert.ok(/\.thread\s*\{[^}]*max-width:\s*var\(--col\)/.test(DEMO_HTML), 'the thread uses it')
  assert.ok(/\.composer-col\s*\{[^}]*max-width:\s*var\(--col\)/.test(DEMO_HTML), 'the composer uses it')
  assert.ok(/\.composer-col\s*\{[^}]*margin:\s*0\s+auto/.test(DEMO_HTML), 'and centres on the same axis')
})

test('the input is a designed container, not a raw textarea', () => {
  const box = DEMO_HTML.match(/#composer-box\s*\{[^}]*\}/)[0]
  assert.ok(/border-radius:\s*22px/.test(box), 'large radius')
  assert.ok(/border:\s*1px solid/.test(box), 'subtle border')
  assert.ok(/padding:/.test(box), 'internal padding')
  const ta = DEMO_HTML.match(/#composer-box textarea\s*\{[^}]*\}/)[0]
  assert.ok(/border:\s*0/.test(ta), 'no default border')
  assert.ok(/outline:\s*none/.test(ta), 'no default outline')
  assert.ok(/resize:\s*none/.test(ta), 'no resize handle')
  assert.ok(/max-height:\s*200px/.test(ta) && /overflow-y:\s*auto/.test(ta), 'auto-grow then scroll')
  assert.ok(/#composer-box:focus-within\s*\{[^}]*box-shadow/.test(DEMO_HTML), 'a soft focus ring')
})

test('the composer is sticky with room beneath, and the send button lives inside it', () => {
  const c = DEMO_HTML.match(/#composer\s*\{[^}]*\}/)[0]
  assert.ok(/position:\s*sticky/.test(c) && /bottom:\s*0/.test(c), 'sticky to the bottom')
  assert.ok(/padding:[^;]*18px/.test(c), 'breathing room beneath, not flush')
  // the button is inside the rounded container IN THE MARKUP (slice the body, not the
  // inlined stylesheet, which mentions the same class names earlier in the document)
  const body = DEMO_HTML.slice(DEMO_HTML.indexOf('<body>'))
  const box = body.slice(body.indexOf('id="composer-box"'), body.indexOf('composer-note'))
  assert.ok(box.includes('id="send"'), 'send sits inside the container')
  assert.ok(box.includes('id="msg"'), 'so does the textarea')
  const s = DEMO_HTML.match(/#send\s*\{[^}]*\}/)[0]
  assert.ok(/border-radius:\s*50%/.test(s), 'circular')
})

test('send is disabled until there is real input, and while a reply is in flight', () => {
  assert.ok(DEMO_HTML.includes('send.disabled = true'), 'starts disabled')
  assert.ok(DEMO_HTML.includes("send.disabled = pending || msg.value.trim() === ''"), 'enabled only on real input')
  assert.ok(DEMO_HTML.includes("send.disabled = p || msg.value.trim() === ''"), 'stays disabled while busy')
  assert.ok(DEMO_HTML.includes('msg.disabled = p'), 'the box is busy too')
  // Enter/Shift+Enter behaviour is unchanged
  assert.ok(DEMO_HTML.includes("e.key === 'Enter' && !e.shiftKey"), 'Enter sends, Shift+Enter newlines')
})

test('the placeholder is short enough not to be clipped', () => {
  const m = DEMO_HTML.match(/id="msg"[^>]*placeholder="([^"]*)"/)
  assert.ok(m, 'the textarea has a placeholder')
  assert.ok(m[1].length <= 12, 'placeholder is short: ' + m[1])
  assert.ok(!m[1].includes('Enter'), 'the Enter/Shift+Enter hint is no longer crammed into it')
})

test('the lane switcher sits inside the composer, not floating in the top bar', () => {
  const body2 = DEMO_HTML.slice(DEMO_HTML.indexOf('<body>'))
  const bar = body2.slice(body2.indexOf('composer-bar'), body2.indexOf('composer-note'))
  assert.ok(bar.includes('id="modes"'), 'the lane switcher is in the composer bar')
  const top = body2.slice(body2.indexOf('id="topbar"'), body2.indexOf('id="log"'))
  assert.ok(!top.includes('id="modes"'), 'and no longer detached at the top right')
})

test('an empty conversation is not also listed in the sidebar', () => {
  assert.ok(DEMO_HTML.includes('function isListed (c) { return c.history.length > 0 }'), 'listing requires content')
  assert.ok(DEMO_HTML.includes('if (!isListed(convs[i])) continue'), 'empty ones are skipped')
  assert.ok(DEMO_HTML.includes("titleEl.textContent = isListed(c) ? c.title : '香香'"), 'the header does not repeat an empty title')
})

/* ── Stage A.2: the model picker ─────────────────────────────────────────── */

test('the picker offers exactly the two providers the server allows', () => {
  assert.ok(DEMO_HTML.includes("id: 'claude'") && DEMO_HTML.includes("id: 'openai'"), 'both options')
  const ids = [...DEMO_HTML.matchAll(/\{ id: '([a-z]+)', name:/g)].map((m) => m[1]).sort()
  assert.deepEqual(ids, ['claude', 'openai'], 'and no third option the server would reject')
  assert.ok(DEMO_HTML.includes('providerHint: provider'), 'the pick is sent as a hint field')
})

test('*** the context asymmetry is stated ON the option, not buried ***', () => {
  // Without this the Owner reads a thinner GPT answer as a worse model rather than a
  // blinder one. It must be visible text in the menu, not a title attribute.
  assert.ok(DEMO_HTML.includes('睇唔到 Drive／Gmail／日曆／GitHub 同過往決定'), 'the GPT limitation is spelled out')
  assert.ok(DEMO_HTML.includes('睇到 Drive／Gmail／日曆／GitHub 同過往決定'), 'and the Claude capability, for contrast')
  assert.ok(DEMO_HTML.includes("el('div', 'opt-note'"), 'rendered as a visible note element')
  assert.ok(!/title="[^"]*睇唔到/.test(DEMO_HTML), 'not a tooltip-only disclosure')
  assert.ok(/\.opt-note\s*\{/.test(DEMO_HTML), 'and it is styled to be read')
})

test('each reply is labelled with the provider that ACTUALLY answered', () => {
  assert.ok(DEMO_HTML.includes('function labelServedBy'), 'there is a served-by label')
  assert.ok(DEMO_HTML.includes('res.servedBy'), 'it reads the server-reported provider')
  assert.ok(DEMO_HTML.includes('你揀嘅嗰個失敗咗'), 'a fallback is disclosed, not hidden')
  // it must not simply echo what the page asked for
  assert.ok(!/labelServedBy[\s\S]{0,400}provider\b/.test(DEMO_HTML.slice(DEMO_HTML.indexOf('function labelServedBy'), DEMO_HTML.indexOf('function labelServedBy') + 400)),
    'the label never reads the local pick')
})
