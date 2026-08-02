'use strict'

/**
 * cleanupOnEveryPath.test.js — the desktop is tidied whatever happens, and the tidying is a
 * measurement rather than a word.
 *
 * ── WHAT THE FIRST SUCCESSFUL CANARY EXPOSED ──────────────────────────────
 * cleanup was called only inside finishFailed(). The two-step canary passed on 2026-08-02 and
 * left Notepad on screen; the Owner closed it by hand and there was no cleanup record anywhere,
 * because the executor never attempted one. The shape is backwards on its face — tidy up when
 * something goes wrong, leave the window open when everything goes right — and it survived
 * because the previous test asserted only that the cleanup OP measures things, never that
 * anybody CALLS it after a success.
 *
 * ── AND THE SECOND PLACE THE MEASUREMENT WAS LOST ─────────────────────────
 * The adapter ran cleanup through `call()`, which throws when the helper returns ok:false — and
 * the helper returns ok:false exactly when it has something to report (the process did not exit,
 * windows remain). The numbers went into an exception and out of existence.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createComputerExecutor } = require('./computerExecutor')
const { createOrderRegistry } = require('./orderRegistry')
const { computeOrderHash } = require('./sealedOrderGate')

const TEXT = 'Aroma Computer Operator canary. Two steps. Round 1.'
const BIND = Object.freeze({
  processId: 4242,
  sessionId: 1,
  windowHandle: '0x9001',
  uiaRuntimeId: '42.66898',
  uiaControlType: 'ControlType.Document',
  uiaClassName: 'RichEditD2DPT',
  uiaAutomationId: ''
})

function order (over = {}) {
  const o = Object.assign({
    orderId: 'wo_cleanup_test',
    approvalId: 'appr_' + 'c'.repeat(32),
    sealed: true,
    sealedText: TEXT,
    maxSteps: 2,
    timeoutSec: 300,
    steps: [
      { n: 1, action: 'open_app', appId: 'notepad' },
      { n: 2, action: 'type_text', text: TEXT }
    ]
  }, over)
  if (!o.orderHash) o.orderHash = computeOrderHash(o)
  return o
}

/** An audit sink that keeps every record in memory. */
function sink () {
  const records = []
  return {
    records,
    // write(collection, record) — TWO arguments. Reading only the first captures the string
    // 'computer-audit' and makes every record look absent, which is how this test first
    // reported "no cleanup record" against code that was writing one.
    store: { write: (collection, rec) => { records.push(rec); return { ok: true, id: rec.id } } },
    kinds: () => records.map((r) => r.kind),
    of: (kind) => records.filter((r) => r.kind === kind)
  }
}

/** A desktop that succeeds, and records every cleanup call it receives. */
function desktopOk (cleanupResult) {
  const calls = { cleanup: [], open: 0, type: 0 }
  return {
    calls,
    openApp: () => { calls.open++; return { ok: true, bind: Object.assign({}, BIND), detail: 'opened notepad' } },
    typeTextIntoControl: () => { calls.type++; return { ok: true, detail: '51 chars via ValuePattern' } },
    verifyBinding: () => Object.assign({ ok: true }, BIND),
    cleanup: (args) => {
      calls.cleanup.push(args)
      // The double must behave like the real adapter, which returns nothing_to_clean when there
      // is no binding. A double that reports success for a cleanup it could not perform would
      // let a test pass over the exact case it was written for.
      if (!args || !args.bind) return { ok: false, measured: false, reason: 'nothing_to_clean', processExited: null, notepadWindowsAfter: null, notepadProcessesAfter: null, forced: null, method: null }
      return cleanupResult || {
        ok: true, measured: true, processExited: true, notepadWindowsAfter: 0, notepadProcessesAfter: 0, forced: false, method: 'CloseMainWindow'
      }
    }
  }
}

function run (desktop, s, over = {}) {
  const ex = createComputerExecutor({
    artifactStore: s.store,
    desktop,
    orderRegistry: createOrderRegistry({ singleUse: true })
  })
  const o = order(over)
  const adm = ex.admit ? null : null
  void adm
  return { ex, o, res: ex.execute(o, { flagOn: true, attestedSessionId: 1 }) }
}

/* ── 1. SUCCESS calls cleanup ─────────────────────────────────────────────── */

test('*** 1. a SUCCESSFUL run calls cleanup ***', () => {
  const s = sink()
  const d = desktopOk()
  const { res } = run(d, s)

  assert.equal(res.ok, true, 'the run succeeded')
  assert.equal(d.calls.cleanup.length, 1, 'cleanup was CALLED — not merely capable of measuring')
  assert.equal(d.calls.cleanup[0].bind.processId, BIND.processId, 'and with the binding open_app produced')
  assert.equal(res.cleanup, 'done')
})

