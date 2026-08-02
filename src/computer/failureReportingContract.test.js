'use strict'

/**
 * failureReportingContract.test.js — a refusal the Owner cannot see is a refusal that did not
 * happen, as far as he is concerned.
 *
 * ── THE SIXTH TIME ─────────────────────────────────────────────────────────
 * The first canary that actually opened Notepad failed with `window_not_found`. That reason was
 * in the executor's result and in the audit record on disk. The screen said:
 *
 *     IT DID NOT RUN.
 *     (nothing)
 *
 * because the runner returned { ok, refusal, result, attestation } and the screen prints
 * res.human and res.detail — fields only the no(...) refusal paths ever set. Six times now a
 * reason has existed and the display layer has dropped it, so it is asserted here rather than
 * remembered: EVERY refusal the chain can produce must reach the screen.
 *
 * ── AND THE REASSURANCE MUST BE A MEASUREMENT ──────────────────────────────
 * "Nothing was left behind" was printed unconditionally on every failure. On that same run it
 * was false — Notepad was still open and the Owner closed it by hand. A sentence that is printed
 * whatever happened carries no information and is believed anyway.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const R = require('./companionCanaryRunner')
const T = require('../../scripts/computer/operatorToolsCommon')
const { createArtifactStore } = require('../store/artifactStore')
const { computeOrderHash } = require('./sealedOrderGate')
const { REQUIRED } = require('./identityAttestation')
const RQ = require('./executeRequestStore')

const NOW = Date.parse('2026-08-01T16:00:00Z')
const TEXT = 'Aroma Computer Operator canary. Round 1.'

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p))

const snapshot = (over = {}) => Object.assign({
  account: REQUIRED.account, sid: REQUIRED.sid, sessionId: 9, desktop: REQUIRED.desktop,
  isElevated: false, isInteractive: true, integrityLevel: 'Medium',
  groupSids: ['S-1-5-32-545'], administratorsPresent: false, administratorsEnabled: false,
  collectorVersion: 1, collectorSha256: 'a'.repeat(64), processId: 22148,
  attestedAt: '2026-08-01T15:59:00.000Z'
}, over)

function chain (executorResult) {
  const auditDir = tmp('fr-audit-')
  const reqDir = tmp('fr-req-')
  const store = createArtifactStore({ baseDir: auditDir })

  const order = {
    orderId: 'wo_canary_notepad_1',
    approvalId: 'appr_' + 'b'.repeat(32),
    sealed: true,
    sealedText: TEXT,
    // No allowedPath: this order has a single open_app step and nothing that saves, and
    // verifySeal refuses a path with no save to bound (unexpected_field).
    maxSteps: 3,
    timeoutSec: 300,
    steps: [{ n: 1, action: 'open_app', appId: 'notepad' }]
  }
  order.orderHash = computeOrderHash(order)
  const receipt = {
    approvalId: order.approvalId,
    workOrderHash: order.orderHash,
    executionPackageManifestHash: 'c'.repeat(64),
    approvedOrder: order
  }
  const ledger = RQ.createRequestStore({ dir: reqDir, now: () => NOW })
  const request = RQ.buildRequest(receipt, { now: () => NOW })
  ledger.submit(request)

  const machine = {
    readAcl: (p) => (p === R.REQUEST_DIR
      ? { ok: true, protected: true, inheritedCount: 0, denyCount: 0, aces: Object.assign({}, R.EXPECTED_REQUEST_ACES) }
      : { ok: true, protected: true, inheritedCount: 0, denyCount: 0, aces: Object.assign({}, R.EXPECTED_ACES) }),
    listDir: () => [],
    fileExists: () => false,
    probeWritable: () => ({ ok: true, paths: [{ path: 'C:\\Aroma', writable: false, class: 'enforced' }], residue: [] }),
    stagedClosure: () => ({ ok: true }),
    notepadCount: () => 0,
    auditWritable: () => true
  }

  const seen = {}
  const executor = { execute: (o, opts) => { seen.opts = opts; return executorResult } }

  const res = R.runCanaryAsCompanion(request, {
    snapshot: snapshot(), machine, executor, ledger, artifactStore: store,
    receipt, receiptVerified: true, currentPackageHash: receipt.executionPackageManifestHash,
    env: { COMPUTER_OPERATOR: 'on' }, now: () => NOW
  })
  return { res, seen, auditDir }
}

/* ── 2. every refusal reaches the screen ──────────────────────────────────── */

