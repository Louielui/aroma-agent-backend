'use strict'

/**
 * openClawWslWorkspace.live.test.js — THE PROVIDER, AGAINST THE REAL DISTRO.
 *
 * The unit tests drive an injected runner, which proves the logic but not that the logic
 * matches git's actual behaviour inside OpenClawGateway. These tests use the REAL provider,
 * with NOTHING injected, and a REAL disposable sandbox — because a detector's blind spot can
 * only be seen against real git. That lesson cost this programme three review rounds in C1.
 *
 * ⛔ THE PROVIDER'S IDENTITY IS NO LONGER INJECTABLE, AND THIS TEST MUST NOT PRETEND IT IS.
 * The previous version constructed it with a private sandboxRoot and a local fixture mirror.
 * Those options are gone: distro, sandbox root and source URL are fixed constants. Passing
 * them now would be silently ignored, and the test would look like it measured a private
 * fixture while actually measuring production. So this exercises the real configuration
 * directly — real distro, real sandbox root, real public source URL — on a disposable
 * approval id that is removed again in `finally`.
 *
 * No OpenClaw agent is invoked and no model call is made: git and the filesystem only.
 *
 * Where the distro is absent the suite SKIPS rather than passing. A green result that
 * silently measured nothing is the failure mode these tests exist to prevent.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c2b1-live-'))

const test = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')

const {
  createOpenClawWslWorkspace, DISTRO, SANDBOX_ROOT, SOURCE_URL, WSL_EXE, CHILD_ENV
} = require('../agent/openClawWslWorkspace')

const APPROVAL = 'appr_live'
const ENV_DIR = SANDBOX_ROOT + '/' + APPROVAL
const DIR = ENV_DIR + '/repo'
/** Where the replacement attack parks the genuine sandbox while the impostor takes its place. */
const ASIDE = SANDBOX_ROOT + '/appr_live_aside'

/**
 * ⛔ THE TEST'S OWN LAUNCHER USES THE SAME BOUNDARY AS THE PROVIDER'S.
 *
 * This helper previously called spawnSync('wsl.exe', …) with no `env`, so the security test
 * inherited the entire Windows parent environment — including WSLENV, the documented
 * mechanism for translating named Windows variables into the Linux side. A test that leaks
 * what it is verifying cannot testify about it: any "no secrets crossed" claim would have
 * been measured through a channel that was itself wide open.
 *
 * So the fixture launcher is held to the provider's own contract: the absolute trusted
 * launcher path, an empty environment, no shell.
 */
const wsl = (argv) => spawnSync(WSL_EXE, ['-d', DISTRO, '--'].concat(argv), {
  env: CHILD_ENV, encoding: 'utf8', shell: false, windowsHide: true, timeout: 120000
})
const sh = (script) => wsl(['sh', '-c', script])

/** Is the distro actually here? Never assume — a skipped test must be an observed fact. */

/** Terminality is proven, not asserted: mint a REAL grant the way production will. */
const { createOpenClawQuarantine, isTerminalGrant } = require('../agent/openClawQuarantine')
function grantFor (approvalId) {
  let data = {}
  const store = { read: () => JSON.parse(JSON.stringify(data)), write: (d) => { data = JSON.parse(JSON.stringify(d)) } }
  const q = createOpenClawQuarantine({ store })
  q.begin(approvalId); q.markRunning(approvalId); q.observeTerminal(approvalId, 'lost')
  return q.terminalGrant(approvalId)
}

function distroAvailable () {
  if (process.platform !== 'win32') return false
  const r = wsl(['true'])
  return !!r && r.status === 0
}

const AVAILABLE = distroAvailable()
const opts = AVAILABLE ? {} : { skip: 'OpenClawGateway distro not available on this machine' }

/** device:inode, measured inside the distro — the same question the provider asks. */
const objectId = (target) => sh(`stat -c %d:%i -- ${target} 2>/dev/null || echo none`).stdout.trim()

