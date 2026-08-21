'use strict'

/**
 * readStateCorrectionConsistency.test.js — E2.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
 * The read-state correction and its `READ_CLAIM_CORRECTED` line came from two DIFFERENT
 * judgments of two DIFFERENT texts: telemetry from the model's DRAFT prose in intakeService,
 * visibility from whatever the renderer finally produced. Nothing coupled them, so they agreed
 * only by luck — and in one real conversation (2026-08-21) all three disagreements occurred:
 *
 *   Drive    c75d0eb9 — correction VISIBLE, telemetry MISSING
 *   Gmail    71824e3a — both fired (agreement by coincidence)
 *   Calendar 1f79bc3d — telemetry EMITTED, correction INVISIBLE
 *
 * ⛔ THE LAST ONE IS THE SERIOUS ONE, and it is not「the note was lost」. On the plan branch the
 * renderer DISCARDS the model's prose entirely, so a note about that prose would be a
 * correction about text nobody can see — which the codebase already refuses to show, on
 * purpose (rowRefAndFallbackWording.test.js:235). The screen was RIGHT. The log was wrong: it
 * counted a correction the Owner was never shown.
 *
 * ── SO E2 CHANGES THE COUNT, NOT THE SCREEN ──────────────────────────────────
 * Owner-visible correction behaviour is deliberately UNCHANGED on both branches — they have
 * opposite contracts and both are pinned by existing tests. What changes is that telemetry is
 * now read from `view.readClaim`: what the finished render actually put in front of him.
 *
 * ⛔ AND IT DOES NOT FIX THE REAL DEFECT. The model still denied reads that succeeded
 * (`modelItemCount: 0` on all five read turns of that conversation). E2 only guarantees that
 * when the deterministic guard does fire, the screen and the count say the same thing.
 */

const test = require('node:test')
const { describe } = require('node:test')
const assert = require('node:assert/strict')

const { buildReadResultReply } = require('./readResultView')
const { enforceReadState } = require('./readStateGuard')

const live = (source, count) => ({ source, trust: 'live', count, usedFallback: false })
const DENIAL = {
  drive: '我讀唔到 Google Drive 嘅資料。',
  gmail: '我讀唔到你嘅郵件內容。',
  calendar: '我讀唔到你嘅日曆。'
}
const ASK = { drive: '幫我睇下 Drive', gmail: '幫我睇下封郵件', calendar: '今個星期有咩安排?' }

/** The template branch: no answerPlan, so the model's prose IS the answer. */
const templateTurn = (source, reply, correction) => ({
  reply,
  message: ASK[source],
  perSource: [live(source, 4)],
  itemsBySource: [],
  evidenceSets: [],
  correction: correction === undefined ? null : correction
})

const NOTE_MARK = '系統更正'
const countOf = (hay, needle) => hay.split(needle).length - 1

/* ═══ A–C. ONE VISIBLE CORRECTION, ONE REPORTED OUTCOME, PER SOURCE ═══════════ */

describe('⛔ E2 — the screen and the count say the same thing', () => {
  for (const source of ['drive', 'gmail', 'calendar']) {
    test(`*** ${source}: a false denial over a live read → exactly one correction, reported once ***`, () => {
      const view = buildReadResultReply(templateTurn(source, DENIAL[source]))

      assert.equal(countOf(view.reply, NOTE_MARK), 1, 'exactly one visible correction')
      assert.ok(view.reply.includes('4 項'), 'stating the count actually read')
      assert.ok(view.readClaim, 'the view must report an outcome telemetry can be read from')
      assert.equal(view.readClaim.corrected, true, 'and it must report the correction it showed')
      assert.deepEqual(view.readClaim.sources, [source])
    })
  }

  test('*** D. a correct statement over a live read is byte-identical and reports nothing ***', () => {
    const honest = '我睇咗 Drive,搵到 4 樣嘢。'
    const view = buildReadResultReply(templateTurn('drive', honest))
    assert.equal(view.reply.includes(NOTE_MARK), false, 'no correction')
    assert.equal(view.readClaim.corrected, false, 'and nothing to count')
    assert.deepEqual(view.readClaim.sources, [])
  })

  test('*** G. no live read → the honest denial stands, uncorrected and uncounted ***', () => {
    const view = buildReadResultReply({
      reply: DENIAL.drive, message: ASK.drive, perSource: [], itemsBySource: [], evidenceSets: []
    })
    assert.equal(view.reply.includes(NOTE_MARK), false, 'a true denial must never be "corrected"')
    assert.equal(view.readClaim.corrected, false)
  })

  test('*** H. one live source cannot prove a different, unread one ***', () => {
    // Operation-grain safety: aroma_system being live says nothing about Drive.
    const view = buildReadResultReply({
      reply: DENIAL.drive,
      message: ASK.drive,
      perSource: [live('aroma_system', 2)],
      itemsBySource: [],
      evidenceSets: []
    })
    assert.equal(view.reply.includes(NOTE_MARK), false, 'an unrelated live read may not vouch for Drive')
    assert.equal(view.readClaim.corrected, false)
  })
})

/* ═══ E. A DISCARDED DRAFT MUST NOT BE COUNTED ═══════════════════════════════ */

