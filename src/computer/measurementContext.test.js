'use strict'
// measurementContext.test.js — the seven cases the Owner named, plus what they imply.
//
// These are not shape tests. Each one is a way the DoD could have accepted a conclusion that
// was not about the thing it claimed to be about, and every one of them is a real shape this
// phase has already produced at least once in another guise.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { STAGES, REQUIRED_FIELDS, VERDICT, validateContext, adjudicate } =
  require('./measurementContext')

// A complete, self-consistent chain: Companion Active on the physical console, one run, Part B
// measured from inside session 5, Lock 3 and the DoD from the Owner's session.
const RUN = 'a1b2c3d4e5f6'
const ctx = (stage, over = {}) => ({
  runId: RUN,
  stage,
  subjectAccount: 'AromaOperator',
  subjectSessionId: 5,
  subjectState: 'Active',
  subjectProtocol: 'console',
  observerAccount: stage === 'part-b' ? 'AromaOperator' : 'louis',
  observerSessionId: stage === 'part-b' ? 5 : 3,
  observerWindowStation: 'WinSta0',
  observerDesktop: 'Default',
  capturedAt: '2026-07-30T12:00:00.0000000-05:00',
  ...over
})
const chain = (over = {}) => STAGES.map((s) => ctx(s, over[s] || {}))

// ── 2. the same context across three stages passes ─────────────────────────
test('*** three stages measured under ONE context are accepted ***', () => {
  const r = adjudicate(chain())
  assert.equal(r.verdict, VERDICT.PASS, r.problems.join(' | '))
  assert.deepEqual(r.problems, [])
  assert.equal(r.subject.sessionId, 5)
  assert.equal(r.subject.state, 'Active')
  assert.equal(r.subject.protocol, 'console')
})

// ── 3. session id changes between stages ───────────────────────────────────
test('*** a changed Companion session id is refused ***', () => {
  // The Companion signed out and back in between Part B and the eye probes. Both stages can
  // pass individually and describe DIFFERENT sessions — exactly the merge the DoD must not do.
  const r = adjudicate(chain({ dod: { subjectSessionId: 7 } }))
  assert.equal(r.verdict, VERDICT.MIXED)
  assert.ok(r.problems.some((p) => /subjectSessionId/.test(p)), r.problems.join(' | '))
})

// ── 4. Active / Disconnected — enforced WHERE THE MEASUREMENT HAPPENS ───────
test('*** the MEASURING stage must be Active; a Disconnected Part B is refused ***', () => {
  const r = adjudicate(chain({ 'part-b': { subjectState: 'Disc' } }))
  assert.equal(r.verdict, VERDICT.UNUSABLE)
  assert.ok(r.problems.some((p) => /Active/.test(p)), r.problems.join(' | '))
})

test('*** an adjudicating stage MAY find the session Disconnected — and that is not a defect ***', () => {
  // CORRECTED 2026-07-31, at the machine, after the old rule blocked Lock 3 outright.
  // Only ONE session is on the console at a time, so the Companion session is Active only while
  // somebody is switched into it — and Lock 3 needs elevation, which that account does not have.
  // Demanding Active of every stage was therefore UNSATISFIABLE: it looked strict and simply
  // stopped the work. Part B measures the session; Lock 3 and the DoD adjudicate what Part B
  // already produced, and the session's state at that later moment says nothing about it.
  const r = adjudicate(chain({ lock3: { subjectState: 'Disc' }, dod: { subjectState: 'Disc' } }))
  assert.equal(r.verdict, VERDICT.PASS, r.problems.join(' | '))
})

test('*** but if the Companion session is GONE, adjudication cannot attach to it ***', () => {
  // The line that still has to hold: a different (or absent) session means the evidence is
  // about something that no longer exists.
  const r = adjudicate(chain({ lock3: { subjectState: 'NOT-SIGNED-IN' } }))
  assert.notEqual(r.verdict, VERDICT.PASS)
  assert.ok(r.problems.some((p) => /no longer exists/.test(p)), r.problems.join(' | '))
})

// ── 5. console vs RDP — same principle ─────────────────────────────────────
test('*** a Part B measured over RDP is refused ***', () => {
  const r = adjudicate(chain({ 'part-b': { subjectProtocol: 'rdp-tcp#0' } }))
  assert.equal(r.verdict, VERDICT.UNUSABLE)
  assert.ok(r.problems.some((p) => /console/.test(p)), r.problems.join(' | '))
})

test('*** the session id must still match, whatever its state ***', () => {
  // This is what actually stops two different sessions being stitched together, and it keeps
  // working after the state requirement was narrowed to the measuring stage.
  const r = adjudicate(chain({ lock3: { subjectSessionId: 7, subjectState: 'Disc' } }))
  assert.equal(r.verdict, VERDICT.MIXED)
  assert.ok(r.problems.some((p) => /subjectSessionId/.test(p)), r.problems.join(' | '))
})

