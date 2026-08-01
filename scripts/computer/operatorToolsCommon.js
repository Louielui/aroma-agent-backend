'use strict'

/**
 * operatorToolsCommon.js — the three operator tools, in plain words.
 *
 * ── WHO READS THIS OUTPUT ──────────────────────────────────────────────────
 * The Owner, standing at a machine he has just switched user on, in a session that is not his
 * own. He is not going to compare a hash, and asking him to would be asking him to perform a
 * check he cannot actually perform — he would compare the first four characters, they would
 * match, and everyone would call it verified. So every hash comparison happens HERE, in code,
 * and what reaches the screen is a sentence.
 *
 * ── EACH TOOL RE-MEASURES ──────────────────────────────────────────────────
 * Nothing carries over between the three tools. `Start Aroma Companion` does not trust that
 * `Check Operator Identity` was run, or that it passed, or that it passed in this session, or
 * that the machine has not changed since. It re-runs the lot. A previous green result is a fact
 * about a moment that has passed.
 *
 * ── NO ARGUMENTS ANYWHERE ──────────────────────────────────────────────────
 * The three entrypoints take no argv, read no stdin, and read no configuration from the
 * environment. Each does exactly one fixed thing. That is why there are three files rather than
 * one file with a verb: a verb is an argument, and an argument is a place to put something else.
 */

const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')

/** Where the Owner's side leaves requests. Fixed, absolute, and never taken from input. */
const REQUEST_DIR = 'C:\\Aroma\\ComputerOperator-Requests'

/**
 * The two folders the Companion needs at run time, outside the staged tree.
 *
 * They cannot live under the staged copy: the operator has ReadAndExecute there, and that is
 * exactly the property which makes the package hash mean anything at run time. So the audit sink
 * and the receipt each need their own place, with their own ACL.
 *
 *   AUDIT_DIR     operator: ReadAndExecute + Write, NO Delete — it may create evidence and must
 *                 never be able to destroy it, the same rule as the canary folder
 *   RECEIPTS_DIR  operator: ReadAndExecute only — it must be able to READ the approval it acts
 *                 under, and must not be able to write one
 */
const AUDIT_DIR = 'C:\\Aroma\\ComputerOperator-Audit'
const RECEIPTS_DIR = 'C:\\Aroma\\ComputerOperator-Receipts'

/** The account this must be. A name is not an identity, so the SID is the check. */
const EXPECTED_SID = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
const EXPECTED_NAME = 'AromaOperator'

const PAD = 24

/* ── the screen ───────────────────────────────────────────────────────────── */

const out = (s) => process.stdout.write(String(s === undefined ? '' : s) + '\n')

function title (text) {
  out('')
  out('  ' + text)
  out('  ' + '-'.repeat(text.length))
  out('')
}

/** `label ......... value   OK` — one fact per line, verdict at the end where the eye lands. */
function line (label, value, verdict, note) {
  const l = String(label).padEnd(PAD, ' ')
  const v = String(value === undefined || value === null ? 'not measured' : value).padEnd(28, ' ')
  // A blank marker means NOT JUDGED. It is not a quiet pass, and the note says so where one
  // applies - the previous version printed nothing at all in that column, which reads as fine.
  const mark = verdict === true ? 'OK' : verdict === false ? '<-- PROBLEM' : (note || '(not judged)')
  out('  ' + l + v + mark)
}

function verdict (ok, sentence, detail) {
  out('')
  out('  ' + (ok ? 'RESULT: ' : 'RESULT: ') + sentence)
  if (detail) out('          ' + detail)
  out('')
}

/* ── identity ─────────────────────────────────────────────────────────────── */

/**
 * Measure this session's identity and judge it.
 *
 * The measurement runs in THIS process, with THIS token, through the one shared PowerShell
 * transport. That is the whole reason the tool exists on the operator's side: the Owner's
 * session cannot answer "who am I" on the operator's behalf, and when it tried, it produced a
 * confident answer about the wrong person.
 */
