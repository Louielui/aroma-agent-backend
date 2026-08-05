'use strict'

/**
 * dataDir.test.js — M-3: the test suite was writing to the Owner's real store.
 *
 * `AROMA_DATA_DIR || path.resolve(__dirname, '../../data')` appeared in FOUR modules, so any
 * process that required one of them and did not set the variable wrote to production. The
 * test suite is exactly such a process.
 *
 * MEASURED, not suspected. Of 12,125 llm_usage rows in the live truth store:
 *
 *     4,768  spy          3,465  f          2,596  fake
 *       264  m              201  other test fixtures
 *       831  claude-haiku-4-5-20251001   ← the only real rows
 *
 * 93% of the largest collection in the Owner's operational truth store was written by tests.
 * The same root cause put 25 real records there via the differential harness in an earlier
 * round, where the Owner ruled: fix the default first, decide about the history after.
 *
 * ── WHY THIS IS BEING FIXED NOW, BEFORE THE AUDIT WORK ───────────────────────
 * Owner ruling: 「a test suite that manufactures fake governance decisions is worse than one
 * that manufactures fake metering, and I will not land the audit work on top of a store that
 * tests still write to.」 Approval events are about to move into this store. Fake metering is
 * noise; fake approvals would be a corrupted governance record.
 *
 * ── REDIRECT, NOT THROW ─────────────────────────────────────────────────────
 * A test process with no AROMA_DATA_DIR gets a per-process temp directory and a loud
 * warning. Throwing would have been more fail-closed but would break every test that merely
 * REQUIRES a store module without writing, turning a safety fix into a suite rewrite. The
 * dangerous operation is the write, and after this there is nowhere for it to land.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const { resolveDataDir, isTestProcess, PRODUCTION_DIR } = require('./dataDir')

/* ═══ 1. THE EXPLICIT VALUE ALWAYS WINS ══════════════════════════════════ */

test('an explicit AROMA_DATA_DIR is used verbatim, test process or not', () => {
  assert.equal(resolveDataDir({ AROMA_DATA_DIR: 'C:/somewhere' }), 'C:/somewhere')
  assert.equal(resolveDataDir({ AROMA_DATA_DIR: 'C:/somewhere', NODE_TEST_CONTEXT: 'child-v8' }), 'C:/somewhere')
})

/* ═══ 2. A TEST PROCESS NEVER REACHES PRODUCTION ═════════════════════════ */

test('*** a test process with no AROMA_DATA_DIR does NOT get the production dir ***', () => {
  const dir = resolveDataDir({ NODE_TEST_CONTEXT: 'child-v8' })
  assert.notEqual(path.resolve(dir), path.resolve(PRODUCTION_DIR))
})

test('*** THIS process — the real one running these tests — is not pointed at production ***', () => {
  // The end-to-end statement. If this fails, the suite is writing to the Owner's store right
  // now, whatever the unit tests above say.
  const dir = resolveDataDir()
  assert.notEqual(path.resolve(dir), path.resolve(PRODUCTION_DIR),
    'the suite is still resolving to the real store')
})

test('the redirect is stable within a process — four modules must agree', () => {
  // store.js, conversationStore.js, coo/proposal.js and run/store.js each resolve this. If
  // they got different temp dirs, a test writing through one and reading through another
  // would see an empty store and the disagreement would look like a bug in the code.
  const a = resolveDataDir({ NODE_TEST_CONTEXT: 'child-v8' })
  const b = resolveDataDir({ NODE_TEST_CONTEXT: 'child-v8' })
  assert.equal(a, b)
})

test('the redirect directory actually exists and is writable', () => {
  const dir = resolveDataDir({ NODE_TEST_CONTEXT: 'child-v8' })
  const probe = path.join(dir, 'writable.probe')
  fs.writeFileSync(probe, 'x')
  assert.equal(fs.readFileSync(probe, 'utf8'), 'x')
  fs.unlinkSync(probe)
})

/* ═══ 3. DETECTION — the whole fix rests on this ═════════════════════════ */

test('*** node --test is detected by the variable NODE ITSELF sets ***', () => {
  // NODE_TEST_CONTEXT='child-v8' is set by the node:test runner in the child process,
  // verified empirically rather than assumed from documentation.
  assert.equal(isTestProcess({ NODE_TEST_CONTEXT: 'child-v8' }, [], null), true)
  assert.equal(isTestProcess({}, ['node', '--test', 'x'], null), true, 'the runner process itself')
  assert.equal(isTestProcess({}, [], 'C:/x/foo.test.js'), true, 'node foo.test.js directly')
  assert.equal(isTestProcess({}, [], 'C:/x/server.js'), false, 'the real server must NOT be redirected')
  assert.equal(isTestProcess({}, [], null), false)
})

test('*** the live server still gets production — this must not break the real process ***', () => {
  assert.equal(path.resolve(resolveDataDir({}, [], 'C:/Aroma/aroma-agent-backend/src/index.js')),
    path.resolve(PRODUCTION_DIR))
})

/* ═══ 4. ALL FOUR MODULES USE THE ONE RESOLVER ══════════════════════════ */

test('*** no module still computes the data dir for itself ***', () => {
  // The defect was one line copied into four files. Fixing three of them would leave the
  // fourth writing to production, and nothing would say which.
  const files = ['store/store.js', 'store/conversationStore.js', 'coo/proposal.js', 'run/store.js']
  const offenders = []
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
    if (/AROMA_DATA_DIR\s*\|\|/.test(src)) offenders.push(f)
    if (!/require\(.*dataDir.*\)/.test(src)) offenders.push(f + ' (does not use the shared resolver)')
  }
  assert.deepEqual(offenders, [])
})

test('a warning is emitted so the redirect is never silent', () => {
  const warned = []
  const orig = console.warn
  console.warn = (...a) => warned.push(a.join(' '))
  try {
    resolveDataDir({ NODE_TEST_CONTEXT: 'child-v8', AROMA_DATA_DIR_WARN_RESET: '1' }, [], null, { forceWarn: true })
  } finally { console.warn = orig }
  assert.equal(warned.length, 1, JSON.stringify(warned))
  assert.ok(/AROMA_DATA_DIR/.test(warned[0]), warned[0])
})
