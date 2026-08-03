'use strict'

/**
 * conversationRecall.test.js — memory that is honest about its own holes.
 *
 * The single most likely failure of a recall layer is not that it forgets — it is that it
 * fills a gap. Half this archive is omission records by design (Owner decision A′), so a
 * renderer that leaves those blank is handing the model a question with no answer beside
 * it, and the most probable completion is an invented one.
 *
 * Every test here is therefore about what the block SAYS, and each rule has a control
 * showing the assertion can fail.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { buildConversationRecall, renderTurn, SAFETY_HEADER, CAPS, OPEN, CLOSE } = require('./conversationRecall')

const T = (over) => Object.assign({
  schemaVersion: 2,
  id: 'turn_' + Math.random().toString(16).slice(2, 10),
  conversationId: 'conv_a',
  turnIndex: 0,
  role: 'user',
  at: '2026-08-01T15:00:00.000Z',
  model: 'claude-haiku-4-5-20251001',
  provider: 'claude',
  lane: 'chat',
  text: 'hello',
  omitted: false,
  redactedKinds: []
}, over)

const OMITTED = (over) => T(Object.assign({
  role: 'assistant',
  text: null,
  omitted: true,
  omissionReason: 'external_read_context',
  readContextSources: ['gmail', 'drive'],
  redactedKinds: null
}, over))

function build (records, opts) {
  return buildConversationRecall(Object.assign({ readRecordsFn: () => records }, opts || {}))
}

/* ── 1. THE POINT: it answers "我哋上次做到邊" ─────────────────────────────── */

test('*** previous conversations become a readable block, newest conversation first ***', () => {
  const r = build([
    T({ conversationId: 'conv_old', at: '2026-07-30T10:00:00.000Z', text: 'older topic' }),
    T({ conversationId: 'conv_new', at: '2026-08-01T15:00:00.000Z', text: 'we were setting up the archive' }),
    T({ conversationId: 'conv_new', at: '2026-08-01T15:01:00.000Z', role: 'assistant', text: 'the flag is on now' })
  ])
  assert.equal(r.status, 'READY')
  assert.ok(r.block.startsWith(OPEN) && r.block.endsWith(CLOSE))
  assert.match(r.block, /we were setting up the archive/)
  assert.match(r.block, /the flag is on now/)
  assert.ok(r.block.indexOf('conv_new') < r.block.indexOf('conv_old'), 'newest conversation first')
})

test('*** every line carries a DATE, so any claim can be sourced ***', () => {
  const r = build([T({ text: 'a thing we said' })])
  // 2026-08-01T15:00Z is 10:00 in Winnipeg (CDT).
  assert.match(r.block, /\[2026-08-01 10:00\] Owner: a thing we said/)
  assert.match(r.block, /conversation conv_a/, 'and its conversation id')
  assert.match(SAFETY_HEADER, /cite the date/)
})

/* ── 2. THE HONESTY RULE: an omitted reply is STATED, never blank ─────────── */

