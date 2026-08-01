'use strict'

/**
 * executionPackageClosure.test.js — the manifest must COVER the call path, not resemble it.
 *
 * The first PACKAGE_FILES list was written by hand from what looked relevant. A transitive
 * `require` walk from the fixed entrypoint then found SIX modules that reach production and were
 * not on it — including the audit sink, the directory resolver that decides where records go,
 * and the manifest module itself. Each of them could change what runs or what gets recorded, so
 * an approval that did not cover them covered less than it appeared to.
 *
 * So the walk is the authority and the list is what the walk checks. A second hand-written list
 * inside this file would reproduce the original mistake in a new place — it would agree with
 * whatever the author believed twice, and with the code never.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PKG = require('../../scripts/computer/executionPackage')

const REPO = path.resolve(__dirname, '..', '..')
const ENTRYPOINT = path.join(REPO, 'scripts', 'computer', 'run-notepad-canary.js')

/** Follow every relative `require` from a file, transitively. Comments stripped first. */
function reachableFrom (entry) {
  const seen = new Set()
  const reached = new Set()
  const walk = (file) => {
    const real = path.resolve(file)
    if (seen.has(real)) return
    seen.add(real)
    let code
    try { code = fs.readFileSync(real, 'utf8') } catch (_) { return }
    code = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const m of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1]
      if (!spec.startsWith('.')) continue // bare/builtin: not a repo file
      const base = path.resolve(path.dirname(real), spec)
      for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { reached.add(cand); walk(cand); break }
      }
    }
  }
  walk(entry)
  return reached
}

const rel = (abs) => path.relative(REPO, abs).split(path.sep).join('/')

/* ── the closure property ─────────────────────────────────────────────────── */

test('*** reached but not listed = 0 — the manifest covers the whole call path ***', () => {
  const listed = new Set(PKG.PACKAGE_FILES.map((p) => path.resolve(REPO, p)))
  const reached = reachableFrom(ENTRYPOINT)

  const missing = [...reached].filter((f) => !listed.has(f)).map(rel).sort()
  assert.deepEqual(missing, [],
    'these modules run in production and are not in PACKAGE_FILES:\n  ' + missing.join('\n  '))

  // The walk must actually have walked. A broken walker returning nothing would make the
  // assertion above trivially true — the vacuous pass this project keeps hunting.
  assert.ok(reached.size >= 10, 'the walk reached ' + reached.size + ' modules, which is too few to be real')
  assert.ok([...reached].some((f) => rel(f) === 'src/computer/desktopAdapter.js'), 'it reached the adapter')
  assert.ok([...reached].some((f) => rel(f) === 'src/store/artifactStore.js'), 'and the audit sink')
})

test('*** POSITIVE CONTROL — a new module on the call path turns this test RED ***', () => {
  // Without this, "missing = 0" could mean the rule cannot detect anything. It is exercised
  // against a temp copy of the repo, so the real tree is never touched.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-closure-'))
  const mk = (rp, body) => {
    const abs = path.join(sandbox, rp.split('/').join(path.sep))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
    return abs
  }
  const entry = mk('entry.js', "require('./listed.js'); require('./sneaked.js')\n")
  mk('listed.js', '// listed\n')
  mk('sneaked.js', '// nobody registered me\n')

  const reached = reachableFrom(entry)
  const listedOnly = new Set([path.join(sandbox, 'listed.js')])
  const missing = [...reached].filter((f) => !listedOnly.has(f)).map((f) => path.basename(f))
  assert.deepEqual(missing, ['sneaked.js'], 'the rule catches an unregistered module')
})

