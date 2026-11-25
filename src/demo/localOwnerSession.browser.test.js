'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { chromium } = require('playwright-core')
const { CATALOGUE } = require('../i18n/catalogue')

async function fixture(t) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  const requests = []
  let loggedIn = true
  let modelsDown = false
  let refuseIntake = false
  let modelGate = null
  let selectedConversation = null
  const { buildDemoHtml } = require('./demoHtml')
  const savedBackend = process.env.CHAT_BACKEND
  process.env.CHAT_BACKEND = 'local'
  let html
  try { html = buildDemoHtml() }
  finally { if (savedBackend === undefined) delete process.env.CHAT_BACKEND; else process.env.CHAT_BACKEND = savedBackend }
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname
    assert.equal(url.origin, 'http://127.0.0.1:19098')
    const body = p === '/api/v1/demo/intake' ? req.postDataJSON() : null
    requests.push({ p, method: req.method(), ...(body ? { body } : {}) })
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (p === '/demo') return route.fulfill({ contentType: 'text/html', body: html })
    if (!loggedIn && ['/api/v1/demo/models','/api/v1/execution-health'].includes(p)) return json({ error: 'owner_auth_required' }, 401)
    if (p === '/api/v1/demo/models') {
      if (modelsDown) return json({ code: 'subscription_unavailable' }, 503)
      const id = req.headers()['x-xiangxiang-conversation']
      selectedConversation = id
      if (modelGate) {
        modelGate.started()
        await modelGate.pending
      }
      const effective = { model: 'local:qwen3.5:9b', effort: 'auto' }
      return json({ billing: 'local', models: [{ model: effective.model, name: 'Local Qwen3.5 9B', available: true,
        supportsEffort: false, efforts: ['auto'] }], selection: id ? { scope: { kind: 'conversation', id }, mode: 'central', revision: 0, effective } : null })
    }
    if (p === '/api/v1/execution-health') return json({ inference: { provider: 'local', state: 'ready', cloudFallback: false } })
    if (p === '/api/v1/demo/intake') {
      if (refuseIntake) return json({ error: 'owner_auth_required' }, 401)
      const body = { lane: 'chat', mode: 'chat', reply: 'Fixture reply', historySaved: true }
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ type: 'final', status: 200, body }) + '\n\n' })
    }
    if (p === '/api/v1/conversations') return json({ ok: true, conversations: [] })
    if (p === '/api/v1/home/settings') return json({ entries: [] })
    return json({})
  })
  await page.goto('http://127.0.0.1:19098/demo')
  const draft = '  Fixture draft，請逐字保留。  '
  await page.locator('#msg').fill(draft)
  await page.waitForFunction(() => !document.getElementById('send').disabled)
  return {
    page, draft, requests, errors,
    restart() { loggedIn = false },
    signedIn() { loggedIn = true },
    modelsDown() { modelsDown = true },
    refuseIntake() { refuseIntake = true },
    writes() { return requests.filter(row => row.method !== 'GET').map(({ p, method }) => ({ p, method })) },
    submissions() { return requests.filter(row => row.body).map(row => row.body) },
    selectedConversation() { return selectedConversation },
    holdModels() {
      let release, started
      const pending = new Promise(resolve => { release = resolve })
      const entered = new Promise(resolve => { started = resolve })
      modelGate = { pending, started }
      return { entered, release() { modelGate = null; release() } }
    }
  }
}

test('local chat distinguishes expired login, restores send after re-login and never posts the draft', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.restart()
  await f.page.locator('#picker').click()
  const notice = f.page.locator('#brain-status')
  await notice.locator('a').waitFor()
  const text = await notice.textContent()
  assert.ok(['zh','en'].some(locale => text.includes(CATALOGUE['localBrain.loginRequired'][locale])))
  assert.equal(await f.page.locator('#send').isDisabled(), true)
  assert.equal(await f.page.locator('#msg').inputValue(), f.draft)
  assert.equal(await notice.locator('a').getAttribute('href'), '/owner/login?next=%2Fdemo')
  assert.equal(await notice.locator('a').getAttribute('target'), '_blank')
  assert.equal(await f.page.locator('#execution-status').textContent(), '')
  f.signedIn()
  await f.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await f.page.waitForFunction(() => !document.getElementById('send').disabled)
  assert.equal(await notice.textContent(), '')
  assert.equal(await f.page.locator('#msg').inputValue(), f.draft)
  assert.deepEqual(f.writes(), [])
  assert.deepEqual(f.errors, [])
})

test('a genuine model catalogue outage stays unavailable without a login prompt', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.modelsDown()
  await f.page.locator('#picker').click()
  await f.page.waitForFunction(() => document.getElementById('send').disabled)
  const notice = f.page.locator('#brain-status')
  const text = await notice.textContent()
  assert.ok(['zh','en'].some(locale => text === CATALOGUE['localBrain.unavailable'][locale]))
  assert.equal(await notice.locator('a').count(), 0)
  assert.equal(await f.page.locator('#msg').inputValue(), f.draft)
  assert.deepEqual(f.writes(), [])
})

test('a refused intake restores the literal draft and removes the unsubmitted turn', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.refuseIntake()
  await f.page.locator('#send').click()
  await f.page.locator('#brain-status a').waitFor()
  await f.page.waitForFunction(() => !document.getElementById('msg').disabled)
  assert.equal(await f.page.locator('#msg').inputValue(), f.draft)
  assert.equal(await f.page.locator('#send').isDisabled(), true)
  assert.equal((await f.page.locator('#log').textContent()).includes(f.draft.trim()), false)
  assert.deepEqual(f.writes().filter(row => row.p === '/api/v1/demo/intake'), [{ p: '/api/v1/demo/intake', method: 'POST' }])
  assert.deepEqual(f.errors, [])
})