test('*** EVERY executor refusal produces a human sentence and a detail ***', () => {
  // The exact one that reached the Owner as a blank screen, plus every other refusal the
  // executor can return.
  const refusals = [
    'step_failed', 'window_not_found', 'window_ambiguous', 'uia_control_missing',
    'stale_binding', 'missing_binding', 'bad_binding', 'wrong_session', 'unexpected_field',
    'audit_write_failed', 'approval_id_already_used', 'flag_off',
    'a_refusal_nobody_has_written_a_sentence_for'
  ]
  for (const refusal of refusals) {
    const { res } = chain({ ok: false, refusal, reason: 'because', stepsRun: 0, desktopActions: 0 })
    assert.equal(res.ok, false, refusal)
    assert.ok(res.human && res.human.length > 0, 'no human sentence for: ' + refusal)
    assert.ok(res.detail && String(res.detail).length > 0, 'no detail for: ' + refusal)
  }
})

test('*** the real failure — window_not_found — says what happened ***', () => {
  const { res } = chain({ ok: false, refusal: 'step_failed', reason: 'window_not_found', stepsRun: 0, desktopActions: 0, cleanup: 'not_done:nothing_to_clean' })
  assert.match(res.human, /step could not be carried out/i)
  assert.equal(res.detail, 'window_not_found', 'the executor\'s own word reaches the screen')
})

test('*** POSITIVE CONTROL — a success carries no failure sentence ***', () => {
  // Without this, "human is always set" could be satisfied by setting it unconditionally, which
  // would put a failure sentence on a successful run.
  const { res } = chain({ ok: true, stepsRun: 3, desktopActions: 3, auditChainComplete: true })
  assert.equal(res.ok, true)
  assert.equal(res.human, null, 'no failure sentence on success')
})

test('*** the screen prints the reason, and says so when there is none ***', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'tool-start-companion.js'), 'utf8')
  assert.match(src, /if \(res && res\.human\)/, 'it prints the sentence')
  assert.match(src, /if \(res && res\.detail\)/, 'and the detail')
  assert.match(src, /It gave no reason/, 'and reports the ABSENCE of a reason as a fault of its own')
  assert.match(src, /audit record in/, 'pointing at where the truth is recorded')
})

/* ── 3. "nothing was left behind" is measured ─────────────────────────────── */

test('*** leftovers() MEASURES: Notepad, the folder, and the cleanup result ***', () => {
  const clean = T.leftovers({
    machine: { notepadCount: () => 0, listDir: () => [] },
    cleanup: 'done'
  })
  assert.equal(clean.clean, true)
  assert.deepEqual(clean.items, [])

  // The real first-run situation: Notepad still open, cleanup refused.
  const dirty = T.leftovers({
    machine: { notepadCount: () => 1, listDir: () => [] },
    cleanup: 'not_done:nothing_to_clean'
  })
  assert.equal(dirty.clean, false)
  assert.ok(dirty.items.some((i) => /Notepad/.test(i)), 'it names the open Notepad')
  assert.ok(dirty.items.some((i) => /cleanup did not run/.test(i)), 'and that cleanup did not run')
})

test('*** "could not look" is never reported as "nothing there" ***', () => {
  const blind = T.leftovers({
    machine: { notepadCount: () => -1, listDir: () => null },
    cleanup: 'no_result'
  })
  assert.equal(blind.clean, false, 'an unreadable machine is not a clean one')
  assert.ok(blind.items.some((i) => /could not be counted/.test(i)))
  assert.ok(blind.items.some((i) => /could not be read/.test(i)))
})

