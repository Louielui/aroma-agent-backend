'use strict'

/**
 * archiveEndToEnd.test.js — the whole path, once, for real.
 *
 * A real HTTP request → the real demoRouter → the REAL processIntake pipeline (only the LLM
 * adapter is a fake, so no paid call) → the real labArchiveHook → a real file on disk.
 *
 * Everything else in the Lab suite tests one seam. This tests the joins between them, because
 * every expensive defect in this project so far has lived in a join: a value that one layer
 * produced under a name the next layer never read. `model: null` in the first live record was
 * exactly that — every unit test passed while the field was never assigned by anyone.
 *
 * So the assertions here are deliberately about the FILE, not about return values.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createDemoRouter } = require('../routes/demoRouter')

// A′ NARROWED (Owner decision 2026-08-02): the omission now turns on whether the REPLY
// drew on the context, not on whether the turn read any. So there are two envelopes:
// one that quotes the mail title, and one that answers without touching it.
const CHAT_ENVELOPE = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'REPLY_SENTINEL 你有一封 MAIL_TITLE_SENTINEL 嘅郵件。' })
const CHAT_ENVELOPE_NO_CITE = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'REPLY_SENTINEL 我建議你先做 X。' })
const MODEL_ID = 'claude-haiku-4-5-20251001'

function fakeAdapter (envelope) {
  return {
    async complete () {
      return { text: envelope || CHAT_ENVELOPE, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, model: MODEL_ID, latencyMs: 3 }
    }
  }
}

function readDeps (sources) {
  return {
    sources,
    connector: {
      async read (source) {
        return {
          asOf: '2026-08-02', source, count: 1,
          results: [{
            source, sourceId: source + '1', title: 'MAIL_TITLE_SENTINEL',
            retrievedAt: '2026-08-02', originalDate: '2026-08-01',
            content: 'MAIL_BODY_SENTINEL', link: 'l', trust: 'live', error: null
          }]
        }
      }
    }
  }
}

/** The router does not accept readContextDeps from the browser (correctly), so inject at the
 *  processIntake seam while still calling the REAL implementation underneath. */
function realPipelineWith (deps) {
  const { processIntake } = require('../intake/intakeService')
  return (message, adapter, history, opts) =>
    processIntake(message, adapter, history, Object.assign({}, opts, { readContextDeps: deps }))
}

function makeApp (processIntakeFn, envelope) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use(createDemoRouter({ getAdapterFn: () => fakeAdapter(envelope), processIntakeFn }))
  return app
}

async function post (app, body) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const port = server.address().port
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/api/v1/demo/intake', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    return { status: res.status, json: await res.json() }
  } finally {
    await new Promise((r) => server.close(r))
  }
}

async function withEnv (vars, fn) {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const lines = (root) => fs.readFileSync(path.join(root, 'archive.jsonl'), 'utf8')

test('*** END TO END: a Gmail turn whose reply CITES the mail stores the question and omits the answer ***', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-e2e-'))
  await withEnv({
    XIANGXIANG_ARCHIVE: 'on', XIANGXIANG_ARCHIVE_ROOT: root,
    READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off'
  }, async () => {
    const app = makeApp(realPipelineWith(readDeps(['gmail'])))
    const { status, json } = await post(app, {
      message: '睇下我今日封郵件', interactionMode: 'chat', conversationId: 'e2e-conv-1', history: []
    })

    // the conversation itself is unaffected
    assert.equal(status, 200)
    assert.ok(json.reply.includes('REPLY_SENTINEL'), 'the Owner still got his answer')
    assert.equal(json.labArchive.recorded, true)
    assert.equal(json.labArchive.assistantOmitted, true, 'the omission is visible on the response')

    // THE FILE
    const raw = lines(root)
    assert.equal(raw.includes('睇下我今日封郵件'), true, 'the Owner\'s own words are kept')
    assert.equal(raw.includes('REPLY_SENTINEL'), false, 'the assistant body reached the archive')
    assert.equal(raw.includes('MAIL_TITLE_SENTINEL'), false, 'a mail TITLE reached the archive')
    assert.equal(raw.includes('MAIL_BODY_SENTINEL'), false, 'mail CONTENT reached the archive')

    const recs = raw.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(recs.length, 2)
    const [user, assistant] = recs

    assert.equal(user.role, 'user')
    assert.equal(user.text, '睇下我今日封郵件')
    assert.equal(assistant.role, 'assistant')
    assert.equal(assistant.turnIndex, user.turnIndex + 1, 'order is preserved')
    assert.equal(assistant.omitted, true)
    assert.equal(assistant.omissionReason, 'external_read_context')
    assert.deepEqual(assistant.readContextSources, ['gmail'])
    assert.equal(assistant.text, null)
    assert.equal(assistant.redactedKinds, null)

    // PROVENANCE — the defect that started this round. Both records, both fields, real values.
    for (const r of recs) {
      assert.equal(r.model, MODEL_ID, 'model must be the adapter\'s own id')
      assert.notEqual(r.model, null)
      assert.equal(r.provider, 'claude')
      assert.equal(r.lane, 'chat')
      assert.equal(typeof r.requestId, 'string')
    }
    assert.equal(recs[0].requestId, recs[1].requestId, 'one request, one correlation id')
  })
})

