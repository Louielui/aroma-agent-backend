'use strict'

/**
 * conversationArchive.test.js — Xiangxiang Lab, Conversation Persistence v0.1.
 *
 * The nine things the Owner asked to be proven, each against the real store on a real
 * filesystem. There is no fake archive here: it is plain file I/O, and this project has now
 * watched a hand-written stand-in accept what the real thing rejects twice.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createConversationArchive, ROLES } = require('./conversationArchive')
const { redact, saysDoNotRecord, MARK } = require('./redaction')
const { recordExchange, archiveEnabled } = require('./labArchiveHook')

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xx-lab-'))
const T0 = Date.parse('2026-08-01T18:00:00Z')
const mk = (root, t = T0) => createConversationArchive({ root, now: () => t })

/* ── 1. turns really reach an independent Lab store ───────────────────────── */

test('*** 1. every turn is written to the Lab store, with full verbatim text ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  const cid = 'conv-abc'

  assert.equal(a.appendTurn({ conversationId: cid, role: 'user', text: '香香，Tea House 個報價點?', turnIndex: 0 }).written, true)
  assert.equal(a.appendTurn({ conversationId: cid, role: 'assistant', text: '報價我未見過,你想我幫你搵?', turnIndex: 1, model: 'claude-haiku-4-5-20251001', provider: 'claude' }).written, true)

  // On disk, as its own file, in its own directory.
  const file = path.join(root, 'archive.jsonl')
  assert.equal(fs.existsSync(file), true)
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)

  const recs = a.readAll()
  assert.equal(recs[0].text, '香香，Tea House 個報價點?', 'the user turn is verbatim, not a summary')
  assert.equal(recs[1].text, '報價我未見過,你想我幫你搵?', 'the assistant turn is verbatim')
})

test('*** the Lab store is NOT any production store ***', () => {
  const { DEFAULT_ROOT } = require('./conversationArchive')
  assert.match(DEFAULT_ROOT, /XiangxiangLab/, 'it has its own root')
  assert.doesNotMatch(DEFAULT_ROOT, /aroma-agent-backend|aroma-3b/, 'not inside the repo')
  assert.doesNotMatch(DEFAULT_ROOT, /aroma-truth|ComputerOperator/, 'not in a production data path')

  // And nothing in the Lab writes a production store.
  const src = fs.readFileSync(path.join(__dirname, 'conversationArchive.js'), 'utf8')
  for (const banned of ['aroma-truth', 'aroma-proposals', 'aroma-runs', 'ComputerOperator']) {
    assert.equal(src.includes(banned), false, 'the Lab must not touch: ' + banned)
  }
})

/* ── 2-3. it survives the browser, and the backend ────────────────────────── */

test('*** 2+3. the record outlives the process that wrote it ***', () => {
  const root = tmpRoot()
  mk(root).appendTurn({ conversationId: 'c1', role: 'user', text: 'remember this', turnIndex: 0 })

  // A BRAND NEW archive object, as a restarted backend would build — and the browser holds
  // nothing at all, so "after the browser closes" is the same question as "does it live on
  // disk". It does: the file is read back by something that never saw the write.
  const reopened = createConversationArchive({ root })
  const recs = reopened.readAll()
  assert.equal(recs.length, 1)
  assert.equal(recs[0].text, 'remember this')

  // Read raw, with no module at all, which is what "it is really on disk" means.
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'archive.jsonl'), 'utf8').trim())
  assert.equal(raw.text, 'remember this')
})

/* ── 4. order, time, role, model, provider ────────────────────────────────── */

