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
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9 })
    const carts = out.nodes.filter((n) => n.name === 'Add to Cart')
    assert.strictEqual(carts.length, 21, 'all 21 still present — the page has 21')
    const containers = carts.map((c) => c.groupName)
    assert.strictEqual(containers.filter(Boolean).length, 21, 'each one names its product')
    assert.strictEqual(new Set(containers).size, 21, 'and the 21 names are distinct')
  })

  test('Bounty resolves to the Bounty button, and it is not the first on the page', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9 })
    const bounty = out.nodes.filter((n) => n.name === 'Add to Cart' && /Bounty/.test(n.groupName || ''))
    assert.strictEqual(bounty.length, 1)
    assert.strictEqual(bounty[0].domId, 2747, 'the frozen key says 2747')
  })

  test('the serialized form nests members under their group', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9 })
    const lines = out.text.split('\n')
    const gi = lines.findIndex((l) => /group "Bounty Plus/.test(l))
    assert.ok(gi >= 0, 'a group line exists')
    assert.match(lines[gi + 1] || '', /^ {2}\[#r/, 'members are indented under it')
  })

  test('UNAMBIGUOUS nodes get no group — context is earned, never universal', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9 })
    const solo = out.nodes.find((n) => n.name === 'Clear All Filters')
    assert.ok(solo)
    assert.strictEqual(solo.groupName, undefined, 'a unique name needs no context')
  })

  test('output nesting is at most ONE level, whatever the DOM depth', () => {
    const out = readPage(fixture('real-costco-search'), { maxNodes: 100000, maxChars: 1e9 })
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
    const out = readPage(raw, { maxNodes: 100, maxChars: 1e6 })
    const adds = out.nodes.filter((n) => n.name === 'Add')
    assert.strictEqual(adds.length, 2, 'BOTH survive — hiding one is the pruner lying')
  })

  test('and the output SAYS they cannot be told apart', () => {
    const raw = [
      { nodeId: '1', role: { value: 'group' }, name: { value: '' }, backendDOMNodeId: 1, childIds: ['2', '3'] },
      { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Add' }, backendDOMNodeId: 2 },
      { nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Add' }, backendDOMNodeId: 3 }
    ]
    const out = readPage(raw, { maxNodes: 100, maxChars: 1e6 })
    assert.ok(out.nodes.filter((n) => n.ambiguous).length === 2, 'both flagged ambiguous')
    assert.match(out.text, /indistinguishable/i,
      'a model must not be allowed to believe it chose correctly between them')
  })

  test('the real Wikipedia case is reported, not silently resolved', () => {
    const out = readPage(fixture('real-wikipedia-costco'), { maxNodes: 100000, maxChars: 1e9 })
    const amb = out.nodes.filter((n) => n.ambiguous)
    assert.ok(amb.length > 0, 'the depth-8 identical siblings measured earlier must surface')
    assert.ok(amb.every((n) => !n.groupName), 'an unresolvable node is not given a misleading group')
  })
})
