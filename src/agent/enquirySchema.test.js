'use strict'

/**
 * enquirySchema.test.js — the result contract, and the local re-check of it.
 *
 * The CLI validates against `--json-schema` on its side. These tests are about OUR side: what
 * arrives may be truncated, may be an error object, may be from a build that ignored the flag.
 * Every case below is one of those, and every one of them must be a failure rather than a
 * result that merely looks thin.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  ENQUIRY_JSON_SCHEMA, validateEnquiryPayload, verifyCitations, isInside, REASON, CITATION
} = require('./enquirySchema')

const good = () => ({
  answer: 'the module refuses on a missing hash',
  citations: [{ path: 'a.js', startLine: 2, endLine: 2, quote: 'const b = 2' }],
  notEstablished: ['whether the caller checks it']
})

describe('the schema we hand to --json-schema', () => {
  test('it is a closed object: the CLI is told exactly what is allowed', () => {
    assert.strictEqual(ENQUIRY_JSON_SCHEMA.type, 'object')
    assert.strictEqual(ENQUIRY_JSON_SCHEMA.additionalProperties, false)
    assert.deepStrictEqual(ENQUIRY_JSON_SCHEMA.required, ['answer', 'citations', 'notEstablished'])
  })

  test('a citation must carry a file, a line range AND the quoted text', () => {
    const c = ENQUIRY_JSON_SCHEMA.properties.citations.items
    assert.deepStrictEqual(c.required, ['path', 'startLine', 'endLine', 'quote'])
    assert.strictEqual(c.additionalProperties, false)
    // A finding nobody can look up is the failure this whole path exists to avoid.
    assert.strictEqual(c.properties.startLine.minimum, 1)
  })

  test('every string is bounded, so a result cannot be an essay', () => {
    assert.ok(ENQUIRY_JSON_SCHEMA.properties.answer.maxLength > 0)
    assert.ok(ENQUIRY_JSON_SCHEMA.properties.citations.maxItems > 0)
    assert.ok(ENQUIRY_JSON_SCHEMA.properties.citations.items.properties.quote.maxLength > 0)
  })
})

describe('the local validator refuses everything malformed', () => {
  test('a well-formed envelope passes', () => {
    assert.strictEqual(validateEnquiryPayload(good()).ok, true)
  })

  for (const [name, payload, reason] of [
    ['null', null, REASON.NOT_AN_OBJECT],
    ['an array', [], REASON.NOT_AN_OBJECT],
    ['a string', 'ok', REASON.NOT_AN_OBJECT],
    ['a number', 7, REASON.NOT_AN_OBJECT],
    ['a missing answer', { citations: [], notEstablished: [] }, REASON.MISSING_FIELD],
    ['a missing citations', { answer: 'a', notEstablished: [] }, REASON.MISSING_FIELD],
    ['a missing notEstablished', { answer: 'a', citations: [] }, REASON.MISSING_FIELD],
    ['an extra top-level field', Object.assign(good(), { extra: 1 }), REASON.UNKNOWN_FIELD],
    ['a non-string answer', Object.assign(good(), { answer: 42 }), REASON.WRONG_TYPE],
    ['a non-array citations', Object.assign(good(), { citations: 'a.js' }), REASON.WRONG_TYPE],
    ['a citation that is not an object', Object.assign(good(), { citations: ['a.js'] }), REASON.WRONG_TYPE],
    ['a citation missing its quote', Object.assign(good(), { citations: [{ path: 'a.js', startLine: 1, endLine: 1 }] }), REASON.MISSING_FIELD],
    ['a citation with an extra field', Object.assign(good(), { citations: [{ path: 'a.js', startLine: 1, endLine: 1, quote: 'q', why: 'x' }] }), REASON.UNKNOWN_FIELD],
    ['a float line number', Object.assign(good(), { citations: [{ path: 'a.js', startLine: 1.5, endLine: 2, quote: 'q' }] }), REASON.WRONG_TYPE],
    ['a descending line range', Object.assign(good(), { citations: [{ path: 'a.js', startLine: 9, endLine: 2, quote: 'q' }] }), REASON.BAD_LINE_RANGE],
    ['a zero start line', Object.assign(good(), { citations: [{ path: 'a.js', startLine: 0, endLine: 2, quote: 'q' }] }), REASON.BAD_LINE_RANGE],
    ['an empty path', Object.assign(good(), { citations: [{ path: '', startLine: 1, endLine: 1, quote: 'q' }] }), REASON.WRONG_TYPE],
    ['an over-long answer', Object.assign(good(), { answer: 'x'.repeat(20001) }), REASON.OUT_OF_BOUNDS],
    ['an over-long quote', Object.assign(good(), { citations: [{ path: 'a.js', startLine: 1, endLine: 1, quote: 'x'.repeat(401) }] }), REASON.OUT_OF_BOUNDS],
    ['a non-string notEstablished item', Object.assign(good(), { notEstablished: [1] }), REASON.WRONG_TYPE]
  ]) {
    test('refuses ' + name, () => {
      const r = validateEnquiryPayload(payload)
      assert.strictEqual(r.ok, false, name + ' must not pass')
      assert.strictEqual(r.reason, reason, name + ' → wrong reason: ' + r.reason)
    })
  }

  test('an INHERITED answer is not an answer this object supplied', () => {
    const proto = { answer: 'inherited', citations: [], notEstablished: [] }
    const payload = Object.create(proto)
    assert.strictEqual(validateEnquiryPayload(payload).ok, false)
  })
})

describe('containment is resolved, not spelled', () => {
  let root, inside, sibling
  test('setup: real directories in a disposable place', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-enq-test-'))
    inside = path.join(root, 'copy'); fs.mkdirSync(inside)
    // ⛔ THE PREFIX TRAP: 'copy-2' starts with the characters of 'copy' but is a sibling.
    sibling = path.join(root, 'copy-2'); fs.mkdirSync(sibling)
    assert.ok(fs.existsSync(inside) && fs.existsSync(sibling))
  })

  test('a directory inside the copy is inside it', () => {
    assert.strictEqual(isInside(inside, inside), true)
    const sub = path.join(inside, 'sub'); fs.mkdirSync(sub, { recursive: true })
    assert.strictEqual(isInside(inside, sub), true)
  })

  test('a SIBLING sharing the name prefix is NOT inside', () => {
    assert.strictEqual(isInside(inside, sibling), false,
      'string-prefix containment would have accepted this, and that is the defect')
  })

  test('a parent is not inside its child', () => {
    assert.strictEqual(isInside(inside, root), false)
  })

  test('Windows case differences do not change the answer', { skip: process.platform !== 'win32' }, () => {
    assert.strictEqual(isInside(inside.toUpperCase(), inside.toLowerCase()), true)
  })

  // ⛔ CONTAINMENT AND EXISTENCE ARE DIFFERENT QUESTIONS, and the first version of this test
  // conflated them: it asserted that a non-existent path is not inside, which made a MISSING
  // file inside the copy report as a file OUTSIDE the copy — the alarming answer for the
  // harmless case. isInside now answers containment only; callers check existence themselves.
  test('a not-yet-existing path INSIDE the copy is still inside it', () => {
    assert.strictEqual(isInside(inside, path.join(inside, 'nope', 'nowhere')), true)
  })

  test('a not-yet-existing path OUTSIDE the copy is still outside it', () => {
    assert.strictEqual(isInside(inside, path.join(sibling, 'nope')), false)
  })
})

describe('citations are checked against the copy, and unverified is said out loud', () => {
  let dir
  const setup = () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-enq-cite-'))
    fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 1\nconst b = 2\nconst c = 3\n')
    return dir
  }

  test('a citation whose quote really is at those lines is CONFIRMED', () => {
    const d = setup()
    const r = verifyCitations({ answer: 'a', notEstablished: [], citations: [{ path: 'a.js', startLine: 2, endLine: 2, quote: 'const b = 2' }] }, { cwd: d })
    assert.strictEqual(r.rows[0].status, CITATION.CONFIRMED)
    assert.strictEqual(r.confirmed, 1)
    assert.strictEqual(r.allConfirmed, true)
    assert.strictEqual(r.evidence.length, 1, 'confirmed rows become evidence for the existing gate')
  })

  test('a quote that is NOT at those lines is a mismatch, not a pass', () => {
    const d = setup()
    const r = verifyCitations({ answer: 'a', notEstablished: [], citations: [{ path: 'a.js', startLine: 1, endLine: 1, quote: 'const b = 2' }] }, { cwd: d })
    assert.strictEqual(r.rows[0].status, CITATION.QUOTE_MISMATCH)
    assert.strictEqual(r.allConfirmed, false)
    assert.strictEqual(r.unverified, 1)
  })

  test('a line range past the end of the file is absent, not clamped', () => {
    const d = setup()
    const r = verifyCitations({ answer: 'a', notEstablished: [], citations: [{ path: 'a.js', startLine: 1, endLine: 99, quote: 'const a = 1' }] }, { cwd: d })
    assert.strictEqual(r.rows[0].status, CITATION.LINE_RANGE_ABSENT)
  })

  test('a path climbing out of the copy is refused', () => {
    const d = setup()
    const r = verifyCitations({ answer: 'a', notEstablished: [], citations: [{ path: '../escape.js', startLine: 1, endLine: 1, quote: 'x' }] }, { cwd: d })
    assert.strictEqual(r.rows[0].status, CITATION.OUTSIDE_COPY)
    assert.strictEqual(r.evidence.length, 0, 'an out-of-bounds citation must never become evidence')
  })

  test('an ABSOLUTE path outside the copy is refused too', () => {
    const d = setup()
    const r = verifyCitations({ answer: 'a', notEstablished: [], citations: [{ path: path.join(os.tmpdir(), 'elsewhere.js'), startLine: 1, endLine: 1, quote: 'x' }] }, { cwd: d })
    assert.strictEqual(r.rows[0].status, CITATION.OUTSIDE_COPY)
  })

  test('a missing file is UNREADABLE, and reported rather than skipped', () => {
    const d = setup()
    const r = verifyCitations({ answer: 'a', notEstablished: [], citations: [{ path: 'gone.js', startLine: 1, endLine: 1, quote: 'x' }] }, { cwd: d })
    assert.strictEqual(r.rows[0].status, CITATION.UNREADABLE)
    assert.strictEqual(r.rows.length, 1, 'it is still counted; silence would look like zero findings')
  })

  test('no citations at all is not "all confirmed"', () => {
    const d = setup()
    const r = verifyCitations({ answer: 'a', notEstablished: [], citations: [] }, { cwd: d })
    assert.strictEqual(r.allConfirmed, false, 'vacuous truth must not read as verified')
    assert.strictEqual(r.confirmed, 0)
  })
})

/* ══════════════ 2026-09-05 correction round ══════════════ */

