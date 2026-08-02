'use strict'

/**
 * executionPackageClosure.test.js — the manifest must COVER the call path, not resemble it.
 *
 * ── WHAT THE PREVIOUS VERSION OF THIS FILE GOT WRONG ───────────────────────
 * It walked JavaScript `require` from one entrypoint and asserted "reached but not listed = 0".
 * That assertion was true. It was also a statement about the JS module graph, and three files
 * that run during every canary are not in the JS module graph:
 *
 *   aromaJsonTransport.ps1   dot-sourced by all three production .ps1 files
 *   probe-machine.ps1        every preflight fact
 *   collect-identity.ps1     the identity attestation itself
 *
 * `uiaCanary.ps1` was in the package; the transport it dot-sources on line 41 was not. A zero
 * from the wrong graph is the most convincing kind of wrong answer, because it looks exactly
 * like the right one.
 *
 * ── SO THE POSITIVE CONTROLS ARE PER EDGE TYPE ─────────────────────────────
 * One control proving "the rule can go red" would have passed happily for the whole period the
 * PowerShell half was invisible: the JS control worked perfectly. There is therefore one control
 * for EACH kind of edge — js-require, ps-dot-source, the runner's script-ID map, and a launcher
 * naming the tool it starts — each built in a temp repo, each asserted to turn the rule red on
 * its own. A category that cannot be shown to fail is a category nobody is checking.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PKG = require('../../scripts/computer/executionPackage')
const W = require('../../scripts/computer/closureWalk')

const REPO = path.resolve(__dirname, '..', '..')

/* ── the closure property ─────────────────────────────────────────────────── */

test('*** reached but not listed = 0 — across BOTH languages ***', () => {
  const r = W.walk({})
  assert.deepEqual(r.missingRoots.map((p) => W.relOf(p)), [], 'every declared root exists')

  const listed = new Set(PKG.PACKAGE_FILES)
  const missing = [...r.reached].map((f) => W.relOf(f)).filter((p) => !listed.has(p)).sort()
  assert.deepEqual(missing, [],
    'these files run in production and are not in PACKAGE_FILES:\n  ' + missing.join('\n  '))
})

test('*** the walk really crossed both languages — every edge type is present ***', () => {
  // Without this, a walker that silently stopped following PowerShell would report zero gaps
  // again, exactly as the previous one did.
  const kinds = W.edgeKinds({})
  for (const k of ['js-require', 'js-names-file', 'ps-dot-source', 'ps-names-file']) {
    assert.ok(kinds[k] > 0, 'no ' + k + ' edges were followed: ' + JSON.stringify(kinds))
  }
})

test('*** the three PowerShell files that were uncovered are covered now ***', () => {
  // Named individually rather than counted. These are the actual files the previous walk missed,
  // and a count would go green again the moment three different ones took their place.
  for (const p of [
    'scripts/computer/aromaJsonTransport.ps1',
    'scripts/computer/probe-machine.ps1',
    'scripts/computer/collect-identity.ps1'
  ]) {
    assert.ok(PKG.PACKAGE_FILES.includes(p), 'must be in the package: ' + p)
  }
  // And they are there because the WALK found them, not because somebody typed them in: each is
  // genuinely reachable from a root.
  const reached = new Set([...W.walk({}).reached].map((f) => W.relOf(f)))
  assert.ok(reached.has('scripts/computer/aromaJsonTransport.ps1'), 'reached by dot-source')
  assert.ok(reached.has('scripts/computer/probe-machine.ps1'), 'reached through the script-ID map')
  assert.ok(reached.has('scripts/computer/collect-identity.ps1'), 'reached through the script-ID map')
})

test('*** an unresolved file name is a failure, not a silent skip ***', () => {
  // A name that looks like a file and resolves to nothing is either a broken reference or a
  // layout the resolver does not know about. `ipcChannel.js` was exactly that on the first run
  // of this walker: the name was in the source, the resolver missed it, and the walk returned a
  // clean zero.
  const r = W.walk({})
  assert.deepEqual(r.unresolved.map((u) => W.relOf(u.from) + ' -> ' + u.literal), [],
    'these names look like repo files and resolve to nothing')
})

/* ── one positive control per edge type ───────────────────────────────────── */

/** A throwaway repo with a root and whatever files a control needs. */
function sandbox (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-closure-'))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel.split('/').join(path.sep))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }
  return dir
}

