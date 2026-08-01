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
// THE G2 PROTOCOL, and only it.
//
// Until 2026-08-01 this line read `require('./executeRequest')` — a second, older request module
// with its own field list (`kind: 'canary-execute-request'`) and its own in-memory ledger. The
// Owner's side had been migrated to `computer.canary.execute.v1`; the Companion had not. Both
// modules were correct, both were tested, and they would never have agreed on a single request:
// the Owner would have written one schema and the Companion refused it as `unknown_message_type`.
//
// Two schemas for one wire is the same defect as two PowerShell launchers, which had already
// cost this project a day. The older module is gone rather than deprecated, because a
// second implementation that still parses is a second implementation somebody can reach.
const { verifyAgainst, createRequestStore } = require('./executeRequestStore')
const { resolveComputerOperator } = require('./computerOperatorFlag')

const ALLOWED_DIR = 'C:\\Aroma\\ComputerOperator-Test'
const EXPECTED_FILE = 'canary-1.txt'

/** The exact ACE set Script A left, by SID. Anything else means the folder was changed. */
const EXPECTED_ACES = Object.freeze({
  'S-1-5-21-2042659270-2029498691-2127769412-1009': 0x1201BF, // AromaOperator: ReadAndExecute+Write
  'S-1-5-32-544': 0x1F01FF, // Administrators: FullControl
  'S-1-5-18': 0x1F01FF // SYSTEM: FullControl
})

/**
 * The request directory, and the exact permissions it must carry.
 *
 * Measured on the real folder rather than guessed. C:\Aroma carries an INHERIT-ONLY DENY
 * FullControl for AromaOperator, so this folder must be PROTECTED — if inheritance were left on,
 * the claimer could not read the request at all and the failure would look like a bug in the
 * Companion rather than a permission the tree was always going to apply.
 *
 * The operator needs Modify, not Read: a claim is a RENAME, which needs delete on the source
 * name and create in the directory. Read-only makes claiming impossible.
 *
 * That write right means the operator could FORGE a request file. It buys nothing: every request
 * is re-verified against a receipt the Companion reads for itself, and the receipt lives in the
 * repo, which this account is denied. A request is a pointer with an expiry, never a permission.
 */