test('*** the reassurance is not printed unconditionally any more ***', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'tool-start-companion.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(code, /Nothing was left behind/,
    'the unconditional sentence is gone')
  assert.match(code, /T\.leftovers\(/, 'and the claim is now measured')
  assert.match(code, /SOMETHING IS LEFT BEHIND/, 'with a branch that says so')
})

test('*** cleanup records what it DID, not that it was called ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'computerExecutor.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(code, /cleanup = 'attempted'/, "no unconditional 'attempted'")
  assert.match(code, /not_done:/, 'a refused cleanup is recorded as refused')
  assert.match(code, /no_result/, 'and a cleanup that answers nothing is its own state')
})

/* ── 4. attestedSessionId is wired in PRODUCTION ──────────────────────────── */

test('*** the runner PASSES attestedSessionId to the executor ***', () => {
  // Second time a parameter existed, tests were green, and production did not send it. Asserted
  // by driving the production runner and reading what the executor was actually handed — not by
  // a test that supplies the argument itself.
  const { seen } = chain({ ok: true, stepsRun: 3, desktopActions: 3 })
  assert.equal(seen.opts.attestedSessionId, 9, 'the executor receives the ATTESTED session id')
  assert.equal(seen.opts.flagOn, true)
})

test('*** and it is the attested session, not a constant ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'companionCanaryRunner.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.match(code, /attestedSessionId:\s*deps\.snapshot\.sessionId/,
    'it comes from the snapshot this run attested, not from a literal')
})

/* ── every packaged .ps1 must survive PowerShell 5.1's encoding rules ─────── */

test('*** every packaged .ps1 is ASCII, or carries a BOM ***', () => {
  // Learned the hard way, twice. PowerShell 5.1 reads a .ps1 WITHOUT a BOM as ANSI, so a UTF-8
  // em-dash arrives as three Windows-1252 characters — one of which is a double quote. In a
  // comment that is harmless; inside a string it closes the string, and the file stops parsing
  // several lines later with an error that points nowhere near the real character.
  //
  // That is exactly what happened to Operator-MeasureNotepadLaunch.ps1 on its first parse:
  // "Missing closing '}'" at a line whose braces were perfectly balanced.
  const PKG = require('../../scripts/computer/executionPackage')
  const REPO = path.resolve(__dirname, '..', '..')
  const offenders = []
  for (const rel of PKG.PACKAGE_FILES.filter((p) => p.endsWith('.ps1'))) {
    const buf = fs.readFileSync(path.join(REPO, rel.split('/').join(path.sep)))
    const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF
    if (hasBom) continue
    const nonAscii = [...buf.toString('utf8')].filter((c) => c.charCodeAt(0) > 127)
    if (nonAscii.length > 0) {
      offenders.push(rel + ' — no BOM and ' + nonAscii.length + ' non-ASCII character(s): ' +
        [...new Set(nonAscii)].join(' '))
    }
  }
  assert.deepEqual(offenders, [],
    'PowerShell 5.1 will read these as ANSI and may mis-parse them')
})

test('*** POSITIVE CONTROL — the encoding rule can detect a bad file ***', () => {
  const bad = Buffer.from('Say "an em dash — here"\n', 'utf8')
  const hasBom = bad[0] === 0xEF && bad[1] === 0xBB && bad[2] === 0xBF
  assert.equal(hasBom, false, 'the sample has no BOM')
  const nonAscii = [...bad.toString('utf8')].filter((c) => c.charCodeAt(0) > 127)
  assert.equal(nonAscii.length, 1, 'and the rule sees the character that breaks it')
})

/* ── 5. the admission record tells the truth about limits ─────────────────── */

test('*** admission records the ORDER\'s limits and the system ceilings, labelled ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'computerExecutor.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.match(code, /orderLimits:\s*\{\s*maxSteps:\s*order\.maxSteps/, 'the order\'s own limits')
  assert.match(code, /systemCeilings:\s*LIMITS/, 'and the ceilings, named as such')
  // The bare `limits: LIMITS` is gone — that is what made a maxSteps-3 order read as 10.
  assert.doesNotMatch(code, /\blimits:\s*LIMITS\b/, 'no unlabelled limits field')
})
