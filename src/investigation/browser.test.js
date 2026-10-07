'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { assemblePage } = require('../demo/pageTemplate')
const { modelCatalogue } = require('../workers/execution/chatBrowser.cjs')
const id = 'c6581afe-49f2-4f30-b46e-012340abcdef', cid = 'c6581afe-49f2-4f30-b46e-012340abcdee'
function pageHtml (lang) {
  const read = n => fs.readFileSync(path.join(__dirname, '../demo/assets', n), 'utf8')
  return assemblePage({ template: read('index.html'), css: read('app.css'), sidebarCss: read('sidebar.css'), app: read('app.js'), sidebar: read('sidebar.js'), topics: read('topics.js'), i18n: require('../i18n/browserResolver').browserI18nSource().replace(/var INITIAL_LOCALE = "(?:zh|en)";/, 'var INITIAL_LOCALE = "' + lang + '";'), dot: read('dot.svg'), favicon: '', sourceLabels: [], subscription: true, modelCenter: true, buildStamp: 'investigation-fixture' })
}
test('bilingual desktop and mobile investigation approves once, shows saved citations and reloads without dispatch', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const browser = await require('playwright-core').chromium.launch({ channel: 'msedge', headless: true })
  const report = { state: 'partial', goal: 'Investigate credit', readOnly: true, billingConfirmed: false, sections: [{ section: 'billing', state: 'unconnected', evidenceState: 'not_established', records: [] }] }
  try {
    for (const [lang, width, retryFailed] of [['zh', 1280], ['en', 390], ['zh', 390, true]]) {
      let linked = !!retryFailed, approvals = 0, preparations = 0
      const unexpected = [], errors = [], c = await browser.newContext({ viewport: { width, height: 900 } })
      await c.route('**/*', async route => {
        const r = route.request(), p = new URL(r.url()).pathname, method = r.method()
        const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
        if (p === '/demo') return route.fulfill({ contentType: 'text/html', body: pageHtml(lang) })
        if (p === '/api/v1/demo/models') return json({ ...modelCatalogue(), central: { model: 'claude-sonnet', effort: 'medium' }, selection: { mode: 'central', revision: 0, effective: { model: 'claude-sonnet', effort: 'medium' } } })
        if (p === '/api/v1/conversations') return json({ ok: true, conversations: [{ id: cid, title: 'Investigate credit', updatedAt: new Date().toISOString(), messageCount: 2 }] })
        if (p === '/api/v1/conversations/' + cid) return json({ ok: true, conversation: { id: cid, messages: [{ role: 'user', content: 'Investigate credit' }, { role: 'assistant', content: 'Billing is not established.', investigationRunId: id }] } })
        if (p === '/api/v1/demo/investigations/' + id) return json({ run: { id, state: 'completed', investigation: report, enquiryApprovalId: linked ? 'appr_fixture' : null } })
        if (p === '/api/v1/owner/investigations/' + id + '/work-order') {
          preparations++; assert.equal(method, 'POST'); assert.deepEqual(r.postDataJSON(), {}); linked = true
          return json({ approvalId: 'appr_fixture', workOrderHash: 'hash', nonce: 'nonce', typedConfirmationRequired: 'EXECUTE', card: { heading: 'Read approved source', sections: [], actions: ['Approve', 'Reject'] } })
        }
        if (p === '/api/v1/owner/approve') {
          approvals++; assert.equal(r.postDataJSON().typedConfirmation, 'EXECUTE')
          return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ dispatchStatus: 'read_only_enquiry_accepted' }) })
        }
        if (p === '/api/v1/owner/results/appr_fixture') return json({ finished: true, status: retryFailed && !approvals ? 'failed' : 'done', headline: 'Saved source check', enquiry: { enquiryId: 'enq_fixture', saved: true, outcome: retryFailed && !approvals ? 'FAILED' : 'CONCLUDED' }, sections: [], lines: [] })
        if (p === '/api/v1/demo/enquiries/enq_fixture') return json({ enquiry: { outcome: 'CONCLUDED', payload: { answer: 'Source check answer.', citations: [{ path: 'settings.txt', startLine: 1, endLine: 1, quote: 'enabled = false' }] }, notEstablished: ['Billing records are not connected.'] } })
        const fixture = { '/api/v1/demo/greeting': { line: 'Fixture' }, '/api/v1/demo/version': { build: 'investigation-fixture' }, '/api/v1/home/settings': { entries: [] }, '/api/v1/home/briefing': { sections: [] }, '/manifest.webmanifest': {} }
        if (method === 'GET' && Object.hasOwn(fixture, p)) return json(fixture[p])
        unexpected.push(p); return route.abort()
      })
      const page = await c.newPage(); page.on('pageerror', e => errors.push(e.message))
      const open = async () => {
        await page.goto('http://127.0.0.1:19091/demo')
        await page.locator('#convs .conv').first().waitFor({ state: 'attached' })
        if (!await page.locator('#convs .conv').first().isVisible()) await page.locator('#expand').click()
        await page.locator('#convs .conv').first().click()
        if (width < 600 && await page.locator('#collapse').isVisible()) await page.locator('#collapse').click()
        await page.locator('.investigation-evidence').waitFor()
      }
      const offer = () => page.getByRole('button', { name: lang === 'zh' ? '核對程式來源與調查範圍' : 'Check source code and investigation coverage', exact: true })
      await open(); assert.equal(await page.locator('.investigation-evidence').getAttribute('open'), null)
      assert.match(await page.locator('a[href*="investigation="]').getAttribute('href'), new RegExp(id))
      await offer().click()
      if (retryFailed) {
        await page.getByRole('button', { name: '重新準備查核（需要批准）', exact: true }).waitFor()
        assert.equal(preparations, 0); assert.equal(approvals, 0)
        await page.getByRole('button', { name: '重新準備查核（需要批准）', exact: true }).click()
      }
      await page.locator('.order').waitFor(); assert.equal(approvals, 0)
      assert.equal(await page.locator('.order .primary').isDisabled(), true)
      await page.locator('.order .typed').fill('EXECUTE'); await page.locator('.order .primary').click()
      await page.locator('.investigation-result').last().waitFor(); assert.equal(approvals, 1)
      await page.locator('.investigation-result summary').last().click()
      assert.equal(await page.locator('.investigation-result blockquote').last().textContent(), 'enabled = false')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await open(); await offer().click(); await page.locator('.investigation-result').waitFor()
      assert.equal(approvals, 1); assert.equal(preparations, 1)
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
      await c.close()
    }
  } finally { await browser.close() }
})
