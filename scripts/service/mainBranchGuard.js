'use strict'
/**
 * mainBranchGuard.js — THE RESIDENT SERVICE MAY ONLY EVER SERVE `main`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY A SERVICE NEEDS THIS MORE THAN THE LAUNCHER DID.
 *
 * The production repo is a working tree that gets parked on feature branches during development.
 * The interactive launcher already refuses to start off `main`, and that refusal has a recorded
 * cost: on 2026-08-19 a reboot found the repo parked on a branch and the guard turned it into a
 * 1h46m silent outage. The lesson from that was NOT 「weaken the guard」 — it was 「put the repo
 * back on main as part of finishing」. Serving whatever happens to be checked out would be far
 * worse: an automatic, unattended, boot-time process quietly answering the Owner from
 * unreviewed code, with a bootCommit nobody chose.
 *
 * ⛔ SO IT FAILS CLOSED IN EVERY DIRECTION, AND REPAIRS NOTHING.
 *
 * Detached HEAD, a feature branch, an absent `.git`, an unreadable HEAD, a malformed HEAD — all
 * refuse. None of them checks out, resets or fixes anything: a service that silently moved the
 * Owner's working tree would destroy work, and 「I will not start, and here is why」 is a usable
 * answer where 「I fixed your repo」 is not.
 *
 * ⛔ AND THE REASON IS A CLOSED ENUM. It names the STATE, never the branch content, never a raw
 * exception, never a path beyond the repo root it was given.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs')
const path = require('node:path')

/** The only ref this service will serve. */
const REQUIRED_REF = 'refs/heads/main'

/** Closed set. Anything a caller renders comes from here. */
const BRANCH_STATE = Object.freeze({
  ON_MAIN: 'on_main',
  NOT_MAIN: 'not_main',
  DETACHED: 'detached_head',
  HEAD_MISSING: 'head_missing',
  HEAD_UNREADABLE: 'head_unreadable',
  HEAD_MALFORMED: 'head_malformed'
})

/**
 * Read `.git/HEAD` and classify it. Never throws, never repairs, never returns file contents.
 *
 * ⛔ A DETACHED HEAD IS ITS OWN ANSWER, not 「not main」. A 40-hex HEAD may well BE main's commit,
 * and it is still refused — the service must serve a branch that keeps moving with `main`, not a
 * commit that happened to match once. Reporting them as the same state would make the log lie
 * about why it stopped.
 */
function readBranchState (repoRoot, readFile = fs.readFileSync, exists = fs.existsSync) {
  const headPath = path.join(repoRoot, '.git', 'HEAD')
  if (!exists(headPath)) return { state: BRANCH_STATE.HEAD_MISSING, ref: null }

  let raw
  try { raw = readFile(headPath, 'utf8') } catch (_) {
    // ⛔ THE EXCEPTION IS SWALLOWED ON PURPOSE. A permission error carries a full path and
    // sometimes an account name; the state is all a log needs.
    return { state: BRANCH_STATE.HEAD_UNREADABLE, ref: null }
  }

  const head = String(raw).trim()
  if (!head) return { state: BRANCH_STATE.HEAD_MALFORMED, ref: null }
  if (/^[0-9a-f]{40}$/i.test(head)) return { state: BRANCH_STATE.DETACHED, ref: null }
  if (!head.startsWith('ref:')) return { state: BRANCH_STATE.HEAD_MALFORMED, ref: null }

  const ref = head.slice(4).trim()
  if (!ref || !ref.startsWith('refs/')) return { state: BRANCH_STATE.HEAD_MALFORMED, ref: null }
  if (ref !== REQUIRED_REF) return { state: BRANCH_STATE.NOT_MAIN, ref }
  return { state: BRANCH_STATE.ON_MAIN, ref }
}

/** ok only when the tree is on main. Everything else refuses. */
function checkMainBranch (repoRoot, deps = {}) {
  const r = readBranchState(repoRoot, deps.readFile, deps.exists)
  return { ok: r.state === BRANCH_STATE.ON_MAIN, state: r.state, ref: r.ref }
}

/**
 * ⛔ THE REF NAME IS THE ONE THING WORTH PRINTING, AND ONLY WHEN IT IS A REF. A branch name is
 * not a secret and it is exactly what the Owner needs in order to fix this himself. Nothing else
 * from the file is emitted.
 */
function branchGuardReport (r) {
  return '[AROMA-SERVICE] branch guard ' + (r.ok ? 'OK' : 'REFUSED') +
    ' state=' + r.state + ' ref=' + (r.ref || 'none') + ' required=' + REQUIRED_REF
}

module.exports = { REQUIRED_REF, BRANCH_STATE, readBranchState, checkMainBranch, branchGuardReport }
