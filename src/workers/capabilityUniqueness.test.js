'use strict'

/**
 * capabilityUniqueness.test.js — THE ROUTING TABLE MUST NAME EXACTLY ONE OWNER.
 *
 * ── WHAT B1 REMOVED ─────────────────────────────────────────────────────────
 * Routing was `WORKERS.find(w => w.capabilities.includes(c))`. First match wins, so the
 * answer depended on ARRAY ORDER. That is invisible today — 42 declarations, 42 distinct
 * capabilities — and stops being invisible the moment two workers declare the same one.
 * The silent winner would be whoever sits earlier: the Architect, at index 0, with 14
 * capabilities and the only `connected: true`. Step A closed exactly that shape of silent
 * upward escalation; array-order authority is the same defect arriving through another door.
 *
 * ── WHY IT THROWS INSTEAD OF CHOOSING ───────────────────────────────────────
 * The registry is developer-authored trusted configuration, so a duplicate is a source
 * error, not a runtime event to arbitrate. Any tie-break — priority, prefer-connected,
 * prefer-Architect, first, last — would make an ambiguous table look answerable, which is
 * the property being removed. Failing at load is the honest shape of "this table does not
 * say who is responsible".
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-b1-test-'))

const test = require('node:test')
const assert = require('node:assert')

const {
  WORKERS, workerForCapability, buildCapabilityIndex, normalizeCapability
} = require('../workers/registry')

/** Two workers shaped like the real ones, for tables we deliberately break. */
const mk = (id, capabilities) => ({ id, role: id, provider: id, engine: 'external', connected: false, capabilities })

test('A. the real production registry builds successfully', () => {
  const index = buildCapabilityIndex(WORKERS)
  assert.ok(index instanceof Map)
  assert.ok(index.size > 0)
})

test('B. every declaration is distinct — no collisions in the real registry', () => {
  // Deliberately NOT asserting the literal 42. Hard-coding today's count would fail the
  // day someone legitimately adds a capability, which teaches people to edit the number
  // rather than think — and it would still not prove uniqueness. Deriving both sides
  // states the actual invariant: the index loses nothing, so nothing was overwritten.
  const declarations = WORKERS.reduce((n, w) => n + w.capabilities.length, 0)
  const index = buildCapabilityIndex(WORKERS)
  assert.strictEqual(index.size, declarations,
    'index.size < declaration count means at least one capability was declared twice')
})

test('C. the SAME capability on two workers fails closed', () => {
  const table = [mk('alpha', ['research']), mk('beta', ['research'])]
  assert.throws(() => buildCapabilityIndex(table), (err) => {
    assert.match(err.message, /research/, 'the error must name the capability')
    assert.match(err.message, /alpha/, 'the error must name the first worker')
    assert.match(err.message, /beta/, 'the error must name the conflicting worker')
    return true
  })
})

test('D. case- and whitespace-equivalent duplicates fail closed', () => {
  const table = [mk('alpha', ['Research']), mk('beta', ['  research  '])]
  assert.throws(() => buildCapabilityIndex(table), /research/,
    "'Research' and ' research ' are ONE capability — normalization must agree with routing")
})

test('E. a duplicate declared twice inside ONE worker fails closed', () => {
  const table = [mk('alpha', ['research', 'RESEARCH'])]
  assert.throws(() => buildCapabilityIndex(table), (err) => {
    assert.match(err.message, /same worker/, 'this is a distinct error from a cross-worker clash')
    assert.match(err.message, /alpha/)
    return true
  })
})

test('E2. an unusable declaration fails closed rather than being skipped', () => {
  for (const bad of [[''], ['   '], [null], [undefined], [42]]) {
    assert.throws(() => buildCapabilityIndex([mk('alpha', bad)]), /unusable capability/,
      'a meaningless declaration is a config error, not something to quietly drop')
  }
})

test('F. ARRAY ORDER has no effect on routing for a valid unique registry', () => {
  const forward = buildCapabilityIndex(WORKERS)
  const reversed = buildCapabilityIndex([...WORKERS].reverse())
  const rotated = buildCapabilityIndex([...WORKERS.slice(3), ...WORKERS.slice(0, 3)])

  assert.strictEqual(reversed.size, forward.size)
  assert.strictEqual(rotated.size, forward.size)
  for (const [cap, worker] of forward) {
    assert.strictEqual(reversed.get(cap).id, worker.id, `'${cap}' changed owner when reversed`)
    assert.strictEqual(rotated.get(cap).id, worker.id, `'${cap}' changed owner when rotated`)
  }
})

