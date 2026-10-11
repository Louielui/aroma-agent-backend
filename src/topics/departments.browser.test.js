'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { assemblePage } = require('../demo/pageTemplate')
function html (lang) {
  const read = name => fs.readFileSync(path.join(__dirname, '../demo/assets', name), 'utf8')
  return assemblePage({ template: read('index.html'), css: read('app.css'), sidebarCss: read('sidebar.css'), app: read('app.js'), sidebar: read('sidebar.js'), topics: read('topics.js'), i18n: require('../i18n/browserResolver').browserI18nSource().replace(/var INITIAL_LOCALE = "(?:zh|en)";/, 'var INITIAL_LOCALE = "' + lang + '";'), dot: read('dot.svg'), favicon: '', sourceLabels: [], subscription: true, modelCenter: true, buildStamp: 'department-fixture' })
}
test('bilingual HR entry prepares an explicit-date read without sending, preserves drafts and persists isolated follow-ups', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'department-browser-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const topics = require('./workspaces').createTopicStore({ dataDir: dir }), catalog = require('../workers/execution/chatBrowser.cjs').modelCatalogue()
  const conversations = require('../store/conversationStore').createConversationStore({ dataDir: dir })
  conversations.appendTurn({ id: 'hr-saved', userText: 'Saved HR question', replyText: 'Saved attendance result' }); topics.link('hr', 'hr-saved')
  conversations.appendTurn({ id: 'mail-saved', userText: 'Saved mail question', replyText: 'Private mail result' }); topics.link('email', 'mail-saved')
  const center = require('../modelCenter/service').createModelCenter({ dataDir: dir, catalogue: async () => catalog, topicForConversation: topics.topicForConversation })
  await center.saveSelection('topic', 'hr', { revision: 0, mode: 'custom', model: 'gpt-6.1-sol', effort: 'high' })
  const browser = await require('playwright-core').chromium.launch({ channel: 'msedge', headless: true }), errors = [], unexpected = [], sent = []
  try {
    for (const [lang, width] of [['zh', 1280], ['en', 390]]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route('**/*', async route => {
        const r = route.request(), url = new URL(r.url()), p = url.pathname, method = r.method(), body = r.postDataJSON()
        const response = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
        if (url.hostname !== '127.0.0.1') { unexpected.push(p); return route.abort() }
        if (p === '/demo') return route.fulfill({ contentType: 'text/html', body: html(lang) })
        if (p === '/api/v1/demo/models') return response({ ...catalog, central: center.read().brain, selection: center.selection('topic', 'hr') })
        if (p.startsWith('/api/v1/conversations/')) return response({ ok: true, conversation: conversations.get(p.split('/').at(-1)) })
        if (p.startsWith('/api/v1/topic-workspaces/')) {
          const id = p.split('/')[4]
          if (p.endsWith('/notes') && method === 'POST') return response({ note: topics.createNote(id, body) })
          if (p.endsWith('/conversations') && method === 'POST') return response({ workspace: topics.link(id, body.id) })
          const workspace = topics.get(id)
          return response({ ok: true, workspace, conversations: conversations.list().filter(v => workspace.conversationIds.includes(v.id)) })
        }
        if (p === '/api/v1/demo/intake') {
          sent.push(body)
          if (require('../context/sevenShiftsComparison').comparisonRequest(body.message)) {
            const { buildComparison, comparisonReply, comparisonWindows } = require('../context/sevenShiftsComparison')
            const request = { window: 'dates', dates: ['2026-10-09'] }, now = '2026-10-10T18:00:00Z', windows = comparisonWindows(request, now)
            const value = (q, field, fields) => ({ results: fields.map(fields => ({ fields })), evidence: { trust: 'live', completeWithinScope: true, returnedRows: fields.length, queryScope: { companyId: 123, field, window: q.start + '..' + new Date(Date.parse(q.end) - 1).toISOString() } } })
            const report = buildComparison(value(windows.query, 'start', [{ companyId: 123, userId: 7, shiftId: 9, locationId: 5, start: '2026-10-09T15:00:00Z', end: '2026-10-09T23:00:00Z', unassigned: false, published: true, employeeName: 'Comparison fixture', nameState: 'confirmed' }]), value(windows.punchQuery, 'clocked_in', [{ companyId: 123, userId: 7, punchId: 11, shiftId: 9, locationId: 5, clockedIn: '2026-10-09T15:10:00Z', clockedOut: null }]), request, now, 123)
            const reply = comparisonReply(report, lang)
            conversations.appendTurn({ id: body.conversationId, userText: body.message, replyText: reply })
            return response({ lane: 'chat', mode: 'chat', reply, sevenShiftsComparison: report, sourceBound: true, servedBy: null })
          }
          if (require('../context/sevenShiftsAttendance').attendanceRequest(body.message)) {
            const report = require('../context/sevenShiftsAttendance').buildAttendance({ results: [{ fields: { companyId: 123, userId: 7, punchId: 11, employeeName: 'Attendance fixture', nameState: 'confirmed', clockedIn: '2026-10-09T16:00:00Z', clockedOut: null } }], evidence: { trust: 'live', completeWithinScope: true, returnedRows: 1, queryScope: { companyId: 123, field: 'clocked_in', window: '2026-10-09T05:00:00.000Z..2026-10-10T04:59:59.999Z' } } }, { window: 'dates', dates: ['2026-10-09'] }, '2026-10-10T18:00:00Z', 123)
            const reply = require('../context/sevenShiftsAttendance').attendanceReply(report, lang)
            conversations.appendTurn({ id: body.conversationId, userText: body.message, replyText: reply })
            return response({ lane: 'chat', mode: 'chat', reply, sevenShiftsAttendance: report, sourceBound: true, servedBy: null })
          }
          return response({ lane: 'chat', mode: 'chat', reply: 'Fixture answer', servedBy: body.chatModel })
        }
        const fixtures = { '/api/v1/demo/greeting': { line: 'Fixture' }, '/api/v1/demo/version': { build: 'department-fixture' }, '/api/v1/conversations': { ok: true, conversations: [] }, '/api/v1/home/briefing': { sections: [] }, '/api/v1/home/settings': { entries: [] }, '/api/v1/execution-health': { state: 'unavailable' }, '/manifest.webmanifest': {} }
        if (method === 'GET' && Object.hasOwn(fixtures, p)) return response(fixtures[p])
        unexpected.push(p); return route.abort()
      })
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
      await page.goto('http://127.0.0.1:19091/demo?topic=hr')
      await page.locator('#hr-query-date').waitFor()
      await page.waitForFunction(() => document.getElementById('log').textContent.includes('Saved attendance result'))
      assert.ok(!(await page.locator('#convs').textContent()).includes('Saved mail question'))
      assert.equal(await page.locator('#hr-query-date').inputValue(), '')
      const before = sent.length
      await page.locator('#hr-query-prepare').click(); assert.equal(await page.locator('#msg').inputValue(), ''); assert.equal(sent.length, before)
      await page.locator('#hr-missing-prepare').click(); assert.equal(await page.locator('#msg').inputValue(), ''); assert.equal(sent.length, before)
      await page.locator('#hr-compare-prepare').click(); assert.equal(await page.locator('#msg').inputValue(), ''); assert.equal(sent.length, before)
      await page.locator('#hr-query-date').fill('2026-10-09'); await page.locator('#hr-query-prepare').click()
      const query = await page.locator('#msg').inputValue()
      assert.deepEqual(require('../context/sevenShiftsReport').clockOutRequest(query), { window: 'dates', dates: ['2026-10-09'] })
      assert.equal(sent.length, before, 'preparing never dispatches a query or invokes a model')
      await page.locator('#msg').fill('Owner draft'); await page.locator('#hr-query-prepare').click(); assert.equal(await page.locator('#msg').inputValue(), 'Owner draft')
      await page.locator('#msg').fill(query); await page.waitForFunction(() => !document.getElementById('send').disabled)
      const reply = page.waitForResponse(r => r.url().endsWith('/api/v1/demo/intake')); await page.locator('#send').click(); await reply
      assert.equal(sent.at(-1).chatModel, 'gpt-6.1-sol'); assert.equal(sent.at(-1).chatLevel, 'high'); assert.equal(sent.at(-1).message, query)
      await page.waitForFunction(() => document.getElementById('log').textContent.includes('Fixture answer'))
      await page.locator('#msg').fill('Owner draft'); await page.locator('#hr-missing-prepare').click(); assert.equal(await page.locator('#msg').inputValue(), 'Owner draft')
      await page.locator('#msg').fill(''); const beforeMissing = sent.length, priorTables = await page.locator('#log table').count()
      await page.locator('#hr-missing-prepare').click()
      assert.deepEqual(require('../context/sevenShiftsAttendance').attendanceRequest(await page.locator('#msg').inputValue()), { window: 'dates', dates: ['2026-10-09'] })
      assert.equal(sent.length, beforeMissing)
      const missingResponse = page.waitForResponse(r => r.url().endsWith('/api/v1/demo/intake')); await page.locator('#send').click(); await missingResponse
      await page.waitForFunction(n => document.querySelectorAll('#log table').length === n + 1, priorTables)
      assert.match(await page.locator('#log').textContent(), /UNKNOWN/); assert.match(await page.locator('#log table').last().textContent(), /CANDIDATE/)
      await page.locator('#msg').fill('Owner draft'); await page.locator('#hr-compare-prepare').click(); assert.equal(await page.locator('#msg').inputValue(), 'Owner draft')
      await page.locator('#msg').fill(''); const beforeCompare = sent.length
      await page.locator('#hr-compare-prepare').click()
      assert.deepEqual(require('../context/sevenShiftsComparison').comparisonRequest(await page.locator('#msg').inputValue()), { window: 'dates', dates: ['2026-10-09'] })
      assert.equal(sent.length, beforeCompare)
      const compareResponse = page.waitForResponse(r => r.url().endsWith('/api/v1/demo/intake')); await page.locator('#send').click(); await compareResponse
      await page.waitForFunction(() => document.getElementById('log').textContent.includes('Comparison fixture'))
      assert.match(await page.locator('#log table').last().textContent(), /CONFIRMED/)
      await page.locator('#topic-follow-ups summary').click(); await page.locator('#topic-note-title').fill('Attendance follow-up ' + lang)
      await page.locator('#topic-note-next').fill('Verify with employee'); await page.locator('.topic-note-form button').click()
      await page.waitForFunction(() => document.querySelector('.topic-note strong') !== null)
      await page.reload(); await page.locator('#hr-query-date').waitFor(); assert.equal(topics.get('email').notes.length, 0)
      await page.waitForFunction(() => document.getElementById('log').textContent.includes('Saved attendance result'))
      assert.match(await page.locator('#log').textContent(), /Attendance fixture/)
      assert.match(await page.locator('#log').textContent(), /Comparison fixture/)
      assert.equal(topics.get('hr').lastConversationId, 'hr-saved')
      await page.locator('[data-sidebar-group="daily"] summary').click()
      for (const id of ['open-hr', 'open-purchasing', 'open-aroma-context', 'open-accounting', 'open-marketing', 'open-gmail-context', 'open-calendar-context']) assert.equal(await page.locator('#' + id).count(), 1)
      await page.locator('#open-hr').focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('[data-sidebar-group="daily"]').getAttribute('open'), null)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (process.env.DEPARTMENT_SCREEN_DIR) await page.screenshot({ path: path.join(process.env.DEPARTMENT_SCREEN_DIR, 'hr-' + lang + '-' + width + '.png') })
      await context.close()
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  } finally { await browser.close() }
})