function checkIdentity (deps = {}) {
  const runner = deps.runner || buildRunner()
  const { attest } = require('../../src/computer/identityAttestation')

  const env = runner.run('collect-identity', {})
  if (!env || env.ok !== true) {
    return { ok: false, refusal: 'identity_unmeasured', human: 'This computer could not be asked who it is running as.', detail: env && env.refusal }
  }
  const snap = env.result
  if (!snap || snap.ok === false) {
    return { ok: false, refusal: 'identity_unmeasured', human: 'The identity check did not complete.', detail: snap && snap.reason }
  }
  // NO `expected` ARGUMENT. This used to pass `{ sid: EXPECTED_SID, name: EXPECTED_NAME }` —
  // wrong key (`name` for `account`), wrong value shape (bare name for DOMAIN\name), and missing
  // `desktop` entirely. attest then compared the real account against `undefined` and refused
  // with `identity_name_mismatch`, on a session that was correct in every respect.
  //
  // Omitting it uses REQUIRED, which is the single pinned definition of the permitted identity.
  // A local copy of that definition is what created the divergence in the first place.
  const v = attest(snap)
  return { ok: v.ok === true, refusal: v.refusal || null, snapshot: snap, verdict: v }
}

/**
 * The rows, in the order the judge checks them, with the refusals each one owns.
 *
 * ── WHY THE ROWS AND THE RESULT NOW COME FROM ONE PLACE ────────────────────
 * They used to come from two. The RESULT line was the judge's refusal; the per-row OK/PROBLEM
 * markers were computed here, from the raw snapshot, by re-deriving the rules. On the first real
 * operator login the two disagreed on screen: the RESULT said the account name was wrong while
 * the PROBLEM marker sat on the desktop row, which was correct.
 *
 * Re-deriving a rule next to the rule is how two answers to one question get onto one screen. So
 * the markers are now DERIVED FROM THE VERDICT: the judge stops at the first problem, so rows
 * before it passed, the row that owns the refusal is the problem, and rows after it were never
 * reached. Nothing here decides anything.
 *
 * `field` is what the row DISPLAYS, and the names are the collector's own — `account`,
 * `isElevated`, `isInteractive`. Three of them were wrong before (`name`, `elevated`,
 * `interactive`), which is why a correct session showed a blank account and a false problem.
 */
const IDENTITY_ROWS = Object.freeze([
  {
    key: 'account',
    label: 'Account',
    fields: ['account'],
    render: (s) => s.account,
    owns: ['wrong_identity', 'identity_name_mismatch']
  },
  {
    key: 'elevation',
    label: 'Administrator rights',
    fields: ['isElevated', 'integrityLevel'],
    render: (s) => (s.isElevated === true ? 'YES' : 'no'),
    owns: ['elevated_token', 'wrong_integrity']
  },
  {
    key: 'adminGroup',
    label: 'In Administrators group',
    fields: ['administratorsEnabled', 'administratorsPresent', 'groupSids'],
    render: (s) => (s.administratorsEnabled === true ? 'YES, enabled' : s.administratorsPresent === true ? 'present, deny-only' : 'no'),
    owns: ['privileged_group', 'administrators_enabled']
  },
  {
    key: 'session',
    label: 'Own desktop session',
    fields: ['isInteractive', 'sessionId', 'desktop'],
    render: (s) => (s.sessionId === 0 ? 'no (session 0)' : s.isInteractive === true ? 'yes (session ' + s.sessionId + ')' : 'not interactive'),
    owns: ['bad_session', 'wrong_session', 'not_interactive', 'wrong_desktop']
  }
])

