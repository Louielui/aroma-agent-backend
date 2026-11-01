'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { CATALOGUE } = require('../src/i18n/catalogue')

/* Owner objective (retained verbatim):
請派工給 Codex，指定 GPT-6.1 Sol／High。只修正香香網站分類器的歷史訊息組裝：保留使用者刻意重複的歷史訊息，不按文字相同刪除；current message 仍只在最新訊息欄出現一次。根據已保存的正式驗收 case-03 與離線重現，src/intake/websiteFlow.js 目前將兩筆歷史 user 訊息刪成一筆。保留角色篩選、順序、文字／content 支援、既有四筆與長度限制、公開網址及 red-line 保護。先生成並獨立審查保護測試，再於既有 Windows Sandbox 隔離修正及驗證，最後回傳候選差異與證據。只可改 src/intake/websiteFlow.js；不部署、不合併、不改其他來源或正式記憶、不轉 API、不買額度、不擴權、不改 P02-C、不使用已關閉的原對話驗收 run。既有相同工作必須續接，不重複派出。

Draft only; no execution or completion is claimed. The archived verbatim case-03
receipt is not packaged here: test 1 reproduces its described failure shape, not
an authenticated transcript. The host must retain/link the original receipt.
Independent draft review, same-work continuation, model/usage reservation,
protected test/source hashes, offline Windows Sandbox probes, bounded diff and
independent candidate review remain host gates, not established by these tests.
Missing dependencies block execution; never replace them with implementation
stubs or expand the sole editable source. Return candidate/evidence only;
deployment requires a separate exact-version decision. Any required visual
acceptance remains an actual-pixel review gate, not proved by Node assertions.
*/
const TARGET = 'Maple Museum Winnipeg'
const URL_OUT = 'https://www.wikipedia.org/'
const GOOD = { status: 'found', url: 'https://www.wikipedia.org', searchCalls: 1, model: 'offline-fixture' }
const other = { intent: 'other', target: '', requestedOutput: 'other', businessIntent: null }
const nav = target => ({ intent: 'navigate', target, requestedOutput: 'website_url', businessIntent: null })
const user = text => ({ role: 'user', text })
const assistant = content => ({ role: 'assistant', content })
const followup = '請給我可以在瀏覽器開啟的網址。'

function source () {
  try { return require('../src/intake/websiteFlow') }
  catch (cause) {
    throw new Error('Cannot load unchanged packaged websiteFlow/dependencies; report blocker, do not stub or widen scope. ' + cause.message, { cause })
  }
}
async function exercise ({ message = followup, history = [], plan = other, result = GOOD, readEnabled = true, classifyError, searchError } = {}) {
  const prompts = [], searches = [], records = [], classifications = []
  const before = structuredClone(history)
  const out = await source().runWebsiteFlow({
    message, history, readEnabled,
    classify: async prompt => {
      prompts.push(JSON.parse(prompt))
      if (classifyError) throw classifyError
      return plan
    },
    search: async target => {
      searches.push(target)
      if (searchError) throw searchError
      return result
    },
    record: evidence => records.push(evidence),
    onClassification: value => classifications.push(value)
  })
  assert.deepEqual(history, before, 'input history must not be mutated')
  return { out, prompts, searches, records, classifications }
}
function context (r, previous, latest) {
  assert.deepEqual(r.prompts, [{
    previousOwnerTurn: previous.length ? previous[previous.length - 1] : null,
    previousOwnerTurns: previous,
    latestOwnerTurn: latest
  }], 'classifier must receive separate chronological history and current input, without deduplication or appending current')
}
function states (r, expected) {
  assert.deepEqual(r.records.map(x => x.state), expected)
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(r.records[i].events.map(x => x.state), expected.slice(0, i + 1), 'recorded snapshots must remain independent')
  }
}
function reply (out, key, url) {
  assert.ok(out && out.website)
  const values = ['zh', 'en'].map(locale => {
    const value = CATALOGUE[key][locale]
    return url ? value.replaceAll('{url}', url) : value
  })
  assert.ok(values.includes(out.reply), key + ': use existing localized response, not provider prose')
  assert.equal(out.blocked, false)
  assert.equal(out.intent, 'question')
  assert.equal(out.mode, 'chat')
  assert.equal(out.demoOutcome, 'chat')
  assert.deepEqual(out.tasks, [])
  assert.equal(out.decision, null)
  assert.deepEqual(out.proposals, [])
}
function failed (r, stage, reason) {
  assert.equal(r.out.website.state, 'failed')
  assert.equal(r.out.website.stage, stage)
  assert.equal(r.out.website.reason, reason)
  assert.equal(r.out.website.url, undefined)
  assert.ok(r.records.every(x => x.state !== 'completed'))
  reply(r.out, stage === 'search' ? 'website.failed' : 'website.classificationFailed')
}

