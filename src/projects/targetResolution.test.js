'use strict'

/**
 * targetResolution.test.js — the page he named, or an honest 「I don't know」.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE NEAR-MISSES ARE THE SUBJECT. This repository really contains a second, different
 * ordering page, so every shortcut that would 「obviously」 work is wrong here in a specific,
 * demonstrable way:
 *
 *   by filename      → 「Order Planning」 is Replenishment.tsx, and OrderPlanning.tsx is another page
 *   by route word    → /branches/replenishment renders TransferOrders, a third component
 *   by prefix        → 「Order Planning v2」 is not 「Order Planning」
 *   by nav label     → 「Replenishment」 IS a label, and it points at TransferOrders.tsx
 *
 * A wrong answer does not stay a lookup. It becomes the file inside a sealed Work Order the
 * Owner approves, and an executor edits a page he never mentioned.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { resolveTargets, projectExecutionAvailable, STATUS, SOURCE, EXECUTABLE_PROJECT_ID } = require('./targetResolution')

/** Code only — this file names what it forbids, and saying it must not count as doing it. */
const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const SRC = codeOf(fs.readFileSync(path.join(__dirname, 'targetResolution.js'), 'utf8'))

/* ═══ exact ════════════════════════════════════════════════════════════════ */

test('*** an exact trusted label resolves to its ONE target ***', () => {
  const r = resolveTargets('幫我改 Order Planning 個 Submit button')
  assert.equal(r.status, STATUS.EXACT)
  assert.equal(r.source, SOURCE.CANONICAL_LABEL)
  assert.deepEqual(r.targetIds, ['aroma-system:order-planning'])
  assert.deepEqual(r.targets[0].files, ['client/src/pages/Replenishment.tsx'])
  assert.equal(r.targets[0].component, 'Replenishment')
})

test('*** an exact trusted route resolves too ***', () => {
  const r = resolveTargets('幫我改 /inventory/order-planning 個 Submit button')
  assert.equal(r.status, STATUS.EXACT)
  assert.equal(r.source, SOURCE.ROUTE)
  assert.deepEqual(r.targets[0].files, ['client/src/pages/OrderPlanning.tsx'])
  assert.equal(r.targets[0].canonicalLabel, null, 'a route-only page still has no invented name')
})

test('*** ⛔ ONE TARGET NAMED TWICE IS STILL ONE TARGET ***', () => {
  // Label AND one of its own routes: two pieces of evidence, not an ambiguity to resolve.
  const r = resolveTargets('幫我改 Order Planning 同 /inventory/replenishment')
  assert.equal(r.status, STATUS.EXACT, '⛔ two clues about one page became a question')
  assert.deepEqual(r.targetIds, ['aroma-system:order-planning'])
})

/* ═══ the near-misses ══════════════════════════════════════════════════════ */

test('*** ⛔ 「Order Planning v2」 IS NOT 「Order Planning」 ***', () => {
  /**
   * ⛔ THE MOST DANGEROUS MATCH AVAILABLE HERE. A known label is a PREFIX of a different name,
   * and truncating to what we recognise would confidently answer with the wrong page.
   */
  for (const m of ['幫我改 Order Planning v2', '幫我改 Order Planning V2 個 button', 'Order Planning2']) {
    assert.equal(resolveTargets(m).status, STATUS.NO_MATCH, '⛔ a longer name resolved to a shorter known one: ' + m)
  }
})

test('*** ⛔ A FILENAME IS NOT A NAV LABEL ***', () => {
  /**
   * ⛔ MEASURED DURING THIS BUILD. 「Replenishment」 is a real owner-facing label — for
   * /branches/replenishment, which renders TransferOrders. So 「改 Replenishment.tsx」 matched it
   * and pointed at TransferOrders.tsx while the Owner was naming Replenishment.tsx: a different
   * page, in a request that mentioned neither.
   */
  for (const m of ['幫我改 Replenishment.tsx', '幫我改 client/src/pages/Replenishment.tsx', '改 pages/Replenishment.tsx 呢個']) {
    assert.equal(resolveTargets(m).status, STATUS.NO_MATCH, '⛔ a filename resolved through a nav label: ' + m)
  }
})

