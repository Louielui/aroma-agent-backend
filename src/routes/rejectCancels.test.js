'use strict'

/**
 * rejectCancels.test.js — a reject button that only greys out the screen is a lie.
 *
 * Measured on the live store while planning this: 3 pending proposals, the oldest from
 * 2026-07-24. The 拒絕 button at app.js:895 disables three controls and prints
 * 「你拒絕了這張工作單。甚麼都沒有執行。」 — and calls nothing. No server request, no
 * cancelProposal, no audit line. The sealed order and its nonce expire on their own after
 * APPROVAL_TTL_MS; the PROPOSAL stays pending forever.
 *
 * Owner ruling 2026-08-05, and his reason: 「A reject button that only greys out the screen
 * while the proposal stays pending forever is a lie about a governance action, and it is the
 * same class as everything else this week: the record and the reality disagreeing.」
 *
 * The second half of the sentence 「甚麼都沒有執行」 was true. The first half — that he
 * rejected it — was not recorded anywhere.
 */

const test = require('node:test')
const { CATALOGUE } = require('../i18n/catalogue')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROUTER = fs.readFileSync(path.join(__dirname, 'ownerApprovalRouter.js'), 'utf8')
const CLIENT = fs.readFileSync(path.join(__dirname, '..', 'demo', 'assets', 'app.js'), 'utf8')

/* ═══ 1. THERE IS A SERVER ROUTE, AND IT CANCELS ═════════════════════════ */

test('*** rejecting is a server action, not a screen state ***', () => {
  // The route follows this surface's existing convention — /api/v1/owner/approve with the
  // approvalId in the BODY — rather than a REST shape the codebase does not use anywhere.
  assert.ok(/router\.(all|post)\('\/api\/v1\/owner\/reject'/.test(ROUTER),
    'no reject route on the approval surface')
})

test('*** it cancels the PROPOSAL, not just the sealed order ***', () => {
  const at = ROUTER.indexOf("/api/v1/owner/reject")
  const body = ROUTER.slice(at, at + 2200)
  assert.ok(/cancelProposal/.test(body), 'the proposal is left pending: ' + body.slice(0, 400))
})

test('*** it is audited — a governance action that leaves no trace is the same fault ***', () => {
  const at = ROUTER.indexOf("/api/v1/owner/reject")
  const body = ROUTER.slice(at, at + 2200)
  assert.ok(/auditFn\(/.test(body), 'the rejection is not written to audit')
  assert.ok(/outcome: 'rejected'/.test(body), 'and it must say what happened')
})

test('it refuses like its siblings — POST only, loopback, session', () => {
  const at = ROUTER.indexOf("/api/v1/owner/reject")
  const body = ROUTER.slice(at, at + 2200)
  assert.ok(/transportRefusal\(req\)/.test(body), 'the write-side check must apply to a write')
  assert.ok(/refuse\(res, 403/.test(body))
})

/* ═══ 2. IT CANNOT BE USED TO CANCEL SOMETHING ELSE ══════════════════════ */

test('*** it cancels only the proposal bound to THIS sealed order ***', () => {
  // The approvalId identifies a sealed record; the proposalId comes from that record, never
  // from the request body. Otherwise a reject becomes a way to cancel any proposal by id.
  const at = ROUTER.indexOf("/api/v1/owner/reject")
  const body = ROUTER.slice(at, at + 2200)
  assert.ok(/loaded\.record\.proposalId|record\.proposalId/.test(body),
    'the proposalId must come from the sealed record, not the body')
  assert.equal(/b\.proposalId|body\.proposalId/.test(body), false,
    'a caller-supplied proposalId would make this a cancel-anything endpoint')
})

/* ═══ 3. THE BUTTON'S OWN COPY BECOMES TRUE ══════════════════════════════ */

test('*** the client calls the route instead of only greying out ***', () => {
  const at = CLIENT.indexOf("no.addEventListener('click'")
  assert.ok(at > 0, 'the reject handler moved — find it before assuming')
  const handler = CLIENT.slice(at, at + 1400)
  assert.ok(/fetch\(/.test(handler), 'the reject button still calls nothing: ' + handler.slice(0, 300))
  assert.ok(/reject/.test(handler), 'and it must call the reject route')
})

test('*** the message is only shown after the server confirms it ***', () => {
  // 「你拒絕了這張工作單」 printed before the call returns would be the same defect in a new
  // place: the screen asserting a governance action that may not have happened.
  const at = CLIENT.indexOf("no.addEventListener('click'")
  const handler = CLIENT.slice(at, at + 1400)
  const fetchAt = handler.indexOf('fetch(')
  const claimAt = handler.indexOf("t('approve.rejected')")
  assert.ok(claimAt > fetchAt, 'the claim is printed before the request is made')
})

test('*** a failed reject says so rather than claiming success ***', () => {
  const at = CLIENT.indexOf("no.addEventListener('click'")
  const handler = CLIENT.slice(at, at + 1400)
  assert.ok(/catch\(/.test(handler), 'no failure path')
  // CONVERTED: a failed reject must say so. Both failure keys are checked, and their
  // sentences are checked in both languages — 「nothing ran」 is the reassurance that matters.
  assert.ok(/approve\.cancelFailed/.test(handler), 'a failed reject must not read as a successful one')
  assert.match(CATALOGUE['approve.cancelFailed'].zh, /沒有執行/, 'the Chinese says nothing ran')
  assert.match(CATALOGUE['approve.cancelFailed'].en, /[Nn]othing ran/, 'and so does the English')
})