/**
 * THE CASE A′ USED TO THROW AWAY. Gmail is read, the reply answers without touching any of
 * it, and the answer survives — while the mail's title and body still never reach the file.
 * Under the old rule this reply was omitted purely because a read had happened, which is
 * five of five turns in the real archive and the reason 香香 could not remember her own
 * advice.
 */
test('*** END TO END: read happened, reply CITES NOTHING → the answer is kept, mail still absent ***', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-e2e-nocite-'))
  await withEnv({
    XIANGXIANG_ARCHIVE: 'on', XIANGXIANG_ARCHIVE_ROOT: root,
    READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off'
  }, async () => {
    const app = makeApp(realPipelineWith(readDeps(['gmail'])), CHAT_ENVELOPE_NO_CITE)
    const { status, json } = await post(app, {
      message: '有咩要跟進？', interactionMode: 'chat', conversationId: 'e2e-conv-nocite', history: []
    })

    assert.equal(status, 200)
    assert.equal(json.labArchive.recorded, true)
    assert.equal(json.labArchive.assistantOmitted, false, 'the reply drew on nothing, so it is kept')

    const raw = lines(root)
    assert.equal(raw.includes('有咩要跟進？'), true, 'the Owner\'s words, as always')
    assert.equal(raw.includes('REPLY_SENTINEL'), true, 'AND her own answer — the memory survives')

    // The promise A′ exists for is untouched: read context still never lands on disk.
    assert.equal(raw.includes('MAIL_TITLE_SENTINEL'), false, 'no mail TITLE reached the archive')
    assert.equal(raw.includes('MAIL_BODY_SENTINEL'), false, 'no mail CONTENT reached the archive')

    const recs = raw.trim().split('\n').map((l) => JSON.parse(l))
    const assistant = recs.find((r) => r.role === 'assistant')
    assert.equal(assistant.omitted, false)
    assert.equal(assistant.omissionReason, undefined, 'not an omission record at all')
    assert.ok(typeof assistant.text === 'string' && assistant.text.length > 0)
  })
})

test('*** END TO END: with no read access the reply IS stored, and provenance still real ***', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-e2e-'))
  await withEnv({
    XIANGXIANG_ARCHIVE: 'on', XIANGXIANG_ARCHIVE_ROOT: root,
    READ_ACCESS: 'off', CONTEXT_GMAIL: 'off', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off'
  }, async () => {
    const app = makeApp(realPipelineWith(readDeps(['gmail'])))
    const { json } = await post(app, {
      message: '早晨', interactionMode: 'chat', conversationId: 'e2e-conv-2', history: []
    })

    assert.equal(json.labArchive.assistantOmitted, false)
    const raw = lines(root)
    assert.equal(raw.includes('REPLY_SENTINEL'), true, 'an ordinary reply must still be kept')

    const recs = raw.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(recs[1].omitted, false)
    assert.equal(recs[1].model, MODEL_ID)
    assert.equal(recs[1].provider, 'claude')
  })
})

test('*** END TO END: flag OFF still writes nothing at all ***', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-e2e-'))
  await withEnv({
    XIANGXIANG_ARCHIVE: 'off', XIANGXIANG_ARCHIVE_ROOT: root,
    READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off'
  }, async () => {
    const app = makeApp(realPipelineWith(readDeps(['gmail'])))
    const { status, json } = await post(app, {
      message: '睇下我封郵件', interactionMode: 'chat', conversationId: 'e2e-conv-3', history: []
    })
    assert.equal(status, 200)
    assert.equal(json.labArchive, undefined, 'flag_off is not attached to the response')
    assert.equal(fs.existsSync(path.join(root, 'archive.jsonl')), false)
  })
})
