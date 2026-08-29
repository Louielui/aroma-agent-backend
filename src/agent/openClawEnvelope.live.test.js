'use strict'

/**
 * openClawEnvelope.live.test.js — THE ENVELOPE, AGAINST THE REAL DISTRO. NO MODEL CALL.
 *
 * Two things are proven here that a fake cannot prove:
 *
 *   E7/E8  a real clone inside a real envelope stays clean while the OpenClaw bootstrap
 *          layer sits beside it, because the verifier is scoped to <envelope>/repo
 *   B3     the installed OpenClaw build really does contain the run-loop ceiling this
 *          programme's cost bound depends on
 *
 * ⛔ THE BOOTSTRAP LAYER HERE IS A SYNTHETIC FIXTURE, AND THAT LIMIT IS DELIBERATE.
 * Reproducing OpenClaw's real bootstrap requires creating an agent and taking a turn, which
 * costs a model call this tranche is not authorised to make. So the exact artefact set
 * MEASURED during C2-B2-A is recreated by hand — AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md,
 * USER.md, HEARTBEAT.md, BOOTSTRAP.md, openclaw-workspace-state.json and a root `git init`.
 * That is a faithful fixture, not a demonstration that OpenClaw writes exactly this and
 * nothing else. Real-bootstrap confirmation belongs to the transport gate, and is reported
 * as outstanding rather than quietly claimed.
 *
 * Where the distro is absent the suite SKIPS rather than passing.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c2b2b1-live-'))

const test = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')

const {
  createOpenClawWslWorkspace, DISTRO, SANDBOX_ROOT, REPO_CHILD, WSL_EXE, CHILD_ENV
} = require('../agent/openClawWslWorkspace')

const APPROVAL = 'appr_envlive'
const ENV_DIR = SANDBOX_ROOT + '/' + APPROVAL
const REPO_DIR = ENV_DIR + '/' + REPO_CHILD
const DIST = '/home/openclaw/.openclaw/tools/node-v22.22.3/lib/node_modules/openclaw/dist'

/** Same boundary the provider uses: absolute launcher, empty env, no shell. */
const wsl = (argv) => spawnSync(WSL_EXE, ['-d', DISTRO, '--'].concat(argv),
  { env: CHILD_ENV, encoding: 'utf8', shell: false, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
const sh = (script) => wsl(['sh', '-c', script])

function distroAvailable () {
  if (process.platform !== 'win32') return false
  const r = wsl(['true'])
  return !!r && r.status === 0
}

const AVAILABLE = distroAvailable()
const opts = AVAILABLE ? {} : { skip: 'OpenClawGateway distro not available on this machine' }

/** The exact artefact set measured during the C2-B2-A probe. */
const BOOTSTRAP_FILES = [
  'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md',
  'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'openclaw-workspace-state.json'
]


/** Terminality is proven, not asserted: mint a REAL grant the way production will. */
const { createOpenClawQuarantine } = require('../agent/openClawQuarantine')
function memLedgerStore () {
  let data = {}
  return { read: () => JSON.parse(JSON.stringify(data)), write: (d) => { data = JSON.parse(JSON.stringify(d)) } }
}
/** One ledger governs the workspaces in this file; grants are bound to it. */
const LEDGER = createOpenClawQuarantine({ store: memLedgerStore() })
const verifyGrant = (g, expect) => LEDGER.verifyGrant(g, expect)
function grantFor (approvalId) {
  if (LEDGER.state(approvalId) === null) LEDGER.begin(approvalId)
  if (LEDGER.state(approvalId) === LEDGER.STATES.PREPARED) LEDGER.abortPreExecution(approvalId)
  return LEDGER.preExecutionGrant(approvalId)
}

const scrub = () => sh(`rm -rf ${ENV_DIR}`)

/* ══════════════ E7/E8 ══════════════ */

test('E7/E8. LIVE. the bootstrap layer sits beside the repo and never inside it', opts, () => {
  scrub()
  const ws = createOpenClawWslWorkspace({ verifyGrant })
  const p = ws.prepare(APPROVAL)

  try {
    // ── the layout is real ──
    assert.strictEqual(p.dir, REPO_DIR, 'prepare returns the repo child')
    assert.strictEqual(sh(`[ -d ${ENV_DIR} ] && echo yes`).stdout.trim(), 'yes', 'envelope exists')
    assert.strictEqual(sh(`[ -d ${REPO_DIR}/.git ] && echo yes`).stdout.trim(), 'yes', 'repo is a real clone')
    assert.match(p.baseSha, /^[0-9a-f]{40}$/)
    assert.strictEqual(p.branch, 'agent/' + APPROVAL)

    // ── clean before ──
    const before = ws.sandboxState(REPO_DIR, p.baseSha)
    assert.strictEqual(before.headSha, p.baseSha)
    assert.strictEqual(before.currentBranch, p.branch)
    assert.deepStrictEqual(before.remotes, [], 'no push target')
    assert.deepStrictEqual(before.indexFlagged, [])
    assert.deepStrictEqual(before.indexDrift, [])
    assert.deepStrictEqual(ws.repoChanges(REPO_DIR), [], 'a fresh clone is clean')

    // ── now reproduce OpenClaw's bootstrap layer AT THE ENVELOPE ROOT ──
    // This is what previously would have landed inside the repository and failed every run.
    for (const f of BOOTSTRAP_FILES) sh(`printf 'bootstrap fixture\\n' > ${ENV_DIR}/${f}`)
    sh(`cd ${ENV_DIR} && git init -q . && git config user.email fixture@test && git config user.name fixture`)

    assert.strictEqual(sh(`ls -A ${ENV_DIR} | wc -l`).stdout.trim(), String(BOOTSTRAP_FILES.length + 2),
      'envelope holds the bootstrap files, its own .git, and repo/')
    assert.strictEqual(sh(`[ -d ${ENV_DIR}/.git ] && echo yes`).stdout.trim(), 'yes',
      'OpenClaw git-inits the workspace root — measured in C2-B2-A')

    // ── E8: the verifier is scoped to the repo, so none of that is visible to it ──
    assert.deepStrictEqual(ws.repoChanges(REPO_DIR), [],
      'the bootstrap layer must not register as a repository change')

    const after = ws.sandboxState(REPO_DIR, p.baseSha)
    assert.strictEqual(after.headSha, p.baseSha, 'HEAD untouched')
    assert.strictEqual(after.currentBranch, p.branch, 'branch untouched')
    assert.deepStrictEqual(after.remotes, [], 'remotes untouched')
    assert.deepStrictEqual(after.indexFlagged, [])
    assert.deepStrictEqual(after.indexDrift, [])
    assert.strictEqual(after.topLevelOk, true, 'the repo top-level is still the repo')
    assert.strictEqual(after.gitDirOk, true)
    assert.strictEqual(after.commonDirOk, true)
    assert.strictEqual(after.dotGitIsRealDir, true)

    // ⛔ the decisive one: git inside repo/ must resolve to repo/.git, NOT the envelope's
    assert.strictEqual(sh(`cd ${REPO_DIR} && git rev-parse --show-toplevel`).stdout.trim(), REPO_DIR,
      'the envelope git repo must not capture the clone')

    // ── and no bootstrap artefact reached the repo ──
    for (const f of BOOTSTRAP_FILES) {
      assert.strictEqual(sh(`[ -e ${REPO_DIR}/${f} ] && echo present || echo absent`).stdout.trim(), 'absent',
        `${f} must not exist inside the repo`)
    }

    // ── cleanup takes the WHOLE envelope, and only when terminal ──
    assert.strictEqual(ws.discardPreparedSandbox(REPO_DIR, {}).ok, false, 'no terminal assertion, no removal')
    assert.strictEqual(sh(`[ -d ${ENV_DIR} ] && echo yes`).stdout.trim(), 'yes', 'still there after refusal')

    const done = ws.discardPreparedSandbox(REPO_DIR, { grant: grantFor(APPROVAL) })
    assert.strictEqual(done.ok, true, JSON.stringify(done))
    assert.strictEqual(done.removed, ENV_DIR)
    assert.strictEqual(sh(`[ -e ${ENV_DIR} ] && echo present || echo absent`).stdout.trim(), 'absent',
      'the whole envelope is gone')
    assert.strictEqual(sh(`[ -d ${SANDBOX_ROOT} ] && echo yes`).stdout.trim(), 'yes', 'the root survived')
  } finally {
    scrub()
  }
})

/* ══════════════ B3 — the bound exists in the INSTALLED build ══════════════ */

test('B3. LIVE. the installed OpenClaw build contains the run-loop ceiling we rely on', opts, () => {
  // The cost bound is only worth stating if the guarantee is really in the build that runs.
  // An OpenClaw upgrade that removed or renamed this guard would silently invalidate the
  // bound, and this test is what would notice.
  const sel = sh(`grep -l 'MAX_RUN_RETRY_ITERATIONS' ${DIST}/*.js | head -1`).stdout.trim()
  assert.ok(sel, 'a module defining MAX_RUN_RETRY_ITERATIONS must exist in the installed build')

  const consts = sh(`grep -o 'const [A-Z_]*RUN_RETRY[A-Z_]* = [0-9]*' ${sel}`).stdout.trim().split('\n')
  const table = {}
  for (const line of consts) {
    const m = line.match(/const ([A-Z_]+) = (\d+)/)
    if (m) table[m[1]] = Number(m[2])
  }
  assert.strictEqual(table.BASE_RUN_RETRY_ITERATIONS, 24)
  assert.strictEqual(table.RUN_RETRY_ITERATIONS_PER_PROFILE, 8)
  assert.strictEqual(table.MIN_RUN_RETRY_ITERATIONS, 32)
  assert.strictEqual(table.MAX_RUN_RETRY_ITERATIONS, 160)

  // the clamp, whose min-floors-max behaviour is the trap openClawPolicy works around
  const clamp = sh(`grep -o 'Math.min(maxLimit, Math.max(minLimit, scaled))' ${sel}`).stdout.trim()
  assert.strictEqual(clamp, 'Math.min(maxLimit, Math.max(minLimit, scaled))',
    'the ceiling is a clamp whose upper bound is floored at minLimit')

  // and the loop guard that actually enforces it, in the embedded runner that we measured
  // running (probe 1 reported executionTrace.runner === "embedded")
  const guarded = sh(`grep -l 'runLoopIterations >= MAX_RUN_LOOP_ITERATIONS' ${DIST}/*.js | head -1`).stdout.trim()
  assert.ok(guarded, 'the run loop must be guarded by the ceiling')
  assert.match(sh(`grep -o 'Exceeded retry limit after' ${guarded}`).stdout.trim(), /Exceeded retry limit after/,
    'and breaching it must terminate the run with a stated reason')

  const policy = require('../agent/openClawPolicy')
  assert.strictEqual(policy.INSTALLED_RUN_RETRY_DEFAULTS.base, table.BASE_RUN_RETRY_ITERATIONS)
  assert.strictEqual(policy.INSTALLED_RUN_RETRY_DEFAULTS.perProfile, table.RUN_RETRY_ITERATIONS_PER_PROFILE)
  assert.strictEqual(policy.INSTALLED_RUN_RETRY_DEFAULTS.min, table.MIN_RUN_RETRY_ITERATIONS)
  assert.strictEqual(policy.INSTALLED_RUN_RETRY_DEFAULTS.max, table.MAX_RUN_RETRY_ITERATIONS)
})

test('B3b. LIVE. the WALL-CLOCK bound is NOT claimed, because it is not established', opts, () => {
  // Honest negative result, pinned so nobody later "remembers" it as proven.
  //
  // models.providers.<p>.timeoutSeconds is documented as covering total request abort
  // handling. Tracing its consumers in the installed build found the web-search path and the
  // cron agent-turn payload — NOT the openai/codex model request path this installation uses.
  // The per-request wall-clock bound is therefore unverified, and so is any turn-level
  // wall-clock statement derived from it.
  //
  // What IS established is the request-COUNT bound (B3) and the per-request output-token cap.
  const policy = require('../agent/openClawPolicy')
  assert.ok(Number.isInteger(policy.RUN_RETRY_CEILING) && policy.RUN_RETRY_CEILING > 0)
  assert.ok(Number.isInteger(policy.MAX_OUTPUT_TOKENS) && policy.MAX_OUTPUT_TOKENS > 0)

  const src = fs.readFileSync(path.join(__dirname, 'openClawPolicy.js'), 'utf8')
  assert.ok(!/wall[- ]?clock (bound|guarantee) (is )?(proven|established)/i.test(src),
    'no wall-clock guarantee may be asserted in the policy module')
})


/* ══════════════ PI3 — the replacement hazard, and its REAL limit ══════════════ */

test('PI3. LIVE. object identity defeats move-aside substitution — delete+recreate is NOT reliably detected', opts, () => {
  // The unit tests drive a scripted device:inode. This measures the premise on real ext4,
  // and the measurement is not what the design would have preferred:
  //
  //   move aside + create new  -> DIFFERENT inode   (detected)
  //   delete + recreate        -> SAME inode        (NOT detected — ext4 recycles it)
  //
  // So device:inode defeats the substitution that keeps the original alive for the attacker
  // to use — the C2-B1 attack — but it does NOT detect delete-then-recreate. That limit is
  // asserted here rather than left for someone to discover later, because a test that only
  // demonstrated the happy case would imply a guarantee this mechanism does not give.
  //
  // What bounds the residual risk is containment, not identity: whatever a rollback removes
  // is at <SANDBOX_ROOT>/<approvalId> exactly one level down, a path only this provider
  // creates. No clone and no model call is involved here.
  const BASE = SANDBOX_ROOT + '/appr_pi3live'
  const id = (t) => sh(`stat -c %d:%i -- ${t} 2>/dev/null || echo none`).stdout.trim()

  sh(`rm -rf ${BASE} ${BASE}_aside`)
  try {
    sh(`mkdir -p ${BASE}`)
    const original = id(BASE)
    assert.match(original, /^\d+:\d+$/)

    // ── the detectable attack: the original survives, so it keeps its inode ──
    sh(`mv ${BASE} ${BASE}_aside && mkdir -p ${BASE}`)
    const substituted = id(BASE)
    assert.match(substituted, /^\d+:\d+$/)
    assert.notStrictEqual(substituted, original,
      'move-aside substitution MUST be detectable — this is the C2-B1 attack')
    assert.strictEqual(id(BASE + '_aside'), original, 'the original kept its identity when moved')

    // ── the honest limit: freeing the inode lets the kernel hand it straight back ──
    //
    // ⛔ THIS OUTCOME IS NONDETERMINISTIC, AND THAT IS PRECISELY THE PROBLEM.
    // Measured in isolation: 2096:118042 -> 2096:118042 (reused). Measured again under the
    // full suite, with other allocations in between: a DIFFERENT inode. So reuse is
    // POSSIBLE, not guaranteed — which means delete-then-recreate is NOT RELIABLY
    // detectable. Asserting either outcome here would be asserting allocator luck, so the
    // observation is recorded and the SAFETY property is asserted instead.
    sh(`rm -rf ${BASE} ${BASE}_aside && mkdir -p ${BASE}`)
    const before = id(BASE)
    sh(`rm -rf ${BASE} && mkdir -p ${BASE}`)
    const after = id(BASE)
    assert.match(after, /^\d+:\d+$/)
    // no assertion on equality: both results have been observed on this filesystem

    // ── and the control that actually bounds this: containment ──
    const q = createOpenClawQuarantine({ store: memLedgerStore() })
    const ws = createOpenClawWslWorkspace({ verifyGrant: (g, e) => q.verifyGrant(g, e) })
    q.begin('appr_pi3live'); q.failPreparation('appr_pi3live', { reason: 'synthetic' })
    const grant = q.preExecutionGrant('appr_pi3live')

    // no pinned baseline for an existing path -> refuse, whatever its inode says
    const r = ws.abortPrepare('appr_pi3live', { grant })
    assert.strictEqual(r.ok, false, JSON.stringify(r))
    assert.match(r.reason, /never pinned its identity/)
    assert.strictEqual(sh(`[ -d ${BASE} ] && echo yes`).stdout.trim(), 'yes', 'the directory is preserved')

    // and nothing outside the fixed root is reachable at all
    for (const outside of ['/etc', '/home/openclaw', '..', '../..']) {
      assert.strictEqual(ws.abortPrepare(outside, { grant }).ok, false, `${outside} must be refused`)
    }
  } finally {
    sh(`rm -rf ${BASE} ${BASE}_aside`)
  }
})