test('the manifest has no entries that are neither reachable nor a known non-JS artefact', () => {
  // The other direction: dead weight in the list means approvals get invalidated by edits to
  // files that cannot affect a run, which is how re-approval becomes a reflex.
  const reached = reachableFrom(ENTRYPOINT)
  const reachedRel = new Set([...reached].map(rel))
  const NON_JS_BY_DESIGN = [
    'scripts/computer/Owner-Approve.ps1',
    'scripts/computer/Owner-Execute.ps1',
    'scripts/computer/uiaCanary.ps1',
    'docs/governance/canary-work-order.draft.json',
    'scripts/computer/run-notepad-canary.js', // the entry itself, not a require target
    'src/computer/killSwitch.js', // consulted through the gate's injected killSwitch option
    // Reachable only from the COMPANION side. The Owner entrypoint cannot walk to these, which
    // is the architecture ruling working — but they are packaged because they decide what runs.
    //
    // The first version of this list also named the adapter, the executor, the runner, the probe
    // and the factory. That was WRONG: the walk shows all five ARE reachable from the entrypoint
    // today, through the flag-gated wiring. Listing them here would have excused a genuine
    // orphan later, so the list is trimmed to the three that are actually unreachable.
    'src/computer/executeRequestStore.js',
    'src/computer/companionCanaryRunner.js',
    'src/computer/identityAttestation.js'
  ]
  const orphans = PKG.PACKAGE_FILES.filter((p) => !reachedRel.has(p) && !NON_JS_BY_DESIGN.includes(p))
  assert.deepEqual(orphans, [], 'listed but unreachable and undeclared: ' + orphans.join(', '))
})

/* ── self-coverage ────────────────────────────────────────────────────────── */

test('*** executionPackage.js is inside its own manifest ***', () => {
  assert.ok(PKG.PACKAGE_FILES.includes('scripts/computer/executionPackage.js'),
    'the file that defines the list must be covered by the list, or the list is the one thing it does not protect')
})

test('*** self-coverage is not circular: editing the file MOVES the hash ***', () => {
  // The claim in the header, tested rather than argued. A temp repo with the real files, then
  // one byte changed in executionPackage.js itself.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-selfhash-'))
  for (const p of PKG.PACKAGE_FILES) {
    const src = path.join(REPO, p.split('/').join(path.sep))
    const dst = path.join(sandbox, p.split('/').join(path.sep))
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }

  const before = PKG.computePackageHash(sandbox)
  assert.match(before, /^[0-9a-f]{64}$/)
  assert.equal(PKG.computePackageHash(sandbox), before, 'stable — it converges immediately, because it never reads its own output')

  const self = path.join(sandbox, 'scripts', 'computer', 'executionPackage.js')
  fs.appendFileSync(self, '\n// one byte of drift\n')
  const after = PKG.computePackageHash(sandbox)

  assert.notEqual(after, before, 'editing the manifest file must move the package hash')
  assert.equal(PKG.computePackageHash(sandbox), after, 'and the new value is stable too')
})

test('the hash is over file bytes, never over its own output', () => {
  // The structural reason there is no fixed point to solve: nothing in the module reads the
  // hash it produces, and no expected value is stored inside it.
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'computer', 'executionPackage.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(code, /EXPECTED_PACKAGE_HASH|computePackageHash\s*\(\s*\)\s*[=!]==/,
    'no self-referential expected value')
  assert.match(code, /createHash\('sha256'\)\.update\(fs\.readFileSync/, 'per-file hash is over bytes read from disk')
})

/* ── the six that were missing ────────────────────────────────────────────── */

test('*** the six modules found by the walk are now covered ***', () => {
  for (const p of [
    'scripts/computer/executionPackage.js',
    'src/store/artifactStore.js',
    'src/runtime/artifactDir.js',
    'src/computer/companion.js',
    'src/computer/sessionBoundary.js',
    'src/computer/observation.js'
  ]) {
    assert.ok(PKG.PACKAGE_FILES.includes(p), 'must be in the package: ' + p)
  }
  const m = PKG.buildManifest()
  assert.deepEqual(m.missing, [], 'and all of them exist on disk')
  assert.equal(m.files.length, PKG.PACKAGE_FILES.length)
})
