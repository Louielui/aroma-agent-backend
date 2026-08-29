'use strict'

/**
 * openClawEnvelope.test.js — THE BOOTSTRAP LAYER MUST NOT LAND INSIDE THE REPOSITORY.
 *
 * ── THE MISTAKE THIS LAYOUT EXISTS TO PREVENT ───────────────────────────────
 * C2-B2-A measured what OpenClaw does to a workspace it is given: before the model produced
 * a single token it wrote AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md,
 * BOOTSTRAP.md, a workspace-state file, and ran `git init`. None of that came from the
 * model — the model had zero tools and emitted 11 output tokens. It is OpenClaw's own
 * workspace bootstrapping.
 *
 * Hand OpenClaw the clone directly and every one of those files becomes an untracked change
 * inside the repository under audit, so repoChanges reports a read-only violation on every
 * single run — a permanent false positive caused by the harness rather than the agent.
 *
 * So the workspace is an ENVELOPE and the clone is its `repo` child:
 *
 *   <SANDBOX_ROOT>/<approvalId>/          <- OpenClaw workspace; bootstrap lands here
 *       AGENTS.md, SOUL.md, ... .git/
 *       repo/                             <- the verified clone; C1 invariants apply here
 *
 * There is still exactly ONE repository object. Nothing is copied, and the directory the
 * verifier measures is the directory the executor reads.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c2b2b1-env-'))

const test = require('node:test')
const assert = require('node:assert')

const {
  createOpenClawWslWorkspace, SANDBOX_ROOT, REPO_CHILD
} = require('../agent/openClawWslWorkspace')

const SHA = '4511f7deeb279b189642b3b812b56250ce518d98'
const APPROVAL = 'appr_x'
const ENV_DIR = SANDBOX_ROOT + '/' + APPROVAL
const REPO_DIR = ENV_DIR + '/' + REPO_CHILD


/**
 * Terminality is proven, not asserted: cleanup requires a grant the quarantine ledger
 * issues only after observing a terminal task status. Tests mint real grants the same way
 * production does, so no test can quietly bypass the gate a caller cannot bypass.
 */
const { createOpenClawQuarantine } = require('../agent/openClawQuarantine')
function memLedgerStore () {
  let data = {}
  return { read: () => JSON.parse(JSON.stringify(data)), write: (d) => { data = JSON.parse(JSON.stringify(d)) } }
}
/** One ledger governs the workspaces in this file; grants are bound to it. */
const LEDGER = createOpenClawQuarantine({ store: memLedgerStore() })
const isTerminalGrant = (g) => LEDGER.verifyTerminalGrant(g)
function grantFor (approvalId) {
  if (LEDGER.state(approvalId) === null) LEDGER.begin(approvalId)
  if (LEDGER.state(approvalId) === LEDGER.STATES.PREPARED) LEDGER.abortPreExecution(approvalId)
  return LEDGER.preExecutionGrant(approvalId)
}


const inner = (argv) => argv.slice(argv.indexOf('--') + 1)
function gitArgs (a) { let i = 0; while (a[i] === '-c') i += 2; return a.slice(i) }

/**
 * A scripted distro. `objects` lets a test change a device:inode AFTER prepare, which is the
 * replacement attack in miniature.
 */
function fakeWsl (over = {}) {
  const calls = []
  let branch = 'agent/' + APPROVAL
  const ok = (stdout) => ({ status: 0, stdout: stdout === undefined ? '' : stdout, stderr: '', timedOut: false })
  const runner = (argv) => {
    const a = inner(argv)
    calls.push(a.join(' '))
    if (a[0] === 'mkdir' || a[0] === 'rm' || a[0] === 'ln') return ok()
    if (a[0] === 'stat') {
      const target = a[a.length - 1]
      const table = over.objects || {}
      const v = table[target] !== undefined ? table[target] : '2049:1000'
      return v === null ? { status: 1, stdout: '', stderr: 'stat: cannot statx', timedOut: false } : ok(v + '\n')
    }
    if (a[0] === 'test') {
      const target = a[a.length - 1]
      if (a[1] === '-L') return { status: 1, stdout: '', stderr: '', timedOut: false }
      if (a[1] === '-d' && target.endsWith('/.git')) return { status: 0, stdout: '', stderr: '', timedOut: false }
      if (a[1] === '-e') {
        const present = (over.present || []).includes(target)
        return { status: present ? 0 : 1, stdout: '', stderr: '', timedOut: false }
      }
      return { status: 1, stdout: '', stderr: '', timedOut: false }
    }
    if (a[0] === 'readlink') {
      const target = a[a.length - 1]
      if (over.realpath && over.realpath[target] !== undefined) {
        const v = over.realpath[target]
        return v === null ? { status: 1, stdout: '', stderr: '', timedOut: false } : ok(v + '\n')
      }
      return ok(target + '\n')
    }
    if (a[0] === 'git') {
      const g = gitArgs(a.slice(1))
      const sub = g[0] === '-C' ? g.slice(2) : g
      const j = sub.join(' ')
      if (sub[0] === 'clone') return ok()
      if (sub[0] === 'checkout') { const bi = sub.indexOf('-b'); if (bi > -1) branch = sub[bi + 1]; return ok() }
      if (j === 'remote') return ok('')
      if (j === 'rev-parse HEAD') return ok(SHA + '\n')
      if (j === 'rev-parse --abbrev-ref HEAD') return ok(branch + '\n')
      if (j === 'rev-parse --show-toplevel') return ok(REPO_DIR + '\n')
      if (j === 'rev-parse --absolute-git-dir') return ok(REPO_DIR + '/.git\n')
      if (j.startsWith('rev-parse --path-format=absolute')) return ok(REPO_DIR + '/.git\n')
      if (sub[0] === 'diff' || sub[0] === 'ls-files') return ok('')
      if (sub[0] === 'status') return ok('')
      return ok('')
    }
    return ok('')
  }
  runner.calls = calls
  return runner
}