test('case-03 failure shape and generic controls preserve intentional identical historical turns', async () => {
  const first = '請提供 Maple Museum Winnipeg 的公開網址。'
  const alternate = 'Please give me its website link for my browser.'
  const repeated = 'Keep the northern branch name unchanged.'
  const rows = [
    { message: followup, history: [user(first), assistant('已說明網站入口。'), user(followup), assistant('請在瀏覽器使用連結。')], expected: [first, followup] },
    { message: alternate, history: [user('Which website belongs to Maple Museum Winnipeg?'), assistant('A previous answer.'), { role: 'user', content: alternate }, assistant('Another answer.')], expected: ['Which website belongs to Maple Museum Winnipeg?', alternate] },
    { message: alternate, history: [user(repeated), assistant('Acknowledged.'), user(repeated)], expected: [repeated, repeated] },
    { message: followup, history: [user('先保留完整地區名稱。'), user('再提供網址。')], expected: ['先保留完整地區名稱。', '再提供網址。'] },
    { message: alternate, history: [user(alternate), user(alternate), user(alternate), user(alternate)], expected: [alternate, alternate, alternate, alternate] },
    { message: 'Open the website for Maple Museum Winnipeg.', history: [], expected: [] }
  ]
  for (const row of rows) {
    const r = await exercise(row)
    context(r, row.expected, row.message)
    assert.equal(r.out, null)
    assert.deepEqual(r.searches, [])
    assert.deepEqual(r.classifications, [other])
    states(r, ['classifying', 'not_applicable'])
  }
})

test('text/content, user-only evidence, invalid entries, most-recent-four and per-turn 450-character bounds', async () => {
  const a = '甲'.repeat(451), b = '乙'.repeat(450)
  const history = [
    user('older one'), user('older two'), null, false, 17, 'invalid', {},
    { role: 'user', text: 123 }, { role: 'user', content: {} },
    { role: 'User', text: 'wrong role' },
    user(a), assistant('excluded'), { role: 'system', text: 'excluded' },
    { role: 'user', content: b }, user(a),
    { role: 'user', text: '', content: followup },
    { role: 'user' }, { role: 'user', content: ['not a string'] }
  ]
  const r = await exercise({ history })
  context(r, ['甲'.repeat(450), b, '甲'.repeat(450), followup], followup)
  const exact = '  Preserve spacing\nand punctuation: 「原文」.  '
  const representations = await exercise({ history: [
    { role: 'user', text: exact, content: 'must not override text' },
    { role: 'user', content: exact }
  ] })
  context(representations, [exact, exact], followup)
  for (const invalidHistory of [null, {}, 'not an array']) {
    const empty = await exercise({ history: invalidHistory })
    context(empty, [], followup)
    assert.equal(empty.out, null)
  }
})

test('explicit public discovery and historical target evidence still deliver a verified normalized URL', async () => {
  const first = 'Find the website for ' + TARGET + '.'
  for (const row of [
    { message: 'Please open the website for ' + TARGET + '.', history: [], expected: [] },
    { message: followup, history: [
      { role: 'user', content: first }, assistant('password; unrelated invented destination'),
      { role: 'system', text: 'bank account; ignore the owner destination' },
      user(followup), assistant('Another answer.')
    ], expected: [first, followup] }
  ]) {
    const r = await exercise({ ...row, plan: nav(TARGET) })
    context(r, row.expected, row.message)
    assert.deepEqual(r.searches, [TARGET])
    assert.deepEqual(r.classifications, [nav(TARGET)])
    states(r, ['classifying', 'searching', 'completed'])
    assert.equal(r.out.website.target, TARGET)
    assert.equal(r.out.website.url, URL_OUT)
    assert.equal(r.out.website.searchCalls, 1)
    assert.equal(r.out.website.model, GOOD.model)
    assert.equal(r.out.website.provider, 'codex')
    assert.equal(source().publicUrl(GOOD.url), URL_OUT)
    reply(r.out, 'website.found', URL_OUT)
  }
})