test('F2. WORKERS is not mutated by building an index', () => {
  const before = JSON.stringify(WORKERS)
  buildCapabilityIndex(WORKERS)
  buildCapabilityIndex([...WORKERS].reverse())
  assert.strictEqual(JSON.stringify(WORKERS), before)
})

test('G. existing known routing is unchanged', () => {
  assert.strictEqual(workerForCapability('ops').id, 'architect')
  assert.strictEqual(workerForCapability('architecture').id, 'architect')
  assert.strictEqual(workerForCapability('coding').id, 'engineer')
  assert.strictEqual(workerForCapability('browser').id, 'automation')
})

test('G2. matching stays case- and whitespace-insensitive', () => {
  assert.strictEqual(workerForCapability('OPS').id, 'architect')
  assert.strictEqual(workerForCapability('  Coding  ').id, 'engineer')
})

test('H. unknown / blank / null / undefined still resolve to null (Step A preserved)', () => {
  for (const cap of ['openclaw_review', 'quantum_analysis', '', '   ', null, undefined, 42, {}]) {
    assert.strictEqual(workerForCapability(cap), null, `${JSON.stringify(cap)} must not route`)
  }
})

test('H2. no unmatched capability may reach a connected worker', () => {
  // The Step A property, re-asserted through the new mechanism.
  for (const cap of ['openclaw_review', 'openclaw_browse', 'deploy_prod', 'ADMIN']) {
    const w = workerForCapability(cap)
    if (w === null) continue
    assert.strictEqual(w.connected, false, `${cap} resolved to a CONNECTED worker (${w.id})`)
  }
})

test('J. MUTATION GUARD — first-match authority cannot be restored silently', () => {
  // Restoring `WORKERS.find(...)` reintroduces order-dependence, which F catches. This
  // pins the other half: with a duplicate present, NO answer may be produced at all.
  // Any implementation that returns a worker here has re-added a tie-break.
  const ambiguous = [mk('alpha', ['shared_cap']), mk('beta', ['shared_cap'])]
  let built = null
  try { built = buildCapabilityIndex(ambiguous) } catch (_) { built = null }
  assert.strictEqual(built, null, 'an ambiguous table must yield no index, not a chosen winner')
})

test('J2. normalizeCapability is the single shared rule', () => {
  assert.strictEqual(normalizeCapability('  Ops '), 'ops')
  assert.strictEqual(normalizeCapability(''), null)
  assert.strictEqual(normalizeCapability('   '), null)
  assert.strictEqual(normalizeCapability(null), null)
  assert.strictEqual(normalizeCapability(undefined), null)
  assert.strictEqual(normalizeCapability(42), null)
})

test('J3. STRUCTURAL — routing authority is the index, not a scan of the array', () => {
  // Honest note on why this test is structural rather than behavioural.
  //
  // Under a VALID unique registry, `WORKERS.find(...)` and `CAPABILITY_INDEX.get(...)`
  // return the same worker for every input. That is not a weakness of the tests — it is
  // precisely why the order-dependence was invisible for so long. No behavioural assertion
  // can separate the two mechanisms while the table is well-formed, and the table is
  // well-formed in every state we are allowed to reach at runtime, because an ambiguous
  // one now throws at load.
  //
  // So the property pinned here is the mechanism itself: routing must consult the built
  // index. Restoring a first-match scan as the authority fails this test.
  const src = fs.readFileSync(path.join(__dirname, 'registry.js'), 'utf8')
  const fn = src.slice(src.indexOf('function workerForCapability'))
  const body = fn.slice(0, fn.indexOf('\n}'))

  assert.ok(body.includes('CAPABILITY_INDEX.get'),
    'workerForCapability must resolve through the uniqueness-checked index')
  assert.ok(!body.includes('WORKERS.find'),
    'first-match array scan must not be the routing authority')
  assert.ok(src.includes('const CAPABILITY_INDEX = buildCapabilityIndex(WORKERS)'),
    'the index must be built at module load, so an ambiguous registry cannot start')
})
