'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { page: html, modelCatalogue, verifyModelControls } = require('./chatBrowser.cjs')

test('actual assembled bilingual mobile/desktop model controls follow the catalogue without model calls', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const { chromium } = require('playwright-core'), browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    for (const locale of ['zh', 'en']) for (const width of [1280, 390]) for (const failedReads of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }), tab = await context.newPage(), errors = [], unexpected = []
      tab.on('pageerror', e => errors.push(e.message))
      await tab.route('**/*', async route => {
        const url = new URL(route.request().url()), p = url.pathname
        if (url.hostname !== 'xiangxiang.invalid' || route.request().method() !== 'GET') { unexpected.push(p); return route.abort() }
        if (p === '/demo') return route.fulfill({ contentType: 'text/html', body: html(locale) })
        const fixtures = { '/api/v1/demo/models': modelCatalogue(), '/api/v1/conversations': { ok: true, conversations: [] }, '/api/v1/home/settings': { entries: [] }, '/api/v1/demo/greeting': { line: 'Fixture' }, '/api/v1/demo/version': { build: 'offline-browser-fixture' }, '/manifest.webmanifest': {} }
        if (!Object.hasOwn(fixtures, p)) { unexpected.push(p); return route.abort() }
        return route.fulfill({ status: failedReads ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fixtures[p]) })
      })
      await tab.goto('http://xiangxiang.invalid/demo')
      const initial = await verifyModelControls(expression => tab.evaluate(expression), failedReads)
      assert.equal(initial.company, 'claude')
      assert.equal(initial.depth, failedReads ? 'auto' : 'medium')
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
      await context.close()
    }
  } finally { await browser.close() }
})
