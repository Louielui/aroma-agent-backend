'use strict'

/**
 * workRequestResolution.test.js — the Owner chooses, and everything that must not.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE ONE THING THIS ENDPOINT EXISTS TO AVOID. When the Owner is shown two files, the
 * obvious way to send his answer back is the path — and that would make the browser the thing
 * that decides which file a Work Order aims at. The whole chain from work request to sealed
 * order exists to prevent exactly that, so the candidates stay server-side and only an opaque
 * ticket travels.
 *
 * ⛔ AND A TICKET IS NOT A LOGIN. /api/v1/demo sits behind requireOwner, but requireOwner also
 * admits a SERVICE TOKEN — and a service token is not a person choosing between two pages. The
 * handler insists on the Owner's own session cookie as well, which is what the token-only test
 * below is for.
 *
 * ⛔ RESOLVING IS NOT PERMITTING. An Aroma System page can be named exactly and still cannot be
 * changed: only one repository is bound to the executor. Those turns must end with zero
 * artifacts, and the tests count the store rather than trusting the reply.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-b2b1-'))

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { createDemoRouter } = require('./demoRouter')
const { SESSION_COOKIE } = require('../governance/ownerAuth')
const store = require('../store/store')

const CID = '11111111-2222-4333-8444-555555555555'
const CID2 = '99999999-8888-4777-8666-555555555555'
const REAL_FILE = 'docs/canary/agent-canary.md'

/** A minimal app with a real Owner session store, exactly as app.js wires it. */
function harness () {
  const issued = []
  const sessions = {
    valid: (id) => typeof id === 'string' && issued.includes(id),
    issue: () => { const id = 'sess_' + issued.length; issued.push(id); return id }
  }
  const proposals = []
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.locals.ownerSessions = sessions
  app.locals.promoteToProposal = async (taskId) => {
    const p = { id: 'prop_' + proposals.length, sourceTaskId: taskId }
    proposals.push(p)
    return { ok: true, proposal: p }
  }
  app.use(createDemoRouter({
    getAdapterFn: () => ({ label: 'x' }),
    processIntakeFn: async () => ({ blocked: false, mode: 'chat', talkOnly: true, reply: 'ok', proposals: [] })
  }))
  return { app, sessions, proposals }
}

async function call (app, pathname, body, cookie) {
  const server = app.listen(0)
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (cookie) headers.Cookie = SESSION_COOKIE + '=' + cookie
    const res = await fetch('http://127.0.0.1:' + server.address().port + pathname, {
      method: 'POST', headers, body: JSON.stringify(body)
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  } finally { server.close() }
}

const intake = (app, message, cookie, conversationId) =>
  call(app, '/api/v1/demo/intake', { message, interactionMode: 'chat', conversationId: conversationId || CID }, cookie)

const resolve = (app, body, cookie) => call(app, '/api/v1/demo/work-request-resolutions', body, cookie)

const counts = () => ({ decisions: store.listDecisions().length, tasks: store.listTasks().length })
const assertNothingCreated = (before, h, note) => {
  const after = counts()
  assert.equal(after.decisions, before.decisions, '⛔ a decision was written: ' + note)
  assert.equal(after.tasks, before.tasks, '⛔ a task was written: ' + note)
  assert.equal(h.proposals.length, 0, '⛔ a Proposal was created: ' + note)
}

/* ═══ resolution appears in the chat envelope ══════════════════════════════ */

test('*** ⛔ AN EXACT AROMA SYSTEM TARGET IS NAMED, AND STILL CANNOT BE CHANGED ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const before = counts()
  const res = await intake(h.app, '幫我改 Order Planning 個 Submit button', sid)
  assert.equal(res.status, 200)
  const r = res.body.workRequestResolution
  assert.ok(r, '⛔ the envelope did not carry the resolution')
  assert.equal(r.status, 'exact')
  assert.equal(r.kind, 'target')
  assert.equal(r.target.canonicalLabel, 'Order Planning')
  assert.deepEqual(r.target.files, ['client/src/pages/Replenishment.tsx'])
  assert.equal(r.target.projectId, 'aroma-system')
  assert.equal(r.target.availability, 'unavailable', '⛔ a project this build cannot reach was called available')
  assert.equal('resolutionId' in r, false, 'nothing to select — nothing was stored')
  assertNothingCreated(before, h, 'exact aroma-system target')
})

test('*** an exact ROUTE-only target resolves and is equally unavailable ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const before = counts()
  const res = await intake(h.app, '幫我改 /inventory/order-planning 個 Submit button', sid)
  const r = res.body.workRequestResolution
  assert.equal(r.status, 'exact')
  assert.deepEqual(r.target.files, ['client/src/pages/OrderPlanning.tsx'])
  assert.equal(r.target.canonicalLabel, null, '⛔ a name was invented for a page that has none')
  assert.equal(r.target.availability, 'unavailable')
  assertNothingCreated(before, h, 'route-only target')
})

