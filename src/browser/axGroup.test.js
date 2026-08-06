'use strict'
/**
 * axGroup.test.js — 21 identical buttons stop being 21 identical buttons.
 *
 * Against the FROZEN real captures. Measured before building: parentId on 3564/3565 nodes,
 * and all 21 `Add to Cart` buttons resolve to a distinct product-naming ancestor.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const { readPage, CORPUS_DIR } = require('./axTree')

const fixture = (n) => require(path.join(CORPUS_DIR, n + '.json')).nodes

describe('the 21-button problem', () => {
  test('every Add to Cart is reachable by the product it belongs to', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9, group: true })
    const carts = out.nodes.filter((n) => n.name === 'Add to Cart')
    assert.strictEqual(carts.length, 21, 'all 21 still present — the page has 21')
    const containers = carts.map((c) => c.groupName)
    assert.strictEqual(containers.filter(Boolean).length, 21, 'each one names its product')
    assert.strictEqual(new Set(containers).size, 21, 'and the 21 names are distinct')
  })

  test('Bounty resolves to the Bounty button, and it is not the first on the page', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9, group: true })
    const bounty = out.nodes.filter((n) => n.name === 'Add to Cart' && /Bounty/.test(n.groupName || ''))
    assert.strictEqual(bounty.length, 1)
    assert.strictEqual(bounty[0].domId, 2747, 'the frozen key says 2747')
  })

  test('the serialized form nests members under their group', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9, group: true })
    const lines = out.text.split('\n')
    const gi = lines.findIndex((l) => /group "Bounty Plus/.test(l))
    assert.ok(gi >= 0, 'a group line exists')
    assert.match(lines[gi + 1] || '', /^ {2}\[#r/, 'members are indented under it')
  })

  test('UNAMBIGUOUS nodes get no group — context is earned, never universal', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9, group: true })
    const solo = out.nodes.find((n) => n.name === 'Clear All Filters')
    assert.ok(solo)
    assert.strictEqual(solo.groupName, undefined, 'a unique name needs no context')
  })

  test('output nesting is at most ONE level, whatever the DOM depth', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9, group: true })
    for (const l of out.text.split('\n')) {
      if (!l.startsWith(' ')) continue
      assert.match(l, /^ {2}\[#/, 'no line is indented more than one level: ' + JSON.stringify(l.slice(0, 30)))
    }
  })
})

describe('⛔ genuine same-container siblings are REPORTED, never resolved by picking', () => {
  test('identical siblings sharing an ancestor stay as separate entries', () => {
    const raw = [
      { nodeId: '1', role: { value: 'group' }, name: { value: '' }, backendDOMNodeId: 1, childIds: ['2', '3'] },
      { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Add' }, backendDOMNodeId: 2 },
      { nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Add' }, backendDOMNodeId: 3 }
    ]
    const out = readPage(raw, { maxNodes: 100, maxChars: 1e6, group: true })
    const adds = out.nodes.filter((n) => n.name === 'Add')
    assert.strictEqual(adds.length, 2, 'BOTH survive — hiding one is the pruner lying')
  })

  test('and the output SAYS they cannot be told apart', () => {
    const raw = [
      { nodeId: '1', role: { value: 'group' }, name: { value: '' }, backendDOMNodeId: 1, childIds: ['2', '3'] },
      { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Add' }, backendDOMNodeId: 2 },
      { nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Add' }, backendDOMNodeId: 3 }
    ]
    const out = readPage(raw, { maxNodes: 100, maxChars: 1e6, group: true })
    assert.ok(out.nodes.filter((n) => n.ambiguous).length === 2, 'both flagged ambiguous')
    assert.match(out.text, /indistinguishable/i,
      'a model must not be allowed to believe it chose correctly between them')
  })

  test('the real Wikipedia case is reported, not silently resolved', () => {
    const out = readPage(fixture('real-wikipedia-costco'), { maxNodes: 100000, maxChars: 1e9, group: true })
    const amb = out.nodes.filter((n) => n.ambiguous)
    assert.ok(amb.length > 0, 'the depth-8 identical siblings measured earlier must surface')
    assert.ok(amb.every((n) => !n.groupName), 'an unresolvable node is not given a misleading group')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE SEAM MUST BE PROVEN TO ISOLATE ONE THING.
 *
 * `opts.group === false` once skipped the container resolution entirely. Ambiguity is
 * DEFINED as 「a duplicate with no resolving container」, so the flat arm flagged 32 nodes
 * ambiguous and carried 「do NOT choose between them」 — a different treatment wearing the
 * word 「baseline」. Three A/B numbers were unreadable because of it.
 *
 * The first fix left a residue: flagging was keyed by NAME while resolution is by NODE, so a
 * name with some resolvable instances still diverged — 153 flagged flat against 134 grouped.
 *
 * These tests are the proof. HR-17: the rule is not 「build measurement tools」, it is
 * 「a seam must be PROVEN to isolate one thing, and the proof is not that you intended it to」.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('the A/B seam isolates grouping and nothing else', () => {
  const wide = { maxNodes: 100000, maxChars: 1e9, group: true }
  for (const page of ['real-costco-search', 'real-mdn-css', 'real-wikipedia-costco']) {
    test(`${page}: ambiguity is IDENTICAL in both arms`, () => {
      const flat = readPage(fixture(page), { ...wide, group: false })
      const grouped = readPage(fixture(page), wide)
      const amb = (v) => v.nodes.filter((n) => n.ambiguous).map((n) => n.ref).sort()
      assert.deepStrictEqual(amb(flat), amb(grouped),
        'the flat arm must not be told anything the grouped arm is not')
      assert.strictEqual(
        /indistinguishable/.test(flat.text), /indistinguishable/.test(grouped.text),
        'the do-not-choose warning must appear in both arms or neither')
    })

    test(`${page}: the arms show the SAME nodes and differ only by group lines`, () => {
      const flat = readPage(fixture(page), { ...wide, group: false })
      const grouped = readPage(fixture(page), wide)
      assert.deepStrictEqual(
        flat.nodes.map((n) => n.ref).sort(), grouped.nodes.map((n) => n.ref).sort(),
        'at an unbounded budget both arms must show the same nodes')
      assert.strictEqual(flat.groupCount, 0)
      assert.ok(grouped.groupCount > 0)
    })
  }
})

describe('grouping is OFF by default — Owner ruling on measurement, 2026-08-06', () => {
  test('the default output has no group lines', () => {
    const out = readPage(fixture('real-costco-search'))
    assert.strictEqual(out.groupCount, 0)
    assert.doesNotMatch(out.text, /^\[#r[0-9a-f]{8}\] group /m)
  })

  test('only an explicit group:true turns it on', () => {
    for (const v of [undefined, false, null, 0, 1, 'true']) {
      assert.strictEqual(readPage(fixture('real-costco-search'), { group: v }).groupCount, 0,
        'value: ' + String(v))
    }
    assert.ok(readPage(fixture('real-costco-search'), { group: true }).groupCount > 0)
  })

  test('the default keeps the coverage grouping was costing', () => {
    // The four targets that grouping cut, back where they belong.
    const costco = readPage(fixture('real-costco-search'))
    assert.ok(costco.nodes.some((n) => n.name === 'Clear All Filters'))
    const wiki = readPage(fixture('real-wikipedia-costco'))
    assert.ok(wiki.nodes.some((n) => n.name === 'Jump to content'))
    assert.ok(wiki.nodes.some((n) => n.name === 'Main menu'))
  })

  test('document order is PRESERVED — it is what disambiguates, and it is load-bearing now', () => {
    // 「我對住一個按文件次序輸出嘅嘢，寫咗『冇位置』。」 The product link must stay
    // immediately above its own Add to Cart button, because that adjacency IS the answer.
    const out = readPage(fixture('real-costco-search'))
    const lines = out.text.split('\n')
    const i = lines.findIndex((l) => /link "Bounty Plus Paper Towel/.test(l))
    assert.ok(i >= 0, 'the Bounty link is shown')
    assert.match(lines[i + 1], /button "Add to Cart"/,
      'its cart button must be the very next line — this adjacency is now a tested property')
  })
})
