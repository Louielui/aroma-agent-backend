'use strict'

/**
 * thirdPartyScope.test.js — Owner decision A′ (2026-08-02), and model/provider provenance.
 *
 * The first real conversation was a Gmail lookup. Nothing about the retrieved mail entered the
 * archive — the read block and the context card are not passed to the Lab and never were — but
 * the assistant's REPLY quoted it, and replies are stored verbatim. Other people's names
 * reached the disk through the answer.
 *
 * A′: when a turn actually used external read context, keep the user's words, do NOT keep the
 * assistant's body, and leave an omission record in its place so order and auditability survive.
 *
 * Everything here runs against the real store on a real filesystem. The decisive tests search
 * the RAW BYTES of the file for the reply, because "the field is null" and "the text is not in
 * the file" are different claims and only the second one matters.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createConversationArchive, OMISSION_REASONS, SCHEMA_VERSION } = require('./conversationArchive')
const { recordExchange } = require('./labArchiveHook')

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xx-a1-'))
const T0 = Date.parse('2026-08-02T05:00:00Z')
const mk = (root) => createConversationArchive({ root, now: () => T0 })
const ON = { XIANGXIANG_ARCHIVE: 'on' }
const raw = (root) => fs.readFileSync(path.join(root, 'archive.jsonl'), 'utf8')

// A reply of the shape that caused this decision: a real answer naming real people.
const THIRD_PARTY_REPLY = '你有三封新郵件。Sysco Canada 的 Marcus Delaney 問下星期送貨時間，' +
  'Pacific Seafoods 的 Ana Ruiz 報咗新價，仲有一封 GFS 帳單提醒。'
const OWNER_QUESTION = '香香，睇下我今日封郵件有咩重要?'

/* ── the omission record itself ───────────────────────────────────────────── */

test('*** A′: an omitted assistant turn puts NO part of the reply on disk ***', () => {
  const root = tmpRoot()
  const a = mk(root)

  a.appendTurn({ conversationId: 'c1', role: 'user', text: OWNER_QUESTION, turnIndex: 1 })
  const r = a.appendTurn({
    conversationId: 'c1',
    role: 'assistant',
    turnIndex: 2,
    omitBody: true,
    omissionReason: 'external_read_context',
    readContextSources: ['gmail'],
    model: 'claude-haiku-4-5-20251001',
    provider: 'claude'
  })

  assert.equal(r.written, true)
  assert.equal(r.omitted, true)

  // THE DECISIVE CHECK: the bytes. Not the parsed field — the file.
  const bytes = raw(root)
  assert.equal(bytes.includes(THIRD_PARTY_REPLY), false)
  for (const name of ['Marcus Delaney', 'Ana Ruiz', 'Sysco', 'Pacific Seafoods', 'GFS']) {
    assert.equal(bytes.includes(name), false, `third-party token "${name}" reached the archive`)
  }
  // The Owner's own question is still there, in full.
  assert.equal(bytes.includes(OWNER_QUESTION), true)
})

test('*** A′: passing the reply ANYWAY still writes nothing — omission is structural ***', () => {
  const root = tmpRoot()
  const a = mk(root)

  // A future caller forgets, and passes the body next to omitBody. The body must not appear
  // in the file, must not be redacted-and-stored, must not be truncated, must not be hashed.
  a.appendTurn({
    conversationId: 'c1',
    role: 'assistant',
    turnIndex: 2,
    omitBody: true,
    text: THIRD_PARTY_REPLY,
    readContextSources: ['gmail']
  })

  const bytes = raw(root)
  assert.equal(bytes.includes(THIRD_PARTY_REPLY), false)
  assert.equal(bytes.includes('Marcus'), false)
  const rec = JSON.parse(bytes.trim())
  assert.equal(rec.text, null)
  // and no smuggled copy under any other key
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === 'string') assert.equal(v.includes('Marcus'), false, `key ${k} carries reply text`)
  }
})