/** Remove every disposable directory this file creates, whatever happened. */
function scrub () {
  sh(`rm -rf ${ENV_DIR} ${ASIDE} /tmp/aroma-write-probe`)
}

/* ══════════════ T2 — the fixture launcher leaks nothing either ══════════════ */

test('LIVE-ENV. ⛔ this test file itself passes no Windows environment into the distro', opts, () => {
  // Sentinels in the parent. If the fixture launcher inherited process.env — as it used to —
  // these would reach the distro, and every other measurement in this file would have been
  // taken through a leaking channel.
  //
  // ⛔ WSLENV IS NOT ABSENT INSIDE THE DISTRO, AND ASSERTING ITS ABSENCE WAS WRONG.
  // Measured here: WSL itself always defines WSLENV in the Linux environment. Under the
  // empty child environment it is defined and EMPTY — carrying no variable names — which is
  // the property that actually matters. An absence assertion failed against a correctly
  // sealed boundary, which is exactly the kind of check that gets "fixed" by loosening it.
  process.env.AROMA_LIVE_SENTINEL = 'live-sentinel-must-not-cross'
  process.env.WSLENV = 'AROMA_LIVE_SENTINEL/u'
  try {
    const seen = sh('env').stdout || ''
    assert.ok(!seen.includes('live-sentinel-must-not-cross'),
      'LIVE_TEST_WINDOWS_ENV_INHERITED must be NO — a parent variable reached the distro')
    assert.match(seen, /^WSLENV=\s*$/m,
      'LIVE_TEST_WSLENV_PASSED must be NO — WSLENV must carry no names across')
    assert.strictEqual(sh('printenv AROMA_LIVE_SENTINEL || echo absent').stdout.trim(), 'absent')

    // ── the differential: the OLD launcher really did leak, so this test is load-bearing ──
    // Without it, "the sentinel is absent" could equally mean the sentinel was never set,
    // the distro strips everything, or the probe measured nothing at all. One inherited-env
    // invocation of the same probe settles which. The sentinel is a fixed, meaningless
    // string and it lives only in this one command's environment.
    const leaked = spawnSync(WSL_EXE, ['-d', DISTRO, '--', 'env'],
      { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000 }).stdout || ''
    assert.ok(leaked.includes('live-sentinel-must-not-cross'),
      'the inherited-env launcher must be shown to leak, or this test proves nothing')
    assert.match(leaked, /^WSLENV=AROMA_LIVE_SENTINEL\/u$/m,
      'and WSLENV must be shown to carry the name across when it is inherited')
  } finally {
    delete process.env.AROMA_LIVE_SENTINEL
    delete process.env.WSLENV
  }
})

/* ══════════════ the provider against real git ══════════════ */

