'use strict'

/**
 * closureWalk.js — what will actually run, followed across BOTH languages.
 *
 * ── THE HOLE THIS FILLS ────────────────────────────────────────────────────
 * The first closure walk followed JavaScript `require` and nothing else. It reported
 * "reached but not listed = 0" and that report was honest — but it was a statement about the
 * JS module graph, and a large part of what runs during a canary is not in the JS module graph.
 *
 * Measured on 2026-08-01, three PowerShell files executed in production and were covered by no
 * approval at all:
 *
 *   . aromaJsonTransport.ps1   dot-sourced by ALL THREE production .ps1 files. It decodes the
 *                              payload and encodes the answer. Whoever controls it controls
 *                              every result the Node side believes.
 *   . probe-machine.ps1        every preflight fact — the ACL, the folder, the Notepad count.
 *   . collect-identity.ps1     the identity attestation itself.
 *
 * `uiaCanary.ps1` WAS in the package while the transport library it dot-sources on line 41 was
 * not. So the approval covered the hands and not the nerves.
 *
 * None of this was a bug in the walk. It was a walk over the wrong graph, and a walk over the
 * wrong graph is the most convincing kind of wrong answer: it produces a zero.
 *
 * ── FOUR EDGE TYPES, ONE RULE ──────────────────────────────────────────────
 * Rather than four bespoke parsers, one rule covers all of them:
 *
 *   A FILE THAT NAMES ANOTHER REPO FILE HAS AN EDGE TO IT.
 *
 *   1. JS require        require('./machineProbe')      -> resolved as Node resolves it
 *   2. PS dot-source     . (Join-Path $PSScriptRoot 'aromaJsonTransport.ps1')
 *   3. runner script map SCRIPTS = { 'machine-probe': 'scripts/computer/probe-machine.ps1' }
 *   4. launcher -> node  & $Node (Join-Path $Root 'scripts\computer\operatorTools.js')
 *
 * (2), (3) and (4) are all the same phenomenon: a quoted string that names a file which exists.
 * Treating them uniformly means a NEW way of naming a file — a fifth mechanism nobody has
 * thought of yet — is caught by the rule that already exists, instead of needing a fifth parser
 * that nobody remembers to write.
 *
 * ── COMMENTS ARE STRIPPED FIRST ────────────────────────────────────────────
 * Four times in this project a scan has tripped over the prose explaining the very thing it
 * bans. A file name inside a comment is documentation, not an edge; counting it would make
 * writing the explanation down expensive.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 * It does not glob. The reached set is compared against an enumerated package list, and a file
 * that appears in the walk and not in the list FAILS rather than being absorbed. The point is to
 * make a person decide.
 */

const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')

/**
 * Where execution can begin. Every one of these is something a person or a screen starts
 * directly, so nothing upstream would ever name it.
 */
const ROOTS = Object.freeze([
  // the Owner's two screens, in his own session
  'scripts/computer/Owner-Approve.ps1',
  'scripts/computer/Owner-Execute.ps1',
  // the Owner-side engine those screens call
  'scripts/computer/run-notepad-canary.js',
  // the three things the operator can start in the operator's session
  'scripts/computer/Operator-CheckIdentity.ps1',
  'scripts/computer/Operator-CheckMachine.ps1',
  'scripts/computer/Operator-StartCompanion.ps1',
  // and the one-off that puts those three on the desktop. It creates no capability, but it
  // decides what the icons point at, so a change to it is a change to what the operator starts.
  'scripts/computer/Install-OperatorShortcuts.ps1'
])

/** Extensions that count as code for this purpose. */
const CODE_EXT = Object.freeze(['.js', '.ps1'])

/**
 * The two files whose string literals are the SUBJECT MATTER, not references.
 *
 * `executionPackage.js` holds the package list; this file holds the resolver's candidate names.
 * Without this exemption the walk followed the package list itself and reached every file on it
 * — so "reached but not listed = 0" became true by construction, and a listed-but-unreachable
 * orphan could never be detected again. A rule that reads its own answer sheet passes every time.
 *
 * Only the uniform "a quoted name is an edge" rule is suspended. A real `require` in either file
 * is still followed, because that is a reference and not a description of one.
 */
const MANIFEST_FILES = Object.freeze(['executionPackage.js', 'closureWalk.js'])

