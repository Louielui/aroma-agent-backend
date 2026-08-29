'use strict'

/**
 * openClawWslWorkspace.live.test.js — THE PROVIDER, AGAINST THE REAL DISTRO.
 *
 * The unit tests drive an injected runner, which proves the logic but not that the logic
 * matches git's actual behaviour inside OpenClawGateway. These tests use the REAL provider
 * and a REAL disposable sandbox, because a detector's blind spot can only be seen against
 * real git — that lesson cost this programme three review rounds in C1.
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

const { createOpenClawWslWorkspace } = require('../agent/openClawWslWorkspace')

const DISTRO = 'OpenClawGateway'
const ROOT = '/tmp/aroma-c2b1-live/sandboxes'
const MIRROR = '/tmp/aroma-c2b1-live/mirror.git'
const APPROVAL = 'appr_live'

const wsl = (argv) => spawnSync('wsl.exe', ['-d', DISTRO, '--'].concat(argv),
  { encoding: 'utf8', shell: false, windowsHide: true, timeout: 120000 })
const sh = (script) => wsl(['sh', '-c', script])

/** Is the distro actually here? Never assume — a skipped test must be an observed fact. */
function distroAvailable () {
  if (process.platform !== 'win32') return false
  const r = wsl(['true'])
  return !!r && r.status === 0
}

const AVAILABLE = distroAvailable()
const opts = AVAILABLE ? {} : { skip: 'OpenClawGateway distro not available on this machine' }

/** A disposable source + bare mirror, built fresh inside the distro. */
function buildFixture () {
  sh('rm -rf /tmp/aroma-c2b1-live && mkdir -p /tmp/aroma-c2b1-live/src')
  sh([
    'cd /tmp/aroma-c2b1-live/src',
    'git init -q .',
    'git config user.email fixture@test',
    'git config user.name fixture',
    'printf "one\\n" > tracked.txt',
    'printf "two\\n" > second.txt',
    'printf "*.log\\n.env\\ndata/\\n" > .gitignore',
    'git add .',
    'git commit -qm init',
    'git branch -M main'
  ].join(' && '))
  sh(`git clone --bare -q /tmp/aroma-c2b1-live/src ${MIRROR}`)
}

const provider = () => createOpenClawWslWorkspace({ sandboxRoot: ROOT, mirrorPath: MIRROR })

test('LIVE. the real provider prepares, detects and cleans a real WSL sandbox', opts, () => {
  buildFixture()
  const ws = provider()
  const p = ws.prepare(APPROVAL)
  const D = p.dir
  // the disposable clone needs an identity before a commit can move HEAD; a fresh clone has
  // none, and without this the HEAD-movement case silently never happens
  sh(`cd ${D} && git config user.email fixture@test && git config user.name fixture`)

  try {
    // ── the sandbox is real, POSIX, and inside the fixed root ──
    assert.ok(D.startsWith(ROOT + '/'), `sandbox must be under the root: ${D}`)
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

    const reset = () => sh(`cd ${D} && git checkout -q -- . 2>/dev/null; git reset -q --hard ${p.baseSha}; git clean -qfdx; git update-index --no-assume-unchanged tracked.txt 2>/dev/null; git update-index --no-skip-worktree tracked.txt 2>/dev/null; true`)

    // ── ordinary and IGNORED untracked files ──
    sh(`printf 'x\\n' > ${D}/ordinary-new.txt`)
    assert.deepStrictEqual(ws.repoChanges(D), ['ordinary-new.txt'])
    reset()

    sh(`printf 'SECRET=1\\n' > ${D}/.env; printf 'noise\\n' > ${D}/app.log`)
    assert.deepStrictEqual(ws.repoChanges(D), ['.env', 'app.log'],
      'ignored files are still repository writes — this is what --exclude-standard hid')
    reset()

    // ── tracked modification and deletion ──
    sh(`printf 'edited\\n' > ${D}/tracked.txt`)
    assert.deepStrictEqual(ws.repoChanges(D), ['tracked.txt'])
    reset()
    sh(`rm -f ${D}/tracked.txt`)
    assert.deepStrictEqual(ws.repoChanges(D), ['tracked.txt'])
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

    sh(`cd ${D} && printf 'committed\\n' > tracked.txt && git commit -qam moved`)
    const moved = ws.sandboxState(D, p.baseSha)
    assert.notStrictEqual(moved.headSha, p.baseSha, 'a commit moves HEAD')
    assert.strictEqual(moved.currentBranch, p.branch, 'on the approved branch the whole time')
    assert.deepStrictEqual(ws.repoChanges(D), [], 'committing makes the worktree clean again')
    reset()

    sh(`cd ${D} && git update-index --assume-unchanged tracked.txt && printf 'MUT\\n' > tracked.txt`)
    assert.strictEqual(ws.sandboxState(D, p.baseSha).indexFlagged.length, 1)
    assert.deepStrictEqual(ws.repoChanges(D), [], 'assume-unchanged hides the edit from the worktree check')
    reset()

    sh(`cd ${D} && git update-index --skip-worktree tracked.txt && printf 'MUT\\n' > tracked.txt`)
    assert.strictEqual(ws.sandboxState(D, p.baseSha).indexFlagged[0].tag, 'S')
    reset()

    sh(`cd ${D} && printf 'STAGED\\n' > tracked.txt && git add tracked.txt && printf 'one\\n' > tracked.txt`)
    assert.deepStrictEqual(ws.sandboxState(D, p.baseSha).indexDrift, ['tracked.txt'])
    assert.deepStrictEqual(ws.repoChanges(D), [], 'the worktree was restored; the index still differs')
    reset()

    // ── containment refuses everything that is not this sandbox ──
    for (const bad of [ROOT, '/', '/home/openclaw', MIRROR, '/home/openclaw/dev/aroma-agent-backend']) {
      assert.throws(() => ws.containmentCheck(bad), /refuse:/, `${bad} must be refused`)
    }
    sh(`ln -sfn /etc ${ROOT}/escape`)
    assert.throws(() => ws.containmentCheck(ROOT + '/escape'), /refuse:/, 'a symlink escape must be refused')
    sh(`rm -f ${ROOT}/escape`)

    // ── cleanup removes the sandbox and nothing else ──
    assert.strictEqual(ws.cleanup(MIRROR).ok, false, 'the mirror is never removable')
    assert.strictEqual(ws.cleanup(ROOT).ok, false, 'the root is never removable')
    assert.deepStrictEqual(ws.cleanup(D), { ok: true })
    assert.notStrictEqual(sh(`[ -e ${D} ] && echo present || echo absent`).stdout.trim(), 'present', 'the sandbox is gone')
    assert.strictEqual(sh(`[ -d ${MIRROR} ] && echo yes`).stdout.trim(), 'yes', 'the mirror survived')
  } finally {
    sh('rm -rf /tmp/aroma-c2b1-live')
  }
})

test('LIVE. the Windows filesystem is not reachable from the distro', opts, () => {
  // Recorded as a standing fact: the isolation this design depends on is measured, not
  // assumed, and a future change to /etc/wsl.conf would surface here.
  assert.strictEqual(sh('ls -A /mnt/c 2>/dev/null | wc -l').stdout.trim(), '0', '/mnt/c is empty')
  assert.notStrictEqual(sh('ls /mnt/c/Aroma 2>/dev/null && echo yes || echo no').stdout.trim(), 'yes',
    'the Windows production repo must not be visible')
})
