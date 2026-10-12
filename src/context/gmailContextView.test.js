'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const vm = require('node:vm')
let api = {}; try { api = require('./gmailContextView') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
test('Gmail UI uses escaped data, separate mailbox selection and explicit body/pagination limits', () => {
  const html = api.buildGmailContextHtml()
  assert.match(html, /gmail\.owner_mail/); assert.match(html, /gmail\.admin_mail/); assert.match(html, /textContent/); assert.match(html, /replaceChildren/)
  assert.ok(!html.includes('innerHTML')); assert.match(html, /\/api\/v1\/live-context\/gmail/); assert.match(html, /16 KB/)
  assert.match(api.gmailReply({ mailbox: 'owner', pack: { state: 'unavailable' } }), /無法|unavailable/)
})
test('Actual mail UI renders hostile titles and originals as text, preserving partial-body and source dates', () => {
  class Element { constructor () { this.children = []; this.dataset = {}; this.textContent = ''; this.value = 'today'; this.parentElement = this } append (...children) { this.children.push(...children) } replaceChildren (...children) { this.children = children } setAttribute () {} addEventListener () {} }
  const elements = new Map(), document = { getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id) }, createElement: () => new Element() }
  const window = {}; window.parent = window
  const context = vm.createContext({ document, window, Date, Number, fetch: () => { throw Error('unexpected_read') } })
  vm.runInContext(api.buildGmailContextHtml().match(/<script>([\s\S]*)<\/script>/)[1], context)
  context.report = { mailbox: 'admin', pack: { state: 'ok', count: 1, operation: 'get', retrievedAt: '2026-10-01T18:00:00Z', coverage: { scope: 'message abc123', complete: false, truncated: true }, content: [{ sourceId: 'abc123', title: '<script>unsafe()</script>', originalDate: '2026-10-01T15:00:00Z', content: 'Source original text', truncated: true, link: 'https://mail.google.com/mail/?authuser=adm%40example.test#all/abc123', fields: { from: 'supplier@example.test', originalBodyComplete: false } }] } }
  vm.runInContext('render(report)', context)
  const text = e => e.textContent + ' ' + e.children.map(text).join(' '), result = text(elements.get('result'))
  assert.match(result, /<script>unsafe\(\)<\/script>/); assert.match(result, /Source original text/); assert.match(result, /行政部共用信箱/); assert.match(result, /內文不完整/); assert.match(result, /abc123/)
})