test('*** 1b. POSITIVE CONTROL — the OLD shape would fail test 1 ***', () => {
  // The old executor called cleanup ONLY inside finishFailed(). Reproduced here so that test 1
  // is known to be testing something: on a run with no failure, that code path never executes,
  // so the cleanup count is zero and test 1 is red.
  const cleanupCalls = []
  const oldShape = (didFail) => { if (didFail) cleanupCalls.push('cleanup') }

  oldShape(false)
  assert.equal(cleanupCalls.length, 0, 'the old shape cleans up ONLY on failure — a success leaves the window open')
  oldShape(true)
  assert.equal(cleanupCalls.length, 1, 'and only then')

  // And the live code is not that shape: the success path really does reach cleanup.
  const src = fs.readFileSync(path.join(__dirname, 'computerExecutor.js'), 'utf8')
  const successBlock = src.slice(src.indexOf('// Every step succeeded'), src.indexOf('function runStep'))
  assert.match(successBlock, /runCleanup\('success'\)/, 'the success path calls cleanup')
  assert.match(src, /function runCleanup \(phase\)/, 'and it is ONE shared implementation')
})

/* ── 2. FAILURE calls cleanup ─────────────────────────────────────────────── */

test('*** 2. a FAILED run calls cleanup ***', () => {
  const s = sink()
  const d = desktopOk()
  d.typeTextIntoControl = () => { throw new Error('type blew up') }
  const { res } = run(d, s)

  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'step_failed')
  assert.equal(d.calls.cleanup.length, 1, 'cleanup ran on the failure path too')
  assert.equal(d.calls.cleanup[0].bind.processId, BIND.processId, 'with the binding that existed')
})

/* ── 3. REFUSAL with a binding calls cleanup ──────────────────────────────── */

test('*** 3. a REFUSAL after a binding exists still calls cleanup ***', () => {
  const s = sink()
  const d = desktopOk()
  // The binding goes stale between the two steps — a refusal, not a crash.
  d.verifyBinding = () => ({ ok: false, reason: 'window_gone' })
  const { res } = run(d, s)

  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'stale_binding')
  assert.equal(d.calls.cleanup.length, 1, 'a refusal holding a binding must not leave the window open')
})

test('*** 3b. a refusal with NO binding still records cleanup, as nothing_to_clean ***', () => {
  const s = sink()
  const d = desktopOk()
  d.openApp = () => { throw new Error('could not open') }
  const { res } = run(d, s)

  assert.equal(res.ok, false)
  assert.equal(d.calls.cleanup.length, 1, 'it is still asked')
  assert.equal(d.calls.cleanup[0].bind, null, 'with no binding to act on')
  // The record says so rather than implying a tidy desktop.
  const rec = s.of('cleanup')[0]
  assert.ok(rec, 'a cleanup record exists even here')
  assert.equal(rec.cleanupOk, false)
})

/* ── 4. a cleanup FAILURE is recorded and does not rewrite the run ────────── */

test('*** 4. cleanup failing does NOT overturn a successful run, and is recorded ***', () => {
  const s = sink()
  const d = desktopOk({
    ok: false, measured: true, processExited: false, notepadWindowsAfter: 1, notepadProcessesAfter: 1, forced: true, method: 'Stop-Process after CloseMainWindow did not exit', reason: 'cleanup_incomplete'
  })
  const { res } = run(d, s)

  // The steps happened and are audited. An untidy desktop does not un-type the text.
  assert.equal(res.ok, true, 'the run is still a success')
  assert.equal(res.stepsRun, 2)
  assert.equal(res.cleanup, 'cleanup_failed', 'and it says so, on the result the Owner sees')
  assert.equal(res.cleanupDetail.processExited, false)
  assert.equal(res.cleanupDetail.notepadWindowsAfter, 1)
  assert.equal(res.cleanupDetail.forced, true)
  assert.equal(res.orderClosed, true, 'the approval is still spent — it does not stay live for a retry')

  const rec = s.of('cleanup')[0]
  assert.ok(rec, 'the cleanup record is on disk')
  assert.equal(rec.cleanupOk, false)
  assert.equal(rec.measured, true)
  assert.equal(rec.reason, 'cleanup_incomplete')

  // The completed record names it too, so the chain does not read as clean.
  assert.match(String(s.of('completed')[0].cleanup), /cleanup_failed/)
})