const REQUEST_DIR = 'C:\\Aroma\\ComputerOperator-Requests'
const EXPECTED_REQUEST_ACES = Object.freeze({
  'S-1-5-18': 0x1F01FF, // SYSTEM
  'S-1-5-32-544': 0x1F01FF, // Administrators
  'S-1-5-21-2042659270-2029498691-2127769412-1002': 0x1301BF, // louis, who creates requests
  'S-1-5-21-2042659270-2029498691-2127769412-1009': 0x1301BF // AromaOperator, who claims them
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
 * A filename-safe fragment of the request id, so audit records from one run group together and
 * two runs can never collide on a name. Falls back to a constant when there is no usable id —
 * an audit record must never fail to be written because the thing it is recording was malformed.
 */
/**
 * A sentence for an executor refusal, for the one screen the Owner reads.
 *
 * Unknown refusals fall through to the raw name rather than to nothing. A refusal this table has
 * not heard of is exactly the case where the reader most needs to be told SOMETHING — and a
 * table that silently swallows what it does not recognise is how the reason went missing.
 */
function humanForExecutorRefusal (refusal, reason) {
  const table = {
    step_failed: 'A step could not be carried out on the desktop.',
    window_not_found: 'The application opened but its window could not be found.',
    window_ambiguous: 'More than one candidate window appeared. It refused to choose between them.',
    uia_control_missing: 'The window opened but its editable area could not be found.',
    stale_binding: 'The window it was working with changed or disappeared part way through.',
    missing_binding: 'Opening the application did not produce a usable window reference.',
    bad_binding: 'The window reference the application produced was malformed.',
    wrong_session: 'The window that opened belongs to a different session.',
    unexpected_field: 'The task was rejected because it carries something it should not.',
    audit_write_failed: 'The record of what happened could not be written, so it stopped.',
    approval_id_already_used: 'This approval has already been used.',
    refuse_overwrite: 'The file it would create already exists. Nothing was overwritten.',
    flag_off: 'The computer operator switch is off in this process.'
  }
  const sentence = table[refusal]
  if (sentence) return sentence
  if (refusal) return 'It stopped with: ' + refusal + (reason ? ' (' + reason + ')' : '')
  return 'It stopped without giving a reason, which is itself a fault worth reporting.'
}

function kindSafe (request) {
  const id = request && typeof request.requestId === 'string' ? request.requestId : ''
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '')
  return cleaned || 'norequest'
}

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

  // PROBE RESIDUE GETS ITS OWN REFUSAL. These files are ours: an earlier run's write-probe that
  // could not be removed, because the operator has no Delete on this folder by design. Reporting
  // them as a generic "the folder is not empty" points the reader at the folder, when the cause
  // is the probe — and leaves them looking for whoever put a file there.
  const residue = entries.filter((e) => /^\.aroma-probe-[0-9a-f]{32}\.tmp$/i.test(String(e)))
  if (residue.length > 0) {
    return no('probe_residue',
      'An earlier check left ' + residue.length + ' of its own temporary file(s) here, and the operator account cannot delete them.',
      'Ask the Owner to empty ' + ALLOWED_DIR + ' from an elevated window. Files: ' + residue.join(', '))
  }
  if (entries.length > 0) return no('folder_not_empty', 'The folder is not empty. It must be clean before a run.', entries.join(', '))
  if (machine.fileExists(ALLOWED_DIR + '\\' + EXPECTED_FILE)) {
    return no('file_exists', 'The file it would create already exists. Nothing will be overwritten.')
  }

  // ── nothing outside the approved path may be writable to the operator ───
  // The result carries its own reason now, so a refusal is reported as itself rather than as
  // "not measured" — which is what the operator was shown when the probe could not clean up.
  const outside = machine.probeWritable ? machine.probeWritable() : null
  if (!outside || outside.ok !== true) {
    return no('write_scope_unmeasured', 'It could not be checked which folders are writable.',
      outside ? (outside.reason + (outside.detail ? ': ' + outside.detail : '')) : 'no probe')
  }
  // ── ONLY `enforced` ENTRIES CAN REFUSE ──────────────────────────────────
  // An entry is enforceable when WE set the permission and can name the script that set it.
  // C:\Windows\Temp and the operator's own profile were treated as enforceable and are not:
  // both are writable by design on every Windows machine, nobody had measured otherwise, and
  // the expectation contradicted two other parts of this same system — the audit probe, which
  // lives in %TEMP%, and the shortcut installer, which writes to the desktop.
  //
  // `observed` entries are measured and reported and never block. Asserting a permission you
  // did not establish is guessing about someone else's system, and this one guessed wrong three
  // logins in a row.
  const enforced = (outside.paths || []).filter((p) => p.class === 'enforced')
  if (enforced.length === 0) {
    return no('write_scope_unmeasured', 'No folder with a known permission was checked.', 'no enforced entries')
  }
  const strays = enforced.filter((p) => p.writable === true && p.path !== ALLOWED_DIR)
  if (strays.length > 0) {
    return no('writable_outside_scope', 'The operator can write somewhere it should not.',
      strays.map((s) => s.path + (s.provenance ? ' [' + s.provenance + ']' : '')).join('; '))
  }
  // A probe that wrote outside its scope AND could not clean up has left evidence. Reported
  // rather than tidied away: the file is the proof of the finding above it.
  if ((outside.residue || []).length > 0) {
    return no('probe_residue_outside_scope', 'A check wrote a file outside the approved folder and could not remove it.',
      outside.residue.join(', '))
  }

  // ── the request directory, checked as itself ────────────────────────────
  // The transport is a directory, so the directory's permissions ARE the transport's security.
  // Verified at run time rather than trusted from the day it was provisioned: "it was right when
  // we set it up" is the same claim the staging check was making while it verified the wrong
  // program entirely.
  const reqAcl = machine.readAcl(REQUEST_DIR)
  if (!reqAcl || reqAcl.ok !== true) {
    return no('request_dir_unreadable', 'The folder tasks arrive in cannot be read.', reqAcl && reqAcl.reason)
  }
  if (reqAcl.protected !== true) {
    // Not protected means it inherits, and what it inherits from C:\Aroma is a Deny FullControl
    // aimed at this very account.
    return no('request_dir_inherits', 'The task folder does not have its own permissions.')
  }
  if (reqAcl.inheritedCount !== 0) return no('request_dir_inherits', 'The task folder does not have its own permissions.', 'inherited=' + reqAcl.inheritedCount)
  if (reqAcl.denyCount !== 0) return no('request_dir_has_deny', 'The task folder has a Deny rule, which would break claiming.')
  {
    const seen = Object.keys(reqAcl.aces || {}).sort()
    const want = Object.keys(EXPECTED_REQUEST_ACES).sort()
    if (seen.length !== want.length || seen.some((s, i) => s !== want[i])) {
      // Anyone at all outside the four named principals is a stranger with access to the channel.
      return no('request_dir_unknown_identity', 'Someone unexpected can reach the task folder.', seen.join(','))
    }
    for (const sid of want) {
      if (reqAcl.aces[sid] !== EXPECTED_REQUEST_ACES[sid]) {
        return no('request_dir_rights_changed', 'The task folder permissions are not the approved ones.', sid)
      }
    }
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
  // ── THE STORE REQUIRES id AND createdAt, AND THIS SUPPLIED NEITHER ────────
  // `toAuditRecord` builds a rich record with no `id` and no `createdAt`, so the store threw
  // TypeError before reaching the filesystem — and the catch below turned that into
  // "The identity check could not be recorded. Nothing will run." A schema error wearing the
  // costume of a disk failure, on the one screen where the difference matters.
  //
  // Supplied by the caller, deliberately, because the store's contract is that the caller
  // supplies them: that is what makes a recorded run reproducible in a test.
  let auditSeq = 0
  const auditId = () => 'ccr_' + String(++auditSeq).padStart(3, '0') + '_' + kindSafe(request)
  const audit = (kind, record) => {
    try {
      const createdAt = new Date(deps.now ? deps.now() : Date.now()).toISOString()
      deps.artifactStore.write('computer-audit', Object.assign({ kind, id: auditId(), createdAt }, record))
    } catch (e) { return false }
    return true
  }
  const fail = (res, phase) => {
    // A failed attempt CONSUMES the request. Not retryable, by design: nobody can evidence what
    // a half-run did, so nobody may repeat it. Only a request this Companion actually holds is
    // settled — a failure before the claim must not disturb a request somebody else owns.
    const held = deps.ledger && ['CLAIMED', 'RUNNING'].includes(deps.ledger.stateOf(request && request.requestId))
    if (held) deps.ledger.transition(request.requestId, 'FAILED', { refusal: res.refusal, phase })
    return Object.assign({}, res, { phase, desktopActions: 0 })
  }

  // ── 1. WHO AM I ─────────────────────────────────────────────────────────
  // ONE ARGUMENT. This forwarded `deps.expectedIdentity`, and tool-start-companion supplied
  // { sid, name } — the same malformed object that broke Check Operator Identity. The Companion
  // would have refused a correct session with identity_name_mismatch, one tool later.
  //
  // The permitted identity is pinned once, in identityAttestation.REQUIRED. A caller that can
  // supply its own copy is a caller that can supply a wrong one, and this one did.
  const verdict = attest(deps.snapshot)
  const attestation = toAuditRecord(deps.snapshot, verdict)
  if (!audit('identity-attestation', attestation)) {
    return fail(no('audit_not_writable', 'The identity check could not be recorded. Nothing will run.'), 'attestation')
  }
  if (!verdict.ok) {
    return fail(no(verdict.refusal, 'This computer is not set up to run the task as the operator account.', verdict.detail), 'attestation')
  }

  // ── 2-3. the request and what it points at ──────────────────────────────
  const rv = verifyAgainst(request, {
    now: deps.now,
    receipt: deps.receipt,
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

  // CLAIMED -> RUNNING before anything touches a desktop, so a crash mid-run is distinguishable
  // on disk from a crash before it. Both are terminal for this request; only one of them may
  // have moved a window, and the record has to be able to say which.
  const running = deps.ledger.transition(request.requestId, 'RUNNING')
  if (!running.ok) return fail(no(running.refusal, 'The request could not be marked as running.', running.reason), 'running')

  // ── the flag, READ rather than asserted ─────────────────────────────────
  // This line used to be `flagOn: true` — a literal, passed to the gate that exists to check it.
  // The gate was then verifying a constant this file had written, which is not a check, and it
  // meant the Companion's switch could be off while the gate was told it was on.
  //
  // It is read here, at the last possible moment, from the environment of the process that is
  // about to act. The entrypoint sets it in the Process scope only, after every check above has
  // passed, and restores it in a `finally`.
  const flag = resolveComputerOperator(deps.env || process.env)
  if (flag !== 'on') return fail(no('flag_off', 'The computer operator switch is off in this process.'), 'flag')

  // ── 6-8. hand to the executor, ONCE, with the frozen approved order ─────
  const approvedOrder = Object.freeze(deps.receipt.approvedOrder)
  // attestedSessionId IS PASSED. The executor refuses a binding whose session is not the
  // Companion's own — and until now this call did not send it, so that check compared against
  // undefined and never fired. Second time a parameter existed, tests were green, and production
  // was not wired to it; the first was attest(snap, {sid, name}).
  const result = deps.executor.execute(approvedOrder, {
    flagOn: flag === 'on',
    killSwitch: deps.killSwitch,
    attestedSessionId: deps.snapshot.sessionId
  })

  deps.ledger.transition(request.requestId, result.ok === true ? 'SUCCEEDED' : 'FAILED',
    { refusal: result.refusal || null })
  audit('canary-outcome', {
    requestId: request.requestId,
    approvalId: request.approvalId,
    ok: result.ok === true,
    refusal: result.refusal || null,
    stepsRun: result.stepsRun || 0,
    sid: deps.snapshot.sid,
    sessionId: deps.snapshot.sessionId
  })

  // ── THE REASON MUST TRAVEL. Sixth time. ──────────────────────────────────
  // This returned { ok, refusal, result, attestation } and nothing else. `human` and `detail`
  // are produced only by the no(...) refusal paths, so when the executor RAN and then failed,
  // both were undefined — and the screen, which prints res.human and res.detail, printed
  // nothing. The Owner watched Notepad open and was told only "IT DID NOT RUN."
  //
  // The reason existed the whole time. `window_not_found` was in result.reason and in the
  // audit record on disk. Two places, neither of them read.
  const human = result.ok === true
    ? null
    : humanForExecutorRefusal(result.refusal, result.reason)
  return {
    ok: result.ok === true,
    refusal: result.refusal || null,
    human,
    // The executor's own words, always carried, even when there is no friendly sentence for
    // this refusal — an unfamiliar reason printed raw beats a blank screen.
    detail: result.reason || result.detail || (result.refusal ? 'refused at step ' + (result.failedStep || '?') : null),
    result,
    attestation
  }
}

module.exports = {
  runCanaryAsCompanion, companionPreflight, createRequestStore,
  ALLOWED_DIR, EXPECTED_FILE, EXPECTED_ACES, FORBIDDEN_RIGHTS,
  REQUEST_DIR, EXPECTED_REQUEST_ACES
}
