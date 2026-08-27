'use strict'

/**
 * revisionIdentity.test.js — THE OWNER APPROVES A COMMIT, NOT A MOOD OF THE DISK.
 *
 * ── WHAT B2-A CLOSED ────────────────────────────────────────────────────────
 * The card's 「現時內容」 was read with fs.readFileSync from the mutable WORKING TREE, while
 * the execution workspace later clones the COMMITTED head. Those are different bytes the
 * moment the target file has uncommitted edits — and this repository genuinely runs that
 * way, since production carries an approved uncommitted launcher override. So the Owner
 * could approve an excerpt the agent would never see, and nothing in the record disagreed.
 *
 * expectedSha does not fix that by itself. Two SHAs can match while the approved TEXT came
 * from somewhere the SHA does not describe. What fixes it is making one commit the single
 * source: the excerpt is read FROM expectedSha, so the two cannot drift apart by
 * construction, and a file that is not faithfully inside that commit refuses to seal.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-b2a-test-'))

const test = require('node:test')
const assert = require('node:assert')

const { validateWorkOrder, canonicalWorkOrder, hashWorkOrder } = require('../agent/workOrder')
const { proposeWorkOrder } = require('../agent/workOrderProducer')
const { buildApprovalView } = require('../agent/workOrderView')

const SHA_A = 'd05527e49d2092fdf82e74efe4d96f203fcd80e9'
const SHA_B = 'cdb3a5f57db464dca61833c7e14c310338518ad7'

const baseOrder = (over = {}) => Object.assign({
  goal: 'change a line',
  projectId: 'p1',
  repoFullName: 'owner/name',
  expectedSha: SHA_A,
  allowedFiles: ['docs/a.md'],
  allowedTestCommand: null,
  forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
  timeoutSec: 120,
  costCapUsd: 0.5,
  branch: 'agent/appr_1',
  approvalId: 'appr_1'
}, over)

/** A scripted git, so no test ever needs a real repository. */
function fakeGit (opts = {}) {
  const heads = Array.isArray(opts.heads) ? opts.heads.slice() : [opts.head || SHA_A, opts.head || SHA_A]
  const dirtyQueue = Array.isArray(opts.dirty) ? opts.dirty.slice() : [opts.dirtyOnce || '', opts.dirtyOnce || '']
  const calls = []
  const git = (args) => {
    calls.push(args.join(' '))
    if (args[0] === 'rev-parse') {
      if (opts.headFails) return { status: 1, stdout: '', stderr: 'fatal' }
      const h = heads.length > 1 ? heads.shift() : heads[0]
      return { status: 0, stdout: h + '\n', stderr: '' }
    }
    if (args[0] === 'status') {
      if (opts.statusFails) return { status: 1, stdout: '', stderr: 'fatal' }
      const d = dirtyQueue.length > 1 ? dirtyQueue.shift() : dirtyQueue[0]
      return { status: 0, stdout: d, stderr: '' }
    }
    if (args[0] === 'ls-tree') {
      // args: ['ls-tree','-z',sha,'--',rel] — answer with a genuine regular-file record
      if (opts.lsTree != null) return { status: 0, stdout: opts.lsTree, stderr: '' }
      if (opts.missing) return { status: 0, stdout: '', stderr: '' }
      const rel = args[4]
      return { status: 0, stdout: '100644 blob ' + 'e'.repeat(40) + String.fromCharCode(9) + rel + String.fromCharCode(0), stderr: '' }
    }
    if (args[0] === 'show') {
      if (opts.showFails) return { status: 1, stdout: '', stderr: 'fatal: path does not exist' }
      return { status: 0, stdout: opts.committedText != null ? opts.committedText : 'COMMITTED CONTENT\n', stderr: '' }
    }
    return { status: 1, stdout: '', stderr: 'unexpected' }
  }
  git.calls = calls
  return git
}