/** What the rule would report, given a package list that omits the sneaked-in file. */
function missingUnder (dir, roots, listed) {
  // The walker resolves against its own REPO constant, so the control runs the same code with
  // an explicit repo root: `walk` takes one.
  const r = W.walk({ repo: dir, roots })
  const have = new Set(listed)
  return [...r.reached].map((f) => path.relative(dir, f).split(path.sep).join('/')).filter((p) => !have.has(p)).sort()
}

test('*** POSITIVE CONTROL 1/4 — a JS require that is not listed turns it RED ***', () => {
  const dir = sandbox({
    'entry.js': "require('./listed.js'); require('./sneaked.js')\n",
    'listed.js': '// listed\n',
    'sneaked.js': '// nobody registered me\n'
  })
  assert.deepEqual(missingUnder(dir, ['entry.js'], ['entry.js', 'listed.js']), ['sneaked.js'])
})

test('*** POSITIVE CONTROL 2/4 — a PowerShell DOT-SOURCE that is not listed turns it RED ***', () => {
  // The one that was missing. aromaJsonTransport.ps1 hid here for the entire life of the
  // previous walker.
  const dir = sandbox({
    'root.ps1': ". (Join-Path $PSScriptRoot 'helper.ps1')\nWrite-Host 'hi'\n",
    'helper.ps1': "function Write-Thing { }\n"
  })
  assert.deepEqual(missingUnder(dir, ['root.ps1'], ['root.ps1']), ['helper.ps1'])
})

test('*** POSITIVE CONTROL 3/4 — a runner SCRIPT-ID MAP entry that is not listed turns it RED ***', () => {
  // A JS file naming a .ps1 it will execute. This is the shape of powershellJsonRunner's frozen
  // map, which is how probe-machine.ps1 and collect-identity.ps1 get run.
  const dir = sandbox({
    'entry.js': "const SCRIPTS = { 'probe': 'tools/probe.ps1' }\nmodule.exports = SCRIPTS\n",
    'tools/probe.ps1': "Write-Host 'probing'\n"
  })
  assert.deepEqual(missingUnder(dir, ['entry.js'], ['entry.js']), ['tools/probe.ps1'])
})

test('*** POSITIVE CONTROL 4/4 — a LAUNCHER naming the tool it starts turns it RED ***', () => {
  // A .ps1 starting a fixed .js file: the shape of the three operator launchers.
  const dir = sandbox({
    'Launcher.ps1': "& 'C:\\node.exe' (Join-Path $PSScriptRoot 'tool.js')\n",
    'tool.js': "console.log('tool')\n"
  })
  assert.deepEqual(missingUnder(dir, ['Launcher.ps1'], ['Launcher.ps1']), ['tool.js'])
})

test('*** the four controls are not the same control wearing four hats ***', () => {
  // Each control must exercise a DIFFERENT edge kind. Four copies of the JS control would pass
  // the four tests above and prove one thing.
  const cases = [
    [sandbox({ 'entry.js': "require('./x.js')\n", 'x.js': '\n' }), ['entry.js'], 'js-require'],
    [sandbox({ 'r.ps1': ". (Join-Path $PSScriptRoot 'h.ps1')\n", 'h.ps1': '\n' }), ['r.ps1'], 'ps-dot-source'],
    [sandbox({ 'e.js': "const S = { a: 'p.ps1' }\n", 'p.ps1': '\n' }), ['e.js'], 'js-names-file'],
    [sandbox({ 'L.ps1': "& 'node' (Join-Path $PSScriptRoot 't.js')\n", 't.js': '\n' }), ['L.ps1'], 'ps-names-file']
  ]
  for (const [dir, roots, kind] of cases) {
    const kinds = W.edgeKinds({ repo: dir, roots })
    assert.ok(kinds[kind] > 0, 'control did not produce a ' + kind + ' edge: ' + JSON.stringify(kinds))
  }
})

test('a comment naming a file is documentation, not an edge', () => {
  // Four times in this project a scan has tripped over the prose explaining the thing it bans.
  const dir = sandbox({
    'entry.js': "// see ./mentioned.js for why\n/* also ./mentioned.js */\nconsole.log(1)\n",
    'mentioned.js': '\n',
    'r.ps1': "# starts helper.ps1 one day\nWrite-Host 'x'\n",
    'helper.ps1': '\n'
  })
  assert.deepEqual(missingUnder(dir, ['entry.js'], ['entry.js']), [], 'a JS comment creates no edge')
  assert.deepEqual(missingUnder(dir, ['r.ps1'], ['r.ps1']), [], 'a PowerShell comment creates no edge')
})