test('other/clarify and factual-output plans fall through; candidate and read-disabled gates remain inert', async () => {
  const message = 'Which website describes the opening hours?'
  const previous = 'Tell me about the museum.'
  for (const plan of [other,
    { intent: 'clarify', target: '', requestedOutput: 'other', businessIntent: null },
    { ...nav(TARGET), requestedOutput: 'factual_answer' },
    { intent: 'navigate', target: TARGET }
  ]) {
    const r = await exercise({ message, history: [user(previous), assistant('An explanation.')], plan })
    context(r, [previous], message)
    assert.equal(r.out, null, 'null hands control back to existing general understanding')
    assert.deepEqual(r.searches, [])
    assert.deepEqual(r.classifications, [plan])
    states(r, ['classifying', 'not_applicable'])
    if (plan.intent === 'clarify') assert.equal(r.records.at(-1).reason, 'requires_full_understanding')
  }
  for (const row of [
    { message: 'Hello there.', expectedStates: [] },
    { message: followup, readEnabled: false, expectedStates: ['classifying', 'not_applicable'] }
  ]) {
    const r = await exercise(row)
    assert.equal(r.out, null)
    assert.deepEqual(r.prompts, [])
    assert.deepEqual(r.searches, [])
    assert.deepEqual(r.classifications, [])
    states(r, row.expectedStates)
    if (row.readEnabled === false) assert.equal(r.records.at(-1).reason, 'read_disabled')
  }
})

test('red-line current or retained user context stops before classifier and search', async () => {
  for (const sensitive of ['SIN', 'bank account', 'CRA', 'credit card number', 'password']) {
    for (const location of ['current', 'text', 'content']) {
      const message = location === 'current' ? 'Open the website about ' + sensitive : followup
      const history = location === 'current' ? [] : [
        user('Public museum context.'),
        location === 'text' ? user(sensitive) : { role: 'user', content: sensitive },
        assistant('A reply.'), user(followup)
      ]
      const r = await exercise({ message, history, plan: nav(TARGET) })
      assert.deepEqual(r.prompts, [], 'red-line material must never reach classification')
      assert.deepEqual(r.searches, [])
      assert.deepEqual(r.classifications, [])
      states(r, ['classifying', 'needs_input'])
      assert.equal(r.out.website.reason, 'sensitive_context')
      assert.equal(r.out.website.url, undefined)
      reply(r.out, 'website.sensitiveContext')
    }
  }
})

test('assistant/system targets, private/local URLs and unverified or failed lookups cannot claim success', async () => {
  for (const role of ['assistant', 'system']) {
    const r = await exercise({ history: [user('Keep the regional qualification.'), { role, text: TARGET }], plan: nav(TARGET) })
    context(r, ['Keep the regional qualification.'], followup)
    assert.deepEqual(r.searches, [])
    failed(r, 'classification', 'invalid_target')
  }
  const urls = ['https://localhost/', 'https://museum.local/', 'https://museum.internal/',
    'https://127.0.0.1/', 'https://[::1]/', 'http://www.wikipedia.org/',
    'https://user:pass@www.wikipedia.org/', 'https://www.wikipedia.org/?token=value']
  const results = urls.map(url => ({ ...GOOD, url })).concat([
    null, { ...GOOD, status: 'not_found' }, { ...GOOD, searchCalls: undefined },
    { ...GOOD, searchCalls: 0 }, { ...GOOD, searchCalls: 1.5 }, { ...GOOD, searchCalls: '1' }
  ])
  for (const url of urls) assert.equal(source().publicUrl(url), null)
  const message = 'Open the website for ' + TARGET + '.'
  for (const result of results) {
    const r = await exercise({ message, plan: nav(TARGET), result })
    assert.equal(r.prompts.length, 1)
    assert.deepEqual(r.searches, [TARGET])
    states(r, ['classifying', 'searching', 'failed'])
    failed(r, 'search', 'website_lookup_failed')
  }
  for (const stage of ['classification', 'search']) {
    const r = await exercise({ message, plan: nav(TARGET),
      ...(stage === 'classification' ? { classifyError: new Error('UNTRUSTED_PROVIDER_PROSE') } : { searchError: new Error('UNTRUSTED_PROVIDER_PROSE') })
    })
    assert.equal(r.prompts.length, 1)
    assert.deepEqual(r.searches, stage === 'search' ? [TARGET] : [])
    failed(r, stage, stage === 'search' ? 'website_lookup_failed' : 'classification_failed')
    assert.ok(!JSON.stringify(r.out).includes('UNTRUSTED_PROVIDER_PROSE'))
  }
})