const propose = (over = {}, gitOpts = {}) => proposeWorkOrder(Object.assign({
  repositoryIdentity: { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' },
  proposal: { goal: 'update docs/a.md', candidateFile: 'docs/a.md', intendedChange: 'add a line' },
  mentionedFiles: ['docs/a.md'],
  repoRoot: '/fake/repo',
  gitRunner: fakeGit(gitOpts),
  newId: () => 'appr_test1'
}, over))

// ─── 1–5: the Work Order contract ───────────────────────────────────────────

test('1. expectedSha is REQUIRED by Work Order validation', () => {
  const wo = baseOrder()
  delete wo.expectedSha
  const r = validateWorkOrder(wo)
  assert.strictEqual(r.ok, false)
  assert.ok(r.errors.some((e) => /expectedSha/.test(e)), 'validation must name the missing field')
})

test('2. malformed / blank / short expectedSha fails closed', () => {
  for (const bad of ['', '   ', 'd05527e', SHA_A.toUpperCase(), SHA_A + 'a', SHA_A.slice(0, 39), 'z'.repeat(40), null, 42, {}]) {
    const r = validateWorkOrder(baseOrder({ expectedSha: bad }))
    assert.strictEqual(r.ok, false, `${JSON.stringify(bad)} must be refused`)
  }
  assert.strictEqual(validateWorkOrder(baseOrder()).ok, true, 'a full 40-char lowercase sha is accepted')
})

test('3. canonicalWorkOrder carries the FULL expectedSha', () => {
  const c = canonicalWorkOrder(baseOrder())
  assert.strictEqual(c.expectedSha, SHA_A)
  assert.strictEqual(c.expectedSha.length, 40, 'the canonical form must never hold an abbreviation')
})

test('4. changing ONLY expectedSha changes the Work Order hash', () => {
  const h1 = hashWorkOrder(baseOrder({ expectedSha: SHA_A }))
  const h2 = hashWorkOrder(baseOrder({ expectedSha: SHA_B }))
  assert.notStrictEqual(h1, h2, 'the revision must be inside the approval hash, not beside it')
})

test('5. projectId / repoFullName behaviour is unchanged', () => {
  const c = canonicalWorkOrder(baseOrder())
  assert.strictEqual(c.projectId, 'p1')
  assert.strictEqual(c.repoFullName, 'owner/name')
  assert.strictEqual(validateWorkOrder(baseOrder({ projectId: null })).ok, false)
  assert.strictEqual(validateWorkOrder(baseOrder({ repoFullName: 'not-a-pair' })).ok, false)
  // And no redundant repository field was introduced.
  assert.ok(!('repoTarget' in c), 'repoTarget must not exist — projectId + repoFullName already bind the repo')
})

// ─── 6: authority ───────────────────────────────────────────────────────────

test('6. a caller-supplied expectedSha CANNOT override the server-derived value', () => {
  const ATTACKER = 'a'.repeat(40)
  const out = propose({
    expectedSha: ATTACKER,
    proposal: { goal: 'update docs/a.md', candidateFile: 'docs/a.md', intendedChange: 'x', expectedSha: ATTACKER }
  }, { head: SHA_A })
  assert.strictEqual(out.ok, true, out.ok ? '' : JSON.stringify(out.errors))
  assert.strictEqual(out.workOrder.expectedSha, SHA_A, 'the sha must come from git, not from the caller')
  assert.notStrictEqual(out.workOrder.expectedSha, ATTACKER)
})

// ─── 7: the Owner's card ────────────────────────────────────────────────────

test('7. the card shows a revision derived from the canonical Work Order', () => {
  const card = buildApprovalView(baseOrder())
  const text = JSON.stringify(card)
  assert.ok(text.includes(SHA_A.slice(0, 12)), 'the abbreviated revision must appear on the card')
  assert.ok(!text.includes('/fake/repo'), 'no machine-local repo path may reach the Owner')
})

// ─── 8–13: the dirty gate ───────────────────────────────────────────────────

const DIRTY_CASES = [
  ['8. unstaged modification', ' M docs/a.md'],
  ['9. staged modification', 'M  docs/a.md'],
  ['10. deletion', ' D docs/a.md'],
  ['11. untracked file', '?? docs/a.md']
]
for (const [label, porcelain] of DIRTY_CASES) {
  test(`${label} in an allowedFile FAILS the seal`, () => {
    const out = propose({}, { head: SHA_A, dirtyOnce: porcelain + '\n' })
    assert.strictEqual(out.ok, false, 'an allowedFile that is not faithfully in the commit must refuse')
    assert.ok(JSON.stringify(out.errors).includes('docs/a.md'), 'the refusal must name the file')
  })
}

test('12. an unrelated dirty file OUTSIDE allowedFiles does NOT block sealing', () => {
  // This is not a nicety. Production deliberately carries an approved uncommitted override
  // in scripts/launcher/xiangxiang-body.ps1; a repository-wide clean check would refuse
  // every Work Order in this system forever.
  const git = fakeGit({ head: SHA_A })
  const out = proposeWorkOrder({
    repositoryIdentity: { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' },
    proposal: { goal: 'update docs/a.md', candidateFile: 'docs/a.md', intendedChange: 'x' },
    mentionedFiles: ['docs/a.md'],
    repoRoot: '/fake/repo',
    gitRunner: git,
    newId: () => 'appr_test2'
  })
  assert.strictEqual(out.ok, true, 'unrelated drift must not refuse the order')
  // The status query must be SCOPED — the pathspec is what keeps the launcher out of scope.
  const statusCall = git.calls.find((c) => c.startsWith('status'))
  assert.ok(statusCall.includes('--'), 'status must be scoped with a pathspec separator')
  assert.ok(statusCall.includes('docs/a.md'), 'status must be scoped to the allowed files')
})

test('13. a committed, clean allowedFile succeeds', () => {
  const out = propose({}, { head: SHA_A })
  assert.strictEqual(out.ok, true)
  assert.strictEqual(out.workOrder.expectedSha, SHA_A)
  assert.strictEqual(validateWorkOrder(out.workOrder).ok, true)
})

// ─── 14: excerpt authority ──────────────────────────────────────────────────

test('14. currentExcerpt comes from the expectedSha COMMIT, not the working tree', () => {
  const out = propose({}, { head: SHA_A, committedText: 'CONTENT AT COMMIT\n' })
  assert.strictEqual(out.ok, true)
  // trailing newline is preserved exactly as the previous working-tree reader did
  assert.strictEqual(out.workOrder.currentExcerpt.trim(), 'CONTENT AT COMMIT')
})

test('14b. the excerpt is read with git show at exactly expectedSha', () => {
  const git = fakeGit({ head: SHA_A })
  proposeWorkOrder({
    repositoryIdentity: { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' },
    proposal: { goal: 'update docs/a.md', candidateFile: 'docs/a.md', intendedChange: 'x' },
    mentionedFiles: ['docs/a.md'],
    repoRoot: '/fake/repo', gitRunner: git, newId: () => 'appr_test3'
  })
  const show = git.calls.find((c) => c.startsWith('show'))
  assert.ok(show, 'the excerpt must be read from a git object')
  assert.ok(show.includes(SHA_A + ':docs/a.md'), `excerpt must be read at expectedSha, got: ${show}`)
})

test('14c. an excerpt unavailable at that revision fails closed', () => {
  const out = propose({}, { head: SHA_A, showFails: true })
  assert.strictEqual(out.ok, false)
})

// ─── 15–16: nothing moved underneath the seal ───────────────────────────────

test('15. HEAD moving between the first and second capture FAILS closed', () => {
  const out = propose({}, { heads: [SHA_A, SHA_B] })
  assert.strictEqual(out.ok, false, 'a revision that moved mid-seal must not be sealed')
  assert.ok(JSON.stringify(out.errors).length > 0)
})

test('16. an allowedFile becoming dirty DURING capture fails closed', () => {
  const out = propose({}, { dirty: ['', ' M docs/a.md\n'] })
  assert.strictEqual(out.ok, false, 'the second cleanliness check must be a real gate, not decoration')
})

test('16b. an unreadable or malformed HEAD fails closed', () => {
  assert.strictEqual(propose({}, { headFails: true }).ok, false)
  assert.strictEqual(propose({}, { head: 'not-a-sha' }).ok, false)
  assert.strictEqual(propose({}, { statusFails: true }).ok, false)
})

// ─── 18: B2-B has not leaked in ─────────────────────────────────────────────

test('18. execution-time fields stay OUT of the sealed Work Order', () => {
  // This test previously also asserted that agentRunner and featureBranchWorkspace were
  // untouched. That was a SCOPE fence for B2-A, and B2-B has now deliberately crossed it —
  // keeping the assertion would only pin the tranche boundary, not a safety property.
  //
  // What is still worth pinning is the DIVISION: what the Owner approves is sealed and
  // hashed; what execution observes is measured at run time and belongs to the result and
  // the audit. An observed value inside the canonical order would mean the hash covered
  // something nobody could have read at approval time.
  const c = canonicalWorkOrder(baseOrder())
  for (const field of ['observedBaseSha', 'revisionMatch', 'endSha', 'patchSha256', 'repoTarget']) {
    assert.ok(!(field in c), `${field} is an execution fact and must never be sealed`)
  }
  assert.strictEqual(c.expectedSha, SHA_A, 'the approved revision IS sealed')
})

test('18b. endSha is never introduced anywhere', () => {
  // Committing is forbidden and the worker edits the working tree, so a clone HEAD does not
  // move during a normal run: an endSha would always equal the base and would look like
  // mutation evidence while carrying none. patchSha256 is the honest identity instead.
  for (const f of ['agentRunner.js', 'featureBranchWorkspace.js', 'audit.js', 'workOrder.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
    assert.ok(!/endSha/.test(src), `endSha must not appear in ${f}`)
  }
})

test('8b. the FIRST dirty check is its own gate, not shaded by the second', () => {
  // Dirty before capture, clean by the time the second check runs. Only the pre-capture gate
  // can catch this. Without it the Owner would be shown an excerpt from a commit that did not
  // describe the file at the moment he was asked to approve it — and the closing check, which
  // exists to catch a DIFFERENT failure (it changed underneath us), would report all clear.
  const out = propose({}, { dirty: [' M docs/a.md\n', ''] })
  assert.strictEqual(out.ok, false, 'a file already dirty at capture time must refuse')
  assert.ok(JSON.stringify(out.errors).includes('docs/a.md'))
})

// ─── PR #48 blocker: EXISTENCE IS NOT ENOUGH ────────────────────────────────
//
// `git cat-file -e <sha>:<path>` answers only "is there an object here". A DIRECTORY
// answers yes, and `git show` then returns a TREE LISTING — which would have been sealed
// into the hash and shown to the Owner as his file's 「現時內容」. A symlink and a submodule
// gitlink pass that same check just as happily.
//
// These tests drive the REAL committed-object reader against REAL git objects. The four
// entry types are built with `update-index --cacheinfo`, which writes genuine tree entries
// without needing OS symlink support or a real submodule.

const { spawnSync } = require('node:child_process')
const { readCommittedExcerpt, defaultGitRunner } = require('../agent/workOrderProducer')

const GITLINK_SHA = '1'.repeat(40)

function fixtureRepo () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-b2a-git-'))
  const g = (args, input) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', input, shell: false })
    if (r.status !== 0) throw new Error(args.join(' ') + ' -> ' + (r.stderr || r.status))
    return String(r.stdout || '')
  }
  g(['init', '-q'])
  g(['config', 'user.email', 'fixture@test'])
  g(['config', 'user.name', 'fixture'])

  const blob = g(['hash-object', '-w', '--stdin'], 'FILE CONTENT\n').trim()
  // A symlink's blob content is its TARGET path. If the reader ever followed it, this is
  // what it would chase.
  const linkBlob = g(['hash-object', '-w', '--stdin'], '../../etc/passwd').trim()

  g(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',regular.txt'])
  g(['update-index', '--add', '--cacheinfo', '100755,' + blob + ',executable.sh'])
  g(['update-index', '--add', '--cacheinfo', '120000,' + linkBlob + ',link.txt'])
  g(['update-index', '--add', '--cacheinfo', '160000,' + GITLINK_SHA + ',submodule'])
  g(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',nested/inner.txt'])

  const tree = g(['write-tree']).trim()
  const commit = g(['commit-tree', tree, '-m', 'fixture']).trim()
  return { dir, commit }
}