test('background health notices expired login before the next send attempt', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.restart()
  await f.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await f.page.locator('#brain-status a').waitFor()
  assert.equal(await f.page.locator('#send').isDisabled(), true)
  assert.equal(await f.page.locator('#msg').inputValue(), f.draft)
  assert.deepEqual(f.writes(), [])
})

async function captureComposerEvents(page) {
  await page.evaluate(() => {
    window.fixtureComposerEvents = []
    function record(event) {
      const id = event.target.closest('#msg, #send, #new-chat')?.id
      if (!id || (event.type === 'keydown' && event.key !== 'Enter')) return
      window.fixtureComposerEvents.push({
        type: event.type, target: id, trusted: event.isTrusted, repeat: event.repeat ?? null
      })
    }
    document.addEventListener('click', record, true)
    document.addEventListener('keydown', record, true)
  })
}

async function submissionEvidence(t, fixture) {
  const events = await fixture.page.evaluate(() => window.fixtureComposerEvents)
  const submissions = fixture.submissions().map(request => ({
    requestId: request.workflowRequestId, websiteRequestId: request.websiteRequestId,
    conversationId: request.conversationId, priorTurns: request.history.length
  }))
  t.diagnostic(JSON.stringify({ events, submissions }))
  assert.ok(events.every(event => event.trusted))
  assert.ok(submissions.every(row => row.requestId && row.requestId === row.websiteRequestId))
  assert.equal(new Set(submissions.map(row => row.requestId)).size, submissions.length)
  assert.deepEqual(fixture.errors, [])
  return { events, submissions }
}

async function waitForFixtureReply(page) {
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('Fixture reply') &&
    !document.getElementById('msg').disabled)
}

for (const [name, send] of [
  ['Enter', async page => page.locator('#msg').press('Enter')],
  ['Send button', async page => page.locator('#send').click()]
]) {
  test('one ' + name + ' submits only the active fictional conversation', { timeout: 20000 }, async t => {
    const f = await fixture(t), cid = f.selectedConversation()
    await captureComposerEvents(f.page)
    await send(f.page)
    await waitForFixtureReply(f.page)
    const { events, submissions } = await submissionEvidence(t, f)
    assert.equal(events.length, 1)
    assert.equal(submissions.length, 1)
    assert.equal(submissions[0].conversationId, cid)
  })
}

test('one held Enter sends once when the model selection response is delayed', { timeout: 20000 }, async t => {
  const f = await fixture(t), cid = f.selectedConversation()
  await captureComposerEvents(f.page)
  const gate = f.holdModels()
  await f.page.locator('#msg').focus()
  await f.page.keyboard.down('Enter')
  await gate.entered
  await f.page.keyboard.down('Enter')
  await f.page.keyboard.up('Enter')
  gate.release()
  await waitForFixtureReply(f.page)
  const { events, submissions } = await submissionEvidence(t, f)
  assert.deepEqual(events.map(event => event.repeat), [false, true])
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0].conversationId, cid)
})

test('Enter and Send during the same model selection check share one submission', { timeout: 20000 }, async t => {
  const f = await fixture(t), cid = f.selectedConversation()
  await captureComposerEvents(f.page)
  const gate = f.holdModels()
  await f.page.locator('#msg').press('Enter')
  await gate.entered
  await f.page.locator('#send').click()
  gate.release()
  await waitForFixtureReply(f.page)
  const { events, submissions } = await submissionEvidence(t, f)
  assert.deepEqual(events.map(event => event.target), ['msg', 'send'])
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0].conversationId, cid)
})

test('new chat during a pending selection never sends a retained draft to either conversation', { timeout: 20000 }, async t => {
  const f = await fixture(t), formerId = f.selectedConversation()
  await captureComposerEvents(f.page)
  const gate = f.holdModels()
  await f.page.locator('#msg').press('Enter')
  await gate.entered
  await f.page.locator('#new-chat').click()
  gate.release()
  await f.page.waitForFunction(() => !document.getElementById('send').disabled)
  const nextId = f.selectedConversation()
  assert.notEqual(nextId, formerId)
  assert.equal(await f.page.locator('#msg').inputValue(), f.draft)
  assert.deepEqual(f.submissions(), [])
  await f.page.locator('#send').click()
  await waitForFixtureReply(f.page)
  const { events, submissions } = await submissionEvidence(t, f)
  assert.deepEqual(events.map(event => event.target), ['msg', 'new-chat', 'send'])
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0].conversationId, nextId)
  assert.equal(submissions[0].priorTurns, 0)
})

test('switching to a new conversation after a fictional reply submits only on each explicit send', { timeout: 20000 }, async t => {
  const f = await fixture(t), formerId = f.selectedConversation()
  await captureComposerEvents(f.page)
  await f.page.locator('#msg').press('Enter')
  await waitForFixtureReply(f.page)
  await f.page.locator('#new-chat').click()
  assert.equal(f.submissions().length, 1)
  await f.page.locator('#msg').fill(f.draft)
  await f.page.waitForFunction(() => !document.getElementById('send').disabled)
  const nextId = f.selectedConversation()
  assert.notEqual(nextId, formerId)
  await f.page.locator('#send').click()
  await waitForFixtureReply(f.page)
  const { events, submissions } = await submissionEvidence(t, f)
  assert.deepEqual(events.map(event => event.target), ['msg', 'new-chat', 'send'])
  assert.deepEqual(submissions.map(row => row.conversationId), [formerId, nextId])
})