/**
 * THE ONE MARKER RULE, used by every table on every screen.
 *
 * ── WHY IT IS A FUNCTION AND NOT A CONVENTION ──────────────────────────────
 * The identity table and the machine table each computed their own markers, and each was fixed
 * separately. The identity one was corrected first; the machine one was left, and the operator's
 * next login showed exactly the same defect one table down — a PROBLEM marker on "can only write
 * in scope" while the RESULT was about the folder not being empty. Two answers to one question,
 * for the second time, in the same file.
 *
 * So the rule lives in one place and both tables call it. The judge stops at the first problem,
 * so: rows before it were checked and passed, the row owning the refusal IS the problem, and
 * rows after it were never reached. "Never reached" is printed as such, not as OK — an unasked
 * question has no answer, and a tick would invent one.
 *
 * @param rows      [{label, owns:[refusal], value, unmeasured}]  in the judge's order
 * @param verdictOk did the judge pass
 * @param refusal   the judge's refusal, if it did not
 */
function markRows (rows, verdictOk, refusal) {
  const failedAt = verdictOk ? rows.length : rows.findIndex((r) => (r.owns || []).includes(refusal))
  return rows.map((r, i) => {
    // A value that was never measured can never be OK, whatever the verdict says. This is the
    // rule a blank "Account / OK" broke: value from one source, marker from another, so an
    // absent value could still be ticked.
    if (r.unmeasured) return { label: r.label, value: 'not measured', mark: false, note: null }
    if (failedAt === -1) return { label: r.label, value: r.value, mark: null, note: null } // nothing judged
    if (i < failedAt) return { label: r.label, value: r.value, mark: true, note: null }
    if (i === failedAt) return { label: r.label, value: r.value, mark: false, note: null }
    return { label: r.label, value: r.value, mark: null, note: 'not checked' }
  })
}

const printRows = (marked) => { for (const m of marked) line(m.label, m.value, m.mark, m.note) }

/** The identity result, as sentences. Shared by the identity tool and the Companion launcher. */
function renderIdentity (res) {
  if (!res.snapshot) {
    for (const r of IDENTITY_ROWS) line(r.label, 'not measured', null)
    verdict(false, res.human || 'This session could not be identified.', res.detail || null)
    return
  }
  const s = res.snapshot

  printRows(markRows(IDENTITY_ROWS.map((r) => ({
    label: r.label,
    owns: r.owns,
    unmeasured: r.fields.some((f) => s[f] === undefined || s[f] === null),
    value: r.fields.some((f) => s[f] === undefined || s[f] === null) ? null : r.render(s)
  })), res.ok === true, res.refusal))

  if (res.ok) {
    verdict(true, 'This session is the operator account, with no extra rights.')
    return
  }
  const why = {
    wrong_identity: 'This session is NOT the operator account.',
    identity_name_mismatch: 'The account name does not match the account this is meant to be.',
    elevated_token: 'This session has administrator rights. The canary must not run with them.',
    privileged_group: 'This account is in a privileged group it should not be in.',
    administrators_enabled: 'This session has Administrators rights switched on.',
    wrong_integrity: 'This session is running at the wrong privilege level.',
    bad_session: 'This is not a normal desktop session.',
    wrong_session: 'This is not the session that was set up for the operator.',
    not_interactive: 'This is not an interactive desktop session.',
    wrong_desktop: 'This is not the ordinary desktop.',
    incomplete_attestation: 'The identity check did not return everything it must.'
  }[res.refusal] || 'This session is not the one the canary may run in.'

  // s.account, not s.name. Reading the wrong field here meant this hint - the one line that
  // tells the Owner WHICH account he is actually in - could never appear.
  const hint = res.refusal === 'wrong_identity' && s.account
    ? 'It is running as "' + s.account + '". Sign in as ' + EXPECTED_NAME + ' and start this again.'
    : null
  verdict(false, why, hint)
}

/* ── machine ──────────────────────────────────────────────────────────────── */

/**
 * The machine rows, in companionPreflight's own order, each owning the refusals it is about.
 *
 * `owns` is what makes the markers derivable from the verdict instead of measured a second time
 * here — the same correction already made to the identity table, applied to this one after the
 * operator's login showed the identical defect: a PROBLEM on the writable row while the RESULT
 * was about the folder.
 */
