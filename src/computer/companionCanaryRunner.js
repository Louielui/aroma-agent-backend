'use strict'

/**
 * companionCanaryRunner.js — the Companion side of the canary. G1 + G5.
 *
 * ── THE ORDER OF THE QUESTIONS IS THE DESIGN ───────────────────────────────
 * The previous chain checked a folder, a hash, a flag and an audit sink, and was about to act
 * as the wrong identity. Every one of those checks was correct and none of them was the first
 * question. Here the first question is WHO, asked by the process that will act, about itself:
 *
 *   1. attest identity          who am I, right now, in this session
 *   2. verify the request       is this pointer usable, and does it point here
 *   3. verify the receipt       what was approved, and is the code still that code
 *   4. preflight AS MYSELF      can I read the ACL, is the folder clean
 *   5. claim the request        one-way, single-writer
 *   6. registry admission       one live order, approval spent
 *   7. durable admission audit  no record, no action
 *   8. executor.execute         once, with the frozen approved order
 *
 * Nothing before step 8 touches a desktop. Steps 1-4 are pure measurement, and any of them
 * failing means zero desktop actions and a request marked failed.
 *
 * ── WHY THE PREFLIGHT MOVED HERE ───────────────────────────────────────────
 * The Owner's side could not read the folder's ACL, and that was not a bug in the ACL — it was
 * the folder correctly permissioned for someone else. A check run by the wrong principal
 * answers a question nobody asked. So the machine preflight runs here, as AromaOperator, where
 * "can I read this" and "can I write here" mean what they say.
 *
 * ── IT HOLDS THE ONLY EXECUTOR ─────────────────────────────────────────────
 * The executor and the adapter are injected into THIS module and nothing else on the Companion
 * side reaches them. The Owner's entrypoint has no path here at all: it writes a request and
 * stops.
 */

const { attest, toAuditRecord } = require('./identityAttestation')
const { verifyRequest } = require('./executeRequest')

const ALLOWED_DIR = 'C:\\Aroma\\ComputerOperator-Test'
const EXPECTED_FILE = 'canary-1.txt'

/** The exact ACE set Script A left, by SID. Anything else means the folder was changed. */
const EXPECTED_ACES = Object.freeze({
  'S-1-5-21-2042659270-2029498691-2127769412-1009': 0x1201BF, // AromaOperator: ReadAndExecute+Write
  'S-1-5-32-544': 0x1F01FF, // Administrators: FullControl
  'S-1-5-18': 0x1F01FF // SYSTEM: FullControl
})

/** Rights the operator must NOT hold on the folder, each checked individually. */
const FORBIDDEN_RIGHTS = Object.freeze({
  Delete: 0x10000,
  ChangePermissions: 0x40000,
  TakeOwnership: 0x80000,
  FullControl: 0x1F01FF
})

const no = (refusal, human, detail) => ({ ok: false, refusal, human, detail: detail || null })

/**
 * The machine preflight, run BY the Companion AS itself.
 *
 * `machine` is injected: on the real Companion it is backed by PowerShell running in the
 * operator's session; in tests it is a fake. The RULES live here so the two cannot disagree.
 */
function companionPreflight (machine, ctx = {}) {
  if (!machine) return no('no_machine_probe', 'nothing could be measured about this machine')

  // ── the folder, read with the operator's own token ──────────────────────
  const acl = machine.readAcl(ALLOWED_DIR)
  if (!acl || acl.ok !== true) {
    // The Owner's side failed here and the message blamed the reader. As the operator this
    // must succeed, and if it does not the folder is not what Script A left.
    return no('acl_unreadable', 'The folder permissions cannot be read by the operator account.', acl && acl.reason)
  }
  if (acl.protected !== true) return no('acl_not_protected', 'The folder permissions are not the approved ones.')
  if (acl.inheritedCount !== 0) return no('acl_inherited', 'The folder permissions are not the approved ones.', 'inherited=' + acl.inheritedCount)
  if (acl.denyCount !== 0) return no('acl_has_deny', 'The folder permissions are not the approved ones.', 'deny=' + acl.denyCount)

  const aces = acl.aces || {}
  const seen = Object.keys(aces).sort()
  const want = Object.keys(EXPECTED_ACES).sort()
  if (seen.length !== want.length || seen.some((s, i) => s !== want[i])) {
    return no('acl_ace_set_mismatch', 'The folder permissions are not the approved ones.', seen.join(','))
  }
  for (const sid of want) {
    if (aces[sid] !== EXPECTED_ACES[sid]) {
      return no('acl_mask_mismatch', 'The folder permissions are not the approved ones.', sid)
    }
  }
  const opMask = aces['S-1-5-21-2042659270-2029498691-2127769412-1009']
  for (const [name, bit] of Object.entries(FORBIDDEN_RIGHTS)) {
    const held = name === 'FullControl' ? (opMask & bit) === bit : (opMask & bit) !== 0
    if (held) return no('operator_over_privileged', 'The operator has more rights than approved.', name)
  }

  // ── the folder contents ─────────────────────────────────────────────────
  const entries = machine.listDir(ALLOWED_DIR)
  if (entries === null || entries === undefined) return no('folder_unreadable', 'The folder cannot be read.')
  if (entries.length > 0) return no('folder_not_empty', 'The folder is not empty. It must be clean before a run.', entries.join(', '))
  if (machine.fileExists(ALLOWED_DIR + '\\' + EXPECTED_FILE)) {
    return no('file_exists', 'The file it would create already exists. Nothing will be overwritten.')
  }

  // ── nothing outside the approved path may be writable to the operator ───
  const outside = machine.probeWritable ? machine.probeWritable() : null
  if (outside === null) return no('write_scope_unmeasured', 'It could not be checked which folders are writable.')
  const strays = outside.filter((p) => p.writable && p.path !== ALLOWED_DIR)
  if (strays.length > 0) {
    return no('writable_outside_scope', 'The operator can write somewhere it should not.', strays.map((s) => s.path).join(', '))
  }

  // ── the staged Companion closure ────────────────────────────────────────
  const staged = machine.stagedClosure ? machine.stagedClosure() : null
  if (!staged || staged.ok !== true) return no('staging_unverified', 'The staged program could not be checked.', staged && staged.reason)

  // ── Notepad, and the audit sink ─────────────────────────────────────────
  const notepads = machine.notepadCount()
  if (notepads !== 0) return no('notepad_already_open', 'Notepad is already open. Please close it first.', String(notepads))
  if (machine.auditWritable() !== true) return no('audit_not_writable', 'The record of what happens cannot be written. Nothing will run.')

  return { ok: true }
}

