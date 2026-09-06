'use strict'

/**
 * readOnlyEnquiryService.test.js — the wire, end to end, offline.
 *
 * ⛔ THE REAL PARTS ARE REAL. The approval store, the Work Order and its hash, the enquiry
 * runner, the report builder, the citation checker and the enquiry store are all the shipped
 * modules. The ONLY substitution is the model process boundary: the worker's `dispatch` is
 * replaced, because calling a real model is what this chapter is forbidden to do. Nothing
 * bypasses the validator to make a case pass.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const { createReadOnlyEnquiryService, REFUSAL } = require('./readOnlyEnquiryService')
const { createOwnerApprovalStore } = require('./ownerApprovalStore')
const { createEnquiryStore } = require('./enquiryStore')
const { hashWorkOrder } = require('./workOrder')
const { createTmpdirSandbox } = require('../workers/workspace/tmpdirSandbox')

const SHA = 'a'.repeat(40)

/** A structurally valid read-only order: question, revision, readable scope, limits. */
function makeOrder (over = {}) {
  return {
    goal: 'Where is the request timeout decided, and what is its default?',
    projectId: 'aroma-agent-backend',
    repoFullName: 'Louielui/aroma-agent-backend',
    expectedSha: SHA,
    allowedFiles: ['src/lib/http.js'],
    allowedTestCommand: null,
    forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
    timeoutSec: 180,
    costCapUsd: 1,
    approvalId: 'appr-' + crypto.randomBytes(4).toString('hex'),
    branch: null,
    ...over
  }
}

/** A source provider that writes the approved file into the minted sandbox. */
function sourceProvider (opts = {}) {
  return async ({ dir, allowedFiles }) => {
    if (opts.fail) throw new Error('cannot reach the repository')
    if (opts.refuse) return { ok: false, reason: 'sha_not_found' }
    for (const rel of allowedFiles) {
      const abs = path.join(dir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, '// line 1\nconst TIMEOUT = 0\nmodule.exports = { TIMEOUT }\n', 'utf8')
    }
    return { ok: true, fileCount: allowedFiles.length }
  }
}

/** A fake worker: real everything else, no model. `reply` decides what the "CLI" returned. */
function fakeWorkerFactory (reply, spy = {}) {
  return (opts) => {
    spy.constructed = (spy.constructed || 0) + 1
    spy.cwd = opts.cwd
    spy.maxTurns = opts.maxTurns
    spy.timeoutMs = opts.timeoutMs
    return {
      dispatch: async (a) => {
        spy.dispatches = (spy.dispatches || 0) + 1
        spy.goal = a.goal
        return reply(a, opts)
      }
    }
  }
}

/** A reply carrying citations the REAL checker will verify against the sandbox copy. */
const goodReply = (cwd) => async () => ({
  sessionId: 'sess-1',
  payload: {
    answer: 'The timeout is declared in src/lib/http.js and defaults to 0.',
    citations: [{ path: 'src/lib/http.js', startLine: 2, endLine: 2, quote: 'const TIMEOUT = 0' }],
    notEstablished: ['Runtime behaviour was not observed.']
  },
  answer: 'The timeout is declared in src/lib/http.js and defaults to 0.',
  citations: [{ path: 'src/lib/http.js', status: 'CONFIRMED', startLine: 2, endLine: 2 }],
  evidence: [{ source: 'disposable-copy:src/lib/http.js', readState: 'OK' }],
  notEstablished: ['Runtime behaviour was not observed.'],
  termination: { terminationRequested: false, killIssued: 'NOT_REQUESTED', directChildExited: true },
  costUsd: 0.12,
  numTurns: 4
})

/** Build the whole wire with the real stores. */
function wire (over = {}) {
  const approvalStore = createOwnerApprovalStore(over.storeOptions || {})
  const enquiryStore = createEnquiryStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'enq-store-')) })
  const spy = {}
  const service = createReadOnlyEnquiryService({
    approvalStore,
    enquiryStore,
    sourceProvider: over.sourceProvider || sourceProvider(),
    workerFactory: over.workerFactory || fakeWorkerFactory(over.reply || goodReply(), spy),
    workspaceFactory: () => createTmpdirSandbox({ prepareSandbox: () => {} }),
    env: over.env || { READONLY_ENQUIRY: 'on' }
  })
  return { approvalStore, enquiryStore, service, spy }
}