test('LIVE. the real provider prepares, detects and cleans a real WSL sandbox', opts, () => {
  scrub()
  const ws = createOpenClawWslWorkspace({ verifyTerminalGrant: isTerminalGrant })
  const p = ws.prepare(APPROVAL)
  const D = p.dir
  // the disposable clone needs an identity before a commit can move HEAD; a fresh clone has
  // none, and without this the HEAD-movement case silently never happens
  sh(`cd ${D} && git config user.email fixture@test && git config user.name fixture`)

  try {
    // ── the sandbox is real, POSIX, and at the fixed production location ──
    assert.strictEqual(D, DIR, 'prepare uses the fixed sandbox root, not a test-supplied one')
    assert.strictEqual(sh(`[ -d ${D} ] && echo yes`).stdout.trim(), 'yes', 'it exists inside the distro')
    assert.strictEqual(p.branch, 'agent/' + APPROVAL)
    assert.match(p.baseSha, /^[0-9a-f]{40}$/)

    const clean = ws.sandboxState(D, p.baseSha)
    assert.strictEqual(clean.headSha, p.baseSha)
    assert.strictEqual(clean.currentBranch, p.branch)
    assert.deepStrictEqual(clean.remotes, [], 'the clone has no push target')
    assert.deepStrictEqual(clean.indexFlagged, [])
    assert.deepStrictEqual(clean.indexDrift, [])
    assert.strictEqual(clean.dotGitIsRealDir, true)
    assert.strictEqual(clean.topLevelOk, true)
    assert.strictEqual(clean.gitDirOk, true)
    assert.strictEqual(clean.commonDirOk, true)
    assert.deepStrictEqual(ws.repoChanges(D), [])

    const tracked = 'package.json'
    const reset = () => sh(`cd ${D} && git checkout -q -- . 2>/dev/null; git reset -q --hard ${p.baseSha}; git clean -qfdx; git update-index --no-assume-unchanged ${tracked} 2>/dev/null; git update-index --no-skip-worktree ${tracked} 2>/dev/null; true`)

    // ── ordinary and IGNORED untracked files ──
    sh(`printf 'x\\n' > ${D}/ordinary-new.txt`)
    assert.deepStrictEqual(ws.repoChanges(D), ['ordinary-new.txt'])
    reset()

    sh(`printf 'SECRET=1\\n' > ${D}/.env; printf 'noise\\n' > ${D}/app.log`)
    assert.deepStrictEqual(ws.repoChanges(D), ['.env', 'app.log'],
      'ignored files are still repository writes — this is what --exclude-standard hid')
    reset()

    // ── tracked modification and deletion ──
    sh(`printf 'edited\\n' > ${D}/${tracked}`)
    assert.deepStrictEqual(ws.repoChanges(D), [tracked])
    reset()
    sh(`rm -f ${D}/${tracked}`)
    assert.deepStrictEqual(ws.repoChanges(D), [tracked])
    reset()

    // ── the .git-only mutations: worktree stays spotless throughout ──
    sh(`cd ${D} && git remote add attacker https://example.invalid/x.git`)
    assert.deepStrictEqual(ws.sandboxState(D, p.baseSha).remotes, ['attacker'])
    assert.deepStrictEqual(ws.repoChanges(D), [], 'the worktree is clean — only the remote gives it away')
    sh(`cd ${D} && git remote remove attacker`)

    sh(`cd ${D} && git checkout -q -B main`)
    assert.strictEqual(ws.sandboxState(D, p.baseSha).currentBranch, 'main')
    assert.deepStrictEqual(ws.repoChanges(D), [])
    sh(`cd ${D} && git checkout -q -B ${p.branch} ${p.baseSha}`)

    sh(`cd ${D} && printf 'committed\\n' > ${tracked} && git commit -qam moved`)
    const moved = ws.sandboxState(D, p.baseSha)
    assert.notStrictEqual(moved.headSha, p.baseSha, 'a commit moves HEAD')
    assert.strictEqual(moved.currentBranch, p.branch, 'on the approved branch the whole time')
    assert.deepStrictEqual(ws.repoChanges(D), [], 'committing makes the worktree clean again')
    reset()

    sh(`cd ${D} && git update-index --assume-unchanged ${tracked} && printf 'MUT\\n' > ${tracked}`)
    assert.strictEqual(ws.sandboxState(D, p.baseSha).indexFlagged.length, 1)
    assert.deepStrictEqual(ws.repoChanges(D), [], 'assume-unchanged hides the edit from the worktree check')
    reset()

    sh(`cd ${D} && git update-index --skip-worktree ${tracked} && printf 'MUT\\n' > ${tracked}`)
    assert.strictEqual(ws.sandboxState(D, p.baseSha).indexFlagged[0].tag, 'S')
    reset()

    sh(`cd ${D} && printf 'STAGED\\n' > ${tracked} && git add ${tracked} && git checkout-index -f -- ${tracked} 2>/dev/null; git cat-file -p ${p.baseSha}:${tracked} > ${D}/${tracked}`)
    assert.deepStrictEqual(ws.sandboxState(D, p.baseSha).indexDrift, [tracked])
    assert.deepStrictEqual(ws.repoChanges(D), [], 'the worktree was restored; the index still differs')
    reset()

    // ── containment refuses everything that is not this sandbox ──
    for (const bad of [SANDBOX_ROOT, '/', '/home/openclaw', '/home/openclaw/dev/aroma-agent-backend']) {
      assert.throws(() => ws.containmentCheck(bad), /refuse:/, `${bad} must be refused`)
    }
    sh(`ln -sfn /etc ${SANDBOX_ROOT}/escape`)
    assert.throws(() => ws.containmentCheck(SANDBOX_ROOT + '/escape'), /refuse:/, 'a symlink escape must be refused')
    sh(`rm -f ${SANDBOX_ROOT}/escape`)

    // ── cleanup removes the sandbox and nothing else ──
    assert.strictEqual(ws.cleanup(SANDBOX_ROOT, { grant: grantFor(APPROVAL) }).ok, false, 'the root is never removable')
    assert.deepStrictEqual(ws.cleanup(D, { grant: grantFor(APPROVAL) }), { ok: true, removed: ENV_DIR })
    assert.notStrictEqual(sh(`[ -e ${D} ] && echo present || echo absent`).stdout.trim(), 'present', 'the sandbox is gone')
    assert.strictEqual(sh(`[ -d ${SANDBOX_ROOT} ] && echo yes`).stdout.trim(), 'yes', 'the root survived')
  } finally {
    scrub()
  }
})

