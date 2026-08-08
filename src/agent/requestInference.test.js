'use strict'

/**
 * requestInference.test.js — she must not ask for what the Owner already said.
 *
 * The complaint that produced this file: the Owner wrote the path AND the change in one
 * sentence and got a form asking for both. So the first test is that exact sentence, and
 * the rule the rest of the file defends is narrow — infer, show what was inferred, and ask
 * ONE question only about what is genuinely missing.
 *
 * Inference changes what she ASKS. It never changes what needs approving: the Work Order,
 * its hash and the typed EXECUTE are untouched, and a wrong reading is visible on the card
 * before the Owner approves.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { inferWorkRequest, questionFor } = require('./requestInference')

/* ── 1. THE SENTENCE THAT STARTED THIS ────────────────────────────────────── */

test('*** the Owner\'s own sentence needs no follow-up question at all ***', () => {
  const r = inferWorkRequest({
    message: '幫我改 docs/canary/agent-canary.md，喺第一行後面加一句「edited by the agent」'
  })
  assert.equal(r.file, 'docs/canary/agent-canary.md')
  assert.equal(r.intent, '喺第一行後面加一句「edited by the agent」',
    'the instruction reads naturally — the path is not spliced out mid-sentence')
  assert.deepEqual(r.missing, [], 'nothing is missing')
  assert.equal(r.question, null, 'so nothing is asked')
})

test('*** English phrasing works the same way ***', () => {
  const r = inferWorkRequest({ message: 'update src/foo.js to add a null check' })
  assert.equal(r.file, 'src/foo.js')
  assert.equal(r.intent, 'to add a null check')
  assert.equal(r.question, null)
})

/* ── 2. only what is missing, and only one question ───────────────────────── */

test('*** a file with no instruction asks ONLY about the change ***', () => {
  const r = inferWorkRequest({ message: '幫我改 docs/canary/agent-canary.md' })
  assert.equal(r.file, 'docs/canary/agent-canary.md', 'the file he gave is kept')
  assert.deepEqual(r.missing, ['intent'])
  assert.equal(r.question, '你想怎麼改？')
  assert.equal(/邊個檔/.test(r.question), false, 'it must NOT re-ask for the file')
})

test('*** an instruction with no file asks ONLY about the file ***', () => {
  const r = inferWorkRequest({ message: '幫我改個 canary 檔，加一行' })
  assert.equal(r.file, null)
  assert.equal(r.question, '你想改哪個檔？')
  assert.equal(/點改/.test(r.question), false, 'it must NOT re-ask what to do')
})

test('*** a bare verb is not an instruction ***', () => {
  // 「幫我改 <path>」 leaves the word 「改」. Putting that on an approval card as the
  // intended change would be claiming to have understood something.
  const r = inferWorkRequest({ message: '幫我改 docs/canary/agent-canary.md' })
  assert.equal(r.intent, null)
})

test('*** two files named → it asks WHICH, and lists them ***', () => {
  const r = inferWorkRequest({ message: '睇下 src/a.js 同 src/b.js 邊個好，然後改佢' })
  assert.equal(r.file, null, 'ambiguity is never resolved by picking one')
  assert.match(r.question, /你想改哪個檔/)
  assert.match(r.question, /src\/a\.js/)
  assert.match(r.question, /src\/b\.js/)
})

test('*** the question is ALWAYS one sentence ***', () => {
  const asks = [
    questionFor(['file'], [], null),
    questionFor(['intent'], [], null),
    questionFor(['file', 'intent'], [], null),
    questionFor(['file'], ['a/b.js', 'c/d.js'], null),
    questionFor([], [], 'src/app.js')
  ]
  for (const q of asks) {
    assert.ok(q && q.length > 0)
    assert.equal((q.match(/[？?]/g) || []).length, 1, 'exactly one question mark: ' + q)
  }
})

/* ── 3. a protected path is NAMED, not silently dropped ──────────────────── */

test('*** a forbidden file is named, with the reason ***', () => {
  // Reporting "no file found" would send the Owner hunting for a typo that is not there.
  const r = inferWorkRequest({ message: '幫我改 src/app.js 加個 log' })
  assert.equal(r.file, null, 'it is never accepted as the target')
  assert.equal(r.forbidden, 'src/app.js')
  assert.match(r.question, /受保護範圍/)
  assert.match(r.question, /src\/app\.js/, 'the Owner is told WHICH file, not just "no"')
})

/* ── 4. it decides nothing, and invents nothing ──────────────────────────── */

test('*** chatter yields no file and no intent ***', () => {
  for (const m of ['今日天氣點?', '你好', '多謝晒']) {
    const r = inferWorkRequest({ message: m })
    assert.equal(r.file, null, m)
    assert.equal(r.intent, null, m)
  }
})

test('*** the current message wins over an older one in history ***', () => {
  // A path named three turns ago is a weaker signal than the sentence just typed.
  const r = inferWorkRequest({
    message: '幫我改 docs/canary/agent-canary.md 加一行',
    conversation: '之前講過 src/old.js'
  })
  assert.equal(r.file, 'docs/canary/agent-canary.md')
  assert.deepEqual(r.candidates, ['docs/canary/agent-canary.md'])
})

test('*** history is used only when the message names nothing ***', () => {
  const r = inferWorkRequest({ message: '改埋佢', conversation: '睇下 src/old.js' })
  assert.equal(r.file, 'src/old.js', 'context still counts when the sentence has no path')
})

test('*** it is DETERMINISTIC — no model, no network ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'requestInference.js'), 'utf8')
  // Substring, not regex: 'complete(' is not a valid pattern, and a guard that throws on
  // its own needle proves nothing about the code it is guarding.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').toLowerCase()
  for (const f of ['fetch', 'http', 'adapter', 'complete(', 'llm', 'require(\'./adapters']) {
    assert.equal(code.includes(f), false, 'it must not reach a model or the network: ' + f)
  }
  const a = inferWorkRequest({ message: '幫我改 docs/x.md 加一行' })
  const b = inferWorkRequest({ message: '幫我改 docs/x.md 加一行' })
  assert.deepEqual(a, b, 'the same words always read the same way')
})

test('*** it shares the producer\'s path extractor rather than re-implementing it ***', () => {
  // Two path rules would eventually disagree, and the one that guesses would accept a file
  // the one that validates rejects.
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'requestInference.js'), 'utf8')
  assert.match(src, /require\('\.\/workOrderProducer'\)/)
  assert.match(src, /mentionedFilesFrom/)
  assert.equal(/const re = \//.test(src), false, 'it defines no path regex of its own')
})
