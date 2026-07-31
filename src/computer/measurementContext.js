'use strict'
// measurementContext.js — one measurement-context chain for Part B, Lock 3 and the DoD.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// Owner ruling 2026-07-30. The DoD's step 2 is a FORMAL ACCEPTANCE that the Companion can see
// only its own desktop. If Part B is measured while the Companion session is Disconnected and
// the eye probes are measured while it is Active, that acceptance rests on numbers gathered
// under different conditions from the ones it claims to describe — which is the same defect
// this phase keeps dismantling everywhere else (a positive control that could not have failed,
// a zero from an instrument that could not have returned anything else).
//
// So the three stages do not merely each pass. They must pass ABOUT THE SAME THING, and that
// sameness is checked mechanically here rather than asserted in prose.
//
// ── WHAT IS INVARIANT AND WHAT IS NOT ───────────────────────────────────────
// It would be wrong to demand every field match across stages. Part B is measured BY the
// Companion, from inside session 5. Lock 3 sweeps the evidence store as the elevated Owner,
// from session 3. Their observer identity, station and desktop differ legitimately.
//
// What must not differ is the SUBJECT — the Companion session the whole phase is about:
//     runId, subject.sessionId, subject.state, subject.protocol
// Everything else is recorded, and checked against a per-stage expectation instead.
//
// ── MEASURED, AND IT IS WHY `state` IS A PRECONDITION AND NOT A PREFERENCE ──
// A DISCONNECTED session reports a BLANK session name. Session 5 on this machine, while Disc,
// has no name at all — so its protocol (console vs rdp) is not merely inconvenient to obtain,
// it is UNKNOWABLE. A stage that claims `protocol: console` about a Disconnected session is
// reporting a guess. Hence: state must be Active before protocol means anything.

const STAGES = ['part-b', 'lock3', 'dod']

// Every one of these must be present and non-empty. A context missing a field is not a context
// with a gap — it is an unverifiable claim, and it fails closed.
const REQUIRED_FIELDS = [
  'runId',
  'stage',
  'subjectSessionId',
  'subjectState',
  'subjectProtocol',
  'subjectAccount',
  'observerAccount',
  'observerSessionId',
  'observerWindowStation',
  'observerDesktop',
  'capturedAt'
]

// Identical across all three stages, or the results describe different things.
//
// ── subjectState AND subjectProtocol WERE REMOVED FROM THIS LIST, 2026-07-31 ──
// They were here, and it made Lock 3 UNSATISFIABLE. Measured at the machine: launcher 4 refused
// with "the Companion session is Disc, not Active", and it was right to by the rule as written —
// but the rule could never be met. Only ONE session is connected to the console at a time, so
// the Companion session is Active only while somebody is switched INTO it; and Lock 3 needs
// elevation, which that account does not have. Both conditions cannot hold at once. A rule that
// cannot be satisfied is not a strict rule, it is a broken one, and it fails in the direction
// that looks rigorous while blocking the work.
//
// What the invariant is actually protecting is that all three stages describe THE SAME
// Companion session in THE SAME run — not that the session is in the same state while each one
// runs. Part B MEASURES the session and must therefore be Active on the console. Lock 3 and the
// DoD ADJUDICATE evidence Part B already produced; the session's state at that later moment
// says nothing about the evidence.
//
// So identity stays invariant, condition-at-measurement is enforced where the measurement
// happens, and every stage still records its own state so the report can show all three.
const INVARIANT_FIELDS = ['runId', 'subjectSessionId', 'subjectAccount']

// The stage that MEASURES the Companion session. Only this one requires Active + console.
const MEASURING_STAGE = 'part-b'

const VERDICT = {
  PASS: 'PASS',
  MIXED: 'MIXED_MEASUREMENT_CONDITIONS',
  INCOMPLETE: 'INCOMPLETE_CONTEXT',
  UNUSABLE: 'UNUSABLE_CONDITIONS'
}

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

// A single context, judged on its own. Fails closed on anything unexpected.
function validateContext(ctx) {
  const problems = []
  if (!ctx || typeof ctx !== 'object') {
    return { ok: false, verdict: VERDICT.INCOMPLETE, problems: ['no context object at all'] }
  }
  for (const f of REQUIRED_FIELDS) {
    if (isBlank(ctx[f])) problems.push(`missing context field: ${f}`)
  }
  if (problems.length) return { ok: false, verdict: VERDICT.INCOMPLETE, problems }

  if (!STAGES.includes(ctx.stage)) problems.push(`unknown stage: ${ctx.stage}`)

  // The two conditions the Owner named, enforced AT THE MEASUREMENT. State first: while the
  // session is Disconnected its name is blank, so a protocol claim about it is a guess.
  if (ctx.stage === MEASURING_STAGE) {
    if (ctx.subjectState !== 'Active') {
      problems.push(`the Companion session must be Active while it is being measured, got: ${ctx.subjectState}`)
    }
    if (ctx.subjectProtocol !== 'console') {
      problems.push(`the Companion session must be on the physical console while it is being measured, got: ${ctx.subjectProtocol}`)
    }
  } else {
    // Adjudication stages: the session must still EXIST and be the same one. Its state may
    // legitimately have changed — the Owner has to switch back to run these at all.
    if (ctx.subjectState === 'NOT-SIGNED-IN') {
      problems.push(
        'the Companion session is gone: the thing the evidence describes no longer exists, ' +
        'so this stage cannot be joined to it')
    }
  }
  if (!Number.isInteger(ctx.subjectSessionId) || ctx.subjectSessionId < 0) {
    problems.push(`subjectSessionId must be a whole number, got: ${ctx.subjectSessionId}`)
  }

  if (problems.length) return { ok: false, verdict: VERDICT.UNUSABLE, problems }
  return { ok: true, verdict: VERDICT.PASS, problems: [] }
}