const REPO = fixtureRepo()
const readReal = (rel) => readCommittedExcerpt(defaultGitRunner, REPO.dir, REPO.commit, rel)

test('B1. a regular 100644 blob is accepted', () => {
  const r = readReal('regular.txt')
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(r.text.trim(), 'FILE CONTENT')
})

test('B2. a regular 100755 (executable) blob is accepted', () => {
  const r = readReal('executable.sh')
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(r.text.trim(), 'FILE CONTENT')
})

test('B3. a TREE (040000) fails closed — a directory listing is not file content', () => {
  const r = readReal('nested')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'not_a_file')
})

test('B4. a SYMLINK (120000) fails closed and is NOT followed', () => {
  const r = readReal('link.txt')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'not_a_file')
  assert.ok(!('text' in r), 'the link target must never be read as content')
})

test('B5. a GITLINK / submodule (160000 commit) fails closed', () => {
  const r = readReal('submodule')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'not_a_file')
})

test('B6. malformed, empty or multiple tree-entry output fails closed', () => {
  const say = (stdout, status = 0) => (args) =>
    args[0] === 'ls-tree' ? { status, stdout, stderr: '' } : { status: 0, stdout: 'X\n', stderr: '' }

  // ambiguous: two entries for one asked-about path
  const two = '100644 blob ' + 'a'.repeat(40) + '\tregular.txt\u0000100644 blob ' + 'b'.repeat(40) + '\tother.txt\u0000'
  assert.strictEqual(readCommittedExcerpt(say(two), '/r', 'c'.repeat(40), 'regular.txt').reason, 'committed_excerpt_unavailable')
  // unparseable
  assert.strictEqual(readCommittedExcerpt(say('garbage\u0000'), '/r', 'c'.repeat(40), 'regular.txt').reason, 'committed_excerpt_unavailable')
  // an entry for a DIFFERENT path than the one asked about
  const wrong = '100644 blob ' + 'a'.repeat(40) + '\tsomething-else.txt\u0000'
  assert.strictEqual(readCommittedExcerpt(say(wrong), '/r', 'c'.repeat(40), 'regular.txt').reason, 'committed_excerpt_unavailable')
  // an unexpected mode that is still a blob
  const oddMode = '100664 blob ' + 'a'.repeat(40) + '\tregular.txt\u0000'
  assert.strictEqual(readCommittedExcerpt(say(oddMode), '/r', 'c'.repeat(40), 'regular.txt').reason, 'not_a_file')
  // git itself failing
  assert.strictEqual(readCommittedExcerpt(say('', 1), '/r', 'c'.repeat(40), 'regular.txt').reason, 'committed_excerpt_unavailable')
})

test('B7. a missing committed path keeps the clear not-found semantics', () => {
  const r = readReal('does-not-exist.txt')
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'not_found', 'absent must stay distinguishable from unreadable')
})

test('B8. the excerpt still comes from expectedSha with the exact case-preserved path', () => {
  const git = fakeGit({ head: SHA_A })
  proposeWorkOrder({
    repositoryIdentity: { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' },
    proposal: { goal: 'update docs/Canary/Mixed.md', candidateFile: 'docs/Canary/Mixed.md', intendedChange: 'x' },
    mentionedFiles: ['docs/Canary/Mixed.md'],
    repoRoot: '/fake/repo', gitRunner: git, newId: () => 'appr_case1'
  })
  const ls = git.calls.find((c) => c.startsWith('ls-tree'))
  const show = git.calls.find((c) => c.startsWith('show'))
  assert.ok(ls.includes(SHA_A) && ls.includes('docs/Canary/Mixed.md'), `case must be preserved: ${ls}`)
  assert.ok(show.includes(SHA_A + ':docs/Canary/Mixed.md'), `excerpt must read at expectedSha: ${show}`)
})
