'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const { resolveTestPython, LEGACY_PYTHON } = require('./offlinePython.cjs')
const { createFixture, cleanEnvironment, verifyEnvironment } = require('./independentFixture.cjs')
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-python-seam-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const python = path.join(dir, 'python.exe'); fs.writeFileSync(python, 'synthetic pin control; never executed')
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(python)).digest('hex')
  return { dir, python, env: { NODE_TEST_CONTEXT: 'child-v8', R1_OFFLINE_TEST_MODE: '1', R1_OFFLINE_TEST_PYTHON: python, R1_OFFLINE_TEST_PYTHON_SHA256: sha256 } }
}
test('offline Python requires explicit Node test mode, absolute identity and exact hash', t => {
  const f = fixture(t)
  assert.deepEqual(resolveTestPython(f.env), { python: f.python, skip: false })
  for (const e of [{ ...f.env, NODE_TEST_CONTEXT: '' }, { ...f.env, R1_OFFLINE_TEST_MODE: '' },
    { ...f.env, R1_OFFLINE_TEST_PYTHON: 'python.exe' }, { ...f.env, R1_OFFLINE_TEST_PYTHON_SHA256: '' },
    { ...f.env, R1_OFFLINE_TEST_PYTHON_SHA256: '0'.repeat(64) },
    { ...f.env, R1_OFFLINE_TEST_PYTHON: 'C:\\Aroma\\hindsight-runtime\\Scripts\\python.exe' }]) {
    assert.throws(() => resolveTestPython(e), /r1_offline_python_/)
  }
})
test('missing or changed test interpreter fails rather than skipping or using production', t => {
  const f = fixture(t)
  fs.unlinkSync(f.python)
  assert.throws(() => resolveTestPython(f.env), /r1_offline_python_missing/)
  fs.writeFileSync(f.python, 'changed')
  assert.throws(() => resolveTestPython(f.env), /r1_offline_python_hash/)
})
test('ordinary non-test default retains the existing interpreter and missing-path skip', () => {
  const calls = [], io = { existsSync: p => { calls.push(p); return false } }
  assert.deepEqual(resolveTestPython({}, io), { python: LEGACY_PYTHON, skip: true })
  assert.deepEqual(calls, ['C:/Aroma/hindsight-runtime/Scripts/python.exe'])
  assert.deepEqual(resolveTestPython({}, { existsSync: () => true }), { python: LEGACY_PYTHON, skip: false })
})
test('all six mandatory Python entrypoints use only the test resolver without changing their assertions', () => {
  const root = path.resolve(__dirname, '../..')
  for (const [file, count] of [['scripts/memory/backupRecovery.test.js', 4], ['src/memory/indexRebuild.test.js', 1], ['src/memory/mailRows.test.js', 1]]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.equal((source.match(/spawnSync\(python,/g) || []).length, count)
    assert.equal((source.match(/\{ skip \}/g) || []).length, count)
    assert.match(source, /offlinePython\.cjs'\)\.resolveTestPython\(\)/)
    assert.equal(source.includes('C:/Aroma/'), false)
  }
})
test('aliased interpreter is refused even when its content hash would match', t => {
  const f = fixture(t)
  assert.throws(() => resolveTestPython(f.env, { ...fs, lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => true, nlink: 1 }) }), /r1_offline_python_alias/)
})
test('test settings never enter Independent operational child environment and are refused if injected', t => {
  const f = fixture(t), owned = createFixture(f.dir), child = cleanEnvironment(owned.root)
  for (const key of Object.keys(f.env)) assert.equal(Object.hasOwn(child, key), false)
  const before = { ...process.env }
  try {
    for (const k of Object.keys(process.env)) delete process.env[k]
    Object.assign(process.env, child); verifyEnvironment(owned.root)
    for (const k of ['R1_OFFLINE_TEST_MODE', 'R1_OFFLINE_TEST_PYTHON', 'R1_OFFLINE_TEST_PYTHON_SHA256']) {
      process.env[k] = f.env[k]
      assert.throws(() => verifyEnvironment(owned.root), /independent_clean_environment_required/)
      delete process.env[k]
    }
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k]
    Object.assign(process.env, before)
  }
})
