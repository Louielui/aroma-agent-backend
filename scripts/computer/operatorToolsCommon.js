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
function line (label, value, verdict) {
  const l = String(label).padEnd(PAD, ' ')
  const v = String(value === undefined || value === null ? '-' : value).padEnd(28, ' ')
  out('  ' + l + v + (verdict === true ? 'OK' : verdict === false ? '<-- PROBLEM' : ''))
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
  const v = attest(snap, { sid: EXPECTED_SID, name: EXPECTED_NAME })
  return { ok: v.ok === true, refusal: v.refusal || null, snapshot: snap, verdict: v }
}

/** The identity result, as sentences. Shared by the identity tool and the Companion launcher. */
function renderIdentity (res) {
  if (!res.snapshot) {
    line('Account', 'could not be read', false)
    verdict(false, res.human || 'This session could not be identified.', res.detail || null)
    return
  }
  const s = res.snapshot
  const isOperator = s.sid === EXPECTED_SID
  line('Account', s.name || '-', isOperator)
  line('Administrator rights', s.elevated ? 'YES' : 'no', s.elevated !== true)
  line('In Administrators group', s.administratorsEnabled ? 'YES' : 'no', s.administratorsEnabled !== true)
  line('Own desktop session', s.sessionId === 0 ? 'no (session 0)' : 'yes', s.sessionId !== 0 && s.interactive === true)

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

  const hint = res.refusal === 'wrong_identity' && s.name
    ? 'It is running as "' + s.name + '". Sign in as ' + EXPECTED_NAME + ' and start this again.'
    : null
  verdict(false, why, hint)
}

/* ── machine ──────────────────────────────────────────────────────────────── */

const MACHINE_ROWS = Object.freeze([
  { key: 'acl', label: 'Folder permissions' },
  { key: 'listdir', label: 'Folder is empty' },
  { key: 'fileexists', label: 'Nothing to overwrite' },
  { key: 'writable', label: 'Can only write in scope' },
  { key: 'staging', label: 'Program files staged' },
  { key: 'notepads', label: 'Notepad closed' },
  { key: 'auditwritable', label: 'Can record what happens' }
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
  const { companionPreflight } = require('../../src/computer/companionCanaryRunner')
  const machine = deps.machine || createMachineProbe({ runner })

  // Each row is measured for the screen; the VERDICT comes from the shared rules below.
  const rows = {}
  const acl = machine.readAcl('C:\\Aroma\\ComputerOperator-Test')
  rows.acl = acl && acl.ok === true ? { value: acl.protected ? 'as approved' : 'not as approved', ok: acl.protected === true && acl.inheritedCount === 0 && acl.denyCount === 0 } : { value: 'cannot be read', ok: false }
  const entries = machine.listDir('C:\\Aroma\\ComputerOperator-Test')
  rows.listdir = entries === null ? { value: 'cannot be read', ok: false } : { value: entries.length === 0 ? 'yes, empty' : entries.length + ' file(s) present', ok: entries.length === 0 }
  const exists = machine.fileExists('C:\\Aroma\\ComputerOperator-Test\\canary-1.txt')
  rows.fileexists = { value: exists ? 'the file already exists' : 'nothing there', ok: exists === false }
  const w = machine.probeWritable()
  rows.writable = w === null ? { value: 'not measured', ok: false } : { value: w.filter((p) => p.writable && p.path !== 'C:\\Aroma\\ComputerOperator-Test').length === 0 ? 'yes' : 'NO - can write elsewhere', ok: w.filter((p) => p.writable && p.path !== 'C:\\Aroma\\ComputerOperator-Test').length === 0 }
  const staged = machine.stagedClosure()
  rows.staging = { value: staged && staged.ok === true ? 'complete' : 'not verified', ok: staged && staged.ok === true }
  const n = machine.notepadCount()
  rows.notepads = { value: n < 0 ? 'could not be counted' : n === 0 ? 'yes, none open' : n + ' open', ok: n === 0 }
  rows.auditwritable = { value: machine.auditWritable() ? 'yes' : 'no', ok: machine.auditWritable() === true }

  const pre = companionPreflight(machine)
  return { ok: pre.ok === true, refusal: pre.refusal || null, human: pre.human || null, detail: pre.detail || null, rows }
}

function renderMachine (res) {
  for (const r of MACHINE_ROWS) {
    const row = res.rows[r.key] || { value: 'not measured', ok: false }
    line(r.label, row.value, row.ok)
  }
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
  checkIdentity, renderIdentity,
  checkMachine, renderMachine, MACHINE_ROWS,
  checkPackage, renderPackage,
  buildRunner, ensureRequestDir,
  REPO, REQUEST_DIR, EXPECTED_SID, EXPECTED_NAME
}