const MACHINE_ROWS = Object.freeze([
  { key: 'acl', label: 'Folder permissions', owns: ['acl_unreadable', 'acl_not_protected', 'acl_inherited', 'acl_has_deny', 'acl_ace_set_mismatch', 'acl_mask_mismatch', 'operator_over_privileged'] },
  { key: 'listdir', label: 'Folder is empty', owns: ['folder_unreadable', 'folder_not_empty', 'probe_residue'] },
  { key: 'fileexists', label: 'Nothing to overwrite', owns: ['file_exists'] },
  { key: 'writable', label: 'Can only write in scope', owns: ['write_scope_unmeasured', 'writable_outside_scope', 'probe_residue_outside_scope'] },
  { key: 'requestdir', label: 'Task folder permissions', owns: ['request_dir_unreadable', 'request_dir_inherits', 'request_dir_has_deny', 'request_dir_unknown_identity', 'request_dir_rights_changed'] },
  { key: 'staging', label: 'Program files staged', owns: ['staging_unverified'] },
  { key: 'notepads', label: 'Notepad closed', owns: ['notepad_already_open'] },
  { key: 'auditwritable', label: 'Can record what happens', owns: ['audit_not_writable'] }
])

/**
 * Run the full machine preflight and describe each answer.
 *
 * The rules are NOT reimplemented here — `companionPreflight` owns them, and this calls it. Two
 * copies of a rule is two rules, and the one on the screen would be the one nobody maintains.
 */
function checkMachine (deps = {}) {
  const runner = deps.runner || buildRunner()
  const { createMachineProbe } = require('../../src/computer/machineProbe')
  const { companionPreflight, ALLOWED_DIR, REQUEST_DIR } = require('../../src/computer/companionCanaryRunner')
  const machine = deps.machine || createMachineProbe({ runner })

  // Each row is DESCRIBED here; none of them is judged here. The OK/PROBLEM markers come from
  // the verdict below, through markRows — see MACHINE_ROWS for why.
  const rows = {}

  const acl = machine.readAcl(ALLOWED_DIR)
  rows.acl = { value: acl && acl.ok === true ? (acl.protected ? 'as approved' : 'not as approved') : 'cannot be read' }

  const entries = machine.listDir(ALLOWED_DIR)
  if (entries === null || entries === undefined) {
    rows.listdir = { value: 'cannot be read' }
  } else {
    const residue = entries.filter((e) => /^\.aroma-probe-[0-9a-f]{32}\.tmp$/i.test(String(e)))
    rows.listdir = {
      value: entries.length === 0
        ? 'yes, empty'
        : residue.length === entries.length
          ? residue.length + ' leftover probe file(s)'
          : entries.length + ' file(s) present'
    }
  }

  rows.fileexists = { value: machine.fileExists(ALLOWED_DIR + '\\canary-1.txt') ? 'the file already exists' : 'nothing there' }

  // The probe now answers with a reason of its own, so a refusal is shown as itself. This row
  // read "not measured" on the operator's screen when the truth was "the probe could not delete
  // the file it wrote" — a reason that existed and was discarded one layer down.
  const w = machine.probeWritable()
  if (!w || w.ok !== true) {
    rows.writable = { value: w && w.reason ? w.reason.replace(/_/g, ' ') : 'not measured' }
  } else {
    const strays = (w.paths || []).filter((p) => p.writable && p.path !== ALLOWED_DIR)
    rows.writable = {
      value: strays.length > 0
        ? 'NO - can write in ' + strays.length + ' place(s) outside'
        : (w.residue || []).length > 0
            ? 'a probe file was left outside the folder'
            : 'yes'
    }
  }

  const reqAcl = machine.readAcl(REQUEST_DIR)
  rows.requestdir = { value: reqAcl && reqAcl.ok === true ? (reqAcl.protected ? 'as approved' : 'not as approved') : 'cannot be read' }

  const staged = machine.stagedClosure()
  rows.staging = { value: staged && staged.ok === true ? 'complete' : 'not verified' }

  const n = machine.notepadCount()
  rows.notepads = { value: n < 0 ? 'could not be counted' : n === 0 ? 'yes, none open' : n + ' open' }

  rows.auditwritable = { value: machine.auditWritable() ? 'yes' : 'no' }

  const pre = companionPreflight(machine)
  return { ok: pre.ok === true, refusal: pre.refusal || null, human: pre.human || null, detail: pre.detail || null, rows }
}