/** Strip JS comments — block first, then line, protecting `://` in URLs. */
function stripJs (src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Strip PowerShell comments — block first, then `#` to end of line.
 *
 * `#` inside a quoted string would be eaten too. That direction is safe: it can only cause an
 * edge to be MISSED if a path literal contains a `#`, and no path in this repo does. The
 * opposite mistake — counting a commented-out path as a live edge — would put files in the
 * package that cannot run, and dead weight in the package is how re-approval becomes a reflex.
 */
function stripPs (src) {
  return String(src).replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')
}

const stripFor = (file) => (file.endsWith('.ps1') ? stripPs : stripJs)

/** Every quoted string in the file, single or double quoted, without the quotes. */
function quotedLiterals (code) {
  const out = []
  for (const m of code.matchAll(/'([^'\r\n]*)'|"([^"\r\n]*)"/g)) {
    out.push(m[1] !== undefined ? m[1] : m[2])
  }
  return out
}

/**
 * Resolve a literal that might name a repo file.
 *
 * Tried relative to the naming file's own directory first (how `$PSScriptRoot` and `__dirname`
 * both behave), then relative to the repo root (how the runner's script map is written).
 * Anything that escapes the repo is not ours and is ignored.
 */
function resolveLiteral (fromFile, literal, repo) {
  const root = repo || REPO
  const s = String(literal).trim()
  if (!s || s.length > 200) return null
  if (!CODE_EXT.includes(path.extname(s).toLowerCase())) return null
  // A bare file name, a repo-relative path, or a Windows-style one. Absolute paths outside the
  // repo (C:\Windows\...\powershell.exe) fall out of the containment check below.
  const norm = s.split('\\').join(path.sep).split('/').join(path.sep)
  const bases = [path.dirname(fromFile), root]
  // THE STAGED LAYOUT, stated rather than guessed. deploy-companion.ps1 copies the modules it
  // needs to sit BESIDE companion-entry.js, so that file resolves `ipcChannel.js` from its own
  // directory at run time while the same name lives in src/computer in the repo. Without this
  // the edge is invisible here and the module runs unapproved — which is the exact failure
  // this walk exists to end, reappearing one layout down.
  if (path.dirname(fromFile) === path.join(root, 'scripts', 'computer')) {
    bases.push(path.join(root, 'src', 'computer'))
  }
  for (const base of bases) {
    const abs = path.resolve(base, norm)
    if (!abs.startsWith(root + path.sep)) continue
    try { if (fs.statSync(abs).isFile()) return abs } catch (_) { /* not this one */ }
  }
  return null
}

/** Every code file in the repo, by basename. Built once, used to judge unresolved names. */
function basenameIndex (repo) {
  const root = repo || REPO
  const found = new Set()
  const skip = new Set(['node_modules', '.git', '.aroma'])
  const walkDir = (dir) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of entries) {
      if (e.isDirectory()) { if (!skip.has(e.name)) walkDir(path.join(dir, e.name)); continue }
      if (CODE_EXT.includes(path.extname(e.name).toLowerCase())) found.add(e.name.toLowerCase())
    }
  }
  walkDir(root)
  return found
}

/**
 * A literal that names a code file which EXISTS in this repo — just not where the resolver
 * looked.
 *
 * That precise shape is how `ipcChannel.js` was missed on the first run of this walker: the name
 * was in the source, a file by that name was in the tree, the resolver did not connect them, and
 * the walk returned a clean zero. It is reported rather than skipped, because it is either a
 * broken reference or a layout the resolver does not know about, and both need a person.
 *
 * A name matching NO file in the tree is not reported. Those are strings like the `'index.js'`
 * candidate inside this very module's own resolver — a name being constructed, not a file being
 * referenced. Reporting them would make the check noisy, and a noisy check gets an exception
 * list, and an exception list is where the real one would eventually be filed.
 */
function isUnresolvedCodeLiteral (fromFile, literal, repo, index) {
  const s = String(literal).trim()
  if (!s || s.length > 200) return false
  if (!CODE_EXT.includes(path.extname(s).toLowerCase())) return false
  if (/[*?<>|]/.test(s)) return false // a pattern, not a name
  if (resolveLiteral(fromFile, s, repo) !== null) return false
  const base = path.basename(s.split('\\').join('/')).toLowerCase()
  return (index || basenameIndex(repo)).has(base)
}

