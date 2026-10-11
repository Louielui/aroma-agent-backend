'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { assemblePage } = require('../demo/pageTemplate')
test('bilingual logout recovery preserves draft and exact selected model, enables Send without saving or sending', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const browser = await require('playwright-core').chromium.launch({ channel: 'msedge', headless: true })
  try {
    for (const lang of ['zh', 'en']) {
      let ready = false; const unexpected = [], writes = [], errors = []
      const context = await browser.newContext(), page = await context.newPage()
      page.on('pageerror', e => errors.push(e.message))
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), p = url.pathname
        if (url.hostname !== '127.0.0.1') { unexpected.push(p); return route.abort() }
        const response = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) })
        if (p === '/demo') {
          const read = n => fs.readFileSync(path.join(__dirname, '../demo/assets', n), 'utf8')
          return route.fulfill({ contentType: 'text/html', body: assemblePage({ template: read('index.html'), css: read('app.css'), sidebarCss: read('sidebar.css'), app: read('app.js'), sidebar: read('sidebar.js'), topics: read('topics.js'), i18n: require('../i18n/browserResolver').browserI18nSource().replace(/var INITIAL_LOCALE = "(?:zh|en)";/, 'var INITIAL_LOCALE = "' + lang + '";'), dot: read('dot.svg'), favicon: '', sourceLabels: [], subscription: true, modelCenter: true, buildStamp: 'availability-fixture' }) })
        }
        if (request.method() !== 'GET') { writes.push(p); return route.abort() }
        if (p === '/api/v1/demo/models') return response({ billing: 'subscriptions', providers: { claude: { state: ready ? 'ready' : 'unavailable', code: ready ? null : 'subscription_login_required' } }, models: [{ model: ready ? 'claude-opus-5-5' : 'claude-sonnet', name: 'Claude Opus 5.5', available: ready, supportsEffort: true, efforts: ready ? ['medium'] : [] }, { model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', available: true, efforts: ['medium'] }], selection: { scope: { kind: 'topic', id: 'hr' }, mode: 'central', revision: 0, effective: { model: 'claude-opus-5-5', effort: 'medium' } } })
        if (p.startsWith('/api/v1/topic-workspaces/')) return response({ ok: true, workspace: { id: 'hr', followups: [] }, conversations: [] })
        const fixtures = { '/api/v1/demo/greeting': { line: 'Fixture' }, '/api/v1/demo/version': { build: 'availability-fixture' }, '/api/v1/conversations': { ok: true, conversations: [] }, '/api/v1/home/settings': { entries: [] }, '/manifest.webmanifest': {}, '/api/v1/execution-health': { state: 'unavailable' } }
        if (Object.hasOwn(fixtures, p)) return response(fixtures[p])
        unexpected.push(p); return route.abort()
      })
      await page.goto('http://127.0.0.1:19091/demo?topic=hr')
      await page.waitForFunction(() => document.getElementById('brain-status').textContent.length > 0)
      assert.match(await page.locator('#brain-status').textContent(), lang === 'zh' ? /Claude.*登入/ : /Claude.*sign/i)
      await page.locator('#msg').fill('Preserved HR query'); assert.equal(await page.locator('#send').isDisabled(), true)
      ready = true; await page.locator('#picker').click()
      await page.waitForFunction(() => !document.getElementById('send').disabled)
      assert.equal(await page.locator('#picker-label').textContent(), 'Claude Opus 5.5'); assert.equal(await page.locator('#chat-level').inputValue(), 'medium')
      assert.equal(await page.locator('#msg').inputValue(), 'Preserved HR query'); assert.equal(await page.locator('#brain-status').textContent(), '')
      assert.deepEqual(writes, []); assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
      await context.close()
    }
  } finally { await browser.close() }
})