/** Seal an order and issue a valid nonce, exactly as the approval path does. */
function approve (approvalStore, order) {
  const sessionId = approvalStore.createSession()
  const sealed = approvalStore.seal({ workOrder: order, proposalId: 'prop-1' })
  assert.ok(sealed.ok, 'seal must succeed: ' + JSON.stringify(sealed))
  const displayedHash = hashWorkOrder(order)
  const nonce = approvalStore.issueNonce({ approvalId: order.approvalId, workOrderHash: displayedHash, sessionId })
  return { sessionId, nonce, displayedHash }
}

describe('1 — every closed gate means ZERO dispatch and zero worker construction', () => {
  test('the flag is off by default, and off builds nothing', async () => {
    const { approvalStore, service, spy } = wire({ env: {} })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.dispatched, false)
    assert.strictEqual(r.reason, REFUSAL.DISABLED)
    assert.strictEqual(service.workersConstructed(), 0, 'a disabled wire must not construct a worker')
    assert.strictEqual(spy.constructed, undefined)
    assert.strictEqual(spy.dispatches, undefined)
  })

  test('an explicit off, and any junk value, are both off', () => {
    for (const raw of ['off', '', 'ON', 'true', '1', undefined]) {
      const { service } = wire({ env: { READONLY_ENQUIRY: raw } })
      assert.strictEqual(service.enabled(), false, JSON.stringify(raw))
    }
    assert.strictEqual(wire({ env: { READONLY_ENQUIRY: 'on' } }).service.enabled(), true)
  })

  test('no approval at all — an unknown approvalId', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    const sessionId = approvalStore.createSession()
    const r = await service.submit({ sessionId, approvalId: 'appr-never-sealed', nonce: 'x', displayedHash: hashWorkOrder(order) })
    assert.strictEqual(r.reason, REFUSAL.APPROVAL_UNKNOWN)
    assert.strictEqual(r.dispatched, false)
    assert.strictEqual(spy.constructed, undefined)
  })

  test('an EXPIRED approval is refused as expired, not as unknown', async () => {
    let t = 1000
    const { approvalStore, service, spy } = wire({ storeOptions: { now: () => t, approvalTtlMs: 50 } })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    t += 5000
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    assert.strictEqual(r.reason, REFUSAL.APPROVAL_EXPIRED)
    assert.strictEqual(spy.constructed, undefined, 'nothing may be built for an expired card')
  })

  test('an invalid session is refused before the order is even loaded', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    approve(approvalStore, order)
    const r = await service.submit({ sessionId: 'not-a-session', approvalId: order.approvalId, nonce: 'x', displayedHash: hashWorkOrder(order) })
    assert.strictEqual(r.reason, REFUSAL.SESSION_INVALID)
    assert.strictEqual(spy.constructed, undefined)
  })

  test('⛔ a hash that does not match what the Owner read', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    const { sessionId, nonce } = approve(approvalStore, order)
    // the same order with a WIDER scope — a different hash, and the Owner never saw it
    const widened = { ...order, allowedFiles: ['src/lib/http.js', 'src/secrets.js'] }
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash: hashWorkOrder(widened) })
    assert.strictEqual(r.reason, REFUSAL.HASH_MISMATCH)
    assert.strictEqual(r.detail.expected, hashWorkOrder(order))
    assert.strictEqual(spy.constructed, undefined)
  })

  test('a bad nonce — and the scope the RUN uses always comes from the sealed order', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    const { sessionId, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce: 'forged', displayedHash })
    assert.strictEqual(r.reason, REFUSAL.NONCE)
    assert.strictEqual(spy.constructed, undefined)
  })

  test('a caller cannot pass a boolean instead of an approval', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    const sessionId = approvalStore.createSession()
    // every shape a hopeful caller might try
    for (const extra of [{ approved: true }, { authorised: true }, { ownerApproved: true }]) {
      const r = await service.submit({ sessionId, approvalId: order.approvalId, ...extra })
      assert.strictEqual(r.dispatched, false, JSON.stringify(extra))
    }
    assert.strictEqual(spy.constructed, undefined)
  })

  test('a source that cannot be prepared refuses — it never runs against whatever is on disk', async () => {
    for (const [label, provider] of [['throws', sourceProvider({ fail: true })], ['refuses', sourceProvider({ refuse: true })]]) {
      const { approvalStore, service, spy } = wire({ sourceProvider: provider })
      const order = makeOrder()
      const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
      const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
      assert.strictEqual(r.reason, REFUSAL.SOURCE_FAILED, label)
      assert.strictEqual(r.dispatched, false)
      assert.strictEqual(spy.dispatches, undefined, 'no dispatch on ' + label)
    }
  })

  test('and with no source provider at all, the refusal is explicit rather than a fallback', async () => {
    const { approvalStore, enquiryStore } = wire()
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const bare = createReadOnlyEnquiryService({ approvalStore, enquiryStore, env: { READONLY_ENQUIRY: 'on' } })
    const r = await bare.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    assert.strictEqual(r.reason, REFUSAL.SOURCE_UNAVAILABLE)
    assert.strictEqual(bare.workersConstructed(), 0)
  })
})