/** Node-style resolution for a relative `require`. */
function resolveRequire (fromFile, spec) {
  if (!spec.startsWith('.')) return null // bare or builtin: not a repo file
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
    try { if (fs.statSync(cand).isFile()) return cand } catch (_) { /* next */ }
  }
  return null
}

/**
 * Every edge out of one file, with the kind of edge recorded.
 *
 * The kind is not decoration: the positive controls assert that EACH kind can independently
 * turn the closure test red, and a walker that quietly collapsed them into one would let three
 * of those controls pass vacuously.
 */
function edgesFrom (file, repo, index) {
  let raw
  try { raw = fs.readFileSync(file, 'utf8') } catch (_) { return [] }
  const code = stripFor(file)(raw)
  const edges = []
  const seen = new Set()
  const add = (abs, kind) => {
    if (!abs || seen.has(abs + kind)) return
    seen.add(abs + kind)
    edges.push({ to: abs, kind })
  }

  if (file.endsWith('.js')) {
    for (const m of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      add(resolveRequire(file, m[1]), 'js-require')
    }
  }
  if (file.endsWith('.ps1')) {
    // Dot-source, in any of the shapes this repo uses. Recorded as its own kind so the
    // positive control for it means something.
    for (const m of code.matchAll(/^\s*\.\s+(?:\(([^)]*)\)|(["'][^"'\r\n]*["']))/gm)) {
      for (const lit of quotedLiterals(m[1] || m[2] || '')) {
        add(resolveLiteral(file, lit, repo), 'ps-dot-source')
      }
    }
  }

  // The uniform rule, applied to both languages: a quoted literal naming a repo file is an
  // edge. In JS this is what catches the runner's frozen script-ID map; in PS it is what
  // catches a launcher naming the Node engine it starts.
  const unresolved = []
  if (MANIFEST_FILES.includes(path.basename(file))) { edges.unresolved = unresolved; return edges }
  for (const lit of quotedLiterals(code)) {
    const abs = resolveLiteral(file, lit, repo)
    if (abs) { if (abs !== file) add(abs, file.endsWith('.js') ? 'js-names-file' : 'ps-names-file'); continue }
    if (isUnresolvedCodeLiteral(file, lit, repo, index)) unresolved.push(String(lit).trim())
  }
  edges.unresolved = unresolved
  return edges
}

/**
 * The transitive reachable set from the given roots.
 *
 * @returns {{reached:Set<string>, edges:Array, roots:Array<string>}}
 */
function walk (opts = {}) {
  const repo = opts.repo || REPO
  const roots = (opts.roots || ROOTS).map((r) => path.resolve(repo, r.split('/').join(path.sep)))
  const index = basenameIndex(repo)
  const reached = new Set()
  const edges = []
  const unresolved = []
  const missingRoots = []
  const stack = []

  for (const r of roots) {
    let isFile = false
    try { isFile = fs.statSync(r).isFile() } catch (_) { isFile = false }
    if (isFile) { reached.add(r); stack.push(r) } else { missingRoots.push(r) }
  }
  while (stack.length) {
    const file = stack.pop()
    const out = edgesFrom(file, repo, index)
    for (const lit of (out.unresolved || [])) unresolved.push({ from: file, literal: lit })
    for (const e of out) {
      edges.push({ from: file, to: e.to, kind: e.kind })
      if (!reached.has(e.to)) { reached.add(e.to); stack.push(e.to) }
    }
  }
  return { reached, edges, unresolved, missingRoots, roots }
}

const relOf = (abs, repo) => path.relative(repo || REPO, abs).split(path.sep).join('/')

/** The reachable set as sorted repo-relative POSIX paths. */
function reachedPaths (opts = {}) {
  const repo = opts.repo || REPO
  return [...walk(opts).reached].map((a) => relOf(a, repo)).sort()
}

/** Edge kinds actually observed, for tests that assert the walk is really crossing languages. */
function edgeKinds (opts = {}) {
  const kinds = {}
  for (const e of walk(opts).edges) kinds[e.kind] = (kinds[e.kind] || 0) + 1
  return kinds
}

module.exports = {
  walk, reachedPaths, edgeKinds, edgesFrom,
  ROOTS, REPO, CODE_EXT, stripJs, stripPs, quotedLiterals, resolveLiteral, resolveRequire, relOf
}