function renderMachine (res) {
  // THE SAME RULE AS THE IDENTITY TABLE, from the same function. This loop used to read
  // `row.ok` — a verdict this table had computed for itself — while the RESULT line came from
  // companionPreflight. That is how a PROBLEM marker ended up on "can only write in scope"
  // while the RESULT was about the folder not being empty.
  printRows(markRows(MACHINE_ROWS.map((r) => {
    const row = res.rows[r.key]
    return {
      label: r.label,
      owns: r.owns,
      unmeasured: !row || row.value === undefined || row.value === null,
      value: row ? row.value : null
    }
  }), res.ok === true, res.refusal))

  if (res.ok) verdict(true, 'This machine is in the state the task was approved for.')
  else verdict(false, res.human || 'This machine is not ready.', res.detail)
}

/* ── the approved program ─────────────────────────────────────────────────── */

/**
 * Is the code on disk the code that was approved?
 *
 * Computed and COMPARED here. The Owner is shown a sentence, never two hashes to eyeball —
 * a comparison a person cannot really do is a comparison that always passes.
 */
function checkPackage (deps = {}) {
  const approval = require('./ownerApproval')
  const v = approval.verify({ receiptDir: deps.receiptDir })
  if (!v.ok) {
    const human = {
      execution_package_changed: 'The program has changed since it was approved. It will not run.',
      work_order_changed: 'The task has changed since it was approved. It will not run.',
      pre_implementation_receipt: 'That approval is from before the program was finished.'
    }[v.refusal] || 'There is no usable approval on this machine.'
    return { ok: false, refusal: v.refusal, human, changedFiles: v.changedFiles || null }
  }
  return { ok: true, receipt: v.receipt, packageHash: v.executionPackageManifestHash }
}

function renderPackage (res) {
  line('Approval', res.ok ? 'found and valid' : 'not usable', res.ok === true)
  line('Program files', res.ok ? 'exactly as approved' : 'changed or unverified', res.ok === true)
  if (!res.ok) {
    verdict(false, res.human, res.changedFiles ? String(res.changedFiles.length) + ' file(s) differ' : null)
  }
}

/* ── plumbing ─────────────────────────────────────────────────────────────── */

/**
 * The ONE production transport — obtained from the Companion factory, never constructed here.
 *
 * A direct `require` of powershellJsonRunner would work perfectly and would quietly cost the
 * property that a graph scan can prove: that there is exactly one place in the system where a
 * process can be started.
 */
function buildRunner () {
  const { createMeasurementRunner } = require('../../src/computer/companionProductionFactory')
  return createMeasurementRunner({})
}

/** The request directory, created if absent. The Owner's side writes here; this side reads. */
function ensureRequestDir () {
  try { fs.mkdirSync(REQUEST_DIR, { recursive: true }); return true } catch (_) { return false }
}

module.exports = {
  out, title, line, verdict,
  checkIdentity, renderIdentity, IDENTITY_ROWS, markRows,
  checkMachine, renderMachine, MACHINE_ROWS,
  checkPackage, renderPackage,
  buildRunner, ensureRequestDir,
  REPO, REQUEST_DIR, AUDIT_DIR, RECEIPTS_DIR, EXPECTED_SID, EXPECTED_NAME
}