describe('2 — a valid approval runs exactly once and the result reads back', () => {
  test('one dispatch, saved, and readable through the existing store', async () => {
    const { approvalStore, enquiryStore, service, spy } = wire()
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)

    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    assert.strictEqual(r.ok, true, JSON.stringify(r))
    assert.strictEqual(r.dispatched, true)
    assert.strictEqual(spy.dispatches, 1, 'exactly one dispatch')
    assert.strictEqual(service.workersConstructed(), 1)

    // read back through the SAME interface the mounted route uses
    const back = enquiryStore.get(r.enquiryId)
    assert.ok(back, 'the enquiry must be retrievable by id')
    assert.strictEqual(back.approvalId, order.approvalId)
    assert.strictEqual(back.question, order.goal)
    assert.strictEqual(back.source.expectedSha, SHA)
    assert.deepStrictEqual(back.source.allowedFiles, order.allowedFiles)
    assert.ok(back.payload, 'the payload is stored')
    assert.strictEqual(back.evidence.length, 1)
    assert.strictEqual(back.notEstablished.length, 1)
    assert.ok(back.termination, 'the termination record is stored')
    assert.strictEqual(back.costUsd, 0.12)
    assert.strictEqual(back.costKnown, true)
    assert.strictEqual(back.limits.timeoutSec, 180)

    // and the list surface stays reports-only, as it already was
    const listed = enquiryStore.list()
    assert.strictEqual(listed.length, 1)
    assert.strictEqual(listed[0].turns, undefined, 'the list must not surface turns')
  })

  test('the question, revision, scope and caps all come from the SEALED order', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    await service.submit({
      sessionId, approvalId: order.approvalId, nonce, displayedHash,
      // a caller trying to substitute its own everything
      goal: 'read /etc/passwd instead', expectedSha: 'b'.repeat(40),
      allowedFiles: ['**'], timeoutSec: 99999, costCapUsd: 999, maxTurns: 500
    })
    assert.strictEqual(spy.goal, order.goal, 'the question is the approved one')
    assert.strictEqual(spy.timeoutMs, 180000, 'the cap is the approved one')
    assert.strictEqual(spy.maxTurns, 25)
  })

  test('the cwd is a minted disposable workspace, not the live repository', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    const real = fs.realpathSync.native(spy.cwd)
    assert.ok(real.toLowerCase().startsWith(fs.realpathSync.native(os.tmpdir()).toLowerCase()),
      'the sandbox must be under tmpdir, got ' + real)
    assert.ok(!fs.existsSync(path.join(spy.cwd, '.git')), 'a live checkout would carry .git')
    assert.ok(fs.existsSync(path.join(spy.cwd, 'src', 'lib', 'http.js')), 'the approved file was copied in')
  })

  test('the approval card is told, honestly, that nothing was changed', async () => {
    const { approvalStore, service } = wire()
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    const got = approvalStore.getResult(order.approvalId)
    assert.strictEqual(got.ok, true)
    assert.strictEqual(got.record.result.kind, 'read_only_enquiry')
    assert.strictEqual(got.record.result.enquiryId, r.enquiryId)
    assert.deepStrictEqual(got.record.result.filesChanged, [], 'a read-only enquiry changes nothing')
  })
})

