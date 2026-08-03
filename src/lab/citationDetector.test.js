'use strict'

/**
 * citationDetector.test.js — A′ narrowed: omit the reply only when it actually cited.
 *
 * The old rule asked "did this turn read context?" and threw away every reply — 5 of 5 in
 * the real archive, including ones containing nothing of anyone else's. The new rule asks
 * "did this REPLY draw on it?".
 *
 * The two mistakes are not equals, so the tests are not symmetric either. A false "cites"
 * costs a memory. A false "does not cite" writes someone else's mail to disk. Everything
 * here checks that doubt resolves toward omission.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { replyCitesContext, extractNeedles } = require('./citationDetector')
const { recordExchange } = require('./labArchiveHook')

/** A read-context block in the real rendered shape (readContext.js renderItem). */
const BLOCK = [
  '<external_read_context>',
  'Retrieved at: 2026-08-02T15:00:00.000Z',
  'These are read-only excerpts just retrieved from connected external sources …',
  '[gmail] "Supplier price increase for cooking oil" (dated Fri, 01 Aug 2026 09:12:00 -0500, Fri) id=18f2a1 https://mail.google.com/mail/u/0/#all/18f2a1 — Hi Chef, our oil price goes up 8% from September.',
  '[calendar] "Dentist appointment" (dated 2026-08-05T14:00:00-05:00, Tue) id=evt_77 https://calendar.google.com/x — ',
  '[drive] "Invoice Intake Phase 3 spec" (dated 2026-07-28T09:12:00Z, Mon) id=1AbCd https://drive.google.com/file/d/1AbCd — application/vnd.google-apps.document',
  '</external_read_context>'
].join('\n')

/* ── 1. THE OWNER'S TWO CASES ─────────────────────────────────────────────── */

test('*** read happened, reply cites NOTHING → body is KEPT ***', () => {
  const reply = '我建議你先做 X，然後再處理第二件事。今日先到呢度。'
  assert.equal(replyCitesContext(reply, BLOCK), false, 'nothing from the block appears in it')
})

test('*** reply quotes an email SUBJECT → body is OMITTED ***', () => {
  const reply = '你有一封關於 Supplier price increase for cooking oil 嘅郵件，要唔要回覆？'
  assert.equal(replyCitesContext(reply, BLOCK), true)
})

/* ── 2. POSITIVE CONTROL — the OLD condition fails the first case ─────────── */

test('*** POSITIVE CONTROL — the old rule would have omitted the non-citing reply ***', () => {
  const readContextUsed = true
  const oldOmit = readContextUsed !== false // the rule as it was
  assert.equal(oldOmit, true, 'the old rule omits purely because a read happened')

  const newOmit = (readContextUsed !== false) && (replyCitesContext('我建議你先做 X。', BLOCK) !== false)
  assert.equal(newOmit, false, 'the new rule keeps it')
  assert.notEqual(oldOmit, newOmit, 'the two rules genuinely disagree on this turn')
})

/* ── 3. citation in its several forms ─────────────────────────────────────── */

test('*** a paraphrase reusing a distinctive noun still counts as citation ***', () => {
  assert.equal(replyCitesContext('個 supplier 話 cooking oil 要加價。', BLOCK), true)
})

test('*** an id or a link is citation, and cannot occur by chance ***', () => {
  assert.equal(replyCitesContext('see 18f2a1', BLOCK), true)
  assert.equal(replyCitesContext('https://drive.google.com/file/d/1AbCd', BLOCK), true)
})

test('*** a calendar entry title counts too ***', () => {
  assert.equal(replyCitesContext('你 8 月 5 號有 Dentist appointment。', BLOCK), true)
})

test('*** naming a SOURCE is not citing its CONTENT ***', () => {
  // "I looked at your gmail" reveals nothing about anyone else and must not omit.
  assert.equal(replyCitesContext('我睇咗你個 gmail 同 calendar，冇特別急嘅嘢。', BLOCK), false)
})

/* ── 4. every doubt omits ─────────────────────────────────────────────────── */