const mk = (over = {}) => createOpenClawWslWorkspace({ wslRunner: fakeWsl(over), verifyTerminalGrant: isTerminalGrant })

/* ══════════════ E1 — the shape itself ══════════════ */

test('E1. prepare returns <envelope>/repo, and the envelope is derived, not supplied', () => {
  const ws = mk()
  const p = ws.prepare(APPROVAL)

  assert.strictEqual(p.dir, REPO_DIR, 'the AgentRunner-visible dir is the REPO, not the envelope')
  assert.strictEqual(p.dir, ENV_DIR + '/repo', 'exactly the repo child — not merely underneath')
  assert.strictEqual(p.branch, 'agent/' + APPROVAL)
  assert.strictEqual(p.baseSha, SHA)

  // the contract AgentRunner depends on is unchanged in shape
  assert.deepStrictEqual(Object.keys(p).sort(), ['baseSha', 'branch', 'dir'])
})

test('E1b. the envelope is a fixed function of SANDBOX_ROOT and approvalId', () => {
  // Nothing about the location is caller-supplied, so no composition site can relocate it.
  for (const id of ['a', 'appr_9', 'A-b_c']) {
    const p = mk().prepare(id)
    assert.strictEqual(p.dir, `${SANDBOX_ROOT}/${id}/${REPO_CHILD}`)
  }
  for (const bad of ['../escape', 'a/b', '', 'x'.repeat(65), 'a b']) {
    assert.throws(() => mk().prepare(bad), /safe approvalId/, `${JSON.stringify(bad)} must be refused`)
  }
})

/* ══════════════ E2/E3/E4 — object identity at all three levels ══════════════ */

test('E2. ⛔ a REPLACED ENVELOPE is detected even when the repo looks untouched', () => {
  // Swapping the envelope relocates everything beneath it. The repo could still answer every
  // git question correctly while sitting inside a directory prepare() never created.
  const objects = { [ENV_DIR]: '2049:100', [REPO_DIR]: '2049:200', [REPO_DIR + '/.git']: '2049:300' }
  const ws = mk({ objects })
  ws.prepare(APPROVAL)
  assert.ok(ws.sandboxState(REPO_DIR, SHA), 'the prepared envelope verifies')

  objects[ENV_DIR] = '2049:999'
  assert.throws(() => ws.sandboxState(REPO_DIR, SHA), /envelope is not the prepared object/)
})

test('E3. ⛔ a REPLACED REPO is detected', () => {
  const objects = { [ENV_DIR]: '2049:100', [REPO_DIR]: '2049:200', [REPO_DIR + '/.git']: '2049:300' }
  const ws = mk({ objects })
  ws.prepare(APPROVAL)
  objects[REPO_DIR] = '2049:888'
  assert.throws(() => ws.sandboxState(REPO_DIR, SHA), /sandbox directory is not the prepared object/)
})

test('E4. ⛔ a REPLACED .git is detected', () => {
  const objects = { [ENV_DIR]: '2049:100', [REPO_DIR]: '2049:200', [REPO_DIR + '/.git']: '2049:300' }
  const ws = mk({ objects })
  ws.prepare(APPROVAL)
  objects[REPO_DIR + '/.git'] = '2049:777'
  assert.throws(() => ws.sandboxState(REPO_DIR, SHA), /\.git is not the prepared object/)
})

test('E4b. the envelope is checked BEFORE the repo, and no git evidence is gathered after a mismatch', () => {
  const objects = { [ENV_DIR]: '2049:100', [REPO_DIR]: '2049:200', [REPO_DIR + '/.git']: '2049:300' }
  const runner = fakeWsl({ objects })
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyTerminalGrant: isTerminalGrant })
  ws.prepare(APPROVAL)
  const before = runner.calls.length
  objects[ENV_DIR] = '2049:999'
  assert.throws(() => ws.sandboxState(REPO_DIR, SHA), /envelope is not the prepared object/)
  const after = runner.calls.slice(before)
  assert.ok(!after.some((c) => c.includes('rev-parse HEAD')),
    'a relocated envelope must not be interrogated with git: ' + after.join(' | '))
})