/* ── the other direction ──────────────────────────────────────────────────── */

test('the manifest has no entries that are neither reachable nor declared', () => {
  // Dead weight means approvals get invalidated by edits to files that cannot affect a run,
  // which is how re-approval becomes a reflex.
  const reached = new Set([...W.walk({}).reached].map((f) => W.relOf(f)))
  const DECLARED_UNREACHABLE = [
    // Data, not code: the walk follows .js and .ps1 only.
    'docs/governance/canary-work-order-2step.draft.json',
    // Consulted through the gate's injected killSwitch option rather than by name.
    'src/computer/killSwitch.js',
    // The two files that DEFINE what is covered. Neither is required by production, and leaving
    // them out would mean the list and the walk that checks it are the only things the package
    // hash does not protect — a rule that cannot notice its own weakening.
    'scripts/computer/executionPackage.js',
    'scripts/computer/closureWalk.js',
    // NEWLY ORPHANED, 2026-08-01, and named here rather than quietly dropped.
    //
    // This was the Owner side's flag-gated way into the executor. The Owner side no longer runs
    // anything — the `run` verb is gone and it writes a request instead — and the Companion
    // assembles its own parts through companionProductionFactory. So nothing reaches this file.
    //
    // It is kept IN the package (a change to it still moves the hash) but recorded as an orphan
    // rather than treated as live. Deleting it is the right end state and is a separate
    // decision: computerOperatorWiring.test.js is where the "flag off, and the acting modules
    // are never even loaded" property is proven, and that evidence should not be thrown away as
    // a side effect of a wiring change.
    'src/computer/computerOperatorWiring.js',
    // RESERVED, not orphaned by accident. sessionBoundary.js holds the legacy pipe vocabulary
    // and its envelope contract. It reserves the names canary_execute / canary_outcome so the
    // directory transport and the pipe cannot collide on one name -- a shared REGISTRY, not a
    // shared wire. deprecationBoundaries.test.js asserts production producer count = 0 and
    // consumer count = 0, so the reservation cannot become a channel. Scheduled for removal
    // from the pipe vocabulary after G3 and before the final Owner Approval.
    'src/computer/sessionBoundary.js'
  ]
  const orphans = PKG.PACKAGE_FILES.filter((p) => !reached.has(p) && !DECLARED_UNREACHABLE.includes(p))
  assert.deepEqual(orphans, [], 'listed but unreachable and undeclared: ' + orphans.join(', '))
})

/* ── self-coverage ────────────────────────────────────────────────────────── */

test('*** both rule-defining files are inside their own manifest ***', () => {
  assert.ok(PKG.PACKAGE_FILES.includes('scripts/computer/executionPackage.js'))
  assert.ok(PKG.PACKAGE_FILES.includes('scripts/computer/closureWalk.js'),
    'the walk decides the list, so weakening the walk must move the package hash')
})

test('*** self-coverage is not circular: editing either file MOVES the hash ***', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-selfhash-'))
  for (const p of PKG.PACKAGE_FILES) {
    const src = path.join(REPO, p.split('/').join(path.sep))
    const dst = path.join(dir, p.split('/').join(path.sep))
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
  let previous = PKG.computePackageHash(dir)
  assert.match(previous, /^[0-9a-f]{64}$/)
  assert.equal(PKG.computePackageHash(dir), previous, 'stable — it never reads its own output')

  for (const self of ['scripts/computer/executionPackage.js', 'scripts/computer/closureWalk.js']) {
    fs.appendFileSync(path.join(dir, self.split('/').join(path.sep)), '\n// one byte of drift\n')
    const after = PKG.computePackageHash(dir)
    assert.notEqual(after, previous, 'editing ' + self + ' must move the package hash')
    previous = after
  }
})

test('the hash is over file bytes, never over its own output', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'computer', 'executionPackage.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(code, /EXPECTED_PACKAGE_HASH|computePackageHash\s*\(\s*\)\s*[=!]==/,
    'no self-referential expected value')
  assert.match(code, /createHash\('sha256'\)\.update\(fs\.readFileSync/, 'per-file hash is over bytes read from disk')
})

test('every listed file exists on disk', () => {
  const m = PKG.buildManifest()
  assert.deepEqual(m.missing, [])
  assert.equal(m.files.length, PKG.PACKAGE_FILES.length)
})