test('*** 4. turn order, timestamp, role, model and provider are all preserved ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  const cid = 'c-order'
  for (let i = 0; i < 6; i++) {
    a.appendTurn({
      conversationId: cid,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'turn ' + i,
      turnIndex: i,
      model: i % 2 === 0 ? null : 'claude-haiku-4-5-20251001',
      provider: i % 2 === 0 ? null : 'claude'
    })
  }
  const recs = a.readAll()
  assert.equal(recs.length, 6)
  assert.deepEqual(recs.map((r) => r.turnIndex), [0, 1, 2, 3, 4, 5], 'order is preserved')
  assert.deepEqual(recs.map((r) => r.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
  assert.equal(recs[1].model, 'claude-haiku-4-5-20251001')
  assert.equal(recs[1].provider, 'claude')
  for (const r of recs) {
    assert.equal(r.at, '2026-08-01T18:00:00.000Z', 'the injected clock is used, not wall time')
    assert.ok(ROLES.includes(r.role))
    assert.equal(r.conversationId, cid)
  }
  // The export groups and orders by conversation.
  const ex = mk(root).exportAll()
  assert.equal(ex.conversationCount, 1)
  assert.deepEqual(ex.conversations[cid].map((t) => t.turnIndex), [0, 1, 2, 3, 4, 5])
})

/* ── 5. flag OFF ──────────────────────────────────────────────────────────── */

test('*** 5. flag OFF writes NOTHING and loads nothing ***', () => {
  const root = tmpRoot()
  for (const XIANGXIANG_ARCHIVE of [undefined, '', 'off', 'ON', 'On', 'true', '1', ' on']) {
    const res = recordExchange({
      env: { XIANGXIANG_ARCHIVE }, root,
      conversationId: 'c1', message: 'hello', reply: 'hi', turnIndex: 0
    })
    assert.equal(res.recorded, false, String(XIANGXIANG_ARCHIVE))
    assert.equal(res.reason, 'flag_off', String(XIANGXIANG_ARCHIVE))
  }
  // Not one byte, and not even a directory.
  assert.equal(fs.existsSync(path.join(root, 'archive.jsonl')), false)

  // The archive module is never loaded on the disabled path. Structural, not a promise: the
  // require sits inside the enabled branch.
  const hook = fs.readFileSync(path.join(__dirname, 'labArchiveHook.js'), 'utf8')
  const flagReturn = hook.indexOf("reason: 'flag_off'")
  const requireAt = hook.indexOf("require('./conversationArchive')")
  assert.ok(flagReturn > 0 && requireAt > flagReturn, 'the archive is required only after the flag check')

  // Positive control: with the flag on, the same call does write.
  const on = recordExchange({ env: { XIANGXIANG_ARCHIVE: 'on' }, root, conversationId: 'c1', message: 'hello', reply: 'hi', turnIndex: 0 })
  assert.equal(on.recorded, true)
  assert.equal(createConversationArchive({ root }).readAll().length, 2)
})

test('*** 5b. the ONLY live-path change is one guarded block ***', () => {
  const router = fs.readFileSync(path.join(__dirname, '..', 'routes', 'demoRouter.js'), 'utf8')
  assert.equal((router.match(/labArchiveHook/g) || []).length, 1, 'exactly one reference')
  // It sits after the reply is built, so it cannot influence what the model produced.
  assert.ok(router.indexOf('const answered') < router.indexOf('labArchiveHook'),
    'the archive runs AFTER the reply exists — it can change nothing about it')
  // And the Lab touches nothing it was told not to touch.
  const labFiles = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  for (const f of labFiles) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
    for (const banned of ['persona', 'decisionRecall', 'distillPrompt', 'buildDistillPrompt']) {
      assert.equal(new RegExp("require\\([^)]*" + banned, 'i').test(src), false, f + ' must not reach ' + banned)
    }
  }
})

/* ── 6. redaction, with controls in BOTH directions ───────────────────────── */

test('*** 6. secrets are redacted — POSITIVE control ***', () => {
  const cases = [
    ['my password is hunter2ABC', /password/i],
    ['密碼: abc123XYZ', /密碼/],
    ['api_key=sk-abcdefghijklmnop1234', /api_key/i],
    ['token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk', /token/i],
    ['here is the key sk-ant-abcdefghijklmnop12345', null],
    ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', null],
    ['AKIAIOSFODNN7EXAMPLE', null],
    ['cookie: session=abc123def456', /cookie/i],
    ['recovery code: 8842-1193-7765', /recovery/i],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', null],
    ['4111 1111 1111 1111', null] // a valid Luhn test card
  ]
  for (const [input, keepsLabel] of cases) {
    const { text, hits } = redact(input)
    assert.ok(hits.length > 0, 'nothing detected in: ' + input)
    assert.ok(text.includes(MARK), 'no redaction mark in: ' + input)
    // The secret value itself must be gone.
    for (const secret of ['hunter2ABC', 'abc123XYZ', 'sk-abcdefghijklmnop1234', 'sk-ant-abcdefghijklmnop12345',
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'AKIAIOSFODNN7EXAMPLE', 'abc123def456', '8842-1193-7765', 'MIIabc', '4111 1111 1111 1111']) {
      if (input.includes(secret)) assert.equal(text.includes(secret), false, 'secret survived: ' + secret)
    }
    if (keepsLabel) assert.match(text, keepsLabel, 'the label is kept so the reader knows WHAT was removed')
  }
})

