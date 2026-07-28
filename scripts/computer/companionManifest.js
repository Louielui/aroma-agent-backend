'use strict'

/**
 * companionManifest.js — what the staged Companion actually needs, computed not guessed.
 *
 * The deploy script previously staged a HAND-WRITTEN list of files. That list happened to
 * be right for the Companion and wrong for the harness, and the run died on a module that
 * was never where anyone thought it was. So the list is now DERIVED: this walks the real
 * require graph from the entry file and returns every relative dependency, transitively.
 *
 * THE STAGED COPY MUST BE CLOSED UNDER require(). If it is not, the Companion falls back
 * to resolving somewhere else — and "somewhere else" is the repo it is deliberately denied.
 * A missing file would therefore not fail loudly at deploy time; it would fail at run time,
 * inside the operator account, as a permission error that looks like a containment problem
 * and is actually a packaging bug. companionStaging.test.js proves closure and proves the
 * entry runs from a directory that contains only these files.
 *
 * The staged layout is FLAT: every module sits beside the entry, so relative requires
 * resolve within the staging directory and never climb out of it.
 *
 * Usage:
 *   node companionManifest.js          # human-readable
 *   node companionManifest.js --list   # one absolute source path per line, for the deploy script
 */

const fs = require('node:fs')
const path = require('node:path')

const SCRIPTS_DIR = __dirname
const SRC_DIR = path.resolve(__dirname, '..', '..', 'src', 'computer')
const ENTRY = 'companion-entry.js'

/**
 * Where a flat module name lives in the repo. The entry is in scripts/, the rest in src/.
 *
 * Node lets you omit the .js extension, and companion.js does exactly that
 * (`require('./sessionBoundary')`). The first version of this walker only tried the
 * literal name and reported sessionBoundary as MISSING — which is the tool working: a
 * hand-written list had silently included the file, so nobody had noticed the two forms.
 */
function sourceOf (name) {
  for (const candidate of [name, name + '.js']) {
    const inScripts = path.join(SCRIPTS_DIR, candidate)
    if (fs.existsSync(inScripts)) return inScripts
    const inSrc = path.join(SRC_DIR, candidate)
    if (fs.existsSync(inSrc)) return inSrc
  }
  return null
}

/** The flat filename a module gets in the staging directory. */
function stagedName (name) {
  return name.endsWith('.js') ? name : name + '.js'
}

/**
 * Every relative require in a file. Matches both forms the entry uses:
 *   require('./x.js')
 *   require(path.join(__dirname, 'x.js'))
 * A form this does not recognise would silently drop a dependency, so the test asserts
 * the graph is closed by actually RUNNING the staged copy — not by trusting this regex.
 */
function relativeRequires (code) {
  const names = new Set()
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const m of stripped.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)) names.add(m[1])
  for (const m of stripped.matchAll(/require\(\s*path\.join\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)\s*\)/g)) names.add(m[1])
  return [...names]
}

/** Node builtins the graph uses. Reported so the staged copy's reach is visible. */
function builtins (code) {
  const out = new Set()
  for (const m of code.matchAll(/require\(\s*['"](node:[^'"]+)['"]\s*\)/g)) out.add(m[1])
  return [...out]
}

/** Walk the graph from the entry. Returns { files, builtins, missing }. */
function buildManifest () {
  const files = new Map() // flat name -> absolute source path
  const used = new Set()
  const missing = []
  const queue = [ENTRY]

  while (queue.length) {
    const raw = queue.shift()
    const name = stagedName(raw)
    if (files.has(name)) continue
    const src = sourceOf(raw)
    if (!src) { missing.push(raw); continue }
    files.set(name, src)
    const code = fs.readFileSync(src, 'utf8')
    for (const b of builtins(code)) used.add(b)
    for (const dep of relativeRequires(code)) if (!files.has(stagedName(dep))) queue.push(dep)
  }

  return {
    entry: ENTRY,
    files: [...files.entries()].map(([name, src]) => ({ name, src })),
    builtins: [...used].sort(),
    missing
  }
}

if (require.main === module) {
  const m = buildManifest()
  if (process.argv.includes('--list')) {
    for (const f of m.files) console.log(f.src)
    process.exit(m.missing.length ? 1 : 0)
  }
  console.log('entry     : ' + m.entry)
  console.log('files     : ' + m.files.length)
  for (const f of m.files) console.log('  ' + f.name.padEnd(24) + ' <- ' + f.src)
  console.log('builtins  : ' + m.builtins.join(', '))
  if (m.missing.length) {
    console.error('MISSING   : ' + m.missing.join(', '))
    process.exit(1)
  }
}

module.exports = { buildManifest, relativeRequires, sourceOf, stagedName, ENTRY, SRC_DIR, SCRIPTS_DIR }
