'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express')
function html (lang) {
  const read = name => fs.readFileSync(path.join(__dirname, '../demo/assets', name), 'utf8')
  return require('../demo/pageTemplate').assemblePage({ template: read('index.html'), css: read('app.css'), sidebarCss: read('sidebar.css'), app: read('app.js'), sidebar: read('sidebar.js'), topics: read('topics.js'), i18n: require('../i18n/browserResolver').browserI18nSource().replace(/var INITIAL_LOCALE = "(?:zh|en)";/, 'var INITIAL_LOCALE = "' + lang + '";'), dot: read('dot.svg'), favicon: '', sourceLabels: [], subscription: true, modelCenter: true, buildStamp: 'recheck-fixture' })
}
test('HR rechecks use authenticated real routes and bilingual chat/buttons, require selection/confirmation, persist comparisons and render mobile safely', { timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-recheck-browser-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = require('./workspaces').createTopicStore({ dataDir: dir }), conversations = require('../store/conversationStore').createConversationStore({ dataDir: dir })
  const report = { state: 'live', companyId: 123, query: { firstDate: '2026-10-09', timeZone: 'America/Winnipeg' }, retrievedAt: '2026-10-10T18:00:00Z', completeWithinScope: true,
    rows: [{ userId: 7, shiftId: 9, employeeName: '<script>employee</script>', punchIds: [11], scheduledStart: '2026-10-09T15:00:00Z', scheduledEnd: '2026-10-09T23:00:00Z', clockedIn: '2026-10-09T15:00:00Z', clockedOut: null, matchState: 'CONFIRMED', findings: ['unclosed_after_scheduled_end'] }], unmatchedPunches: [] }
  const snapshot = require('./evidenceFollowups').createSnapshot('comparison', report, 'hr-source-report'), cid = 'hr-check-fixture'
  conversations.appendTurn({ id: cid, userText: 'Source', replyText: 'Source', evidenceReport: snapshot }); store.link('hr', cid)
  const note = require('./evidenceFollowups').createEvidenceFollowups({ store, conversations }).accept('hr', { conversationId: cid, reportId: snapshot.id, keys: [snapshot.candidates[0].key], confirmed: true }).notes[0]
  let reads = 0, models = 0, locale = 'zh'
  const reader = { captureAccess: () => () => {}, readComparison: async () => { reads++; const value = structuredClone(report); value.retrievedAt = new Date(Date.now() - 100).toISOString(); value.rows[0].clockedOut = value.rows[0].scheduledEnd; value.rows[0].findings = []; return value } }
  const rechecks = require('./rechecks').createRechecks({ store, reader })
  const app = express(); app.locals.conversationDemo = true; app.use(express.json()); app.use((req, res, next) => req.headers['x-fixture-owner'] === 'owner' ? next() : res.sendStatus(401))
  app.get('/demo', (req, res) => res.type('html').send(html(locale)))
  app.get('/api/v1/conversations/:id', (req, res) => res.json({ ok: true, conversation: conversations.get(req.params.id) }))
  app.use('/api/v1/topic-workspaces', require('./routes').createTopicRouter({ store, conversations, rechecks }))
  app.use('/api/v1/demo/intake', (req, res, next) => { const original = 'http://' + req.headers.host; req.headers.host = '127.0.0.1:8090'; if (req.headers.origin === original) req.headers.origin = 'http://127.0.0.1:8090'; next() })
  app.use(require('../routes/demoRouter').createDemoRouter({ conversationStore: conversations, hrRechecks: rechecks, getAdapterFn: () => { models++; throw Error('model_must_not_run') } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port, request = (url, body, origin = base, owner = true) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { ...(owner ? { 'x-fixture-owner': 'owner' } : {}), origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const input = { conversationId: cid, requestId: 'http-recheck-fixture' }, prefix = '/api/v1/topic-workspaces/hr'
  assert.equal((await request(prefix + '/rechecks', input, base, false)).status, 401)
  assert.equal((await request(prefix + '/rechecks', input, 'https://outside.example')).status, 403)
  assert.equal((await request('/api/v1/topic-workspaces/email/rechecks', input)).status, 403)
  assert.equal(reads, 0)
  const preview = await (await request(prefix + '/rechecks', input)).json(); assert.equal(preview.recheck.items[0].result.suggestedState, 'done'); assert.equal(store.get('hr').notes[0].state, 'todo')
  const approved = { id: input.requestId, keys: [note.id], confirmed: true }
  assert.equal((await request(prefix + '/recheck-updates', { ...approved, confirmed: false })).status, 400)
  assert.equal((await request(prefix + '/recheck-updates', { ...approved, state: 'done' })).status, 400)
  assert.equal((await request(prefix + '/recheck-updates', { ...approved, keys: ['bad-note-id'] })).status, 400)
  assert.equal(store.get('hr').notes[0].revision, 1)
  for (const [message, id] of [['重新查一下 HR 未完成的跟進項目，看看哪些已有變化', '11111111-1111-4111-8111-111111111111'], ['Recheck unfinished HR follow-ups and show changes', '22222222-2222-4222-8222-222222222222']]) {
    const body = { message, conversationId: cid, workflowRequestId: id, interactionMode: 'chat' }
    const response = await request('/api/v1/demo/intake', body); assert.equal(response.status, 200); const value = await response.json()
    assert.equal(value.hrRecheckOffer.id, id); assert.equal(value.historySaved, true)
    await request('/api/v1/demo/intake', body)
    assert.equal(conversations.get(cid).messages.filter(m => m.hrRecheckId === id).length, 1)
  }
  assert.equal(reads, 3); assert.equal(models, 0)
  const browser = await require('playwright-core').chromium.launch({ channel: 'msedge', headless: true }), errors = []
  try {
    for (const [lang, width] of [['zh', 1280], ['en', 390]]) {
      locale = lang
      const context = await browser.newContext({ viewport: { width, height: 844 }, extraHTTPHeaders: { 'x-fixture-owner': 'owner' } })
      const catalog = require('../workers/execution/chatBrowser.cjs').modelCatalogue()
      await context.route('**/api/v1/demo/models', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...catalog, central: { model: 'gpt-6.1-sol', effort: 'high' }, selection: { mode: 'central' } }) }))
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
      await page.goto(base + '/demo?topic=hr'); await page.locator('.hr-recheck-open').first().click(); const dialog = page.locator('.hr-recheck-viewer'); await dialog.waitFor()
      assert.equal(await dialog.locator('script').count(), 0); assert.equal(await dialog.locator('.followup-footer button').isDisabled(), true)
      assert.match(await dialog.textContent(), /<script>employee<\/script>/)
      await dialog.locator('details').first().locator('summary').click()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (process.env.DEPARTMENT_SCREEN_DIR) await page.screenshot({ path: path.join(process.env.DEPARTMENT_SCREEN_DIR, 'hr-rechecks-' + lang + '.png') })
      if (lang === 'zh') {
        assert.equal(store.get('hr').notes[0].state, 'todo'); await dialog.locator('input[type=checkbox]').check(); await dialog.locator('.followup-footer button').click()
        await page.waitForFunction(() => document.querySelector('.hr-recheck-viewer .topic-status').textContent.includes('已保存'))
        assert.equal(store.get('hr').notes[0].state, 'done'); assert.deepEqual(store.get('hr').notes[0].source, note.source)
        await dialog.locator('details').nth(1).locator('summary').click(); assert.match(await dialog.textContent(), /2026-10-09/)
      } else assert.equal(await dialog.locator('input[type=checkbox]').isDisabled(), true)
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); await page.reload()
      await page.locator('#topic-follow-ups > summary').click(); await page.locator('.topic-note').waitFor(); assert.equal(await page.locator('.topic-note select').inputValue(), 'done')
      await page.locator('.hr-recheck-latest').click(); await dialog.waitFor(); assert.match(await dialog.textContent(), lang === 'zh' ? /UNKNOWN/ : /No unfinished/)
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
      if (!await page.locator('#topic-follow-ups').evaluate(el => el.open)) await page.locator('#topic-follow-ups > summary').click(); await page.locator('.hr-recheck-all').click(); await dialog.waitFor()
      assert.equal(await dialog.locator('input[type=checkbox]').count(), 0); assert.equal(reads, 3, 'completed items cause no fresh reads')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await context.close()
    }
    assert.deepEqual(errors, []); assert.equal(models, 0)
  } finally { await browser.close() }
})
