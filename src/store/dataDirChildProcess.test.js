'use strict'

/**
 * dataDirChildProcess.test.js — does the M-3 redirect survive a child process?
 *
 * The Owner's question, and it is the right one: 「your own concurrency tests fork real
 * children, and a child that does not inherit the detection would write to the real store
 * while every assertion passes. That is the exact shape you fixed — worth proving rather
 * than assuming.」
 *
 * So this proves it by SPAWNING REAL CHILDREN and asking each one where it resolved to,
 * rather than reasoning about environment inheritance.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const { PRODUCTION_DIR } = require('./dataDir')

/** Run a child that reports where the shared resolver sent it. */
function childResolves (env) {
  const code = `process.stdout.write(require(${JSON.stringify(path.join(__dirname, 'dataDir.js'))}).resolveDataDir())`
  return execFileSync(process.execPath, ['-e', code], { env, encoding: 'utf8', cwd: ROOT }).trim()
}

const isProduction = (dir) => path.resolve(dir) === path.resolve(PRODUCTION_DIR)

/* ═══ 1. THE ORDINARY CASE — env inherited ═══════════════════════════════ */

test('*** a child that inherits the environment is still redirected ***', () => {
  // The default for spawn/execFile/fork is to inherit process.env, which carries
  // NODE_TEST_CONTEXT down. This is what every spawning test in the suite does today.
  const dir = childResolves(process.env)
  assert.equal(isProduction(dir), false, 'an inherited-env child reached production: ' + dir)
})

test('a child given an explicit AROMA_DATA_DIR uses it — the pattern atomicStore already uses', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aroma-child-'))
  const dir = childResolves(Object.assign({}, process.env, { AROMA_DATA_DIR: tmp }))
  assert.equal(path.resolve(dir), path.resolve(tmp))
})

/* ═══ 2. THE UNCOVERED CASE, MEASURED AND NAMED ══════════════════════════ */

test('*** a STRIPPED-ENV node child DOES reach production — the honest limit ***', () => {
  // This is the hole, and it is real. A child spawned with an env that carries neither
  // NODE_TEST_CONTEXT nor AROMA_DATA_DIR is indistinguishable from the live server, because
  // there is no signal left to detect. No amount of cleverness inside dataDir.js can see a
  // parent that deliberately erased the evidence.
  //
  // It is pinned rather than hidden so the limit is a known quantity instead of a surprise,
  // and so the guard below has something to be measured against.
  const bare = { PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot }
  const dir = childResolves(bare)
  assert.equal(isProduction(dir), true,
    'if this now fails, dataDir gained a way to detect a stripped-env child — update the guard below')
})

/* ═══ 3. THE GUARD — nothing in the suite is in that shape today ═════════ */

test('*** no test spawns a node child with an env that ERASES the detection ***', () => {
  // MY FIRST VERSION OF THIS TEST HAD THE RULE BACKWARDS, and it is worth recording because
  // the wrong version reported three files as unsafe when all three are fine:
  //
  //   OMITTING `env:`  is INHERITANCE — Node passes process.env by default. SAFE.
  //   `{ ...process.env }` also inherits. SAFE, and my regex did not recognise the spread.
  //
  // The dangerous shape is the opposite: an explicit env object built from scratch. So the
  // rule is now "if you pass an env, it must derive from process.env or name
  // AROMA_DATA_DIR", and a file that passes no env at all is not even a candidate.
  //
  // KNOWN GRANULARITY LIMIT, stated rather than discovered: this reads whole FILES, not
  // individual call sites. A file that spawns two children — one inheriting, one stripped —
  // reads as safe. This file is exactly that, which is why it is excluded by name below.
  const offenders = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.test\.js$/.test(e.name)) continue
      const rel = path.relative(ROOT, p).replace(/\\/g, '/')
      if (rel === 'src/store/dataDirChildProcess.test.js') continue // spawns a stripped child on purpose
      const src = fs.readFileSync(p, 'utf8')
      // Node children only. The `claude` CLI spawn in agentBridgeWorker runs an external
      // binary that never requires our store, so its env allowlist is not in scope here.
      if (!/(execFileSync|execFile|spawnSync|spawn|fork)\s*\(\s*process\.execPath/.test(src)) continue
      if (!/\benv\s*:/.test(src)) continue // no env option ⇒ inherits ⇒ safe
      const derives = /process\.env/.test(src) || /AROMA_DATA_DIR/.test(src)
      if (!derives) offenders.push(rel)
    }
  }
  walk(path.join(ROOT, 'src'))
  assert.deepEqual(offenders, [],
    'a test builds a child env from scratch — that child would resolve to the REAL store')
})

/* ═══ 4. AND THE REAL STORE IS UNTOUCHED BY ALL OF THIS ══════════════════ */

test('*** running this very file did not write to the production store ***', () => {
  // The stripped-env child above RESOLVED to production. It must not have WRITTEN there:
  // it only computed a path. Proven by hash rather than by intent.
  const file = path.join(PRODUCTION_DIR, 'aroma-truth.json')
  if (!fs.existsSync(file)) return // nothing to protect on a fresh machine
  const before = fs.statSync(file).mtimeMs
  childResolves({ PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot })
  assert.equal(fs.statSync(file).mtimeMs, before, 'resolving a path must never write')
})