test('*** 4b. a cleanup that THROWS is caught, recorded, and still not fatal ***', () => {
  const s = sink()
  const d = desktopOk()
  d.cleanup = () => { throw new Error('helper died') }
  const { res } = run(d, s)

  assert.equal(res.ok, true, 'a thrown cleanup does not fail a run that succeeded')
  assert.equal(res.cleanup, 'cleanup_failed')
  assert.equal(s.of('cleanup').length, 1)
  assert.equal(s.of('cleanup')[0].cleanupOk, false)
})

/* ── 5. the cleanup record carries MEASUREMENTS, not a word ───────────────── */

test('*** 5. every measured field reaches the audit record ***', () => {
  const s = sink()
  const { res } = run(desktopOk(), s)
  void res
  const rec = s.of('cleanup')[0]
  for (const f of ['processExited', 'notepadWindowsAfter', 'notepadProcessesAfter', 'forced', 'method']) {
    assert.ok(Object.prototype.hasOwnProperty.call(rec, f), 'the record carries ' + f)
  }
  assert.equal(rec.processExited, true)
  assert.equal(rec.notepadWindowsAfter, 0)
  assert.equal(rec.cleanupOk, true)
  assert.equal(rec.measured, true)
})

test('*** 5b. the ADAPTER keeps the measurements when the helper reports ok:false ***', () => {
  // The other place they were lost: call() throws on ok:false, so an incomplete cleanup used to
  // arrive as an exception with no numbers in it.
  const src = fs.readFileSync(path.join(__dirname, 'desktopAdapter.js'), 'utf8')
  const block = src.slice(src.indexOf('cleanup ({ bind })'))
  const body = block.slice(0, block.indexOf('\n    }') + 6)
  assert.equal(/\bcall\('cleanup'/.test(body), false, 'cleanup no longer goes through the throwing helper')
  assert.match(body, /runner\.run\(scriptPath, \{ op: 'cleanup'/, 'it unwraps the envelope itself')
  for (const f of ['processExited', 'notepadWindowsAfter', 'notepadProcessesAfter', 'forced', 'method']) {
    assert.ok(body.includes(f), 'the adapter returns ' + f)
  }
  assert.match(body, /ok: res\.ok === true/, 'and ok stays DERIVED from the helper, not asserted')
})

/* ── the binding is auditable, not merely inferable ───────────────────────── */

test('*** every step record carries the binding VALUES and where they came from ***', () => {
  const s = sink()
  const { res } = run(desktopOk(), s)
  assert.equal(res.ok, true)

  const starts = s.of('step-start')
  const outcomes = s.of('step-outcome')
  assert.equal(starts.length, 2)
  assert.equal(outcomes.length, 2)

  // open_app has no binding when it STARTS — that is the honest value, not a blank.
  assert.equal(starts[0].bindSource, 'not_yet_bound')
  assert.equal(starts[0].bindProcessId, null)

  // By its outcome, and for every record after, the binding is present and identical.
  const bound = [outcomes[0], starts[1], outcomes[1]]
  for (const r of bound) {
    assert.equal(r.bindProcessId, 4242)
    assert.equal(r.bindWindowHandle, '0x9001')
    assert.equal(r.bindUiaRuntimeId, '42.66898')
    assert.equal(r.bindSource, 'open_app@step1', 'and it says WHICH step produced it')
  }
})

test('*** THE OWNER\'S QUESTION, answered from the record alone ***', () => {
  // "Did both steps use the same binding?" — previously answerable only by reading the code.
  // Here it is decided by comparing two audit records, the way a third party would.
  const s = sink()
  run(desktopOk(), s)

  const step1 = s.of('step-outcome').find((r) => r.n === 1)
  const step2 = s.of('step-outcome').find((r) => r.n === 2)
  assert.equal(step1.bindProcessId, step2.bindProcessId)
  assert.equal(step1.bindWindowHandle, step2.bindWindowHandle)
  assert.equal(step1.bindUiaRuntimeId, step2.bindUiaRuntimeId)
  assert.equal(step1.bindSource, step2.bindSource)
})

test('*** the step records carry NO content — only identifiers ***', () => {
  // A pid, a handle and a RuntimeId name no file, no person and no text. The typed string must
  // not ride along with them.
  const s = sink()
  run(desktopOk(), s)
  for (const r of s.of('step-start').concat(s.of('step-outcome'))) {
    assert.equal(JSON.stringify(r).includes(TEXT), false, 'the sealed text is not in a step record')
    for (const forbidden of ['uiaAutomationId', 'uiaClassName', 'text', 'fileName', 'path']) {
      assert.equal(Object.prototype.hasOwnProperty.call(r, forbidden), false, 'no ' + forbidden)
    }
  }
})