test('*** a bare trusted label IS a match, even when a file shares its name ***', () => {
  // The distinction above is about path/extension glue, not about refusing the label itself.
  const r = resolveTargets('幫我改 Replenishment 呢個 page')
  assert.equal(r.status, STATUS.EXACT)
  assert.equal(r.targets[0].component, 'TransferOrders', 'and it is that label\'s real component')
})

test('*** a route PREFIX is not the route ***', () => {
  assert.equal(resolveTargets('改 /inventory/order-planning-v2').status, STATUS.NO_MATCH)
})

test('*** ⛔ COLLOQUIAL NAMES STAY UNKNOWN — no synonyms were added ***', () => {
  for (const m of ['幫我改訂貨頁個 Submit button', '幫我改中央廚房訂貨頁', '幫我改補貨頁']) {
    assert.equal(resolveTargets(m).status, STATUS.NO_MATCH, '⛔ a colloquial name was guessed: ' + m)
  }
})

/* ═══ multiple ═════════════════════════════════════════════════════════════ */

test('*** ⛔ TWO DISTINCT TARGETS ARE MULTIPLE, NEVER FIRST-WINS ***', () => {
  const r = resolveTargets('幫我改 Order Planning 同 /inventory/order-planning')
  assert.equal(r.status, STATUS.MULTIPLE)
  assert.equal(r.targetIds.length, 2)
  assert.ok(r.targetIds.includes('aroma-system:order-planning'))
  assert.ok(r.targetIds.includes('aroma-system:inventory-order-planning-route'))
})

/* ═══ availability ═════════════════════════════════════════════════════════ */

test('*** ⛔ ONLY THIS REPOSITORY IS EXECUTABLE, AND NOT BECAUSE A REGISTRY SAID SO ***', () => {
  /**
   * The Project Registry deliberately encodes no authority, so availability is NOT read from
   * it. It comes from the one fact this tranche is allowed to know: the executor is bound to
   * this repository and nothing else.
   */
  assert.equal(projectExecutionAvailable('aroma-system'), false)
  assert.equal(projectExecutionAvailable(EXECUTABLE_PROJECT_ID), true)
  assert.equal(projectExecutionAvailable('anything-else'), false)
  assert.equal(projectExecutionAvailable(undefined), false)
})

/* ═══ purity ═══════════════════════════════════════════════════════════════ */

test('*** ⛔ IT IS PURE, AND CANNOT AUTHORISE ANYTHING ***', () => {
  assert.equal(/process\.env|fs\.|readFileSync|fetch\(|child_process/.test(SRC), false, '⛔ it reaches the world')
  for (const banned of ['toLowerCase()', 'levenshtein', 'fuzzy', 'similar', 'adapter', 'providerHint', 'persistIntake', 'promoteToProposal', 'workOrder', 'repoRoot']) {
    assert.equal(SRC.includes(banned), false, '⛔ it gained: ' + banned)
  }
  const requires = [...SRC.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(requires, ['./targetCatalogue'], 'it reads trusted truth and nothing else')

  const r = resolveTargets('幫我改 Order Planning')
  assert.deepEqual(Object.keys(r).sort(), ['source', 'status', 'targetIds', 'targets'])
  assert.deepEqual(Object.keys(r.targets[0]).sort(),
    ['canonicalLabel', 'component', 'files', 'projectId', 'routes', 'targetId'])
  const blob = JSON.stringify(r)
  assert.equal(/C:[\\/]|repoRoot|approvalId|hash/.test(blob), false, 'no root, id or hash crosses the boundary')
})

test('*** an empty message is not a question about targets ***', () => {
  assert.equal(resolveTargets('').status, STATUS.NOT_APPLICABLE)
  assert.equal(resolveTargets(null).status, STATUS.NOT_APPLICABLE)
})