describe('verification order: validate first, read the filesystem second', () => {
  test('⛔ a malformed payload never reaches a file read', () => {
    let reads = 0
    const r = verifyCitations(
      { answer: 'a', notEstablished: [], citations: [{ path: 42, startLine: 'x', endLine: 1, quote: 'q' }] },
      { cwd: os.tmpdir(), readFile: () => { reads += 1; return '' } }
    )
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.reason, REASON.NOT_VALIDATED)
    assert.strictEqual(reads, 0, 'an unvalidated path must not be handed to the filesystem')
  })

  test('a blank quote is refused by the validator, so it can never be CONFIRMED', () => {
    for (const q of ['', '   ', '\t\n']) {
      const v = validateEnquiryPayload({ answer: 'a', notEstablished: [], citations: [{ path: 'a.js', startLine: 1, endLine: 1, quote: q }] })
      assert.strictEqual(v.ok, false, JSON.stringify(q) + ' must be refused')
      assert.strictEqual(v.reason, REASON.EMPTY_QUOTE)
    }
  })

  test('the CLI schema and the local validator agree that a quote needs content', () => {
    assert.strictEqual(ENQUIRY_JSON_SCHEMA.properties.citations.items.properties.quote.minLength, 1)
    assert.strictEqual(ENQUIRY_JSON_SCHEMA.properties.citations.items.properties.path.minLength, 1)
  })
})