test('*** 6. ordinary text is NOT redacted — NEGATIVE control ***', () => {
  // Without this, a rule that redacted everything would pass the test above.
  const innocent = [
    '今日 Tea House 個爐要換',
    'the order number is 4111111111111112 and it is not a card',   // fails Luhn
    'I passed the exam',                                            // "pass" is not "password:"
    'my token of appreciation',                                     // no separator, not a token=
    'Computer Operator stopped at window_not_found',
    'sk- is a prefix but this is not a key',
    '請幫我草擬一封信畀供應商'
  ]
  for (const s of innocent) {
    const { text, hits } = redact(s)
    assert.equal(text, s, 'text was altered: ' + s)
    assert.deepEqual(hits, [], 'false positive on: ' + s)
  }
})

test('*** 6. the redaction runs BEFORE the write, and the archive records only KINDS ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  a.appendTurn({ conversationId: 'c1', role: 'user', text: 'my password is superSecret123', turnIndex: 0 })

  const raw = fs.readFileSync(path.join(root, 'archive.jsonl'), 'utf8')
  assert.equal(raw.includes('superSecret123'), false, 'the secret never reached disk')
  assert.ok(raw.includes(MARK))
  const rec = a.readAll()[0]
  assert.ok(rec.redactedKinds.length > 0, 'the removal is auditable')
  assert.equal(JSON.stringify(rec.redactedKinds).includes('superSecret123'), false,
    'the audit records the KIND, never the value')
})

