'use strict'

/**
 * deprecationBoundaries.test.js — two modules are on their way out, and "on the way out" is a
 * claim about the graph, not a note in a header.
 *
 * A DEPRECATED marker that nothing enforces is a comment. Both of these have a defined,
 * checkable end state — zero importers, zero producers, zero consumers — so both are checked
 * here rather than trusted.
 *
 *   computerOperatorWiring.js   DEPRECATED  — no production importers
 *   canary_execute/_outcome     RESERVED    — no production producer, no production consumer
 *
 * Removal of both is scheduled for after G3 and before the final Owner Approval. Until then
 * these tests are what stops either one drifting back into service.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const SRC = path.join(REPO, 'src')
const SCRIPTS = path.join(REPO, 'scripts')

/** Every production file: .js and .ps1 under src/ and scripts/, tests excluded. */
function productionFiles () {
  const out = []
  const walk = (dir) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
      if (e.name.endsWith('.test.js')) continue
      if (!e.name.endsWith('.js') && !e.name.endsWith('.ps1')) continue
      out.push(p)
    }
  }
  walk(SRC); walk(SCRIPTS)
  return out
}

const rel = (p) => path.relative(REPO, p).split(path.sep).join('/')

/** Comments stripped, because a file explaining a ban must not count as breaking it. */
function code (file) {
  const raw = fs.readFileSync(file, 'utf8')
  return file.endsWith('.ps1')
    ? raw.replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')
    : raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/* ── computerOperatorWiring: importer count must be 0 ─────────────────────── */

test('*** DEPRECATED computerOperatorWiring — production importer count is 0 ***', () => {
  const importers = productionFiles()
    .filter((f) => path.basename(f) !== 'computerOperatorWiring.js')
    .filter((f) => /require\(['"][^'"]*computerOperatorWiring['"]\)/.test(code(f)))
    .map(rel)
  assert.deepEqual(importers, [], 'nothing in production may import the deprecated wiring')
})

test('*** no launcher, Owner entrypoint or Companion entrypoint reaches it ***', () => {
  // Named individually. A count of zero across "production" could drift if the file list ever
  // narrowed; these are the six places it would actually matter.
  const ENTRYPOINTS = [
    'scripts/computer/Owner-Approve.ps1',
    'scripts/computer/Owner-Execute.ps1',
    'scripts/computer/run-notepad-canary.js',
    'scripts/computer/Operator-CheckIdentity.ps1',
    'scripts/computer/Operator-CheckMachine.ps1',
    'scripts/computer/Operator-StartCompanion.ps1',
    'scripts/computer/tool-check-identity.js',
    'scripts/computer/tool-check-machine.js',
    'scripts/computer/tool-start-companion.js',
    'scripts/computer/operatorToolsCommon.js',
    'scripts/computer/operatorLauncher.ps1'
  ]
  for (const e of ENTRYPOINTS) {
    const abs = path.join(REPO, e.split('/').join(path.sep))
    assert.ok(fs.existsSync(abs), 'the entrypoint exists: ' + e)
    assert.equal(code(abs).includes('computerOperatorWiring'), false, e + ' must not reach the deprecated wiring')
  }
})

test('the deprecation is declared in the file itself, not only here', () => {
  const head = fs.readFileSync(path.join(SRC, 'computer', 'computerOperatorWiring.js'), 'utf8').slice(0, 1200)
  assert.match(head, /DEPRECATED/, 'a reader opening the file learns it is on the way out')
  assert.match(head, /NO PRODUCTION IMPORTERS/)
})

/* ── canary_execute / canary_outcome: producer 0, consumer 0 ──────────────── */

const RESERVED = ['canary_execute', 'canary_outcome']

/**
 * Where the names are ALLOWED to appear: the vocabulary that reserves them, and nowhere else in
 * production. Appearing anywhere else means something started using the reservation.
 */
const VOCABULARY = 'src/computer/sessionBoundary.js'

test('*** RESERVED canary_execute/canary_outcome — production producer count is 0 ***', () => {
  // A PRODUCER would construct or send one: a message literal, an assignment, a send call.
  const producers = []
  for (const f of productionFiles()) {
    if (rel(f) === VOCABULARY) continue
    const c = code(f)
    for (const name of RESERVED) {
      if (!c.includes(name)) continue
      producers.push(rel(f) + ' :: ' + name)
    }
  }
  assert.deepEqual(producers, [], 'nothing in production builds or sends these messages')
})

test('*** RESERVED canary_execute/canary_outcome — production consumer count is 0 ***', () => {
  // A CONSUMER would branch on the type. Same scan, stated separately because they are different
  // claims: a system can easily have a sender with no receiver, or a receiver with no sender, and
  // either one alone would mean the reservation had become a channel.
  const consumers = []
  for (const f of productionFiles()) {
    if (rel(f) === VOCABULARY) continue
    const c = code(f)
    for (const name of RESERVED) {
      if (new RegExp("(case|===|==|includes\\(|match\\()\\s*['\"]" + name + "['\"]").test(c)) {
        consumers.push(rel(f) + ' :: ' + name)
      }
    }
  }
  assert.deepEqual(consumers, [], 'nothing in production dispatches on these messages')
})

test('*** POSITIVE CONTROL — the producer/consumer scan can actually find something ***', () => {
  // Without this, "count is 0" could mean the scan is broken. The same two regexes are run over
  // synthetic sources that DO produce and DO consume.
  const producerish = "const msg = { type: 'canary_execute' }\n"
  const consumerish = "if (msg.type === 'canary_execute') { run() }\n"
  assert.ok(producerish.includes('canary_execute'), 'the producer scan matches a producer')
  assert.ok(/(case|===|==|includes\(|match\()\s*['"]canary_execute['"]/.test(consumerish),
    'the consumer scan matches a consumer')
  // And it does NOT match the reservation itself, which is a bare list entry.
  const reservationOnly = "const SERVICE_TO_COMPANION = ['execute_step', 'canary_execute']\n"
  assert.equal(/(case|===|==|includes\(|match\()\s*['"]canary_execute['"]/.test(reservationOnly), false,
    'a name in a list is a reservation, not a consumer')
})

test('the reservation is declared in the vocabulary file itself', () => {
  const src = fs.readFileSync(path.join(REPO, VOCABULARY.split('/').join(path.sep)), 'utf8')
  assert.match(src, /RESERVED — NOT IMPLEMENTED|RESERVED - NOT IMPLEMENTED/,
    'a reader of the vocabulary learns these two carry nothing')
  for (const name of RESERVED) {
    assert.ok(src.includes(name), 'and the name really is still reserved: ' + name)
  }
})

/* ── the transport claim, corrected ───────────────────────────────────────── */

test('*** the request transport is described as independent, not as a pipe extension ***', () => {
  // The wording matters because it is what a future reader will act on. "Extends the existing
  // SessionGate protocol" would tell them the pipe carries this, and they would go looking for
  // framing and endpoints that do not exist — or, worse, add a pipe path to match the sentence.
  const store = fs.readFileSync(path.join(SRC, 'computer', 'executeRequestStore.js'), 'utf8')
  assert.match(store, /INDEPENDENT DIRECTORY TRANSPORT/i)
  assert.match(store, /not an extension of the SessionGate pipe/i)
  assert.match(store, /exactly ONE request channel/i, 'and no fallback is offered')
})

test('*** canary production has no pipe fallback and no second request channel ***', () => {
  // The Companion path must reach the directory store and nothing else that could deliver a
  // request. If a pipe listener appeared on this path, a request could arrive by two routes and
  // only one of them would be the one that was reasoned about.
  const companionSide = [
    'scripts/computer/tool-start-companion.js',
    'src/computer/companionCanaryRunner.js',
    'src/computer/companionProductionFactory.js'
  ]
  for (const f of companionSide) {
    const c = code(path.join(REPO, f.split('/').join(path.sep)))
    for (const banned of ['ipcChannel', 'createPipeListener', 'net.createServer', '\\\\.\\pipe']) {
      assert.equal(c.includes(banned), false, f + ' must not reach a pipe: ' + banned)
    }
  }
  // And exactly one module provides a request store to the Companion path.
  const storeImporters = productionFiles()
    .filter((f) => /require\(['"][^'"]*executeRequestStore['"]\)/.test(code(f)))
    .map(rel).sort()
  assert.deepEqual(storeImporters,
    ['scripts/computer/run-notepad-canary.js', 'scripts/computer/tool-start-companion.js', 'src/computer/companionCanaryRunner.js'],
    'one producer, one consumer entrypoint, one runner — and no fourth way in')
})