test('*** no block, no reply, empty, or a broken block → CITES (omit) ***', () => {
  assert.equal(replyCitesContext('anything', null), true, 'no block is a doubt')
  assert.equal(replyCitesContext('anything', ''), true)
  assert.equal(replyCitesContext(null, BLOCK), true, 'no reply is a doubt')
  assert.equal(replyCitesContext('', BLOCK), true)
  assert.equal(replyCitesContext('anything', '<external_read_context>\nheader only\n</external_read_context>'), true,
    'a block with no item lines yields no needles, and that is a doubt')
})

test('*** only ITEM lines become needles — our own header never does ***', () => {
  // Otherwise every reply would look like a citation, and the narrowing would do nothing.
  const needles = extractNeedles(BLOCK)
  for (const w of ['retrieved', 'excerpts', 'external', 'sources', 'connected']) {
    assert.equal(needles.has(w), false, 'header word "' + w + '" must not be a needle')
  }
  assert.ok(needles.has('supplier price increase for cooking oil'), 'but a subject is')
})

test('*** the detector never returns or logs a needle ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'citationDetector.js'), 'utf8')
  assert.equal(/console\./.test(src), false, 'the needles ARE the third-party content')
  assert.equal(typeof replyCitesContext('x', BLOCK), 'boolean', 'the public answer is a boolean')
})

/* ── 5. end to end through the hook ───────────────────────────────────────── */

function fakeArchive () {
  const turns = []
  return { turns, appendTurn: (t) => { turns.push(t); return { ok: true, written: true, id: 'id_' + turns.length, omitted: t.omitBody === true } } }
}

function run (over) {
  const archive = fakeArchive()
  const res = recordExchange(Object.assign({
    env: { XIANGXIANG_ARCHIVE: 'on' },
    archive,
    conversationId: 'c1',
    message: '有咩要跟進？',
    reply: '我建議你先做 X。',
    turnIndex: 0,
    readContextUsed: true,
    readContextSources: ['gmail'],
    replyCitesContext: false
  }, over || {}))
  return { res, archive }
}

test('*** HOOK — read happened, reply cites nothing → the text is written ***', () => {
  const { res, archive } = run({})
  assert.equal(res.assistantOmitted, false)
  const asst = archive.turns.find((t) => t.role === 'assistant')
  assert.equal(asst.omitBody, undefined)
  assert.equal(asst.text, '我建議你先做 X。', 'the memory survives')
})

test('*** HOOK — reply cites → omission record, and the text never reaches the writer ***', () => {
  const { res, archive } = run({ replyCitesContext: true, reply: 'Supplier price increase for cooking oil' })
  assert.equal(res.assistantOmitted, true)
  const asst = archive.turns.find((t) => t.role === 'assistant')
  assert.equal(asst.omitBody, true)
  assert.equal(asst.text, undefined, 'not passed, not redacted, not truncated')
  assert.equal(asst.omissionReason, 'external_read_context', 'the omission record is unchanged')
  assert.deepEqual(asst.readContextSources, ['gmail'])
})

test('*** HOOK — an ABSENT replyCitesContext still omits (fail-safe) ***', () => {
  const { res } = run({ replyCitesContext: undefined })
  assert.equal(res.assistantOmitted, true, 'a pipeline that stops reporting loses bodies, not promises')
})

test('*** HOOK — no read context at all → kept, as before ***', () => {
  const { res, archive } = run({ readContextUsed: false, replyCitesContext: undefined })
  assert.equal(res.assistantOmitted, false)
  assert.equal(archive.turns.find((t) => t.role === 'assistant').text, '我建議你先做 X。')
})

test('*** HOOK — the user turn is ALWAYS kept, both ways ***', () => {
  for (const cites of [true, false]) {
    const { archive } = run({ replyCitesContext: cites })
    const user = archive.turns.find((t) => t.role === 'user')
    assert.equal(user.text, '有咩要跟進？')
    assert.equal(user.omitBody, undefined)
  }
})