test('*** 6. nothing in the Lab claims the archive is clean ***', () => {
  // ── A SCAN THAT CANNOT TELL A PROHIBITION FROM A VIOLATION ──────────────
  // The first version of this test banned the phrase "is clean" outright and went red on
  // redaction.js's own header sentence — "never claim the rest is clean". That is the seventh
  // time in this project a rule has punished the prose explaining the very thing it forbids,
  // and the requirement here is specifically that the COMMENTS stay honest, so stripping
  // comments would delete the thing being checked.
  //
  // So a claim only counts when its sentence does not also refute it.
  const CLAIMS = [/\bis\s+clean\b/i, /\bguaranteed\s+safe\b/i, /\bno\s+secrets\s+remain\b/i,
    /\bfully\s+redacted\b/i, /\bsafe\s+to\s+back\s+up\b/i, /\bsafe\s+to\s+copy\b/i]
  const NEGATION = /\b(never|not|no longer|must not|cannot|is wrong|would be wrong|nothing|neither|without)\b/i

  // A SENTENCE, not a line. Splitting on newlines cut "the archive is redacted, so it is safe
  // to copy" away from "that reasoning is wrong" on the next line, and reported the refutation
  // as the claim. Comment markers are stripped and lines rejoined first, so the unit being
  // judged is the unit that carries the meaning.
  const sentences = (src) => src
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\/\*+|\*+\/?|\/\/)\s?/, ''))
    .join(' ')
    .split(/(?<=[.:])\s+/)

  const offenders = []
  for (const f of ['redaction.js', 'conversationArchive.js', 'labArchiveHook.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
    for (const sentence of sentences(src)) {
      for (const claim of CLAIMS) {
        if (claim.test(sentence) && !NEGATION.test(sentence)) {
          offenders.push(f + ': ' + sentence.trim().slice(0, 90))
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'these read as a promise that the archive is clean')

  // POSITIVE CONTROL — the rule still catches a real, unqualified claim.
  const bad = 'The archive is clean and safe to copy anywhere.'
  const caught = CLAIMS.some((c) => c.test(bad)) && !NEGATION.test(bad)
  assert.equal(caught, true, 'the rule must still detect an actual claim')
  // And a refutation of the same words is not a claim.
  const good = 'It must never be said that the archive is clean.'
  assert.equal(CLAIMS.some((c) => c.test(good)) && !NEGATION.test(good), false)

  const red = fs.readFileSync(path.join(__dirname, 'redaction.js'), 'utf8')
  assert.match(red, /BEST-EFFORT/i, 'it says what it is')
  assert.match(red, /not a guarantee/i)
})

/* ── the Owner's opt-out ──────────────────────────────────────────────────── */

test('*** "這段不要記錄" means not stored — not stored-and-redacted ***', () => {
  const root = tmpRoot()
  const res = recordExchange({
    env: { XIANGXIANG_ARCHIVE: 'on' }, root,
    conversationId: 'c1', message: '這段不要記錄,我同太太嗌交', reply: '明白,我唔會記低。', turnIndex: 0
  })
  assert.equal(res.recorded, false)
  assert.equal(res.reason, 'owner_asked_not_to_record')

  const a = createConversationArchive({ root })
  assert.equal(a.readAll().length, 0, 'nothing was stored at all')
  const raw = fs.existsSync(path.join(root, 'archive.jsonl')) ? fs.readFileSync(path.join(root, 'archive.jsonl'), 'utf8') : ''
  assert.equal(raw.includes('嗌交'), false)
  // The skip itself is auditable, without the content.
  const ev = a.readAudit().find((e) => e.event === 'turn_skipped')
  assert.ok(ev, 'the skip is recorded')
  assert.equal(JSON.stringify(ev).includes('嗌交'), false, 'and records nothing about what was skipped')

  assert.equal(saysDoNotRecord('這段不要記錄'), true)
  assert.equal(saysDoNotRecord('off the record please'), true)
  assert.equal(saysDoNotRecord('請記錄低呢個決定'), false, 'a request TO record is not an opt-out')
})

/* ── 7. delete and export ─────────────────────────────────────────────────── */

test('*** 7. delete: one turn, one conversation, a date range, and everything ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  const t1 = a.appendTurn({ conversationId: 'A', role: 'user', text: 'a0', turnIndex: 0 })
  a.appendTurn({ conversationId: 'A', role: 'assistant', text: 'a1', turnIndex: 1 })
  a.appendTurn({ conversationId: 'B', role: 'user', text: 'b0', turnIndex: 0 })
  assert.equal(a.readAll().length, 3)

  assert.equal(a.remove({ turnId: t1.id }).removed, 1)
  assert.equal(a.readAll().length, 2)
  assert.equal(a.readAll().some((r) => r.id === t1.id), false, 'and it is really gone from the file')

  assert.equal(a.remove({ conversationId: 'A' }).removed, 1)
  assert.equal(a.readAll().length, 1)

  // date range
  const later = createConversationArchive({ root, now: () => Date.parse('2026-09-01T00:00:00Z') })
  later.appendTurn({ conversationId: 'C', role: 'user', text: 'c0', turnIndex: 0 })
  assert.equal(later.readAll().length, 2)
  assert.equal(later.remove({ from: '2026-08-25', to: '2026-09-05' }).removed, 1, 'only the September record')
  assert.equal(later.readAll().length, 1)

  assert.equal(later.remove({ all: true }).removed, 1)
  assert.equal(later.readAll().length, 0)

  // every deletion is auditable, and none of them kept the text
  const events = later.readAudit().filter((e) => e.event === 'deleted')
  assert.equal(events.length, 4)
  const dump = JSON.stringify(events)
  for (const gone of ['a0', 'a1', 'b0', 'c0']) {
    assert.equal(dump.includes('"' + gone + '"'), false, 'the audit kept deleted text: ' + gone)
  }
})

test('*** 7. export carries every turn, grouped and ordered ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  a.appendTurn({ conversationId: 'A', role: 'user', text: 'first', turnIndex: 0 })
  a.appendTurn({ conversationId: 'B', role: 'user', text: 'other', turnIndex: 0 })
  a.appendTurn({ conversationId: 'A', role: 'assistant', text: 'second', turnIndex: 1 })

  const ex = a.exportAll()
  assert.equal(ex.turnCount, 3)
  assert.equal(ex.conversationCount, 2)
  assert.deepEqual(ex.conversations.A.map((t) => t.text), ['first', 'second'])
  assert.match(ex.note, /best-effort/i, 'the export says what it contains')
})

