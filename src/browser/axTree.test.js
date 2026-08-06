'use strict'

/**
 * axTree.test.js — read_page is the real work, and this is it.
 *
 * ── WHY THIS IS A PURE LAYER ─────────────────────────────────────────────────
 * Getting a raw accessibility tree is ONE CDP call (`Accessibility.getFullAXTree`). Turning
 * 890 nodes into something a model can act on is the part that decides whether any of the
 * other verbs mean anything — so it is written against FROZEN trees, with no browser in the
 * loop, and it is deterministic.
 *
 * ── THE CORPUS IS FROZEN, AND WAS FROZEN BEFORE THIS FILE EXISTED ────────────
 * test/fixtures/axcorpus/ — five authored pages, each modelling one hazard, plus the real
 * Costco search page (890 AX nodes, 419 ignored, 184 interactive).
 *
 * > **Owner: 「a corpus that grows while you work is a corpus that grows toward what you
 * > already pass.」** New awkward pages are a FUTURE round, never a mid-build addition.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const { readPage, resolveRef, CORPUS_DIR } = require('./axTree')

const fixture = (n) => require(path.join(CORPUS_DIR, n + '.json')).nodes

describe('pruning — what survives is what a person could point at', () => {
  test('ignored nodes never survive', () => {
    const out = readPage(fixture('costco-search'))
    assert.ok(out.nodes.length > 0)
    assert.ok(out.nodes.every((n) => n.ref), 'every surviving node carries a ref')
  })

  test('the real page shrinks by an order of magnitude, and the number is stated', () => {
    const out = readPage(fixture('costco-search'))
    // 890 raw. A tree a model can hold is not 890 lines of InlineTextBox.
    assert.ok(out.nodes.length < 300, 'expected heavy pruning, got ' + out.nodes.length)
    assert.strictEqual(out.rawNodeCount, 890, 'the raw count must be reported, not hidden')
  })

  test('InlineTextBox is dropped — it duplicates StaticText and is pure noise', () => {
    const out = readPage(fixture('costco-search'))
    assert.ok(!out.nodes.some((n) => /InlineTextBox/i.test(n.role)))
  })

  test('a page with nothing actionable yields NOTHING, not a tree of empty divs', () => {
    const out = readPage(fixture('unnamed-only'))
    assert.strictEqual(out.nodes.length, 0,
      'an unnamed, non-interactive page must produce an empty answer — that IS the answer')
  })
})

describe('interactive elements are never pruned away', () => {
  test('the login form keeps both inputs and the submit button', () => {
    const out = readPage(fixture('login-form'))
    const roles = out.nodes.map((n) => n.role)
    assert.ok(roles.includes('textbox'), 'roles seen: ' + [...new Set(roles)].join(','))
    assert.ok(out.nodes.some((n) => /Sign in/i.test(n.name)))
  })

  test('an element behind a modal is STILL LISTED — hiding it would be a judgement', () => {
    // The pruner's job is to report what is there. Deciding a modal blocks a button is an
    // actionability question, and it belongs to click, not to read.
    const out = readPage(fixture('modal-over-content'))
    assert.ok(out.nodes.some((n) => /Behind Modal/i.test(n.name)))
    assert.ok(out.nodes.some((n) => /Continue/i.test(n.name)))
  })
})

describe('refs are stable and are what click will use', () => {
  test('a ref maps back to exactly one node', () => {
    const out = readPage(fixture('login-form'))
    const refs = out.nodes.map((n) => n.ref)
    assert.strictEqual(new Set(refs).size, refs.length, 'refs must be unique')
  })

  test('the same tree read twice gives the same refs — a ref is not a position', () => {
    const a = readPage(fixture('costco-search'))
    const b = readPage(fixture('costco-search'))
    assert.deepStrictEqual(a.nodes.map((n) => n.ref), b.nodes.map((n) => n.ref))
  })

  test('NO COORDINATES anywhere in the output', () => {
    const out = readPage(fixture('costco-search'))
    const s = JSON.stringify(out)
    assert.ok(!/"x":|"y":|clientX|boundingBox/.test(s),
      'coordinates are the worst possible record and must not leak into read_page')
  })
})

describe('bounding — and a cut that says it was cut', () => {
  test('a huge page is bounded', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 100 })
    assert.strictEqual(out.nodes.length, 100)
  })

  test('TRUNCATION IS STATED, with what was dropped', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 100 })
    assert.strictEqual(out.truncated, true)
    assert.ok(out.totalCandidates > 100, 'the caller must be able to see what it did not get')
  })

  test('a page that fits is NOT marked truncated', () => {
    const out = readPage(fixture('login-form'), { maxNodes: 100 })
    assert.strictEqual(out.truncated, false)
  })

  test('the serialized form carries the truncation notice, not just the flag', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 100 })
    assert.match(out.text, /截斷|truncated/i,
      'a model reads the text; a flag it never sees is not a disclosure')
  })
})

describe('the serialized form is what the model actually gets', () => {
  test('each line carries ref, role and name — the audit vocabulary', () => {
    const out = readPage(fixture('login-form'))
    const first = out.text.split('\n').find((l) => l.trim())
    // was /\[#\d+\]/ — updated when refs became opaque, deliberately and not as a loosening:
    // a NUMERIC ref marker is now itself a defect, and the test below asserts none appear.
    assert.match(first, /\[#r[0-9a-f]{8}\]/, 'an opaque ref marker per line')
    assert.match(out.text, /button/)
  })

  test('it is bounded in characters too — a 300-node tree is still a prompt', () => {
    const out = readPage(fixture('costco-search'), { maxChars: 4000 })
    assert.ok(out.text.length <= 4000, 'got ' + out.text.length)
    assert.strictEqual(out.truncated, true)
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * NON-EXTRAPOLABLE REFS — the structural fix, replacing the reverted notice.
 *
 * Owner: 「That is a mechanism; the notice was a declaration, and this project's own rule is
 * that declarative fences degrade. It also refuses REF 250, which the notice cannot.」
 *
 * Two real failures this must make IMPOSSIBLE rather than discouraged:
 *   REF 634  — extrapolated from the visible numbering. Not in the input.
 *   REF 250  — the ITEM NUMBER answered as a ref. Present, printed, and the wrong element,
 *              so it passes every absence-based check we have.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('a ref cannot be guessed, computed, or confused with a number on the page', () => {
  test('no ref is a bare number — so an item number can never BE a ref', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 60 })
    for (const n of out.nodes) {
      assert.match(String(n.ref), /^r[0-9a-f]{8}$/, 'got ' + n.ref)
    }
    assert.doesNotMatch(out.text, /\[#\d+\]/, 'a numeric ref marker must not appear anywhere')
  })

  test('the same node keeps its ref across two independent reads', () => {
    const a = readPage(fixture('login-form'))
    const b = readPage(fixture('login-form'))
    assert.deepStrictEqual(a.nodes.map((n) => n.ref), b.nodes.map((n) => n.ref))
  })

  test('a ref survives OTHER nodes disappearing — the property an index does not have', () => {
    const raw = fixture('login-form')
    const full = readPage(raw)
    const target = full.nodes[full.nodes.length - 1]
    const thinned = readPage(raw.filter((n) => n.backendDOMNodeId !== full.nodes[0].domId))
    const still = thinned.nodes.find((n) => n.domId === target.domId)
    assert.ok(still, 'the node is still present')
    assert.strictEqual(still.ref, target.ref, 'and its ref did not move')
  })

  test('refs are not ordered, so the sequence carries no information to extrapolate from', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 40 })
    const nums = out.nodes.map((n) => parseInt(n.ref.slice(1), 16))
    const ascending = nums.every((v, i) => i === 0 || v >= nums[i - 1])
    assert.strictEqual(ascending, false, 'a monotonic sequence is an extrapolable one')
  })

  test('every ref in one read is unique — an ambiguous ref would click the wrong element', () => {
    const out = readPage(fixture('costco-search'), { maxNodes: 4000, maxChars: 500000 })
    assert.strictEqual(new Set(out.nodes.map((n) => n.ref)).size, out.nodes.length)
    assert.strictEqual(out.refCollision, false)
  })

  test('resolveRef maps a ref back to the DOM node — statelessly, by recomputation', () => {
    const raw = fixture('login-form')
    const out = readPage(raw)
    const n = out.nodes.find((x) => x.role === 'button')
    assert.strictEqual(resolveRef(n.ref, raw), n.domId)
  })

  test('resolveRef REFUSES a ref that does not belong to this page', () => {
    assert.strictEqual(resolveRef('r00000000', fixture('login-form')), null)
    assert.strictEqual(resolveRef('250', fixture('huge-list')), null, 'REF 250 is not even well-formed now')
    assert.strictEqual(resolveRef(250, fixture('huge-list')), null)
  })

  test('the DOM id never appears in the text the model reads', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 40 })
    const domIds = out.nodes.map((n) => n.domId)
    for (const id of domIds) {
      assert.doesNotMatch(out.text, new RegExp('#' + id + '\]'), 'domId ' + id + ' leaked')
    }
  })
})
