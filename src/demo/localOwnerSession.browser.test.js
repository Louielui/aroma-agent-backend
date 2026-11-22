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
    requests.push({ p, method: req.method() })
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (p === '/demo') return route.fulfill({ contentType: 'text/html', body: html })
    if (!loggedIn && ['/api/v1/demo/models','/api/v1/execution-health'].includes(p)) return json({ error: 'owner_auth_required' }, 401)
    if (p === '/api/v1/demo/models') {
      if (modelsDown) return json({ code: 'subscription_unavailable' }, 503)
      const id = req.headers()['x-xiangxiang-conversation']
      const effective = { model: 'local:qwen3.5:9b', effort: 'auto' }
      return json({ billing: 'local', models: [{ model: effective.model, name: 'Local Qwen3.5 9B', available: true,
        supportsEffort: false, efforts: ['auto'] }], selection: id ? { scope: { kind: 'conversation', id }, mode: 'central', revision: 0, effective } : null })
    }
    if (p === '/api/v1/execution-health') return json({ inference: { provider: 'local', state: 'ready', cloudFallback: false } })
    if (p === '/api/v1/demo/intake') return refuseIntake ? json({ error: 'owner_auth_required' }, 401) : json({ reply: 'Fixture reply', historySaved: true })
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
    writes() { return requests.filter(row => row.method !== 'GET') }
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