/* ══════════════ B5 — the replacement attack, against real git ══════════════ */

test('LIVE. ⛔ a sandbox REPLACED by a pristine clone at the same path is refused', opts, () => {
  // This is the load-bearing one. Every check the verifier makes is answered by asking git
  // about a PATH, and a same-user executor can rename this sandbox away and drop a fresh
  // clone at that path. The impostor has the same HEAD, the same agent branch, no remotes, a
  // clean worktree and its own real .git — so HEAD, branch, remote, index and structural
  // checks all pass. Only the filesystem object is different.
  scrub()
  const ws = createOpenClawWslWorkspace({ verifyTerminalGrant: isTerminalGrant })
  const p = ws.prepare(APPROVAL)
  const D = p.dir

  try {
    const original = objectId(D)
    assert.match(original, /^\d+:\d+$/, 'the genuine sandbox has a filesystem identity')
    assert.ok(ws.sandboxState(D, p.baseSha), 'the genuine sandbox verifies')

    // ── the attack: move the real sandbox aside, build a convincing impostor in its place ──
    sh(`mv ${D} ${ASIDE}`)
    sh(`git clone --quiet ${ASIDE} ${D} && cd ${D} && git checkout -q -B agent/${APPROVAL} ${p.baseSha} && git remote remove origin`)

    const impostor = objectId(D)
    assert.match(impostor, /^\d+:\d+$/, 'the impostor exists at the original path')
    assert.notStrictEqual(impostor, original, 'a different object now occupies the path')

    // it really is convincing — every git fact matches
    assert.strictEqual(sh(`cd ${D} && git rev-parse HEAD`).stdout.trim(), p.baseSha, 'same HEAD')
    assert.strictEqual(sh(`cd ${D} && git rev-parse --abbrev-ref HEAD`).stdout.trim(), 'agent/' + APPROVAL, 'same branch')
    assert.strictEqual(sh(`cd ${D} && git remote`).stdout.trim(), '', 'no remotes')
    assert.strictEqual(sh(`cd ${D} && git status --porcelain`).stdout.trim(), '', 'clean worktree')
    assert.strictEqual(sh(`[ -d ${D}/.git ] && [ ! -L ${D}/.git ] && echo yes`).stdout.trim(), 'yes', 'a real .git directory')

    // ── and it is still refused ──
    assert.throws(() => ws.sandboxState(D, p.baseSha), /sandbox directory is not the prepared object/,
      'a clean-looking replacement must not be accepted as the prepared sandbox')
  } finally {
    scrub()
  }
})