// ── 6. evidence from different runs cannot be spliced ──────────────────────
test('*** stages from DIFFERENT runs cannot be stitched into one acceptance ***', () => {
  // The most tempting failure of all: Part B passed this morning, the eye probes passed this
  // afternoon after a reboot, and the numbers all look fine. Different runs, one report.
  const r = adjudicate(chain({ lock3: { runId: 'ffffffffffff' } }))
  assert.equal(r.verdict, VERDICT.MIXED)
  assert.ok(r.problems.some((p) => /runId/.test(p)), r.problems.join(' | '))
})

// ── 7. a missing context field cannot pass ─────────────────────────────────
test('*** every required field is load-bearing — each omission fails closed ***', () => {
  // Asserted field by field rather than once, so a later edit that quietly drops one from the
  // required list is caught by the test rather than by an unverifiable acceptance months on.
  for (const f of REQUIRED_FIELDS) {
    const c = ctx('part-b')
    delete c[f]
    const v = validateContext(c)
    assert.equal(v.ok, false, `omitting ${f} still validated`)
    assert.equal(v.verdict, VERDICT.INCOMPLETE, `omitting ${f} gave ${v.verdict}`)
  }
  // and blank/whitespace is treated as missing, not as a value
  assert.equal(validateContext(ctx('part-b', { subjectAccount: '   ' })).ok, false)
  assert.equal(validateContext(ctx('part-b', { runId: null })).ok, false)
})

test('*** a whole stage missing fails closed rather than passing on the other two ***', () => {
  const r = adjudicate(chain().filter((c) => c.stage !== 'dod'))
  assert.equal(r.verdict, VERDICT.INCOMPLETE)
  assert.ok(r.problems.some((p) => /missing stage: dod/.test(p)))
  assert.equal(adjudicate([]).verdict, VERDICT.INCOMPLETE)
  assert.equal(adjudicate(null).verdict, VERDICT.INCOMPLETE)
})

// ── desktop identity ───────────────────────────────────────────────────────
test('*** same session, different desktop, is refused ***', () => {
  // Two stages observed from the same session must be on the same station and desktop. A
  // desktop switch between them changes what "visible" meant, without changing any session id.
  const r = adjudicate(chain({ dod: { observerDesktop: 'Winlogon' } }))
  assert.equal(r.verdict, VERDICT.MIXED)
  assert.ok(r.problems.some((p) => /observerDesktop/.test(p)), r.problems.join(' | '))
})

test('*** different observer sessions may legitimately differ ***', () => {
  // The counterweight to the rule above: Part B is measured BY the Companion from session 5,
  // Lock 3 by the elevated Owner from session 3. Demanding one desktop across all stages would
  // make a correct run impossible, so the rule is keyed on the observing session.
  const r = adjudicate(chain())
  assert.equal(r.verdict, VERDICT.PASS)
  const partB = r.contexts.find((c) => c.stage === 'part-b')
  const lock3 = r.contexts.find((c) => c.stage === 'lock3')
  assert.notEqual(partB.observerSessionId, lock3.observerSessionId)
  assert.notEqual(partB.observerAccount, lock3.observerAccount)
})

// ── a matching context may not rescue a failed stage ───────────────────────
test('*** context agreement cannot turn a failed stage into a PASS ***', () => {
  const r = adjudicate(chain(), { lock3: 'FAIL' })
  assert.notEqual(r.verdict, VERDICT.PASS)
  assert.equal(r.verdict, VERDICT.UNUSABLE)
  assert.ok(r.problems.some((p) => /lock3 did not pass/.test(p)))
})

test('*** a mixed record is reported as MIXED even when a stage also failed ***', () => {
  // Ordering matters for the diagnosis the Owner reads: "these results are not about the same
  // thing" is the more fundamental defect, and must not be hidden behind "one stage failed".
  const r = adjudicate(chain({ dod: { subjectSessionId: 9 } }), { lock3: 'FAIL' })
  assert.equal(r.verdict, VERDICT.MIXED)
})

// ── the PowerShell capture side must agree with this module ────────────────
test('*** the PowerShell capture emits exactly the fields this module requires ***', () => {
  // Two languages, one contract. The classic way this rots is a field renamed on one side
  // only, which shows up as an INCOMPLETE_CONTEXT at the machine with nobody able to read it.
  const ps = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'scripts', 'computer', 'measurementContext.ps1'), 'utf8')
  for (const f of REQUIRED_FIELDS) {
    assert.match(ps, new RegExp('\\b' + f + '\\s*='), `capture script never sets ${f}`)
  }
  // and it must refuse the same two conditions rather than leaving it to the adjudicator
  assert.match(ps, /Active/, 'capture must know the Active requirement')
  assert.match(ps, /console/, 'capture must know the console requirement')
})