describe('a citation is a SAMPLE, and the evidence rows say so', () => {
  test('⛔ a confirmed citation is not dressed up as a complete survey', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-enq-ev-'))
    fs.writeFileSync(path.join(d, 'a.js'), 'l1\nl2\nl3\nl4\n')
    const r = verifyCitations(
      { answer: 'a', notEstablished: [], citations: [{ path: 'a.js', startLine: 2, endLine: 2, quote: 'l2' }] },
      { cwd: d }
    )
    const e = r.evidence[0]
    assert.strictEqual(e.completeness, 'sample', 'one excerpt of one file is not the whole source')
    assert.strictEqual(e.completeWithinScope, false)
    assert.strictEqual(e.sourceTotal, null, 'the wider source total is genuinely unknown')
    assert.strictEqual(e.shownCount, 1)
    assert.strictEqual(e.matchingTotal, 5, 'the file has 5 split parts including the trailing empty one')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('evidenceGate REFUSES a universal claim built on citation evidence', () => {
    const { checkEvidence } = require('./evidenceGate')
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-enq-gate-'))
    fs.writeFileSync(path.join(d, 'a.js'), 'l1\nl2\n')
    const r = verifyCitations(
      { answer: 'a', notEstablished: [], citations: [{ path: 'a.js', startLine: 1, endLine: 1, quote: 'l1' }] },
      { cwd: d }
    )
    const gate = checkEvidence({ claim: 'all callers check the hash', evidence: r.evidence })
    assert.strictEqual(gate.ok, false, 'citations cannot support a universal claim, and the existing gate is what says so')
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('realpath failures are not all the same failure', () => {
  test('a non-ENOENT realpath error refuses rather than climbing to a computed path', () => {
    const boom = () => { const e = new Error('denied'); e.code = 'EACCES'; throw e }
    assert.strictEqual(isInside(os.tmpdir(), path.join(os.tmpdir(), 'x'), boom), false,
      'EACCES means we could not see it; reasoning on a computed string would be a guess')
  })
})
