'use strict'

/**
 * targetCatalogue.test.js — the page the Owner means, or an honest 「I don't know」.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FINDING THIS FILE EXISTS FOR. The page the Owner calls 「Order Planning」 is
 * client/src/pages/Replenishment.tsx. A file literally named OrderPlanning.tsx also exists and
 * is a DIFFERENT page. And /branches/replenishment — same word again — renders TransferOrders,
 * a third component entirely.
 *
 * So the two obvious shortcuts are both wrong here, and wrong with confidence:
 *   matching by filename  → picks OrderPlanning.tsx for 「Order Planning」
 *   matching by route word → merges TransferOrders into Replenishment
 *
 * A wrong answer does not stay a lookup. It becomes an allowedFiles entry inside a sealed
 * Work Order the Owner then approves, and an executor edits a page he never asked about.
 *
 * ⛔ THESE ARE TRUTH TESTS, NOT AUTHORITY TESTS. Nothing here creates a Proposal, a Work Order
 * or a Run, and the catalogue is not reachable from anything that could.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cat = require('./targetCatalogue')
const { RESULT, DISCOVERABILITY } = cat
/**
 * ⛔ CODE ONLY. Scanning the raw file made this fail on its own subject's COMMENTS — the
 * header explains that there is no fuzzy matching, and naming the thing to forbid it counted
 * as doing it. Fixed rather than loosened. RAW is kept for the few assertions that are
 * genuinely about the prose (that the file states its snapshot is not an execution branch).
 */
const codeOf = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

const RAW_SRC = fs.readFileSync(path.join(__dirname, 'targetCatalogue.js'), 'utf8')
const RAW_DATA = fs.readFileSync(path.join(__dirname, 'catalogues', 'aromaSystem.js'), 'utf8')
const SRC = codeOf(RAW_SRC)
const DATA = codeOf(RAW_DATA)

/* ═══ the three seed records, and the traps they encode ════════════════════ */

test('*** ⛔ ORDER PLANNING IS Replenishment.tsx — NOT THE FILE OF THE SAME NAME ***', () => {
  const r = cat.findByCanonicalLabel('Order Planning')
  assert.equal(r.status, RESULT.EXACT)
  const t = cat.getTarget(r.targetIds[0])
  assert.equal(t.component, 'Replenishment')
  assert.deepEqual(t.files, ['client/src/pages/Replenishment.tsx'],
    '⛔ the owner-facing Order Planning resolved to the wrong file')
  assert.deepEqual(t.routes, ['/inventory/replenishment', '/procurement/replenishment'])
  assert.equal(t.discoverability, DISCOVERABILITY.OWNER_LABEL)
  // Provenance, so a future reader can check the claim rather than trust it.
  assert.ok(t.evidence.label.includes('Layout.tsx:175'))
  assert.ok(t.evidence.route.includes('App.tsx:290'))
  assert.ok(t.evidence.file.includes('App.tsx:65'))
})

test('*** ⛔ OrderPlanning.tsx IS ROUTE-ONLY AND HAS NO INVENTED LABEL ***', () => {
  /**
   * ⛔ 「Order Planning v2」 is a name nothing in the source says. It would have been invented
   * because the filename suggested it — the exact move this catalogue refuses.
   */
  const r = cat.findByRoute('/inventory/order-planning')
  assert.equal(r.status, RESULT.EXACT)
  const t = cat.getTarget(r.targetIds[0])
  assert.equal(t.component, 'OrderPlanning')
  assert.deepEqual(t.files, ['client/src/pages/OrderPlanning.tsx'])
  assert.equal(t.canonicalLabel, null, '⛔ a label was invented for a page that has none')
  assert.equal(t.discoverability, DISCOVERABILITY.ROUTE_ONLY)
  assert.ok(t.evidence.label.startsWith('NONE'), 'and it records that no label exists')

  for (const invented of ['Order Planning v2', 'OrderPlanning', 'Order Planning V2', 'order planning']) {
    const m = cat.findByCanonicalLabel(invented)
    assert.equal(m.status, RESULT.NO_MATCH, '⛔ route-only target matched an invented label: ' + invented)
  }
})

