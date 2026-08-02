'use strict'

/**
 * evidenceReachesAudit.test.js — a helper's measurements must arrive in the audit, whole.
 *
 * ── THE SAME SHAPE, TWICE, BOTH TIMES EXPENSIVE ───────────────────────────
 *   1. cleanup measured processExited / notepadWindowsAfter / forced / method. The adapter ran
 *      it through call(), which THROWS when a helper returns ok:false — and ok:false is exactly
 *      when cleanup has something to report. The numbers went into an exception.
 *   2. Resolve-SaveUiBinding measured candidatesObserved, elapsedMs, dialogOwnership and
 *      dialogHandle. uiaCanary turned four of those into a sentence and dropped the evidence
 *      hashtable; the executor then kept only err.message, which is the reason code alone. The
 *      canary failed with `filename_field_not_found` and not one fact about why.
 *
 * Both were invisible to every existing test, because every existing test asserted that a
 * RECORD EXISTED. A record existed both times. What was missing was inside it.
 *
 * So this file asserts FIELD COMPLETENESS end to end: a fake helper returns a refusal carrying
 * known evidence, the real adapter and the real executor carry it, and every key must be found
 * in the audit record. The positive control drops one field and the test must go red.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createComputerExecutor } = require('./computerExecutor')
const { createDesktopAdapter } = require('./desktopAdapter')
const { createOrderRegistry } = require('./orderRegistry')
const { computeOrderHash } = require('./sealedOrderGate')

const TEXT = 'Aroma Computer Operator canary. Three steps with save. Round 1.'
const ALLOWED = 'C:\\Aroma\\ComputerOperator-Test'

/** Exactly what Resolve-SaveUiBinding measures. If it grows a field, this list must grow. */
const RESOLVER_EVIDENCE = Object.freeze({
  stage: 'filename_field',
  candidatesObserved: 3,
  elapsedMs: 8012,
  dialogVerified: true,
  filenameFieldVerified: false,
  saveButtonVerified: false,
  dialogClassName: '#32770',
  dialogOwnership: 'uia_descendant',
  dialogHandle: '132456',
  dialogsVerified: 1,
  dialogsRejected: 'class:Static, class:#32770, pid',
  filenameCandidates: 0,
  timedOut: true
})

const BIND = Object.freeze({
  processId: 4242, sessionId: 1, windowHandle: '0x9001',
  uiaRuntimeId: '42.66904', uiaControlType: 'ControlType.Document',
  uiaClassName: 'RichEditD2DPT', uiaAutomationId: ''
})

function order () {
  const o = {
    orderId: 'wo_evidence',
    approvalId: 'appr_' + 'e'.repeat(32),
    sealed: true,
    sealedText: TEXT,
    allowedPath: ALLOWED,
    maxSteps: 3,
    timeoutSec: 300,
    steps: [
      { n: 1, action: 'open_app', appId: 'notepad' },
      { n: 2, action: 'type_text', text: TEXT },
      { n: 3, action: 'save', fileName: 'canary-save-1.txt' }
    ]
  }
  o.orderHash = computeOrderHash(o)
  return o
}

/**
 * A runner speaking the REAL envelope shape, so the path under test is the production one:
 * extractEnvelope wraps the parsed JSON as { ok:true, result:<whole document> }, and a script
 * refusal is therefore a result whose own ok is false.
 */
function runnerRefusingSaveWith (evidence) {
  return {
    run (scriptId, payload) {
      if (payload.op === 'open_app') {
        return { ok: true, result: Object.assign({ ok: true }, BIND, { uiaControlMatchedAs: 'Document' }) }
      }
      // verify_binding is re-run before EVERY step. A double that answers it with a bare
      // { ok: true } is not neutral — the adapter compares the returned identity against the
      // binding and refuses `process_identity_changed`, so the run dies at step 2 and never
      // reaches the save this file exists to test. It must speak the real shape.
      if (payload.op === 'verify_binding') {
        return { ok: true, result: Object.assign({ ok: true }, BIND, { uiaControlPresent: true }) }
      }
      if (payload.op === 'type_text') return { ok: true, result: { ok: true, method: 'ValuePattern', chars: TEXT.length } }
      if (payload.op === 'save_as') {
        const res = { ok: false, reason: 'filename_field_not_found', detail: 'timed out after 8012 ms' }
        if (evidence) res.evidence = evidence
        return { ok: true, result: res }
      }
      if (payload.op === 'cleanup') {
        return { ok: true, result: { ok: true, processExited: true, notepadWindowsAfter: 0, notepadProcessesAfter: 0, forced: true, method: 'Stop-Process after CloseMainWindow did not exit' } }
      }
      return { ok: true, result: { ok: true } }
    }
  }
}

function runWith (evidence) {
  const records = []
  const store = { write: (collection, rec) => { records.push(rec); return { ok: true, id: rec.id } } }
  const desktop = createDesktopAdapter({ runner: runnerRefusingSaveWith(evidence), fsProbe: { exists: () => false } })
  const ex = createComputerExecutor({ artifactStore: store, desktop, orderRegistry: createOrderRegistry({ singleUse: true }), fsProbe: { exists: () => false } })
  const res = ex.execute(order(), { flagOn: true, attestedSessionId: 1 })
  return { res, records, aborted: records.find((r) => r.kind === 'aborted') }
}

/* ── 1. every measured field arrives ──────────────────────────────────────── */

