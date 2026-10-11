'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express')
function html (lang) {
  const read = name => fs.readFileSync(path.join(__dirname, '../demo/assets', name), 'utf8')
  return require('../demo/pageTemplate').assemblePage({ template: read('index.html'), css: read('app.css'), sidebarCss: read('sidebar.css'), app: read('app.js'), sidebar: read('sidebar.js'), topics: read('topics.js'), i18n: require('../i18n/browserResolver').browserI18nSource().replace(/var INITIAL_LOCALE = "(?:zh|en)";/, 'var INITIAL_LOCALE = "' + lang + '";'), dot: read('dot.svg'), favicon: '', sourceLabels: [], subscription: true, modelCenter: true, buildStamp: 'evidence-fixture' })
}
test('real HTTP HR follow-up path selects, confirms, reopens, edits and deduplicates evidence in Chinese desktop and English mobile', { timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-evidence-browser-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const conversations = require('../store/conversationStore').createConversationStore({ dataDir: dir }), store = require('./workspaces').createTopicStore({ dataDir: dir })
  const report = { state: 'live', companyId: 123, query: { firstDate: '2026-10-09', lastDate: '2026-10-09', timeZone: 'America/Winnipeg' }, punchQuery: { firstDate: '2026-10-08', lastDate: '2026-10-10' }, retrievedAt: '2026-10-10T18:00:00Z', completeWithinScope: false, scheduleRows: 1, punchRows: 1, attentionRows: 1,
    rows: [{ userId: 7, shiftId: 9, locationId: 5, employeeName: '<script>employee</script>', punchIds: [11], clockedIn: '2026-10-09T15:10:00Z', clockedOut: null, scheduledStart: '2026-10-09T15:00:00Z', scheduledEnd: '2026-10-09T23:00:00Z', startDifferenceMinutes: 10, endDifferenceMinutes: null, matchState: 'CONFIRMED', findings: ['later_clock_in', 'unclosed_after_scheduled_end'], discrepancyState: 'CANDIDATE', absenceState: 'UNKNOWN', currentlyWorkingState: 'UNKNOWN' }], unmatchedPunches: [] }
  let lang = 'zh', reads = 0, models = 0
  const app = express(); app.locals.conversationDemo = true; app.use(express.json())
  app.use((req, res, next) => req.headers['x-fixture-owner'] === 'owner' ? next() : res.sendStatus(401))
  app.get('/demo', (req, res) => res.type('html').send(html(lang)))
  app.get('/api/v1/conversations/:id', (req, res) => res.json({ ok: true, conversation: conversations.get(req.params.id) }))
  app.use('/api/v1/topic-workspaces', require('./routes').createTopicRouter({ store, conversations }))
  // The production intake is pinned to 8090; this isolated listener uses an ephemeral port.
  app.use('/api/v1/demo/intake', (req, res, next) => { const original = 'http://' + req.headers.host; req.headers.host = '127.0.0.1:8090'; if (req.headers.origin === original) req.headers.origin = 'http://127.0.0.1:8090'; next() })
  app.use(require('../routes/demoRouter').createDemoRouter({ conversationStore: conversations, sevenShiftsReport: { captureAccess: () => () => {}, readComparison: async () => { reads++; return report } }, getAdapterFn: () => { models++; throw Error('model_must_not_run') } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port
  const request = (url, body, origin = base, owner = true) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { ...(owner ? { 'x-fixture-owner': 'owner' } : {}), origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const cid = 'hr-browser-report', body = { message: '查 2026-10-09 排班與打卡差異', conversationId: cid, workflowRequestId: '11111111-1111-4111-8111-111111111111', interactionMode: 'chat' }
  store.link('hr', cid)
  const response = await request('/api/v1/demo/intake', body); assert.equal(response.status, 200)
  const value = await response.json(); assert.equal(value.followUpOffer.reportId, body.workflowRequestId); assert.equal(value.historySaved, true)
  assert.equal(conversations.get(cid).messages[1].evidenceReport.candidates[0].evidence.clockedOut, null)
  const suffix = '/api/v1/topic-workspaces/hr/follow-up-candidates?conversationId=' + cid + '&reportId=' + body.workflowRequestId
  assert.equal((await request(suffix, null, base, false)).status, 401)
  const preview = await (await request(suffix)).json(), accepted = { ...value.followUpOffer, keys: [preview.report.candidates[0].key], confirmed: true }
  assert.equal((await request('/api/v1/topic-workspaces/hr/evidence-follow-ups', accepted, 'https://outside.example')).status, 403)
  assert.equal((await request('/api/v1/topic-workspaces/email/evidence-follow-ups', accepted)).status, 403)
  assert.equal((await request('/api/v1/topic-workspaces/hr/evidence-follow-ups', { ...accepted, confirmed: false })).status, 400)
  assert.equal((await request('/api/v1/topic-workspaces/hr/evidence-follow-ups', { ...accepted, keys: ['fake'] })).status, 400)
  for (const message of ['把這份報告需要確認的項目整理成跟進清單', 'Prepare a follow-up list from this report']) {
    const offer = await (await request('/api/v1/demo/intake', { ...body, message })).json(); assert.equal(offer.followUpOffer.reportId, body.workflowRequestId)
  }
  assert.equal(reads, 1); assert.equal(models, 0); assert.equal(store.get('hr').notes.length, 0)
  const browser = await require('playwright-core').chromium.launch({ channel: 'msedge', headless: true }), errors = []
  try {
    for (const [locale, width] of [['zh', 1280], ['en', 390]]) {
      lang = locale
      const context = await browser.newContext({ viewport: { width, height: 844 }, extraHTTPHeaders: { 'x-fixture-owner': 'owner' } })
      const catalog = require('../workers/execution/chatBrowser.cjs').modelCatalogue()
      await context.route('**/api/v1/demo/models', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...catalog, central: { model: 'gpt-6.1-sol', effort: 'high' }, selection: { mode: 'central' } }) }))
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
      await page.goto(base + '/demo?topic=hr'); await page.locator('.followup-prepare').first().click()
      const dialog = page.locator('.followup-viewer'); await dialog.waitFor()
      assert.match(await dialog.textContent(), /UNKNOWN/)
      assert.equal(await dialog.locator('script').count(), 0, 'external employee names cannot become markup')
      assert.equal(await dialog.locator('.followup-footer button').isDisabled(), true)
      if (locale === 'zh') {
        assert.equal(store.get('hr').notes.length, 0, 'preview is read-only')
        await dialog.locator('input[type=checkbox]').check(); await dialog.locator('.followup-footer button').click()
        await page.waitForFunction(() => document.querySelector('.followup-footer .topic-status').textContent.includes('已保存'))
        assert.equal(store.get('hr').notes.length, 1)
      } else {
        assert.equal(await dialog.locator('input[type=checkbox]').isDisabled(), true, 'reopening does not reopen or duplicate saved work')
        assert.match(await dialog.textContent(), /Already tracked/)
      }
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
      await page.locator('#topic-follow-ups > summary').click()
      const note = page.locator('.topic-note'); await note.locator('details summary').click()
      assert.match(await note.textContent(), /11111111-1111-4111-8111-111111111111/)
      assert.match(await note.textContent(), /UNKNOWN/)
      if (locale === 'zh') {
        await note.locator('select').selectOption('doing'); await note.locator('form input').fill('Owner checking shift'); await note.locator('form button').click()
        await page.waitForFunction(() => document.querySelector('.topic-note select').value === 'doing')
      }
      await page.locator('#msg').fill('Owner draft'); await note.locator('div > button').click(); assert.equal(await page.locator('#msg').inputValue(), 'Owner draft')
      await page.locator('#msg').fill(''); await note.locator('div > button').click(); assert.match(await page.locator('#msg').inputValue(), /2026-10-09/)
      assert.equal(reads, 1, 'preparing refresh never dispatches')
      await page.reload(); await page.locator('#topic-follow-ups > summary').click(); await page.locator('.topic-note').waitFor()
      assert.equal(await page.locator('.topic-note select').inputValue(), 'doing')
      assert.equal(await page.locator('.topic-note form input').inputValue(), 'Owner checking shift')
      assert.equal(await page.locator('.followup-prepare').count(), 1, 'saved structured report restores its preparation button')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (process.env.DEPARTMENT_SCREEN_DIR) await page.screenshot({ path: path.join(process.env.DEPARTMENT_SCREEN_DIR, 'hr-followups-' + locale + '.png') })
      await context.close()
    }
    const again = await (await request('/api/v1/topic-workspaces/hr/evidence-follow-ups', accepted)).json(); assert.equal(again.reused, 1); assert.equal(again.notes[0].state, 'doing')
    assert.equal(reads, 1); assert.equal(models, 0); assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
