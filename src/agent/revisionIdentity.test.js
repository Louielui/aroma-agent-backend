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
    if (args[0] === 'cat-file') {
      return opts.showFails ? { status: 1, stdout: '', stderr: 'missing' } : { status: 0, stdout: '', stderr: '' }
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

test('18. no B2-B fields or runner enforcement were added', () => {
  const c = canonicalWorkOrder(baseOrder())
  for (const field of ['observedBaseSha', 'endSha', 'patchSha256', 'repoTarget']) {
    assert.ok(!(field in c), `${field} belongs to B2-B and must not be in B2-A`)
  }
  const runner = fs.readFileSync(path.join(__dirname, 'agentRunner.js'), 'utf8')
  assert.ok(!runner.includes('expectedSha'), 'agentRunner must be untouched in B2-A')
  const ws = fs.readFileSync(path.join(__dirname, 'featureBranchWorkspace.js'), 'utf8')
  assert.ok(!ws.includes('baseSha'), 'featureBranchWorkspace must be untouched in B2-A')
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