test('LIVE. ⛔ replacing only <clone>/.git is refused', opts, () => {
  // The narrower version of the same attack: leave the worktree alone and swap the
  // repository underneath it. The directory the verifier canonicalises is unchanged, so the
  // containment and structural checks are undisturbed.
  scrub()
  const ws = createOpenClawWslWorkspace({ verifyTerminalGrant: isTerminalGrant })
  const p = ws.prepare(APPROVAL)
  const D = p.dir

  try {
    const originalGit = objectId(D + '/.git')
    assert.match(originalGit, /^\d+:\d+$/)

    sh(`git clone --quiet ${D} ${ASIDE} && cd ${ASIDE} && git checkout -q -B agent/${APPROVAL} ${p.baseSha} && git remote remove origin`)
    sh(`rm -rf ${D}/.git && mv ${ASIDE}/.git ${D}/.git`)

    assert.notStrictEqual(objectId(D + '/.git'), originalGit, 'a different .git now occupies the path')
    assert.strictEqual(objectId(D), objectId(D), 'the worktree directory itself was never moved')
    assert.strictEqual(sh(`cd ${D} && git rev-parse HEAD`).stdout.trim(), p.baseSha, 'the swapped repository agrees about HEAD')

    assert.throws(() => ws.sandboxState(D, p.baseSha), /\.git is not the prepared object/,
      'a swapped repository must not be accepted')
  } finally {
    scrub()
  }
})

/* ══════════════ standing facts about the environment this design depends on ══════════════ */

test('LIVE. the executor identity CANNOT write to the source authority', opts, () => {
  // The review was right that "the executor is never told the path" is not a permission
  // boundary. The persistent local mirror is gone, so the only source authority left is the
  // remote — and this proves the Unix identity OpenClaw will run as cannot write to it.
  //
  // ⛔ THE VERDICT IS THE REFUSAL TEXT, NOT THE EXIT CODE. Measured on this machine:
  // `git push --dry-run` returns exit 0 even when it fatally fails to authenticate. An
  // assertion on status would therefore pass whatever happened, which is the same shape of
  // vacuous check this review round already found elsewhere.
  //
  // --dry-run is deliberate: if the distro DID hold push rights, a real push would create a
  // branch on the repository. The dry run authenticates without being able to mutate.
  const probe = sh([
    'rm -rf /tmp/aroma-write-probe',
    `GIT_TERMINAL_PROMPT=0 git clone -q --depth 1 ${SOURCE_URL} /tmp/aroma-write-probe >/dev/null 2>&1`,
    'cd /tmp/aroma-write-probe',
    'GIT_TERMINAL_PROMPT=0 git push --dry-run origin HEAD:refs/heads/openclaw-write-probe'
  ].join(' ; '))
  const out = String(probe.stdout || '') + String(probe.stderr || '')
  sh('rm -rf /tmp/aroma-write-probe')

  assert.match(out, /denied|authentication|could not read Username|terminal prompts disabled|403/i,
    `the push must be refused for want of credentials: ${out.slice(0, 300)}`)
  assert.ok(!/Everything up-to-date|new branch|->\s*openclaw-write-probe/i.test(out),
    `the push must not have been accepted: ${out.slice(0, 300)}`)
})

test('LIVE. no persistent OpenClaw source authority exists on disk', opts, () => {
  // The whole class of "can the agent find and modify the mirror" is removed by there
  // being no mirror. This records that as an observed fact, so a future reintroduction
  // has to argue with a failing test.
  assert.notStrictEqual(sh('[ -e /home/openclaw/.aroma/mirrors ] && echo present || echo absent').stdout.trim(),
    'present', 'no persistent mirror directory may exist')
})

test('LIVE. the Windows filesystem is not reachable from the distro', opts, () => {
  // Recorded as a standing fact: the isolation this design depends on is measured, not
  // assumed, and a future change to /etc/wsl.conf would surface here.
  assert.strictEqual(sh('ls -A /mnt/c 2>/dev/null | wc -l').stdout.trim(), '0', '/mnt/c is empty')
  assert.notStrictEqual(sh('ls /mnt/c/Aroma 2>/dev/null && echo yes || echo no').stdout.trim(), 'yes',
    'the Windows production repo must not be visible')
})