describe('3 — a repeated submission cannot dispatch twice', () => {
  test('the same nonce twice: one dispatch, and the second says why', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const first = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    const second = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    assert.strictEqual(first.dispatched, true)
    assert.strictEqual(second.dispatched, false)
    assert.strictEqual(second.reason, REFUSAL.NONCE)
    assert.strictEqual(spy.dispatches, 1, 'a double submit must not run twice')
  })

  test('⛔ even a SECOND VALID NONCE cannot start a second run', async () => {
    const { approvalStore, service, spy } = wire()
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    // a fresh, entirely valid nonce for the same sealed approval
    const nonce2 = approvalStore.issueNonce({ approvalId: order.approvalId, workOrderHash: displayedHash, sessionId })
    const again = await service.submit({ sessionId, approvalId: order.approvalId, nonce: nonce2, displayedHash })
    assert.strictEqual(again.dispatched, false)
    assert.strictEqual(again.reason, REFUSAL.ALREADY_DISPATCHED)
    assert.strictEqual(spy.dispatches, 1, 'the write-once execution record is the durable lock')
  })
})

describe('4 — partial verification stays partial', () => {
  const partialReply = async () => ({
    sessionId: 's',
    payload: {
      answer: 'Two claims.',
      citations: [
        { path: 'src/lib/http.js', startLine: 2, endLine: 2, quote: 'const TIMEOUT = 0' },
        { path: 'src/lib/http.js', startLine: 1, endLine: 1, quote: 'this text is not in the file' }
      ],
      notEstablished: []
    },
    answer: 'Two claims.',
    citations: [
      { path: 'src/lib/http.js', status: 'CONFIRMED', startLine: 2, endLine: 2 },
      { path: 'src/lib/http.js', status: 'QUOTE_MISMATCH', detail: 'the quoted text is not present at the cited lines' }
    ],
    evidence: [{ source: 'disposable-copy:src/lib/http.js', readState: 'OK' }],
    notEstablished: [],
    termination: { terminationRequested: false },
    costUsd: 0.2,
    numTurns: 3
  })

  test('an unconfirmed citation is kept, marked, and never promoted', async () => {
    const { approvalStore, enquiryStore, service } = wire({ reply: partialReply })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })

    const back = enquiryStore.get(r.enquiryId)
    assert.strictEqual(back.citations.length, 2, 'the unverified one is kept, not dropped')
    assert.strictEqual(back.verification.cited, 2)
    assert.strictEqual(back.verification.confirmed, 1)
    assert.strictEqual(back.verification.unverified, 1)
    assert.strictEqual(back.verification.allConfirmed, false, '⛔ partial is not complete')
    assert.strictEqual(r.verification.allConfirmed, false)
    assert.ok(back.citations.some((c) => c.status === 'QUOTE_MISMATCH'), 'the status survives to the read surface')
  })

  test('⛔ zero citations is never 「all confirmed」', async () => {
    const noneReply = async () => ({
      sessionId: 's',
      payload: { answer: 'No citations at all.', citations: [], notEstablished: [] },
      answer: 'No citations at all.', citations: [], evidence: [], notEstablished: [],
      termination: {}, costUsd: 0.01, numTurns: 1
    })
    const { approvalStore, enquiryStore, service } = wire({ reply: noneReply })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    const back = enquiryStore.get(r.enquiryId)
    assert.strictEqual(back.verification.cited, 0)
    assert.strictEqual(back.verification.allConfirmed, false)
  })

  test('a finished process is not a verified answer — they are separate fields', async () => {
    const { approvalStore, enquiryStore, service } = wire({ reply: partialReply })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    const back = enquiryStore.get(r.enquiryId)
    assert.strictEqual(back.outcome, 'CONCLUDED', 'the process finished')
    assert.strictEqual(back.verification.allConfirmed, false, 'and the answer is still not fully checked')
    assert.ok(!('verified' in back), 'there is no single field that could be read as 「all checked」')
  })
})