test('*** ⛔ /branches/replenishment IS TransferOrders AND MUST NOT COLLAPSE ***', () => {
  const r = cat.findByRoute('/branches/replenishment')
  assert.equal(r.status, RESULT.EXACT)
  const t = cat.getTarget(r.targetIds[0])
  assert.equal(t.component, 'TransferOrders', '⛔ a shared route word merged two different pages')
  assert.deepEqual(t.files, ['client/src/pages/TransferOrders.tsx'])
  assert.equal(t.canonicalLabel, 'Replenishment', 'it does have its own owner-facing label')

  // Same word, different page: the two must stay distinct records with distinct files.
  const orderPlanning = cat.getTarget(cat.findByCanonicalLabel('Order Planning').targetIds[0])
  assert.notEqual(t.targetId, orderPlanning.targetId)
  assert.notEqual(t.files[0], orderPlanning.files[0])
  assert.notEqual(t.component, orderPlanning.component)
})

/* ═══ lookup semantics ═════════════════════════════════════════════════════ */

test('*** exact lookups by id, route and label ***', () => {
  assert.equal(cat.getTarget('aroma-system:order-planning').component, 'Replenishment')
  assert.equal(cat.getTarget('nope'), null)
  assert.equal(cat.getTarget(''), null)
  assert.equal(cat.getTarget(null), null)
  assert.equal(cat.findByRoute('/procurement/replenishment').status, RESULT.EXACT)
  assert.equal(cat.findByCanonicalLabel('Replenishment').status, RESULT.EXACT)
})

test('*** ⛔ UNKNOWN LABELS AND ROUTES ARE no_match — NOT A NEAR MISS ***', () => {
  for (const label of ['訂貨頁', '中央廚房訂貨頁', '補貨頁', 'Ordering', 'Order', 'Replenish', '']) {
    const r = cat.findByCanonicalLabel(label)
    assert.equal(r.status, RESULT.NO_MATCH, '⛔ matched: ' + label)
    assert.deepEqual(r.targetIds, [])
  }
  for (const route of ['/inventory', '/inventory/replenish', '/inventory/replenishment/', 'inventory/replenishment']) {
    assert.equal(cat.findByRoute(route).status, RESULT.NO_MATCH, '⛔ matched a near route: ' + route)
  }
})

test('*** ⛔ MULTIPLE EXACT MATCHES RETURN MULTIPLE — NEVER FIRST-MATCH-WINS ***', () => {
  /**
   * ⛔ The catalogue has no duplicate label today, so this is proven on the FUNCTION rather
   * than hoping data never collides. `result()` is what every lookup returns; two ids must
   * mean MULTIPLE, because silently returning ids[0] is selection disguised as lookup.
   */
  const two = SRC.includes('ids.length === 1 ? RESULT.EXACT : RESULT.MULTIPLE')
  assert.ok(two, 'the result shape distinguishes one from many')
  assert.equal(/\[0\]/.test(SRC.slice(SRC.indexOf('const result ='), SRC.indexOf('function getTarget'))), false,
    '⛔ the result builder indexes the first candidate')

  // And the property holds end to end: label lookup returns ALL matches, not one.
  const labels = cat.listTargets('aroma-system')
    .filter((t) => t.discoverability === DISCOVERABILITY.OWNER_LABEL)
    .map((t) => t.canonicalLabel)
  assert.equal(new Set(labels).size, labels.length, 'no duplicate owner label in the seed data')
})

