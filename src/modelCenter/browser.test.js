'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createModelCenter } = require('./service'), { createTopicStore } = require('../topics/workspaces')
const { assemblePage } = require('../demo/pageTemplate'), { modelCatalogue } = require('../workers/execution/chatBrowser.cjs')
function html (lang) {
  const read = name => fs.readFileSync(path.join(__dirname, '../demo/assets', name), 'utf8')
  return assemblePage({ template: read('index.html'), css: read('app.css'), sidebarCss: read('sidebar.css'), app: read('app.js'), sidebar: read('sidebar.js'), topics: read('topics.js'), i18n: require('../i18n/browserResolver').browserI18nSource().replace(/var INITIAL_LOCALE = "(?:zh|en)";/, 'var INITIAL_LOCALE = "' + lang + '";'), dot: read('dot.svg'), favicon: '', sourceLabels: [], subscription: true, modelCenter: true, buildStamp: 'model-center-fixture' })
}
test('actual central settings and independent bilingual topic controls persist, follow changes and send the selected model', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-browser-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const topics = createTopicStore({ dataDir: dir }), catalog = modelCatalogue(), center = createModelCenter({ dataDir: dir, catalogue: async () => catalog, topicForConversation: topics.topicForConversation })
  catalog.models.unshift({ model: 'claude-opus-5-5', name: 'Claude Opus 5.5', available: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', supportsEffort: true })
  const browser = await require('playwright-core').chromium.launch({ channel: 'msedge', headless: true }), errors = [], unexpected = [], sent = []
  async function context (lang, width) {
    const c = await browser.newContext({ viewport: { width, height: 1000 } })
    await c.route('**/*', async route => {
      const r = route.request(), url = new URL(r.url()), p = url.pathname, method = r.method(), body = r.postDataJSON(), headers = r.headers()
      if (url.hostname !== '127.0.0.1') { unexpected.push(p); return route.abort() }
      const response = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
      if (p === '/demo') return route.fulfill({ contentType: 'text/html', body: html(lang) })
      if (p === '/model-center') return route.fulfill({ contentType: 'text/html', body: require('./view').page() })
      if (p === '/api/v1/model-center') return response({ ...center.read(), models: catalog.models, roles: require('./routes').inventory(lang) })
      if (p === '/api/v1/model-center/brain') return response(await center.saveBrain(body))
      if (p.startsWith('/api/v1/model-center/selection/')) { const [, , , , , kind, id] = p.split('/'); return response({ selection: await center.saveSelection(kind, id, body) }) }
      if (p === '/api/v1/demo/models') { const topic = headers['x-xiangxiang-topic'], id = headers['x-xiangxiang-conversation']; return response({ ...catalog, central: center.read().brain, selection: topic ? center.selection('topic', topic) : id ? center.selection('conversation', id) : null }) }
      if (p.startsWith('/api/v1/topic-workspaces/')) { const id = p.split('/')[4]; return response(method === 'POST' ? { workspace: topics.link(id, body.id) } : { ok: true, workspace: topics.get(id), conversations: [] }) }
      if (p === '/api/v1/demo/intake') { sent.push(body); return response({ lane: 'chat', reply: 'Fixture answer', servedBy: body.chatModel }) }
      const fixtures = { '/api/v1/demo/greeting': { line: 'Fixture' }, '/api/v1/demo/version': { build: 'model-center-fixture' }, '/api/v1/conversations': { ok: true, conversations: [] }, '/api/v1/home/settings': { entries: [] }, '/manifest.webmanifest': {} }
      if (method === 'GET' && Object.hasOwn(fixtures, p)) return response(fixtures[p])
      unexpected.push(p); return route.abort()
    })
    const page = await c.newPage(); page.on('pageerror', e => errors.push(e.message)); return { c, page }
  }
  try {
    for (const [lang, width] of [['zh', 1280], ['en', 390]]) {
      const central = await context(lang, width), email = await context(lang, width), dev = await context(lang, width)
      await central.page.goto('http://127.0.0.1:19091/model-center?lang=' + lang)
      await central.page.locator('#save').waitFor({ state: 'visible' }); await central.page.waitForFunction(() => !document.getElementById('save').disabled)
      await central.page.locator('#company').selectOption('claude'); await central.page.locator('#model').selectOption('claude-opus-5-5'); await central.page.locator('#save').click()
      await central.page.waitForFunction(() => document.getElementById('effective').textContent.includes('Opus 5.5'))
      await email.page.goto('http://127.0.0.1:19091/demo?topic=email'); await dev.page.goto('http://127.0.0.1:19091/demo?topic=development')
      for (const p of [email.page, dev.page]) {
        try { await p.waitForFunction(() => document.getElementById('picker-label').textContent === 'Claude Opus 5.5', null, { timeout: 10000 }) }
        catch (e) { console.log({ errors, unexpected, brain: center.read().brain, ui: await p.evaluate(() => ({ label: document.getElementById('picker-label').textContent, status: document.getElementById('brain-status').textContent })) }); throw e }
      }
      await email.page.locator('#picker').click(); await email.page.locator('#picker-menu button.opt').filter({ hasText: 'Claude Sonnet 5.5' }).click()
      await email.page.waitForFunction(() => document.getElementById('brain-mode').value === 'custom' && !document.getElementById('brain-mode').disabled)
      await email.page.locator('#chat-level').selectOption('low'); await email.page.waitForFunction(() => !document.getElementById('brain-mode').disabled)
      assert.equal(center.selection('topic', 'email').effective.effort, 'low'); assert.equal(await dev.page.locator('#picker-label').textContent(), 'Claude Opus 5.5')
      await central.page.locator('#company').selectOption('openai'); await central.page.locator('#model').selectOption('gpt-6.1-sol'); await central.page.locator('#effort').selectOption('high'); await central.page.locator('#save').click()
      await central.page.waitForFunction(() => document.getElementById('effective').textContent.includes('GPT-6.1 Sol'))
      for (const p of [email.page, dev.page]) { await p.locator('#msg').fill('Fixture message'); const reply = p.waitForResponse(r => r.url().endsWith('/api/v1/demo/intake')); await p.locator('#send').click(); await reply; await p.waitForFunction(() => !document.getElementById('msg').disabled) }
      assert.equal(sent.at(-2).chatModel, 'claude-sonnet'); assert.equal(sent.at(-2).chatLevel, 'low'); assert.equal(sent.at(-1).chatModel, 'gpt-6.1-sol'); assert.equal(sent.at(-1).chatLevel, 'high')
      await email.page.reload(); await email.page.waitForFunction(() => document.getElementById('picker-label').textContent === 'Claude Sonnet 5.5' && document.getElementById('chat-level').value === 'low')
      await email.page.locator('#brain-mode').selectOption('central'); await email.page.waitForFunction(() => document.getElementById('picker-label').textContent === 'GPT-6.1 Sol')
      for (const p of [central.page, email.page, dev.page]) assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (width < 600) for (const id of ['brain-mode', 'brain-company', 'picker-wrap', 'chat-level']) assert.ok((await email.page.locator('#' + id).boundingBox()).width > 90, id + ' remains readable on mobile')
      if (process.env.BRAIN_SCREEN_DIR) { await central.page.screenshot({ path: path.join(process.env.BRAIN_SCREEN_DIR, 'model-center-' + lang + '-' + width + '.png'), fullPage: true }); await email.page.screenshot({ path: path.join(process.env.BRAIN_SCREEN_DIR, 'topic-model-' + lang + '-' + width + '.png') }) }
      for (const v of [central, email, dev]) await v.c.close()
      await center.saveSelection('topic', 'email', { revision: center.selection('topic', 'email').revision, mode: 'central' })
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  } finally { await browser.close() }
})
