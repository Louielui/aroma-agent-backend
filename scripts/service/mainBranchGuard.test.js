'use strict'

/**
 * mainBranchGuard.test.js — AN UNATTENDED SERVICE MAY NOT SERVE WHATEVER IS CHECKED OUT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE RISK THIS CLOSES.
 *
 * The production repo is a working tree, and it gets parked on feature branches during
 * development. The interactive launcher already refuses to start off `main`; a boot-time service
 * that did not would answer the Owner from unreviewed code, automatically, with a bootCommit
 * nobody chose — and, being unattended, would do it without anyone noticing.
 *
 * ⛔ AND IT REPAIRS NOTHING. On 2026-08-19 the same guard on the launcher turned a reboot into a
 * 1h46m outage because the repo was parked off main. The lesson recorded then was 「put the tree
 * back as part of finishing」, NOT 「let the guard fix it」. A service that checked out or reset
 * the Owner's working tree could destroy work; refusing cannot.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test scripts/service/mainBranchGuard.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { REQUIRED_REF, BRANCH_STATE, checkMainBranch, branchGuardReport } = require('./mainBranchGuard')
const entry = require('./xiangxiang-service-entry')

/** A fixture HEAD, without touching any real repository. */
const withHead = (text) => ({ exists: () => true, readFile: () => text })
const CREDS = { ANTHROPIC_API_KEY: 'a', HUB_TOKEN: 'b', CLAUDE_CHAT_MODEL: 'c' }

describe('the branch guard admits main and nothing else', () => {
  test('*** ⛔ ONLY refs/heads/main IS ADMITTED ***', () => {
    assert.equal(REQUIRED_REF, 'refs/heads/main')
    const r = checkMainBranch('R', withHead('ref: refs/heads/main\n'))
    assert.equal(r.ok, true)
    assert.equal(r.state, BRANCH_STATE.ON_MAIN)
  })

  test('*** ⛔ A FEATURE BRANCH IS REFUSED, AND NAMED ***', () => {
    for (const ref of ['refs/heads/feat/runtime-service-v2', 'refs/heads/main-backup', 'refs/heads/mainline']) {
      const r = checkMainBranch('R', withHead('ref: ' + ref))
      assert.equal(r.ok, false, '⛔ admitted ' + ref)
      assert.equal(r.state, BRANCH_STATE.NOT_MAIN)
      assert.equal(r.ref, ref, 'the Owner is told which branch, so he can fix it himself')
    }
  })

  test('*** ⛔ A DETACHED HEAD IS ITS OWN STATE, NOT 「not main」 ***', () => {
    // A 40-hex HEAD may well BE main's current commit, and it is still refused: the service must
    // follow a branch that keeps moving, not a commit that matched once. Calling it 「not main」
    // would make the log lie about why it stopped.
    const r = checkMainBranch('R', withHead('a'.repeat(40)))
    assert.equal(r.ok, false)
    assert.equal(r.state, BRANCH_STATE.DETACHED)
  })

  test('*** ⛔ MISSING, UNREADABLE AND MALFORMED ALL REFUSE ***', () => {
    assert.equal(checkMainBranch('R', { exists: () => false }).state, BRANCH_STATE.HEAD_MISSING)
    const unreadable = checkMainBranch('R', { exists: () => true, readFile: () => { throw new Error('EACCES C:/some/path') } })
    assert.equal(unreadable.ok, false)
    assert.equal(unreadable.state, BRANCH_STATE.HEAD_UNREADABLE)
    for (const bad of ['', '   ', 'garbage', 'ref:', 'ref: nonsense', 'refs/heads/main']) {
      const r = checkMainBranch('R', withHead(bad))
      assert.equal(r.ok, false, '⛔ admitted malformed HEAD: ' + JSON.stringify(bad))
    }
  })

  test('*** ⛔ IT NEVER CHECKS OUT, RESETS OR REPAIRS ***', () => {
    const code = fs.readFileSync(path.join(__dirname, 'mainBranchGuard.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const banned of ['checkout', 'reset', 'exec', 'spawn', 'writeFile', 'child_process']) {
      assert.equal(code.includes(banned), false, '⛔ the guard can modify the tree: ' + banned)
    }
  })

  test('*** ⛔ THE REPORT CARRIES A STATE AND A REF, NEVER AN EXCEPTION ***', () => {
    const line = branchGuardReport(checkMainBranch('R', { exists: () => true, readFile: () => { throw new Error('EACCES C:/secret/path') } }))
    assert.equal(line.includes('EACCES'), false, '⛔ a raw exception reached the log')
    assert.equal(line.includes('secret'), false, '⛔ a path reached the log')
    assert.match(line, /state=head_unreadable/)
  })
})

describe('the guard runs before anything else can excuse it', () => {
  const base = { resolveRepo: () => ({ root: 'R', entry: 'R/src/index.js' }), log () {}, error () {}, chdir () {} }
  const run = (env, deps) => {
    try { entry.main(env, Object.assign({}, base, deps)); return null } catch (x) { return x.message }
  }

  test('*** ⛔ PERFECT CREDENTIALS DO NOT RESCUE A TREE THAT IS OFF MAIN ***', () => {
    for (const state of ['not_main', 'detached_head', 'head_missing', 'head_unreadable', 'head_malformed']) {
      const msg = run(Object.assign({}, CREDS),
        { checkMainBranch: () => ({ ok: false, state, ref: null }), start () { throw new Error('the server was started') } })
      assert.ok(msg && msg.includes('not on main'), '⛔ started on ' + state)
      assert.ok(msg.includes(state), 'the refusal names the state')
      assert.ok(msg.includes('Nothing was checked out'), 'and says plainly that it repaired nothing')
    }
  })

  test('on main with everything present, it proceeds to the application', () => {
    let started = null
    const msg = run(Object.assign({}, CREDS), {
      checkMainBranch: () => ({ ok: true, state: 'on_main', ref: 'refs/heads/main' }),
      start: (e) => { started = e; return 'ok' }
    })
    assert.equal(msg, null, 'no refusal')
    assert.equal(started, 'R/src/index.js', 'the ordinary production entrypoint')
  })
})