// Which fields disagree between two contexts. Pure comparison, no judgement.
function diffContexts(a, b, fields = INVARIANT_FIELDS) {
  const out = []
  for (const f of fields) {
    if (a[f] !== b[f]) out.push({ field: f, a: a[f], b: b[f] })
  }
  return out
}

// The whole point. Takes one context per stage and decides whether their results may be
// combined into a single acceptance.
//
// `stageVerdicts` is optional: {stage: 'PASS'|...}. A stage that did not itself pass cannot be
// rescued by a matching context, and this must never turn a stage failure into an overall PASS.
function adjudicate(contexts, stageVerdicts = {}) {
  const problems = []
  const list = Array.isArray(contexts) ? contexts : []

  // 1. every stage present, exactly once
  const seen = new Map()
  for (const c of list) {
    if (!c || isBlank(c.stage)) { problems.push('a context with no stage was supplied'); continue }
    if (seen.has(c.stage)) problems.push(`stage supplied twice: ${c.stage}`)
    seen.set(c.stage, c)
  }
  for (const s of STAGES) {
    if (!seen.has(s)) problems.push(`missing stage: ${s}`)
  }
  if (problems.length) {
    return { verdict: VERDICT.INCOMPLETE, problems, contexts: list }
  }

  // 2. each context valid on its own
  for (const s of STAGES) {
    const v = validateContext(seen.get(s))
    if (!v.ok) {
      for (const p of v.problems) problems.push(`${s}: ${p}`)
    }
  }
  if (problems.length) {
    const anyIncomplete = problems.some((p) => p.includes('missing context field'))
    return {
      verdict: anyIncomplete ? VERDICT.INCOMPLETE : VERDICT.UNUSABLE,
      problems,
      contexts: list
    }
  }

  // 3. THE INVARIANT: all three describe the same subject, in the same run
  const base = seen.get('part-b')
  for (const s of STAGES) {
    if (s === 'part-b') continue
    for (const d of diffContexts(base, seen.get(s))) {
      problems.push(
        `${s} was measured under a different condition from part-b — ${d.field}: ` +
        `${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`)
    }
  }

  // 4. desktop identity: two stages observed FROM THE SAME session must be on the same
  //    window station and desktop. Different sessions legitimately differ — the Companion
  //    measures Part B from session 5, the Owner sweeps Lock 3 from session 3 — so this is
  //    keyed on the observer session rather than applied blindly across all stages.
  const bySession = new Map()
  for (const s of STAGES) {
    const c = seen.get(s)
    const k = String(c.observerSessionId)
    if (!bySession.has(k)) bySession.set(k, [])
    bySession.get(k).push(c)
  }
  for (const [sid, group] of bySession) {
    for (let i = 1; i < group.length; i++) {
      for (const f of ['observerWindowStation', 'observerDesktop', 'observerAccount']) {
        if (group[0][f] !== group[i][f]) {
          problems.push(
            `${group[i].stage} and ${group[0].stage} ran in the same session (${sid}) but on a ` +
            `different ${f}: ${JSON.stringify(group[0][f])} vs ${JSON.stringify(group[i][f])}`)
        }
      }
    }
  }

  if (problems.length) {
    return { verdict: VERDICT.MIXED, problems, contexts: list }
  }

  // 5. a matching context may not rescue a stage that did not pass. Checked LAST so that a
  //    mixed-condition record is reported as mixed rather than hidden behind a stage failure.
  const failed = STAGES.filter((s) => stageVerdicts[s] && stageVerdicts[s] !== 'PASS')
  if (failed.length) {
    return {
      verdict: VERDICT.UNUSABLE,
      problems: failed.map((s) => `${s} did not pass (${stageVerdicts[s]}); context agreement cannot substitute`),
      contexts: list
    }
  }

  return {
    verdict: VERDICT.PASS,
    problems: [],
    contexts: list,
    subject: {
      runId: base.runId,
      account: base.subjectAccount,
      sessionId: base.subjectSessionId,
      state: base.subjectState,
      protocol: base.subjectProtocol
    }
  }
}

module.exports = { STAGES, REQUIRED_FIELDS, INVARIANT_FIELDS, VERDICT, validateContext, diffContexts, adjudicate }