test('*** A′: the omission record keeps place, order and provenance — and nothing else ***', () => {
  const root = tmpRoot()
  const a = mk(root)

  a.appendTurn({ conversationId: 'c1', role: 'user', text: OWNER_QUESTION, turnIndex: 1, model: 'claude-haiku-4-5-20251001', provider: 'claude', lane: 'chat', requestId: 'req-1' })
  a.appendTurn({ conversationId: 'c1', role: 'assistant', turnIndex: 2, omitBody: true, readContextSources: ['gmail', 'calendar'], model: 'claude-haiku-4-5-20251001', provider: 'claude', lane: 'chat', requestId: 'req-1' })

  const [u, o] = a.readAll()

  // order and place survive
  assert.equal(u.role, 'user')
  assert.equal(o.role, 'assistant')
  assert.equal(o.turnIndex, u.turnIndex + 1)
  assert.equal(o.conversationId, 'c1')
  assert.equal(o.requestId, 'req-1')

  // provenance survives
  assert.equal(o.model, 'claude-haiku-4-5-20251001')
  assert.equal(o.provider, 'claude')
  assert.equal(o.lane, 'chat')
  assert.equal(typeof o.at, 'string')

  // the omission is legible
  assert.equal(o.omitted, true)
  assert.equal(o.omissionReason, 'external_read_context')
  assert.ok(OMISSION_REASONS.includes(o.omissionReason))
  assert.deepEqual(o.readContextSources, ['gmail', 'calendar'])

  // NOT [] — an empty array would claim redaction ran and found nothing, about text nobody read
  assert.equal(o.redactedKinds, null)

  // no field carrying content, by name or by shape
  assert.equal(o.text, null)
  for (const forbidden of ['contextCard', 'snippet', 'snippets', 'subject', 'title', 'sender', 'from', 'preview', 'summary', 'excerpt', 'textHash', 'replyChars']) {
    assert.equal(Object.prototype.hasOwnProperty.call(o, forbidden), false, `omission record carries "${forbidden}"`)
  }
  assert.equal(o.schemaVersion, SCHEMA_VERSION)
})

test('*** an ordinary turn is UNCHANGED — A′ did not quietly stop storing replies ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  a.appendTurn({ conversationId: 'c1', role: 'assistant', text: '我幫你睇咗,冇急事。', turnIndex: 2 })
  const [rec] = a.readAll()
  assert.equal(rec.text, '我幫你睇咗,冇急事。')
  assert.equal(rec.omitted, false)
  assert.deepEqual(rec.redactedKinds, [])   // [] here is correct: redaction DID run
})

/* ── the hook: who decides, and which way it fails ────────────────────────── */

test('*** A′: read context used → user kept, assistant body omitted ***', () => {
  const root = tmpRoot()
  const out = recordExchange({
    env: ON, root, conversationId: 'c1', turnIndex: 1,
    message: OWNER_QUESTION, reply: THIRD_PARTY_REPLY,
    readContextUsed: true, readContextSources: ['gmail'],
    model: 'claude-haiku-4-5-20251001', provider: 'claude'
  })

  assert.equal(out.recorded, true)
  assert.equal(out.assistantOmitted, true)
  assert.equal(out.ids.length, 2)

  const bytes = raw(root)
  assert.equal(bytes.includes(OWNER_QUESTION), true)
  assert.equal(bytes.includes(THIRD_PARTY_REPLY), false)

  const [u, o] = mk(root).readAll()
  assert.equal(u.text, OWNER_QUESTION)
  assert.equal(o.omitted, true)
  assert.deepEqual(o.readContextSources, ['gmail'])
})

test('*** no read context → the reply IS stored, exactly as before ***', () => {
  const root = tmpRoot()
  const reply = '好,我記住咗。'
  const out = recordExchange({
    env: ON, root, conversationId: 'c1', turnIndex: 1,
    message: '記住我聽日要落單', reply,
    readContextUsed: false, readContextSources: [],
    model: 'claude-haiku-4-5-20251001', provider: 'claude'
  })

  assert.equal(out.assistantOmitted, false)
  const [, assistant] = mk(root).readAll()
  assert.equal(assistant.text, reply)
  assert.equal(assistant.omitted, false)
})

test('*** FAIL-SAFE: anything that is not an explicit false omits the body ***', () => {
  // Every one of these is a way the signal could arrive broken. All must omit.
  const cases = [
    ['undefined', undefined],
    ['null', null],
    ['the STRING "false"', 'false'],
    ['the STRING "off"', 'off'],
    ['0', 0],
    ['empty string', ''],
    ['NaN', NaN],
    ['an object', {}]
  ]
  for (const [label, value] of cases) {
    const root = tmpRoot()
    const out = recordExchange({
      env: ON, root, conversationId: 'c1', turnIndex: 1,
      message: OWNER_QUESTION, reply: THIRD_PARTY_REPLY,
      readContextUsed: value
    })
    assert.equal(out.assistantOmitted, true, `readContextUsed=${label} kept the body`)
    assert.equal(raw(root).includes('Marcus'), false, `readContextUsed=${label} put a name on disk`)
  }
})

