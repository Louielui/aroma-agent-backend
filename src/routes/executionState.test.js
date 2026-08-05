'use strict'

/**
 * executionState.test.js — the last unverified cell in a gate that is currently open.
 *
 * The audit-wiring question could be answered for `workerDeps.artifactStore` from the LIVE
 * process — GET /return-ready 503s when it is missing, and it returned 200 — but not for the
 * agent runner's own copy, because `app.agentAuditConfigured` was never exposed. Reading
 * app.js is exactly what hid the CAP-7 defect after the first canary, so "the code says they
 * are the same object" is not an acceptable answer about a live, open gate.
 *
 * ── WHY AN ENDPOINT AND NOT A STARTUP LOG LINE ───────────────────────────────
 * The Owner's two criteria were: survives a restart, and cannot drift.
 *
 *   A LOG LINE survives a restart but is a point-in-time claim, in a file that rotates. It
 *   says what was true at boot and nothing about the process running now.
 *   AN ENDPOINT can be asked at any moment and answers from the live object.
 *
 * CANNOT DRIFT is a property of WHAT is read. This forwards a value the composition root
 * already computed from the runner's own answer; it never recomputes the question, which is
 * the thing that drifts. Pinned below.
 *
 * ── WHY IT IS NOT ON THE CHAT SURFACE ────────────────────────────────────────
 * The first version sat in demoRouter and turned the bridge-isolation invariant red:
 * demo / context / intake must remain unaware of the bridge. That invariant is correct, so
 * the route moved to the surface that already owns approval and execution — the invariant
 * was not weakened to accommodate it.
 *
 * MEASUREMENT, NOT REPAIR. It changes no execution behaviour and fixes nothing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(path.join(__dirname, 'ownerApprovalRouter.js'), 'utf8')

/* ═══ 1. IT FORWARDS, AND NEVER DERIVES ══════════════════════════════════ */

test('*** the route exists on the approval surface, GET-only ***', () => {
  assert.ok(/router\.get\('\/api\/v1\/owner\/execution-state'/.test(SRC), 'route not registered')
})

test('*** it forwards app.agentAuditConfigured — no second computation ***', () => {
  const at = SRC.indexOf("router.get('/api/v1/owner/execution-state'")
  const body = SRC.slice(at, SRC.indexOf('})', SRC.indexOf('res.json', at)))
  assert.ok(/req\.app/.test(body) && /agentAuditConfigured/.test(body), 'it must read the app value: ' + body)
  // If this handler ever computes the answer itself it can disagree with the runner, which
  // is precisely the drift the Owner asked to be made impossible.
  for (const forbidden of ['resolveAgentBridge', 'createAgentRunner', 'artifactStore', 'require(', 'auditLog']) {
    assert.equal(body.includes(forbidden), false, 'the route must forward, not derive: ' + forbidden)
  }
})

test('*** NULL IS NOT FALSE — the two states must not collapse ***', () => {
  // 「nothing was constructed」 and 「it was constructed without an audit」 are different, and
  // a reader who sees `false` for both would draw the wrong conclusion about an open gate.
  const at = SRC.indexOf("router.get('/api/v1/owner/execution-state'")
  const body = SRC.slice(at, SRC.indexOf('})', SRC.indexOf('res.json', at)))
  assert.ok(/typeof v === 'boolean' \? v : null/.test(body), 'got: ' + body)
})

/* ═══ 2. IT IS GUARDED LIKE ITS SIBLINGS ═════════════════════════════════ */

test('*** it goes through the same transport refusal as every other owner route ***', () => {
  const at = SRC.indexOf("router.get('/api/v1/owner/execution-state'")
  const body = SRC.slice(at, SRC.indexOf('})', SRC.indexOf('res.json', at)))
  assert.ok(/transportRefusal\(req\)/.test(body), 'not behind the loopback/CSRF check')
  assert.ok(/refuse\(res, 403/.test(body), 'and it refuses rather than falling through')
})

test('it leaks nothing — one boolean-or-null, and no path', () => {
  const at = SRC.indexOf("router.get('/api/v1/owner/execution-state'")
  const body = SRC.slice(at, SRC.indexOf('})', SRC.indexOf('res.json', at)))
  const json = body.slice(body.indexOf('res.json'))
  assert.equal(/[A-Za-z]:\\\\|artifactRoot|dir|path/.test(json), false, 'a path or root escaped: ' + json)
})

/* ═══ 3. THE INVARIANT IT WAS MOVED TO RESPECT ═══════════════════════════ */

test('*** the chat surface still knows nothing about the bridge ***', () => {
  // The reason this file is not in demoRouter. Asserted here too, so the connection between
  // the move and the invariant is visible from the code that caused it.
  for (const f of ['demoRouter.js', 'contextRouter.js', 'intakeRouter.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
    assert.equal(/agentRunner|AgentBridge/.test(src), false, f + ' must not reference the agent bridge')
  }
})