test('*** EVERY field the resolver measured reaches the audit record ***', () => {
  const { res, aborted } = runWith(RESOLVER_EVIDENCE)

  assert.equal(res.ok, false, 'the run failed, as the helper said')
  assert.ok(aborted, 'an abort record exists')

  const missing = []
  for (const [k, v] of Object.entries(RESOLVER_EVIDENCE)) {
    if (!Object.prototype.hasOwnProperty.call(aborted, k)) { missing.push(k + ' (absent)'); continue }
    if (aborted[k] !== v) missing.push(k + ' (got ' + JSON.stringify(aborted[k]) + ', expected ' + JSON.stringify(v) + ')')
  }
  assert.deepEqual(missing, [],
    'these measurements did not survive the journey to the audit:\n  ' + missing.join('\n  '))
})

test('*** the specific refusal and its detail survive too, not just "step_failed" ***', () => {
  const { aborted } = runWith(RESOLVER_EVIDENCE)
  // The generic reason is still step_failed — that is the executor's own classification — but
  // the helper's own code and sentence must both be readable.
  assert.equal(aborted.reason, 'step_failed')
  assert.match(String(aborted.detail), /filename_field_not_found/, 'the helper\'s code is named')
  assert.match(String(aborted.detail), /timed out after 8012 ms/, 'and its detail, which used to be dropped')
})

test('*** the run RESULT carries the evidence as well, for the screen ***', () => {
  const { res } = runWith(RESOLVER_EVIDENCE)
  assert.ok(res.evidence, 'the caller can show it without reading the audit file')
  assert.equal(res.evidence.dialogOwnership, 'uia_descendant')
  assert.equal(res.evidence.candidatesObserved, 3)
})

/* ── 2. POSITIVE CONTROLS — the test must be able to fail ─────────────────── */

test('*** POSITIVE CONTROL — dropping ONE field is caught ***', () => {
  // Without this, "no missing fields" could mean the loop compares nothing.
  for (const drop of ['dialogOwnership', 'candidatesObserved', 'elapsedMs', 'dialogHandle']) {
    const partial = Object.assign({}, RESOLVER_EVIDENCE)
    delete partial[drop]
    const { aborted } = runWith(partial)

    const missing = Object.keys(RESOLVER_EVIDENCE).filter((k) => !Object.prototype.hasOwnProperty.call(aborted, k))
    assert.deepEqual(missing, [drop],
      'dropping ' + drop + ' must be detected, and only it: ' + missing.join(', '))
  }
})

test('*** POSITIVE CONTROL — no evidence at all is caught, and is not an empty object ***', () => {
  const { aborted } = runWith(null)
  const missing = Object.keys(RESOLVER_EVIDENCE).filter((k) => !Object.prototype.hasOwnProperty.call(aborted, k))
  assert.equal(missing.length, Object.keys(RESOLVER_EVIDENCE).length, 'all of it is reported missing')
  // Absent must stay absent. An empty object would read as "measured, and there was nothing".
  assert.equal(aborted.evidence, undefined, 'nothing is invented to fill the gap')
})

test('*** POSITIVE CONTROL — the OLD code path would fail this ***', () => {
  // Reproduces exactly what the executor used to do: keep err.message and nothing else.
  const err = Object.assign(new Error('filename_field_not_found'), {
    reason: 'filename_field_not_found',
    detail: 'timed out after 8012 ms',
    evidence: RESOLVER_EVIDENCE
  })
  const oldRecord = { reason: 'step_failed', detail: err.message }
  const newRecord = Object.assign(
    { reason: 'step_failed', detail: err.reason + ': ' + err.detail },
    err.evidence)

  const missingOld = Object.keys(RESOLVER_EVIDENCE).filter((k) => !(k in oldRecord))
  assert.equal(missingOld.length, Object.keys(RESOLVER_EVIDENCE).length,
    'the old shape carried NONE of the measurements')
  const missingNew = Object.keys(RESOLVER_EVIDENCE).filter((k) => !(k in newRecord))
  assert.deepEqual(missingNew, [], 'and the new one carries all of them')
})

/* ── 3. the transport itself has somewhere to put structure ───────────────── */

test('*** the PowerShell refusal envelope can carry evidence, and omits it when absent ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const transport = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'aromaJsonTransport.ps1'), 'utf8')
  assert.match(transport, /\[hashtable\] \$Evidence = \$null/, 'the refusal writer accepts evidence')
  assert.match(transport, /if \(\$null -ne \$Evidence\) \{ \$env\.evidence = \$Evidence \}/,
    'and adds it only when there is some — absent stays absent')

  const canary = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'uiaCanary.ps1'), 'utf8')
  // The resolver's own fields, spread into the emitted evidence rather than summarised.
  for (const f of ['stage', 'candidatesObserved', 'elapsedMs', 'dialogVerified', 'filenameFieldVerified', 'saveButtonVerified']) {
    assert.match(canary, new RegExp(f + ' = \\$ui\\.' + f), 'the canary emits ' + f)
  }
  assert.match(canary, /foreach \(\$k in \$ui\.evidence\.Keys\) \{ \$ev\[\$k\] = \$ui\.evidence\[\$k\] \}/,
    'and copies the whole evidence hashtable, so a new field travels without another edit here')
})

test('*** the adapter keeps evidence on the thrown error ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const adapter = fs.readFileSync(path.join(__dirname, 'desktopAdapter.js'), 'utf8')
  assert.match(adapter, /e\.evidence = evidence \|\| null/, 'an Error may carry more than a sentence')
  assert.match(adapter, /throw fail\(res\.reason \|\| 'adapter_failed', res\.detail \|\| null, res\.evidence \|\| null\)/,
    'and the helper evidence is what it carries')
})