/* ══════════════ E5/E6 — cleanup ══════════════ */

test('E5. cleanup removes the ENVELOPE, never the repo path it was handed', () => {
  const runner = fakeWsl()
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyTerminalGrant: isTerminalGrant })
  ws.prepare(APPROVAL)

  const r = ws.cleanup(REPO_DIR, { grant: grantFor(APPROVAL) })
  assert.deepStrictEqual(r, { ok: true, removed: ENV_DIR })

  const removals = runner.calls.filter((c) => c.startsWith('rm -rf'))
  assert.strictEqual(removals.length, 1, 'exactly one removal')
  assert.ok(removals[0].endsWith('-- ' + ENV_DIR), `must remove the envelope: ${removals[0]}`)
})

test('E5b. the envelope comes from the PREPARED record, not from trimming the argument', () => {
  // Deriving it by chopping '/repo' off the caller's string would re-trust the caller's path
  // at the one moment it is most expensive to be wrong: immediately before rm -rf.
  const ws = mk()
  const unprepared = ws.cleanup(SANDBOX_ROOT + '/never_prepared/repo', { grant: grantFor(APPROVAL) })
  assert.strictEqual(unprepared.ok, false)
  assert.match(unprepared.reason, /no prepared sandbox baseline/)
})

test('E6. ⛔ cleanup cannot escape the sandbox root, whatever it is handed', () => {
  const runner = fakeWsl()
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyTerminalGrant: isTerminalGrant })
  ws.prepare(APPROVAL)

  const escapes = [
    '/', '/home', '/home/openclaw', SANDBOX_ROOT,
    ENV_DIR,                                   // the envelope is not a repo path
    SANDBOX_ROOT + '/../../etc',
    SANDBOX_ROOT + '/a/b/repo',                // arbitrary descendant masquerading as a repo
    SANDBOX_ROOT + '/appr_x/repo/nested'
  ]
  for (const bad of escapes) {
    const r = ws.cleanup(bad, { grant: grantFor(APPROVAL) })
    assert.strictEqual(r.ok, false, `${bad} must be refused`)
  }
  assert.ok(!runner.calls.some((c) => c.startsWith('rm -rf')), 'no removal may be attempted for any of them')
})

test('E6b. ⛔ a REPLACED envelope is never deleted', () => {
  // Whatever is standing at that path now is not the directory we created; removing it would
  // destroy something we cannot account for.
  const objects = { [ENV_DIR]: '2049:100', [REPO_DIR]: '2049:200', [REPO_DIR + '/.git']: '2049:300' }
  const runner = fakeWsl({ objects, present: [ENV_DIR] })
  const ws = createOpenClawWslWorkspace({ wslRunner: runner, verifyTerminalGrant: isTerminalGrant })
  ws.prepare(APPROVAL)

  // prepare() legitimately removes a pre-existing stale envelope, so only removals issued
  // AFTER this point are evidence about cleanup.
  const before = runner.calls.length
  objects[ENV_DIR] = '2049:999'
  const r = ws.cleanup(REPO_DIR, { grant: grantFor(APPROVAL) })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /envelope is not the prepared object/)
  assert.ok(!runner.calls.slice(before).some((c) => c.startsWith('rm -rf')),
    'a replaced envelope must not be removed')
})

/* ══════════════ containment shape ══════════════ */

test('E6c. containment pins BOTH shapes exactly, not merely "underneath the root"', () => {
  const ws = mk()

  // envelope: exactly one level down
  assert.strictEqual(ws.envelopeContainmentCheck(ENV_DIR), ENV_DIR)
  for (const bad of [SANDBOX_ROOT, SANDBOX_ROOT + '/a/b', REPO_DIR]) {
    assert.throws(() => ws.envelopeContainmentCheck(bad), /refuse:/, `envelope: ${bad}`)
  }

  // repo: exactly <envelope>/repo
  assert.strictEqual(ws.containmentCheck(REPO_DIR), REPO_DIR)
  for (const bad of [SANDBOX_ROOT, ENV_DIR, SANDBOX_ROOT + '/a/b/repo', REPO_DIR + '/sub', SANDBOX_ROOT + '/a/notrepo']) {
    assert.throws(() => ws.containmentCheck(bad), /refuse:/, `repo: ${bad}`)
  }
})

test('E6d. ⛔ a symlink cannot make an outside path look contained', () => {
  // The literal string is contained; the canonical path is not. Only the canonical one counts.
  const ws = mk({ realpath: { [REPO_DIR]: '/etc' } })
  assert.throws(() => ws.containmentCheck(REPO_DIR), /refuse:/)
})
