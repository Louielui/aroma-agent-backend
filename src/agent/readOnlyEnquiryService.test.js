'use strict'

/**
 * readOnlyEnquiryService.test.js — the lane FUNCTION, at unit level.
 *
 * The end-to-end proof lives in `routes/readOnlyEnquiryLane.test.js`, which drives the real HTTP
 * approval route. This file covers what that one cannot reach cheaply: the ORDER in which the
 * gates refuse, where each bound came from, and describing failures whose error values fight back.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createReadOnlyEnquiryService, REFUSAL, PHASE, SERVICE_MAX_TURNS, safeErrorText } = require('./readOnlyEnquiryService')
const { createEnquiryStore } = require('./enquiryStore')
const { createTmpdirSandbox } = require('../workers/workspace/tmpdirSandbox')

const ORDER = Object.freeze({
  goal: 'Where is the timeout decided?',
  taskKind: 'read_only_enquiry',
  projectId: 'aroma-agent-backend',
  repoFullName: 'Louielui/aroma-agent-backend',
  expectedSha: 'a'.repeat(40),
  allowedFiles: ['src/lib/http.js'],
  allowedTestCommand: null,
  branch: null,
  timeoutSec: 180,
  costCapUsd: 1,
  approvalId: 'appr-unit'
})

const provider = async ({ dir, allowedFiles }) => {
  for (const rel of allowedFiles) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, '// line 1\nconst TIMEOUT = 0\n', 'utf8')
  }
  return { ok: true, fileCount: allowedFiles.length }
}

const reply = async () => ({
  sessionId: 's',
  payload: { answer: 'ok', citations: [], notEstablished: [] },
  answer: 'ok',
  citations: [],
  evidence: [],
  notEstablished: [],
  termination: {},
  costUsd: 0.05,
  numTurns: 2
})

function build (over = {}) {
  const spy = { workers: 0, dispatches: 0 }
  const store = over.enquiryStore !== undefined
    ? over.enquiryStore
    : createEnquiryStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'svc-')) })
  const svc = createReadOnlyEnquiryService({
    enquiryStore: store,
    sourceProvider: over.sourceProvider === undefined ? provider : over.sourceProvider,
    workspaceFactory: over.workspaceFactory || (() => createTmpdirSandbox({ prepareSandbox: () => {} })),
    workerFactory: over.workerFactory || ((o) => {
      spy.workers++
      spy.maxTurns = o.maxTurns
      spy.timeoutMs = o.timeoutMs
      return { dispatch: async () => { spy.dispatches++; return (over.reply || reply)() } }
    }),
    env: over.env || { READONLY_ENQUIRY: 'on' }
  })
  return { svc, spy, store }
}

const call = (svc, over = {}) =>
  svc.run(Object.assign({ workOrder: ORDER, approvalId: ORDER.approvalId, authorized: true }, over))

describe('the refusal ORDER — each gate names itself, and none of them builds anything', () => {
  test('the flag is checked first', async () => {
    const { svc, spy } = build({ env: {} })
    const r = await call(svc)
    assert.strictEqual(r.reason, REFUSAL.DISABLED)
    assert.strictEqual(r.stoppedAt, PHASE.AUTHORIZING)
    assert.strictEqual(spy.workers, 0)
  })

  test('⛔ authorization is NOT self-granted — the caller carries the matrix decision', async () => {
    const { svc, spy } = build()
    const r = await call(svc, { authorized: false })
    assert.strictEqual(r.reason, REFUSAL.NOT_AUTHORIZED)
    assert.strictEqual(spy.workers, 0)
  })

  test('a code_change order can never reach this lane', async () => {
    const { svc, spy } = build()
    const r = await call(svc, { workOrder: { ...ORDER, taskKind: 'code_change' } })
    assert.strictEqual(r.reason, REFUSAL.WRONG_TASK_KIND)
    assert.strictEqual(spy.workers, 0)
  })

  test('⛔ NO STORE, NO RUN — refused BEFORE the model is called', async () => {
    const { svc, spy } = build({ enquiryStore: null })
    const r = await call(svc)
    assert.strictEqual(r.reason, REFUSAL.STORE_UNAVAILABLE)
    assert.strictEqual(r.stoppedAt, PHASE.AUTHORIZING)
    assert.strictEqual(spy.dispatches, 0, 'a model call whose result cannot be kept must not happen')
  })

  test('no source provider is an explicit refusal, never a fallback', async () => {
    const { svc, spy } = build({ sourceProvider: null })
    const r = await call(svc)
    assert.strictEqual(r.reason, REFUSAL.SOURCE_UNAVAILABLE)
    assert.strictEqual(spy.workers, 0)
  })

  test('a workspace that cannot be prepared is contained and named', async () => {
    const { svc, spy } = build({ workspaceFactory: () => { throw new Error('tmpdir is read-only') } })
    const r = await call(svc)
    assert.strictEqual(r.reason, REFUSAL.WORKSPACE_FAILED)
    assert.strictEqual(r.stoppedAt, PHASE.PREPARING_SOURCE)
    assert.strictEqual(spy.workers, 0)
  })

  test('a source that refuses stops the lane before any model call', async () => {
    const { svc, spy } = build({ sourceProvider: async () => ({ ok: false, reason: 'sha_not_found' }) })
    const r = await call(svc)
    assert.strictEqual(r.reason, REFUSAL.SOURCE_FAILED)
    assert.strictEqual(spy.dispatches, 0)
  })
})

describe('the turn cap is the SERVICE\'s, and the record says so', () => {
  test('⛔ an unapproved order field cannot raise it', async () => {
    const { svc, spy, store } = build()
    const r = await call(svc, { workOrder: { ...ORDER, maxTurns: 9999 } })
    assert.strictEqual(spy.maxTurns, SERVICE_MAX_TURNS, 'the service cap, not an unvalidated number')
    assert.strictEqual(r.turnCapSource, 'service_fixed')
    const back = store.get(r.enquiryId)
    assert.strictEqual(back.limits.maxTurns, SERVICE_MAX_TURNS)
    assert.strictEqual(back.limits.turnCapSource, 'service_fixed')
  })

  test('the timeout DOES come from the approved order, and each source is named', async () => {
    const { svc, spy, store } = build()
    const r = await call(svc)
    assert.strictEqual(spy.timeoutMs, 180000, 'the approved 180s')
    const back = store.get(r.enquiryId)
    assert.strictEqual(back.limits.timeoutSource, 'approved_order')
    assert.strictEqual(back.limits.costCapSource, 'approved_order')
    // ⛔ stated rather than implied: the budget is checked BEFORE a round, and nothing here
    // stops a round already running or enforces a charge.
    assert.strictEqual(back.limits.costCapKind, 'pre_round_check_only')
  })
})

describe('a save failure is reported as one, and loses nothing that was known', () => {
  test('⛔ ok false, saved false, outcome still reported, and NO id is offered', async () => {
    const broken = { save () { throw new Error('disk is full') }, get: () => null, list: () => [] }
    const { svc, spy } = build({ enquiryStore: broken })
    const r = await call(svc)
    assert.strictEqual(spy.dispatches, 1, 'it ran')
    assert.strictEqual(r.dispatched, true)
    assert.strictEqual(r.ok, false, 'a result that cannot be stored is not a delivery')
    assert.strictEqual(r.saved, false)
    assert.match(r.saveError, /disk is full/)
    assert.strictEqual(r.enquiryId, null, 'no id that would resolve to nothing')
    assert.strictEqual(r.outcome, 'CONCLUDED', 'the enquiry outcome is a separate fact and stays true')
    assert.strictEqual(r.costUsd, 0.05, 'the known cost survives')
  })

  test('a store that silently returns nothing is also not a delivery', async () => {
    const silent = { save: () => null, get: () => null, list: () => [] }
    const { svc } = build({ enquiryStore: silent })
    const r = await call(svc)
    assert.strictEqual(r.saved, false)
    assert.ok(r.saveError, 'and it is named rather than left blank')
  })
})

describe('describing a failure must never BE the failure', () => {
  const revoked = () => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy }
  const HOSTILE = [
    ['null', () => null],
    ['undefined', () => undefined],
    ['a bare string', () => 'just a string, not an Error'],
    ['a throwing message getter', () => ({ get message () { throw new Error('boom') } })],
    ['a throwing conversion', () => ({ toString () { throw new Error('boom') }, [Symbol.toPrimitive] () { throw new Error('boom') } })],
    ['a revoked Proxy', revoked]
  ]

  for (const [label, make] of HOSTILE) {
    test('safeErrorText survives ' + label, () => {
      const out = safeErrorText(make())
      assert.strictEqual(typeof out, 'string')
      assert.ok(out.length > 0)
      assert.ok(out.length <= 300)
    })

    test('a source provider throwing ' + label + ' still yields a clean refusal', async () => {
      const { svc, spy } = build({ sourceProvider: async () => { throw make() } })
      const r = await call(svc)
      assert.strictEqual(r.reason, REFUSAL.SOURCE_FAILED)
      assert.strictEqual(r.dispatched, false)
      assert.strictEqual(typeof r.detail, 'string')
      assert.strictEqual(spy.dispatches, 0)
    })
  }

  test('a worker constructor throwing a revoked Proxy is contained too', async () => {
    const { svc } = build({ workerFactory: () => { throw revoked() } })
    const r = await call(svc)
    assert.strictEqual(r.reason, REFUSAL.WORKER_FAILED)
    assert.strictEqual(r.stoppedAt, PHASE.BUILDING_WORKER)
    assert.strictEqual(typeof r.detail, 'string')
  })

  test('a dispatch that throws is a FAILED enquiry, still saved and still readable', async () => {
    const { svc, store } = build({
      workerFactory: () => ({ dispatch: async () => { const e = new Error('timed out'); e.failure = 'STOPPED'; e.termination = { stopReason: 'TIMEOUT' }; throw e } })
    })
    const r = await call(svc)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.dispatched, true)
    assert.strictEqual(r.saved, true, 'a failure is evidence and is kept')
    const back = store.get(r.enquiryId)
    assert.strictEqual(back.outcome, 'FAILED')
    assert.strictEqual(back.failure, 'STOPPED')
    assert.strictEqual(back.termination.stopReason, 'TIMEOUT')
    assert.strictEqual(back.costUsd, null, 'a failed round cost an unreported amount')
  })
})

describe('verification counts; it never concludes', () => {
  test('partial confirmation is kept partial, and zero citations is not 「all confirmed」', async () => {
    for (const [citations, cited, confirmed] of [
      [[{ path: 'src/lib/http.js', status: 'CONFIRMED' }, { path: 'src/lib/http.js', status: 'QUOTE_MISMATCH' }], 2, 1],
      [[], 0, 0]
    ]) {
      const { svc, store } = build({
        reply: async () => ({
          sessionId: 's',
          payload: { answer: 'a', citations: [], notEstablished: [] },
          answer: 'a', citations, evidence: [], notEstablished: [], termination: {}, costUsd: 0.01, numTurns: 1
        })
      })
      const r = await call(svc)
      const back = store.get(r.enquiryId)
      assert.strictEqual(back.verification.cited, cited)
      assert.strictEqual(back.verification.confirmed, confirmed)
      assert.strictEqual(back.verification.allConfirmed, false)
      assert.ok(!('verified' in back), 'no single field could be read as 「all checked」')
    }
  })
})

describe('cost states stay distinct', () => {
  for (const [label, costUsd, expect, known] of [
    ['a genuine zero stays 0 and known', 0, 0, true],
    ['an unreported cost stays null and UNKNOWN', undefined, null, false]
  ]) {
    test(label, async () => {
      const { svc, store } = build({
        reply: async () => ({
          sessionId: 's',
          payload: { answer: 'a', citations: [], notEstablished: [] },
          answer: 'a', citations: [], evidence: [], notEstablished: [], termination: {}, costUsd, numTurns: 1
        })
      })
      const r = await call(svc)
      assert.strictEqual(r.costUsd, expect)
      assert.strictEqual(r.costKnown, known)
      assert.strictEqual(store.get(r.enquiryId).costUsd, expect)
    })
  }
})