test('*** an omitted assistant turn is rendered as an explicit absence ***', () => {
  const line = renderTurn(OMITTED(), CAPS)
  assert.match(line, /\[reply not retained/, 'the absence is stated')
  assert.match(line, /the turn used external read context/, 'with the reason')
  assert.match(line, /sources consulted: gmail, drive/, 'and which connectors, which is a fact about the Owner\'s own setup')
  assert.equal(/null|undefined|\[empty\]/.test(line), false, 'and never a placeholder that reads as content')
})

test('*** POSITIVE CONTROL — a blank rendering would be caught ***', () => {
  const blank = '[2026-08-01 10:00] 香香:'
  assert.throws(() => assert.match(blank, /\[reply not retained/),
    'a bare heading with nothing after it must not pass')
})

test('*** the header tells the model it DOES NOT KNOW what it said ***', () => {
  assert.match(SAFETY_HEADER, /DO NOT KNOW what you said/)
  assert.match(SAFETY_HEADER, /never reconstruct, guess, or imply you remember it/)
})

test('*** an omitted record\'s text is never read, even if a caller wrongly supplies it ***', () => {
  // The writer refuses to store text on this path; the reader must not resurrect it either.
  const sneaky = OMITTED({ text: 'THIS-SHOULD-NEVER-APPEAR' })
  const line = renderTurn(sneaky, CAPS)
  assert.equal(line.includes('THIS-SHOULD-NEVER-APPEAR'), false)

  const r = build([sneaky, T({ text: 'a real user turn' })])
  assert.equal(r.block.includes('THIS-SHOULD-NEVER-APPEAR'), false, 'nor anywhere in the block')
})

/* ── 3. discussed ≠ decided ────────────────────────────────────────────────── */

test('*** the header forbids treating a discussion as a decision ***', () => {
  assert.match(SAFETY_HEADER, /DISCUSSED is not something that was DECIDED/)
  assert.match(SAFETY_HEADER, /NOT approvals, and NOT decisions/)
  assert.match(SAFETY_HEADER, /MEMORY, for continuity/)
})

test('*** and to say so when memory has nothing ***', () => {
  assert.match(SAFETY_HEADER, /say you do not have it in memory rather than inferring/)
})

/* ── 4. the live conversation is not memory ───────────────────────────────── */

test('*** the CURRENT conversation is excluded ***', () => {
  const recs = [
    T({ conversationId: 'conv_past', text: 'last time' }),
    T({ conversationId: 'conv_now', text: 'right now', at: '2026-08-02T15:00:00.000Z' })
  ]
  const r = build(recs, { currentConversationId: 'conv_now' })
  assert.match(r.block, /last time/)
  assert.equal(r.block.includes('right now'), false, 'she must not quote the live turn back at the Owner')
})

test('*** an archive containing ONLY the current conversation yields nothing ***', () => {
  const r = build([T({ conversationId: 'conv_now' })], { currentConversationId: 'conv_now' })
  assert.equal(r.block, null)
  assert.equal(r.status, 'NO_RECORDS')
})

/* ── 5. absent / broken archive is silence, not a crash ───────────────────── */

test('*** no archive file at all → no block, no throw ***', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-'))
  try {
    const r = buildConversationRecall({ root: dir })
    assert.equal(r.block, null)
    assert.equal(r.status, 'NO_RECORDS')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('*** a corrupt line is skipped; the rest of the memory survives ***', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-'))
  try {
    fs.writeFileSync(path.join(dir, 'archive.jsonl'),
      JSON.stringify(T({ text: 'first' })) + '\n' +
      '{ this is not json\n' +
      JSON.stringify(T({ text: 'second', at: '2026-08-01T16:00:00.000Z' })) + '\n')
    const r = buildConversationRecall({ root: dir })
    assert.match(r.block, /first/)
    assert.match(r.block, /second/, 'one bad line must not cost the whole memory')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

/* ── 6. caps ─────────────────────────────────────────────────────────────── */

test('*** the block is bounded, and stops at a whole conversation ***', () => {
  const recs = []
  for (let c = 0; c < 8; c++) {
    for (let i = 0; i < 10; i++) {
      recs.push(T({ conversationId: 'conv_' + c, at: '2026-08-0' + (1 + (c % 2)) + 'T1' + i + ':00:00.000Z', text: 'x'.repeat(300) }))
    }
  }
  const r = build(recs)
  assert.ok(r.block.length <= CAPS.charCap, 'within the char cap, got ' + r.block.length)
  assert.equal(r.status, 'TRUNCATED')
  assert.ok(r.conversations <= CAPS.maxConversations)
  assert.ok(r.turns <= CAPS.maxTurns)
  // Whole sections only: every conversation header present must have at least one turn after it.
  for (const seg of r.block.split('— conversation ').slice(1)) {
    assert.ok(/\n\[\d{4}-\d{2}-\d{2}/.test(seg), 'a conversation header is never left dangling')
  }
})

test('*** a long turn is truncated with a marker, not silently cut ***', () => {
  const r = build([T({ text: 'y'.repeat(CAPS.perTurnChars + 200) })])
  assert.match(r.block, /y…/, 'the ellipsis says something was removed')
})

/* ── 7. the flag ─────────────────────────────────────────────────────────── */

test('*** OFF is the default, and OFF means byte-identical ***', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'intake', 'intakeService.js'), 'utf8')
  assert.match(src, /process\.env\.CONVERSATION_RECALL === 'on' \? 'on' : 'off'/,
    'fail-closed: only the exact string enables it')
  assert.match(src, /if \(isChat && resolveConversationRecall\(\) === 'on'\)/,
    'chat lane only, and gated')
  // With the flag off the builder is never called, so the prompt cannot change.
  const gated = src.slice(src.indexOf("resolveConversationRecall() === 'on'"))
  const blockEnd = gated.indexOf('\n    }')
  assert.ok(gated.slice(0, blockEnd).includes('buildConversationRecall'),
    'the only call site is inside the gate')
  assert.equal(src.split('buildConversationRecall(').length - 1, 1,
    'and there is exactly one call site')
})

test('*** a recall failure is fail-soft but never silent ***', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'intake', 'intakeService.js'), 'utf8')
  const seg = src.slice(src.indexOf("resolveConversationRecall() === 'on'"))
  assert.match(seg.slice(0, 1400), /logReadSource\(\{ source: 'conversation-archive', trust: 'unavailable'/,
    'losing memory must not look identical to having none')
})

test('*** the writer is untouched ***', () => {
  const reader = fs.readFileSync(path.join(__dirname, 'conversationRecall.js'), 'utf8')
  for (const w of ['appendTurn', 'writeFileSync', 'appendFileSync', 'openSync', 'unlink', 'rename']) {
    assert.equal(reader.includes(w), false, 'the reader must not be able to ' + w)
  }
})