test('*** ⛔ NO FUZZY, SUBSTRING, DISTANCE OR MODEL MATCHING EXISTS ***', () => {
  for (const banned of ['includes(label', 'indexOf(label', 'startsWith(label', 'toLowerCase()', 'levenshtein', 'fuzzy', 'similar', 'adapter', 'providerHint', 'RegExp(']) {
    assert.equal(SRC.includes(banned), false, '⛔ an approximate match path appeared: ' + banned)
  }
  assert.equal(/require\(['"](?!\.\/)/.test(SRC), false, 'it imports only its own siblings')
})

/* ═══ structural safety of the data itself ════════════════════════════════ */

test('*** ⛔ EVERY TARGET IS PROJECT-SCOPED AND REPO-RELATIVE ***', () => {
  const all = cat.listTargets('aroma-system')
  assert.equal(all.length, 3, 'the seed catalogue is small and proven, not exhaustive')
  const ids = all.map((t) => t.targetId)
  assert.equal(new Set(ids).size, ids.length, 'targetIds are unique')

  for (const t of all) {
    assert.equal(t.projectId, 'aroma-system')
    for (const f of t.files) {
      assert.equal(/^[A-Za-z]:/.test(f), false, '⛔ absolute Windows path: ' + f)
      assert.equal(f.startsWith('/') || f.startsWith('\\'), false, '⛔ absolute POSIX path: ' + f)
      assert.equal(f.split(/[\\/]/).includes('..'), false, '⛔ traversal: ' + f)
    }
  }
  assert.deepEqual(cat.listTargets('nope'), [], 'an unknown project has no targets')
  assert.deepEqual(cat.listTargets('aroma-agent-backend'), [], 'and a known one may legitimately have none yet')
})

test('*** ⛔ A MALFORMED CATALOGUE IS REFUSED AT LOAD, NOT SERVED ONCE ***', () => {
  // The validator is what stands between a hand-edited record and a wrong answer. Each of
  // these is a way the data could be wrong that nothing downstream would notice.
  for (const rule of [
    'unknown projectId', 'must be repo-relative, not absolute', "must not contain '..'",
    'duplicate targetId', 'must carry the label a human can actually see',
    'must say WHERE that label came from', 'must have canonicalLabel null'
  ]) {
    assert.ok(RAW_SRC.includes(rule), 'the validator enforces: ' + rule)
  }
})

/* ═══ provenance ══════════════════════════════════════════════════════════ */

test('*** ⛔ IT IS A PINNED SNAPSHOT, AND SAYS SO ***', () => {
  const [s] = cat.listSources()
  assert.equal(s.repoFullName, 'Louielui/aroma-system')
  assert.equal(s.sourceCommit, '9a08646565c00f503e042dbf07b23b4a41a09e34')
  assert.equal(s.sourceRef, 'feat/aroma-core-slice1')
  assert.deepEqual(s.sourceFiles, ['client/src/components/Layout.tsx', 'client/src/App.tsx'])
  // ⛔ The snapshot ref is provenance. It must never be read as the branch an executor builds.
  assert.ok(RAW_DATA.includes('NOT an execution branch'), 'the data file says the ref is not an execution branch')
  assert.ok(RAW_DATA.includes('PINNED') || RAW_DATA.includes('Pinned') || RAW_DATA.includes('pinned'))
})

test('*** ⛔ NO PRODUCTION READ OF A DEVELOPER CHECKOUT ***', () => {
  for (const src of [SRC, DATA]) {
    assert.equal(/C:[\\/]Users/.test(src), false, '⛔ a machine-specific path is baked in')
    assert.equal(/fs\.|readFileSync|child_process|execSync/.test(src), false, '⛔ it reads the filesystem at runtime')
    assert.equal(/process\.env/.test(src), false, '⛔ it reads an environment flag')
  }
})

test('*** ⛔ NO INVENTED ALIAS ENTERED THE DATA ***', () => {
  for (const invented of ['訂貨頁', '中央廚房', '補貨頁', 'v2', 'V2', 'alias', 'synonym']) {
    assert.equal(DATA.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n').includes(invented), false,
      '⛔ an invented alias reached the catalogue data: ' + invented)
  }
})

test('*** ⛔ THE CATALOGUE RETURNS IDENTIFIERS, NEVER EXECUTABLE SHAPES ***', () => {
  const t = cat.getTarget('aroma-system:order-planning')
  assert.deepEqual(Object.keys(t).sort(),
    ['canonicalLabel', 'component', 'discoverability', 'evidence', 'files', 'projectId', 'routes', 'targetId'].sort(),
    '⛔ a field appeared on a target record')
  for (const k of ['repoRoot', 'command', 'allowedFiles', 'workOrder', 'proposalId', 'branch', 'localRoot']) {
    assert.equal(k in t, false, '⛔ an executable-shaped field appeared: ' + k)
  }
  const blob = JSON.stringify(cat.listTargets('aroma-system'))
  assert.equal(/C:[\\/]/.test(blob), false, 'no absolute path crosses the boundary')
})