describe('⛔ E2 — a correction about text nobody can see is not a correction', () => {
  test('*** E. the upstream note is neither shown nor counted when the prose is discarded ***', () => {
    // The plan branch renders rows and throws the model's prose away. The draft guard had
    // already produced a correction ABOUT that prose — the Calendar shape exactly.
    const draft = enforceReadState(DENIAL.calendar, [live('calendar', 3)], ASK.calendar)
    assert.equal(draft.corrected, true, 'precondition: the draft judgment did fire')

    const view = buildReadResultReply({
      reply: DENIAL.calendar,
      message: ASK.calendar,
      // an answerPlan routes to the branch that discards the prose
      answerPlan: { sections: [], directAnswer: '' },
      correction: draft.correction,
      readClaim: { corrected: draft.corrected, sources: draft.sources, kind: draft.kind },
      perSource: [live('calendar', 3)],
      itemsBySource: [],
      evidenceSets: []
    })

    assert.equal(view.reply.includes(NOTE_MARK), false,
      'THE PRODUCTION CONTRADICTION: a note about prose the Owner never saw')
    assert.equal(view.readClaim.corrected, false,
      'and the count must not claim he was told — this is the Calendar defect')
  })

  test('*** a false claim that IS on screen is still corrected and still counted ***', () => {
    // The other half: the plan's own visible text denies a live read.
    const view = buildReadResultReply({
      reply: '',
      message: ASK.calendar,
      answerPlan: { sections: [], directAnswer: DENIAL.calendar },
      perSource: [live('calendar', 3)],
      itemsBySource: [],
      evidenceSets: []
    })
    assert.equal(countOf(view.reply, NOTE_MARK), 1, 'shown → corrected')
    assert.equal(view.readClaim.corrected, true, 'shown → counted')
  })
})

/* ═══ F. EXACTLY ONCE ════════════════════════════════════════════════════════ */

describe('⛔ E2 — never twice', () => {
  test('*** F. a reply that already carries the correction does not get a second one ***', () => {
    const first = buildReadResultReply(templateTurn('drive', DENIAL.drive))
    assert.equal(countOf(first.reply, NOTE_MARK), 1)

    // Feed the already-corrected text back through: the denial is still in it, so a naive
    // re-judgment would append a duplicate.
    const second = buildReadResultReply({
      reply: first.reply, message: ASK.drive, perSource: [live('drive', 4)],
      itemsBySource: [], evidenceSets: []
    })
    assert.equal(countOf(second.reply, NOTE_MARK), 1, 'still exactly one — no duplicate note')
    assert.equal(second.readClaim.corrected, true, 'and it is still reported as corrected')
  })

  test('the template branch does not double up when the caller also supplies the note', () => {
    const draft = enforceReadState(DENIAL.gmail, [live('gmail', 4)], ASK.gmail)
    const view = buildReadResultReply(templateTurn('gmail', draft.reply, draft.correction))
    assert.equal(countOf(view.reply, NOTE_MARK), 1, 'carried + judged must still be one note')
  })
})

/* ═══ THE 1:1 STRUCTURAL PROOF ═══════════════════════════════════════════════ */

describe('⛔ E2 — visibility and telemetry cannot disagree', () => {
  test('*** ⛔ readClaim.corrected === (the note is on screen), across every shape ***', () => {
    const shapes = [
      templateTurn('drive', DENIAL.drive),
      templateTurn('gmail', DENIAL.gmail),
      templateTurn('calendar', DENIAL.calendar),
      templateTurn('drive', '我睇咗 Drive,搵到 4 樣嘢。'),
      { reply: DENIAL.drive, message: ASK.drive, perSource: [], itemsBySource: [], evidenceSets: [] },
      { reply: DENIAL.drive, message: ASK.drive, perSource: [live('aroma_system', 2)], itemsBySource: [], evidenceSets: [] },
      { reply: DENIAL.calendar, message: ASK.calendar, answerPlan: { sections: [], directAnswer: '' }, perSource: [live('calendar', 3)], itemsBySource: [], evidenceSets: [] },
      { reply: '', message: ASK.calendar, answerPlan: { sections: [], directAnswer: DENIAL.calendar }, perSource: [live('calendar', 3)], itemsBySource: [], evidenceSets: [] }
    ]
    for (const shape of shapes) {
      const view = buildReadResultReply(shape)
      const onScreen = view.reply.includes(NOTE_MARK)
      assert.equal(view.readClaim.corrected, onScreen,
        'the count and the screen disagreed — that is the whole defect E2 exists to close')
    }
  })

  test('*** ⛔ EVERY EXIT REPORTS AN OUTCOME — a silent exit would be an uncounted correction ***', () => {
    const shapes = [
      templateTurn('drive', DENIAL.drive),
      { reply: 'hello', message: 'hi', perSource: [], itemsBySource: [], evidenceSets: [] },
      { reply: '', message: 'x', answerPlan: { sections: [], directAnswer: '' }, perSource: [], itemsBySource: [], evidenceSets: [] },
      { reply: '好。', message: '你好', perSource: [live('drive', 1)], itemsBySource: [], evidenceSets: [] }
    ]
    for (const shape of shapes) {
      const view = buildReadResultReply(shape)
      assert.ok(view.readClaim && typeof view.readClaim.corrected === 'boolean',
        'every exit of buildReadResultReply must carry readClaim')
    }
  })

  test('the judgment is made against the FINAL text, not the draft handed in', () => {
    // Draft says nothing false; the plan's visible answer does. Judging the draft would miss it.
    const view = buildReadResultReply({
      reply: '好,我睇睇。',
      message: ASK.calendar,
      answerPlan: { sections: [], directAnswer: DENIAL.calendar },
      perSource: [live('calendar', 3)],
      itemsBySource: [],
      evidenceSets: []
    })
    assert.equal(view.readClaim.corrected, true, 'the final text is the one that counts')
    assert.ok(view.reply.includes(NOTE_MARK))
  })
})
