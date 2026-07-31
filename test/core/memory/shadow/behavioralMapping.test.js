'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const B = require('../../../../src/core/memory/shadow/behavioralMapping')
const { PERSONA_IDENTITY } = require('../../../../src/persona/xiangxiang')

const P = PERSONA_IDENTITY
function clone (mut) { const m = B.MAPPING.map((f) => ({ ...f })); if (mut) mut(m); return m }
function verify (persona, map) { return B.verifyBehavioralMapping(persona, map) }

// --- valid ------------------------------------------------------------------
test('valid Owner-approved mapping verifies against the live constant', () => {
  const r = verify(P, B.MAPPING)
  assert.equal(r.status, 'PASS')
  assert.equal(r.reconstituteOk, true)
  assert.equal(r.fragmentCount, 9)
  assert.equal(r.domainCounts.personality, 1)
  assert.equal(r.domainCounts['operating-principles'], 8)
  assert.equal(r.sourceCommit, 'e90cb5bbf73203053b1f67c4a6d1468db67edbff')
  assert.match(r.behavioralSectionSha256, /^[a-f0-9]{64}$/)
})

// --- markers ----------------------------------------------------------------
test('start / end marker missing or duplicated, and bad ordering, fail', () => {
  assert.equal(verify(P.replace(B.START_MARKER, 'XX'), B.MAPPING).reason, 'START_MARKER_NOT_ONCE')
  assert.equal(verify(P + B.START_MARKER, B.MAPPING).reason, 'START_MARKER_NOT_ONCE') // duplicate
  assert.equal(verify(P.replace(B.END_MARKER, 'YY'), B.MAPPING).reason, 'END_MARKER_NOT_ONCE')
  assert.equal(verify(P + B.END_MARKER, B.MAPPING).reason, 'END_MARKER_NOT_ONCE')
  const reordered = 'A' + B.END_MARKER + 'B' + B.START_MARKER + 'C'
  assert.equal(verify(reordered, B.MAPPING).reason, 'MARKER_ORDER_INVALID')
})

// --- fragment integrity -----------------------------------------------------
test('source commit / fragment hash mismatch fail', () => {
  assert.equal(verify(P, clone((m) => { m[0].sourceCommit = '0'.repeat(40) })).reason, 'SOURCE_COMMIT_MISMATCH')
  assert.equal(verify(P, clone((m) => { m[1].sha256Utf8 = '0'.repeat(64) })).reason, 'FRAGMENT_HASH_MISMATCH')
})

test('missing / duplicate / reorder fragments fail', () => {
  assert.equal(verify(P, clone((m) => { m.splice(4, 1) })).reason, 'SEQUENCE_NOT_CONTIGUOUS') // missing seq5
  assert.equal(verify(P, clone((m) => { m.push({ ...m[2] }) })).reason, 'SEQUENCE_NOT_CONTIGUOUS') // duplicate seq3
  assert.equal(verify(P, clone((m) => { const a = m[1].sequence; m[1].sequence = m[2].sequence; m[2].sequence = a })).reason, 'FRAGMENT_GAP_OR_OVERLAP') // reorder
})

test('gap / overlap / off-by-one code unit fail', () => {
  assert.equal(verify(P, clone((m) => { m[3].startCodeUnit = 1010 })).reason, 'FRAGMENT_GAP_OR_OVERLAP') // gap (prev end 1008)
  assert.equal(verify(P, clone((m) => { m[3].startCodeUnit = 1000 })).reason, 'FRAGMENT_GAP_OR_OVERLAP') // overlap
  assert.equal(verify(P, clone((m) => { m[0].endCodeUnit = 887; m[1].startCodeUnit = 887 })).reason, 'FRAGMENT_HASH_MISMATCH') // off-by-one -> hash breaks
})

test('unknown authority domain and double-domain overlap fail', () => {
  assert.equal(verify(P, clone((m) => { m[0].authorityDomain = 'foo' })).reason, 'UNKNOWN_AUTHORITY_DOMAIN')
  // same code-units claimed by a second domain -> overlap
  assert.equal(verify(P, clone((m) => { m.splice(2, 0, { ...m[1], sequence: 2.5, authorityDomain: 'operating-principles' }); m.forEach((f, i) => { f.sequence = i + 1 }) })).reason, 'FRAGMENT_GAP_OR_OVERLAP')
})

// --- Owner classification is honored exactly --------------------------------
test('only item-2 tone/style is personality; everything else is operating-principles', () => {
  const pers = B.MAPPING.filter((f) => f.authorityDomain === 'personality')
  assert.equal(pers.length, 1)
  assert.equal(pers[0].startCodeUnit, 886)
  assert.equal(pers[0].endCodeUnit, 952)
  assert.equal(pers[0].classificationRef, 'item-2-expression-style-tone')
  // item-2 honesty fragment [952,1008) is operating-principles, NOT personality
  const honesty = B.MAPPING.find((f) => f.startCodeUnit === 952)
  assert.equal(honesty.authorityDomain, 'operating-principles')
  // no personality fragment overlaps items 1,3,4,5,6,7,8 ranges
  const opRanges = B.MAPPING.filter((f) => f.authorityDomain === 'operating-principles')
  for (const p of pers) for (const o of opRanges) assert.ok(p.endCodeUnit <= o.startCodeUnit || p.startCodeUnit >= o.endCodeUnit, 'personality must not overlap an operating-principles range')
})

test('mapping stays strictly within the behavioral section (no Identity/Business/Runtime)', () => {
  const first = B.MAPPING[0]; const last = B.MAPPING[B.MAPPING.length - 1]
  assert.equal(first.startCodeUnit, P.indexOf(B.START_MARKER)) // 807
  assert.equal(last.endCodeUnit, P.indexOf(B.END_MARKER)) // 1586
})

// --- safety / isolation -----------------------------------------------------
test('verifier output is safe (no persona / fragment text)', () => {
  const s = JSON.stringify(verify(P, B.MAPPING))
  for (const leak of ['香香', '思考順序', '表達風格', 'Aroma Central Kitchen', '即時事實']) assert.equal(s.includes(leak), false)
})

test('buildPersonaSystem is byte-identical and unaffected by M3a', () => {
  const { buildPersonaSystem } = require('../../../../src/persona/xiangxiang')
  assert.equal(buildPersonaSystem('X'), buildPersonaSystem('X'))
  assert.ok(buildPersonaSystem('X').includes(P))
})

test('runtime entrypoints (index.js, app.js) never reach core/memory (incl. M3a)', () => {
  const SRC = path.resolve(__dirname, '../../../../src')
  const resolveReq = (fromDir, rel) => { const base = path.resolve(fromDir, rel); for (const c of [base, base + '.js', path.join(base, 'index.js')]) { try { if (fs.statSync(c).isFile()) return c } catch (e) {} } return null }
  const reach = (entry) => { const seen = new Set(); const stack = [path.resolve(entry)]; while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); let src; try { src = fs.readFileSync(f, 'utf8') } catch (e) { continue } const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let m; while ((m = re.exec(src))) { const t = resolveReq(path.dirname(f), m[1]); if (t) stack.push(t) } } return seen }
  for (const e of ['index.js', 'app.js']) {
    const leaks = [...reach(path.join(SRC, e))].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f))
    assert.deepEqual(leaks, [], `${e} must not reach core/memory`)
  }
})