test('*** the hook has NO parameter that could carry retrieved content ***', () => {
  // Structural: the only way third-party data could enter is a parameter that accepts it.
  // recordExchange takes the message, the reply, and metadata — there is no context card,
  // no snippet list, no source payload. Passing one has no effect.
  const root = tmpRoot()
  recordExchange({
    env: ON, root, conversationId: 'c1', turnIndex: 1,
    message: 'hi', reply: 'hello', readContextUsed: false,
    // all ignored — proven by their absence from the file below
    contextCard: { note: 'SECRETCARD' },
    readContext: 'SECRETBLOCK',
    sources: [{ title: 'SECRETTITLE', snippet: 'SECRETSNIPPET' }]
  })
  const bytes = raw(root)
  for (const marker of ['SECRETCARD', 'SECRETBLOCK', 'SECRETTITLE', 'SECRETSNIPPET']) {
    assert.equal(bytes.includes(marker), false, `${marker} reached the archive`)
  }
})

test('*** source kinds only — a source payload cannot ride in on readContextSources ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  a.appendTurn({
    conversationId: 'c1', role: 'assistant', turnIndex: 2, omitBody: true,
    // whatever the caller passes is copied verbatim, so the CALLER must pass kinds. This test
    // pins the contract that the pipeline supplies ALL_SOURCES members and nothing else, and
    // documents that the archive does not sanitise it for them.
    readContextSources: ['gmail']
  })
  const [rec] = a.readAll()
  assert.deepEqual(rec.readContextSources, ['gmail'])
  assert.equal(rec.readContextSources.every((s) => ['drive', 'gmail', 'calendar', 'github'].includes(s)), true)
})

/* ── omission does not disable the Owner's own controls ───────────────────── */

test('*** the opt-out still wins over everything, including an omitted turn ***', () => {
  const root = tmpRoot()
  const out = recordExchange({
    env: ON, root, conversationId: 'c1', turnIndex: 1,
    message: '呢段唔好記錄,睇下我封郵件', reply: THIRD_PARTY_REPLY,
    readContextUsed: true, readContextSources: ['gmail']
  })
  assert.equal(out.recorded, false)
  assert.equal(out.reason, 'owner_asked_not_to_record')
  // not even the omission record — the Owner said do not record this exchange
  assert.equal(fs.existsSync(path.join(root, 'archive.jsonl')), false)
})

test('*** stats counts omissions, so an archive of placeholders cannot look full ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  a.appendTurn({ conversationId: 'c1', role: 'user', text: 'q', turnIndex: 1 })
  a.appendTurn({ conversationId: 'c1', role: 'assistant', turnIndex: 2, omitBody: true, readContextSources: ['gmail'] })
  const s = a.stats()
  assert.equal(s.turnCount, 2)
  assert.equal(s.omittedCount, 1)
})

test('*** delete still removes an omission record ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  a.appendTurn({ conversationId: 'c1', role: 'user', text: 'q', turnIndex: 1 })
  a.appendTurn({ conversationId: 'c1', role: 'assistant', turnIndex: 2, omitBody: true, readContextSources: ['gmail'] })
  const r = a.remove({ conversationId: 'c1' })
  assert.equal(r.removed, 2)
  assert.equal(a.readAll().length, 0)
})

/* ── v1 records still readable ────────────────────────────────────────────── */

test('*** records written before A′ (schemaVersion 1) are still readable ***', () => {
  const root = tmpRoot()
  fs.mkdirSync(root, { recursive: true })
  // a real v1 line, of the shape the two live records have
  const v1 = { schemaVersion: 1, id: 'turn_old', conversationId: 'c0', turnIndex: 1, role: 'user', text: 'old turn', at: '2026-08-02T04:44:16.562Z', model: null, provider: 'claude', lane: 'chat', requestId: 'r0', redactedKinds: [] }
  fs.writeFileSync(path.join(root, 'archive.jsonl'), JSON.stringify(v1) + '\n', 'utf8')

  const a = mk(root)
  const all = a.readAll()
  assert.equal(all.length, 1)
  assert.equal(all[0].text, 'old turn')
  assert.equal(all[0].omitted, undefined)          // absent, not false — it predates the field
  assert.equal(a.stats().omittedCount, 0)          // and absent must not count as omitted
})
