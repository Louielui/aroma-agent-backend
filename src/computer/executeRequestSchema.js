'use strict'

/**
 * executeRequestSchema.js — THE canonical definition of an execute request. One file, one truth.
 *
 * ── WHY THIS EXISTS AS ITS OWN MODULE ──────────────────────────────────────
 * There were two request schemas in this repo at the same time. The Owner's side produced
 * `computer.canary.execute.v1`; the Companion consumed `kind: 'canary-execute-request'`. Both
 * were carefully written, both had tests, and both test suites were GREEN — because each tested
 * its own producer against its own fixture. Nothing in the repo ever put a real request written
 * by one side in front of the other, so the mismatch was invisible until a real run would have
 * failed with `unknown_message_type`.
 *
 * Two fixtures that agree with their own author and never with each other is the failure mode
 * this module removes. The producer and the consumer now import THIS file. Not a copy of it, not
 * a compatible re-implementation of it: the same object, from the same path.
 *
 * ── AND A CONTRACT TEST OVER REAL BYTES ────────────────────────────────────
 * Sharing a module makes disagreement harder, not impossible — a serialiser can still write
 * something the reader parses differently. executeRequestContract.test.js therefore takes what
 * the Owner side actually wrote to disk, reads those bytes back on the Companion side, and
 * verifies them. No fixture appears anywhere in it.
 *
 * ── THE SHAPE CARRIES NO WORK ──────────────────────────────────────────────
 * Bindings only: which approval, which order hash, which package hash, which receipt, when it
 * dies. No action, no text, no filename, no path, no command, no module name. If a request could
 * describe the work, whoever writes requests would be choosing the work — and the entire point of
 * the boundary is that the Owner's side chooses nothing. The work lives in the receipt, which the
 * Companion reads and verifies for itself with its own token.
 */

const SCHEMA_VERSION = 1
const MESSAGE_TYPE = 'computer.canary.execute.v1'
const CANARY_TYPE = 'notepad-canary'

/** Exactly these fields. An extra one is a refusal — that is how an instruction would arrive. */
const REQUEST_FIELDS = Object.freeze([
  'schemaVersion', 'messageType', 'requestId', 'approvalId', 'approvedOrderHash',
  'executionPackageManifestHash', 'receiptHash', 'canaryType', 'createdAt', 'expiresAt'
])

/**
 * Names that must NEVER appear, however the schema grows.
 *
 * Redundant with the closed field list above, and kept anyway: the closed list is a rule about
 * what is allowed and this is a rule about what is forbidden, and the day somebody widens the
 * first one they will have to argue with the second.
 */
const FORBIDDEN_FIELDS = Object.freeze([
  'actions', 'action', 'text', 'fileName', 'filename', 'path', 'targetPath', 'command',
  'executable', 'exe', 'scriptPath', 'script', 'args', 'arguments', 'module', 'moduleName',
  'adapter', 'adapterName', 'env', 'environment', 'powershell', 'ps', 'payload', 'steps',
  'approvedOrder', 'order'
])

const STATES = Object.freeze(['CREATED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ABORTED', 'EXPIRED'])
const TERMINAL = Object.freeze(['SUCCEEDED', 'FAILED', 'ABORTED', 'EXPIRED'])

/** Legal transitions. Absent from this table means impossible, not merely discouraged. */
const TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(['CLAIMED', 'EXPIRED']),
  CLAIMED: Object.freeze(['RUNNING', 'FAILED', 'ABORTED']),
  RUNNING: Object.freeze(['SUCCEEDED', 'FAILED', 'ABORTED']),
  SUCCEEDED: Object.freeze([]),
  FAILED: Object.freeze([]),
  ABORTED: Object.freeze([]),
  EXPIRED: Object.freeze([])
})

/**
 * How long a request stays claimable.
 *
 * The floor is physical, not a preference: the Owner presses E in his own session and then
 * SWITCHES USER to the operator account, where the Companion is started by hand. That switch is
 * a logon — a profile load, a desktop, possibly a password typed wrong once. A TTL that expires
 * mid-procedure fails at the point where he has already decided, and teaches him to hurry.
 */
const MIN_TTL_MS = 15 * 60 * 1000
const DEFAULT_TTL_MS = 30 * 60 * 1000

const no = (refusal, reason, detail) => ({ ok: false, refusal, reason, detail: detail === undefined ? null : detail })

/**
 * Shape validation. Pure: no clock, no filesystem, no receipt.
 *
 * Passing this means the object IS a request. It does not mean the request may be used, and it
 * certainly does not mean anything is authorised — see verifyAgainst in the store.
 */
function validateRequest (req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) return no('no_request', 'nothing was submitted')
  if (req.messageType !== MESSAGE_TYPE) return no('unknown_message_type', 'not a canary execute request', String(req.messageType))
  if (req.schemaVersion !== SCHEMA_VERSION) return no('wrong_schema_version', 'built for a different schema', String(req.schemaVersion))

  for (const k of Object.keys(req)) {
    if (FORBIDDEN_FIELDS.includes(k)) return no('forbidden_field', 'a request may never carry instructions', k)
    if (!REQUEST_FIELDS.includes(k)) return no('unexpected_field', 'a request carries bindings only', k)
  }
  for (const k of REQUEST_FIELDS) {
    if (req[k] === undefined) return no('missing_field', 'a binding is absent', k)
    if (req[k] === null && k !== 'receiptHash') return no('missing_field', 'a binding is null', k)
  }
  if (req.canaryType !== CANARY_TYPE) return no('wrong_canary_type', 'not this canary', String(req.canaryType))
  if (!/^req_[0-9a-f]{24}$/.test(String(req.requestId))) return no('bad_request_id', 'malformed request id')
  if (!/^appr_[0-9a-f]{32}$/.test(String(req.approvalId))) return no('bad_approval_id', 'malformed approval id')
  for (const h of ['approvedOrderHash', 'executionPackageManifestHash']) {
    if (!/^[0-9a-f]{64}$/.test(String(req[h]))) return no('bad_hash', 'malformed hash', h)
  }
  if (!Number.isFinite(Date.parse(req.createdAt)) || !Number.isFinite(Date.parse(req.expiresAt))) {
    return no('bad_timestamps', 'createdAt or expiresAt is not a time')
  }
  if (Date.parse(req.expiresAt) <= Date.parse(req.createdAt)) return no('bad_timestamps', 'it expires before it exists')
  return { ok: true }
}

module.exports = {
  SCHEMA_VERSION, MESSAGE_TYPE, CANARY_TYPE,
  REQUEST_FIELDS, FORBIDDEN_FIELDS,
  STATES, TERMINAL, TRANSITIONS,
  MIN_TTL_MS, DEFAULT_TTL_MS,
  validateRequest, no
}