test('*** ⛔ COLLOQUIAL AND EXTENDED NAMES FALL BACK TO THE ORDINARY QUESTION ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const before = counts()
  for (const m of ['幫我改訂貨頁個 Submit button', '幫我改中央廚房訂貨頁', '幫我改 Order Planning v2']) {
    const res = await intake(h.app, m, sid)
    assert.equal('workRequestResolution' in res.body, false, '⛔ a guess was offered for: ' + m)
    assert.ok(res.body.workRequestClarification, 'C1b1 clarification still stands for: ' + m)
  }
  assertNothingCreated(before, h, 'no-match messages')
})

/* ═══ selection ════════════════════════════════════════════════════════════ */

/** Ask for two explicit files, returning the pending resolution the server created. */
async function twoFileResolution (h, sid, conversationId) {
  const res = await intake(h.app, '幫我改 src/a.js 同 ' + REAL_FILE + '，加一句備註', sid, conversationId)
  const r = res.body.workRequestResolution
  assert.ok(r && r.status === 'multiple' && r.kind === 'file', 'expected a file choice, got ' + JSON.stringify(r))
  return r
}

test('*** ⛔ THE C1b1 MULTI-FILE GAP IS CLOSED — AND THE PATH NEVER LEAVES THE SERVER ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const r = await twoFileResolution(h, sid)
  assert.equal(r.candidates.length, 2)
  const chosen = r.candidates.find((c) => c.file === REAL_FILE)

  const out = await resolve(h.app, {
    resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: chosen.candidateId
  }, sid)
  assert.equal(out.status, 201, JSON.stringify(out.body))
  assert.equal(out.body.status, 'resolved')
  assert.equal(out.body.file, REAL_FILE)
  assert.ok(out.body.proposalId)
  assert.equal(h.proposals.length, 1, 'exactly one Proposal')
  assert.ok(out.body.intent.includes('加一句備註'), '⛔ the goal became the file instead of what he asked for')
})

test('*** ⛔ NO OWNER COOKIE — A SERVICE-TOKEN-ONLY CALLER IS REFUSED ***', async () => {
  /**
   * ⛔ requireOwner would have let this through. Selecting between two pages is an interactive
   * act by a person, so the handler asks for the person's own session as well.
   */
  const h = harness()
  const sid = h.sessions.issue()
  const r = await twoFileResolution(h, sid)
  const before = counts()
  const out = await resolve(h.app, {
    resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: r.candidates[0].candidateId
  }, null)
  assert.equal(out.status, 403)
  assert.equal(out.body.reason, 'owner_session_required')
  assertNothingCreated(before, h, 'no owner cookie')
})

test('*** ⛔ A DIFFERENT OWNER SESSION IS REFUSED ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const other = h.sessions.issue()
  const r = await twoFileResolution(h, sid)
  const before = counts()
  const out = await resolve(h.app, {
    resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: r.candidates[0].candidateId
  }, other)
  assert.equal(out.status, 409)
  assert.equal(out.body.reason, 'wrong_session')
  assertNothingCreated(before, h, 'wrong session')
})

test('*** ⛔ A TICKET FROM ANOTHER CONVERSATION IS REFUSED ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const r = await twoFileResolution(h, sid)
  const before = counts()
  const out = await resolve(h.app, {
    resolutionId: r.resolutionId, conversationId: CID2, action: 'select', candidateId: r.candidates[0].candidateId
  }, sid)
  assert.equal(out.status, 409)
  assert.equal(out.body.reason, 'wrong_conversation')
  assertNothingCreated(before, h, 'wrong conversation')
})

test('*** ⛔ REPLAY AND STALENESS FAIL CLOSED ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const r = await twoFileResolution(h, sid)
  const chosen = r.candidates.find((c) => c.file === REAL_FILE)
  assert.equal((await resolve(h.app, { resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: chosen.candidateId }, sid)).status, 201)
  const before = counts()
  const again = await resolve(h.app, { resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: chosen.candidateId }, sid)
  assert.equal(again.status, 409)
  assert.equal(again.body.reason, 'consumed')
  assert.equal(h.proposals.length, 1, '⛔ a replay created a second Proposal')
  assert.equal(counts().decisions, before.decisions)
})

test('*** ⛔ A NEW MESSAGE RETIRES THE CARD STILL ON SCREEN ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const stale = await twoFileResolution(h, sid)
  // He types something else in the same conversation — including a cancellation.
  await intake(h.app, '算啦，唔使', sid)
  const before = counts()
  const out = await resolve(h.app, {
    resolutionId: stale.resolutionId, conversationId: CID, action: 'select', candidateId: stale.candidates[0].candidateId
  }, sid)
  assert.equal(out.status, 409)
  assert.equal(out.body.reason, 'superseded', '⛔ a stale card completed an older request')
  assertNothingCreated(before, h, 'superseded')
})