describe('5 — honest failure, with the evidence kept', () => {
  test('a timeout is recorded as a failure and the termination record survives', async () => {
    const timeoutReply = async () => {
      const e = new Error('agent CLI did not finish within 180000ms')
      e.failure = 'STOPPED'
      e.termination = { terminationRequested: true, killIssued: 'ISSUED', directChildExited: true, stopReason: 'TIMEOUT' }
      e.diagnostics = { exitCode: 1, stdoutBytes: 0, stderrBytes: 0 }
      throw e
    }
    const { approvalStore, enquiryStore, service } = wire({ reply: timeoutReply })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })

    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.dispatched, true, 'it did run; it failed')
    const back = enquiryStore.get(r.enquiryId)
    assert.strictEqual(back.outcome, 'FAILED')
    assert.strictEqual(back.failure, 'STOPPED')
    assert.strictEqual(back.termination.stopReason, 'TIMEOUT')
    assert.ok(back.diagnostics, 'the diagnostics survive')
    assert.strictEqual(back.costUsd, null, 'a failed round costs an unreported amount')
    assert.strictEqual(back.costKnown, false)
  })

  test('an invalid model output fails without inventing a payload', async () => {
    const badReply = async () => {
      const e = new Error('structured_output missing')
      e.failure = 'STRUCTURED_OUTPUT_MISSING'
      throw e
    }
    const { approvalStore, enquiryStore, service } = wire({ reply: badReply })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    const back = enquiryStore.get(r.enquiryId)
    assert.strictEqual(back.outcome, 'FAILED')
    assert.strictEqual(back.payload, null, 'nothing may be fabricated')
    assert.strictEqual(back.failure, 'STRUCTURED_OUTPUT_MISSING')
  })

  test('⛔ a REFUSED report loses nothing — the round is still saved and readable', async () => {
    // The real report validator refuses an unbacked change claim; the real runner preserves
    // the round. Both of those are the shipped modules.
    const claimReply = async () => ({
      sessionId: 's',
      payload: { answer: 'I applied the patch to src/lib/http.js.', citations: [], notEstablished: [] },
      answer: 'I applied the patch to src/lib/http.js.',
      citations: [], evidence: [{ source: 'x' }], notEstablished: [],
      termination: { terminationRequested: false }, costUsd: 0.07, numTurns: 2
    })
    const { approvalStore, enquiryStore, service } = wire({ reply: claimReply })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })

    assert.strictEqual(r.ok, false, 'a refused report is not a conclusion')
    const back = enquiryStore.get(r.enquiryId)
    assert.strictEqual(back.outcome, 'FAILED')
    assert.ok(back.reportFailure, 'the reporting fault is recorded as its own thing')
    assert.strictEqual(back.reportFailure.locus, 'report validation/rendering')
    assert.strictEqual(back.reportFailure.errorName, 'ReportRefused')
    assert.strictEqual(back.costUsd, 0.07, 'the money was spent before the formatter ran')
    assert.ok(back.payload, 'and the payload the worker returned is still there')
    assert.ok(!String(back.report && back.report.text).includes('I applied the patch'),
      'the refused answer is not displayed as the result')
  })
})

describe('6 — UNKNOWN cost and a genuine zero stay different', () => {
  const replyWithCost = (costUsd) => async () => ({
    sessionId: 's',
    payload: { answer: 'ok', citations: [], notEstablished: [] },
    answer: 'ok', citations: [], evidence: [], notEstablished: [],
    termination: {}, costUsd, numTurns: 1
  })

  test('a genuine zero is stored as 0 and known', async () => {
    const { approvalStore, enquiryStore, service } = wire({ reply: replyWithCost(0) })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    const back = enquiryStore.get(r.enquiryId)
    assert.strictEqual(back.costUsd, 0)
    assert.strictEqual(back.costKnown, true)
    assert.match(String(back.report.text), /US\$0\.00/)
  })

  test('an unreported cost is stored as null and rendered UNKNOWN', async () => {
    const { approvalStore, enquiryStore, service } = wire({ reply: replyWithCost(undefined) })
    const order = makeOrder()
    const { sessionId, nonce, displayedHash } = approve(approvalStore, order)
    const r = await service.submit({ sessionId, approvalId: order.approvalId, nonce, displayedHash })
    const back = enquiryStore.get(r.enquiryId)
    assert.strictEqual(back.costUsd, null)
    assert.strictEqual(back.costKnown, false)
    assert.match(String(back.report.text), /UNKNOWN/)
    assert.ok(!/US\$0\.00/.test(String(back.report.text)), 'UNKNOWN must never render as free')
  })
})