/* ── 8. the Lab cannot damage production ──────────────────────────────────── */

test('*** 8. deleting the whole Lab archive leaves production untouched ***', () => {
  const root = tmpRoot()
  const a = mk(root)
  a.appendTurn({ conversationId: 'A', role: 'user', text: 'x', turnIndex: 0 })

  // Everything the Lab can touch lives under its own root.
  const p = a.paths
  assert.ok(p.archivePath.startsWith(root))
  assert.ok(p.auditPath.startsWith(root))

  a.remove({ all: true })
  fs.rmSync(root, { recursive: true, force: true })
  assert.equal(fs.existsSync(root), false)

  // Production stores still load, unchanged.
  const store = require('../store/store')
  assert.ok(Array.isArray(store.listDecisions()), 'the truth store still reads')
  assert.ok(Array.isArray(store.listTasks()))

  // And a fresh archive on a deleted root simply starts empty rather than throwing.
  assert.deepEqual(createConversationArchive({ root }).readAll(), [])
})

/* ── 9. fail-OPEN ─────────────────────────────────────────────────────────── */

test('*** 9. a write failure NEVER throws, and is reported ***', () => {
  const root = tmpRoot()
  const a = createConversationArchive({ root })
  // Make the archive path a DIRECTORY, so appendFileSync cannot write to it.
  fs.mkdirSync(path.join(root, 'archive.jsonl'), { recursive: true })

  let res
  assert.doesNotThrow(() => { res = a.appendTurn({ conversationId: 'c', role: 'user', text: 'hi', turnIndex: 0 }) })
  assert.equal(res.ok, false)
  assert.equal(res.written, false)
  assert.equal(res.reason, 'write_failed')
  assert.ok(res.error, 'and it says what went wrong')
})

test('*** 9. the conversation completes and the failure is VISIBLE ***', () => {
  const root = tmpRoot()
  fs.mkdirSync(path.join(root, 'archive.jsonl'), { recursive: true })

  let out
  assert.doesNotThrow(() => {
    out = recordExchange({ env: { XIANGXIANG_ARCHIVE: 'on' }, root, conversationId: 'c', message: 'hi', reply: 'hello', turnIndex: 0 })
  })
  assert.equal(out.recorded, false, 'it did not record')
  assert.equal(out.reason, 'write_failed')
  assert.ok(Array.isArray(out.failures) && out.failures.length > 0, 'and it says so, rather than failing silently')

  // The router attaches this to the reply, so a failure reaches the screen instead of vanishing.
  const router = fs.readFileSync(path.join(__dirname, '..', 'routes', 'demoRouter.js'), 'utf8')
  assert.match(router, /labArchive\b/, 'the outcome is attached to the response')
  assert.match(router, /fail-OPEN/i, 'and the reason for the direction is written where it applies')
})

test('*** 9. fail-OPEN is documented AS THE OPPOSITE of the Computer Operator audit ***', () => {
  // The two defaults are contradictory on purpose. If the reason is not written down, one of
  // them will eventually be "corrected" to match the other.
  const src = fs.readFileSync(path.join(__dirname, 'conversationArchive.js'), 'utf8')
  assert.match(src, /fail-OPEN/i)
  assert.match(src, /fail-CLOSED/i, 'it names the other direction')
  assert.match(src, /authorisation chain|authorization chain/i, 'and why the audit is different')
})

/* ── durability, claimed honestly ─────────────────────────────────────────── */

test('*** the archive is NOT claimed to be durable storage ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'conversationArchive.js'), 'utf8')
  assert.match(src, /NOT DURABLE STORAGE YET/i)
  assert.match(src, /restore/i, 'a restore must be verified before the word is used')
  assert.doesNotMatch(src, /is\s+durable\b/i)
})