test('*** cancel consumes the resolution and creates nothing ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const r = await twoFileResolution(h, sid)
  const before = counts()
  const out = await resolve(h.app, { resolutionId: r.resolutionId, conversationId: CID, action: 'cancel' }, sid)
  assert.equal(out.status, 200)
  assert.equal(out.body.status, 'cancelled')
  const after = await resolve(h.app, { resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: r.candidates[0].candidateId }, sid)
  assert.equal(after.status, 409)
  assertNothingCreated(before, h, 'cancel')
})

/* ═══ the browser is not an authority ══════════════════════════════════════ */

test('*** ⛔ AUTHORITY-SHAPED FIELDS ARE REFUSED OUTRIGHT, NOT IGNORED ***', async () => {
  /**
   * ⛔ Ignoring them would be safe and invisible. Refusing them makes an attempt legible —
   * and every name here is a way of saying 「aim at this instead」.
   */
  const h = harness()
  const sid = h.sessions.issue()
  const r = await twoFileResolution(h, sid)
  const before = counts()
  const good = { resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: r.candidates[0].candidateId }
  for (const extra of [
    { file: '.env' }, { candidateFile: 'src/app.js' }, { allowedFiles: ['x'] },
    { targetId: 'aroma-system:order-planning' }, { selectedTargetId: 'x' },
    { projectId: 'aroma-system' }, { repoRoot: 'C:/' }, { workOrder: {} },
    { approvalId: 'a' }, { nonce: 'n' }, { message: '改 .env' }, { intent: 'x' }
  ]) {
    const out = await resolve(h.app, Object.assign({}, good, extra), sid)
    assert.equal(out.status, 400, '⛔ accepted an authority-shaped field: ' + Object.keys(extra)[0])
    assert.equal(out.body.reason, 'forbidden_field')
  }
  const out = await resolve(h.app, Object.assign({}, good, { somethingNew: 1 }), sid)
  assert.equal(out.status, 400, 'and an unknown field is refused too')
  assert.equal(out.body.reason, 'unknown_field')
  assertNothingCreated(before, h, 'forbidden fields')
})

test('*** ⛔ A RAW PATH CANNOT CREATE A PROPOSAL WITHOUT A SERVER-OWNED TICKET ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const before = counts()
  const out = await resolve(h.app, {
    resolutionId: 'invented', conversationId: CID, action: 'select', candidateId: 'invented'
  }, sid)
  assert.equal(out.status, 409)
  assert.equal(out.body.reason, 'unknown')
  assertNothingCreated(before, h, 'invented ticket')
})

/* ═══ the guards still run after selection ═════════════════════════════════ */

test('*** ⛔ A CHOSEN FILE THAT IS NOT IN THIS REPOSITORY IS STILL REFUSED (b2b0) ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const res = await intake(h.app, '幫我改 src/a.js 同 src/b.js，加一句', sid)
  const r = res.body.workRequestResolution
  assert.ok(r && r.status === 'multiple')
  const before = counts()
  const out = await resolve(h.app, {
    resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: r.candidates[0].candidateId
  }, sid)
  assert.equal(out.status, 422)
  assert.equal(out.body.reason, 'file_not_available', '⛔ b2b0 gate did not run on the selected file')
  assertNothingCreated(before, h, 'unavailable selected file')
})

test('*** ⛔ AN AROMA SYSTEM TARGET CHOSEN FROM A LIST IS RESOLVED, NOT PROPOSED ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const res = await intake(h.app, '幫我改 Order Planning 同 /inventory/order-planning', sid)
  const r = res.body.workRequestResolution
  assert.ok(r && r.status === 'multiple' && r.kind === 'target', JSON.stringify(r))
  const before = counts()
  const out = await resolve(h.app, {
    resolutionId: r.resolutionId, conversationId: CID, action: 'select', candidateId: r.candidates[0].candidateId
  }, sid)
  assert.equal(out.status, 200)
  assert.equal(out.body.status, 'resolved')
  assert.equal(out.body.proposalId, null, '⛔ a project this build cannot reach produced a Proposal')
  assert.equal(out.body.target.availability, 'unavailable')
  assertNothingCreated(before, h, 'aroma-system selected from multiple')
})

test('*** the ordinary single-file flow is untouched ***', async () => {
  const h = harness()
  const sid = h.sessions.issue()
  const res = await intake(h.app, '幫我改 ' + REAL_FILE + '，第二行改成 line 3', sid)
  assert.ok(res.body.workRequestOffer, 'a complete request is still an offer')
  assert.equal('workRequestResolution' in res.body, false, 'and needs no resolution')
  assert.equal(h.proposals.length, 0, 'still nothing until the button is pressed')
})