/**
 * Run one canary on the Companion side.
 *
 * @param {object} deps.machine      the operator's view of its own machine
 * @param {object} deps.snapshot     identity measured by the collector, of THIS process
 * @param {object} deps.ledger       the request ledger
 * @param {object} deps.executor     the ONLY executor in the system
 * @param {object} deps.artifactStore durable audit
 */
function runCanaryAsCompanion (request, deps = {}) {
  const audit = (kind, record) => {
    try { deps.artifactStore.write('computer-audit', Object.assign({ kind }, record)) } catch (e) { return false }
    return true
  }
  const fail = (res, phase) => {
    // A failed attempt CONSUMES the request. Not retryable, by design: nobody can evidence what
    // a half-run did, so nobody may repeat it.
    if (deps.ledger && deps.ledger.stateOf(request && request.requestId) === 'claimed') {
      deps.ledger.settle(request.requestId, { ok: false, refusal: res.refusal, phase })
    }
    return Object.assign({}, res, { phase, desktopActions: 0 })
  }

  // ── 1. WHO AM I ─────────────────────────────────────────────────────────
  const verdict = attest(deps.snapshot, deps.expectedIdentity)
  const attestation = toAuditRecord(deps.snapshot, verdict)
  if (!audit('identity-attestation', attestation)) {
    return fail(no('audit_not_writable', 'The identity check could not be recorded. Nothing will run.'), 'attestation')
  }
  if (!verdict.ok) {
    return fail(no(verdict.refusal, 'This computer is not set up to run the task as the operator account.', verdict.detail), 'attestation')
  }

  // ── 2-3. the request and what it points at ──────────────────────────────
  const rv = verifyRequest(request, {
    now: deps.now,
    receipt: deps.receipt,
    receiptSha256: deps.receiptSha256,
    currentPackageHash: deps.currentPackageHash
  })
  if (!rv.ok) return fail(no(rv.refusal, 'The request is not usable.', rv.reason), 'request')

  if (!deps.receipt || deps.receiptVerified !== true) {
    return fail(no('receipt_not_verified', 'The approval could not be confirmed.'), 'receipt')
  }

  // ── 4. the machine, measured by me ──────────────────────────────────────
  const pre = companionPreflight(deps.machine, { sessionId: deps.snapshot.sessionId })
  if (!pre.ok) return fail(pre, 'preflight')

  // ── 5. claim: one-way, single-writer ────────────────────────────────────
  const claimed = deps.ledger.claim(request.requestId, deps.snapshot.sid)
  if (!claimed.ok) return Object.assign({}, no(claimed.refusal, 'This request has already been used.', claimed.reason), { phase: 'claim', desktopActions: 0 })

  // ── 6-8. hand to the executor, ONCE, with the frozen approved order ─────
  const approvedOrder = Object.freeze(deps.receipt.approvedOrder)
  const result = deps.executor.execute(approvedOrder, { flagOn: true, killSwitch: deps.killSwitch })

  deps.ledger.settle(request.requestId, { ok: result.ok === true, refusal: result.refusal || null })
  audit('canary-outcome', {
    requestId: request.requestId,
    approvalId: request.approvalId,
    ok: result.ok === true,
    refusal: result.refusal || null,
    stepsRun: result.stepsRun || 0,
    sid: deps.snapshot.sid,
    sessionId: deps.snapshot.sessionId
  })

  return { ok: result.ok === true, refusal: result.refusal || null, result, attestation }
}

module.exports = {
  runCanaryAsCompanion, companionPreflight,
  ALLOWED_DIR, EXPECTED_FILE, EXPECTED_ACES, FORBIDDEN_RIGHTS
}
