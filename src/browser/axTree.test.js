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
const { readPage, CORPUS_DIR } = require('./axTree')

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
    assert.match(first, /\[#\d+\]/, 'a ref marker per line')
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
 * THE TRUNCATION NOTICE — rewritten after the benchmark caught it failing.
 *
 * Benchmark 2026-08-06: on the truncated huge-list the model answered `REF 634` — a ref
 * that was NOT in its input. A real node (`link "Item 210"`) that the pruner had cut,
 * reached by EXTRAPOLATING the ref numbering from the visible lines. The true ref was 754.
 *
 * The old notice was one line, in Chinese, AFTER 250 lines of data, and it said that
 * unshown things may exist. It never said the two things that would have stopped this:
 * that refs are not sequential, and that only a ref printed above may be answered.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('the truncation notice must stop an extrapolation, not just disclose a cut', () => {
  test('the boundary is declared BEFORE the data, not only after it', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 100 })
    const firstNodeLine = out.text.split('\n').findIndex((l) => l.startsWith('[#'))
    const head = out.text.slice(0, out.text.indexOf('[#'))
    assert.ok(firstNodeLine > 0, 'something must precede the first node line')
    assert.match(head, /truncated/i,
      'a limit announced after 250 lines is announced to a reader who has stopped reading')
  })

  test('it says refs are NOT sequential — the exact move the model made', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 100 })
    assert.match(out.text, /not sequential|do not (?:infer|extrapolate|guess)/i)
  })

  test('it forbids answering with a ref that is not printed', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 100 })
    assert.match(out.text, /only .*(?:ref|refs).*(?:appear|printed|listed|shown)/i)
  })

  test('it states the counts so the model knows how much is missing', () => {
    const out = readPage(fixture('huge-list'), { maxNodes: 100 })
    assert.match(out.text, /100\b/)
    assert.match(out.text, new RegExp(String(out.totalCandidates)))
  })

  test('an untruncated page carries NO notice — a warning that always fires is ignored', () => {
    const out = readPage(fixture('login-form'), { maxNodes: 100 })
    assert.strictEqual(out.truncated, false)
    assert.doesNotMatch(out.text, /truncated/i)
    assert.ok(out.text.startsWith('[#'), 'no header at all when nothing was cut')
  })

  test('the character-budget cut states itself exactly as the count cut does', () => {
    const out = readPage(fixture('costco-search'), { maxChars: 4000 })
    assert.strictEqual(out.truncated, true)
    assert.match(out.text.slice(0, out.text.indexOf('[#')), /truncated/i)
    assert.ok(out.text.length <= 4000, 'the notice must fit INSIDE the budget, got ' + out.text.length)
  })
})
