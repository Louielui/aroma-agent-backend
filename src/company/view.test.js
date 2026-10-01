'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { buildHtml } = require('./view')

class Element {
  constructor (tag, connected = false) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.connected = connected; this.parentNode = null; this.value = ''; this.text = '' }
  appendChild (child) { child.parentNode?.removeChild(child); this.children.push(child); child.parentNode = this; return child }
  removeChild (child) { this.children = this.children.filter(value => value !== child); child.parentNode = null }
  replaceChildren (...children) { for (const child of [...this.children]) this.removeChild(child); this.text = ''; for (const child of children) this.appendChild(child) }
  addEventListener (type, action) { this.listeners[type] = action }
  remove () { this.parentNode?.removeChild(this) }
  get isConnected () { return this.connected || !!this.parentNode?.isConnected }
  get textContent () { return this.text + this.children.map(child => child.textContent).join(' ') }
  set textContent (value) { this.replaceChildren(); this.text = String(value) }
  querySelector (tag) { return this.walk().find(child => tag === '[data-memory-detail]' ? child.dataset.memoryDetail : child.tag === tag) || null }
  walk () { return this.children.flatMap(child => [child, ...child.walk()]) }
}
const ownerData = connected => ({ enabled: true, users: [], sources: [], audit: [], mailbox: { state: connected ? 'connected' : 'not_connected' }, memory: 'source_bound' })
const automationData = { events: null, cloud: { configured: false }, scheduler: { state: 'unavailable' }, history: { state: 'not_started' } }
const memoryData = subject => ({ items: [{ id: 'xx-fixture', subject, text: subject, status: 'candidate', source: { url: null }, details: { messageIds: [], needsReview: false, mailbox: 'adm@example.test' } }],
  sync: { enabled: true, analysis: { ready: 5, pending: 7, failed: 1 }, hindsight: { configured: true, total: 200, saved: 30, rawOnly: 10, sourceOnly: 5, pending: 153, failed: 2, partialIndex: 0,
    rebuild: { state: 'running', total: 200, queued: 50, remaining: 150 } } } })
const flush = () => new Promise(resolve => setImmediate(resolve))
function browser (locale = 'zh', hash = '', deferAutomation = false) {
  const before = process.env.XIANGXIANG_LOCALE; process.env.XIANGXIANG_LOCALE = locale
  let html
  try { html = buildHtml({ owner: true }) } finally { if (before === undefined) delete process.env.XIANGXIANG_LOCALE; else process.env.XIANGXIANG_LOCALE = before }
  const root = new Element('main', true); const nodes = {}
  for (const id of ['nav', 'title', 'intro', 'limit', 'local', 'status', 'actions', 'people', 'sources', 'files', 'audit']) { nodes[id] = new Element('section'); nodes[id].id = id; root.appendChild(nodes[id]) }
  nodes.audit.appendChild(new Element('summary')); nodes.audit.appendChild(new Element('pre'))
  const requests = []; let connected = true
  const response = (body, ok = true) => ({ ok, json: async () => body })
  const fetch = (url, options = {}) => {
    if (url === '/api/v1/company-access' && !options.method) return Promise.resolve(response(ownerData(connected)))
    if (url === '/api/v1/company-access/mail-automation' && !deferAutomation) return Promise.resolve(response(automationData))
    let resolve; const result = new Promise(done => { resolve = done }); requests.push({ url, options, resolve: (body, ok = true) => resolve(response(body, ok)) }); return result
  }
  const location = { hash, search: '', assign: () => {} }
  const context = vm.createContext({ document: { documentElement: {}, createElement: tag => new Element(tag), getElementById: id => nodes[id] },
    fetch, location, window: { location }, history: { replaceState: (_, __, url) => { location.hash = url.includes('#') ? '#' + url.split('#')[1] : '' } }, URLSearchParams, encodeURIComponent })
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context)
  return { nodes, requests, run: source => vm.runInContext(source, context), disconnect: () => { connected = false } }
}

test('overlapping automatic and clicked mail-memory loads render only the newest response once', async () => {
  const b = browser('zh', '#mail-memory'); await flush()
  const automatic = b.requests.find(request => request.url.includes('/mail-memory?'))
  const clicked = b.run('memoryView("latest")'); const latest = b.requests.at(-1)
  latest.resolve(memoryData('LATEST SOURCE')); await clicked
  automatic.resolve(memoryData('STALE PRIVATE SOURCE')); await flush()
  assert.doesNotMatch(b.nodes.files.textContent, /STALE PRIVATE SOURCE/)
  assert.equal(b.nodes.files.walk().filter(node => node.tag === 'h3' && node.textContent === 'LATEST SOURCE').length, 1)
  assert.equal(b.nodes.files.walk().filter(node => node.tag === 'h2' && node.textContent === '行政部電郵記憶').length, 1)
})

test('switching the shared content source during automation loading cannot append stale mail cards to Drive', async () => {
  const b = browser('zh', '', true); await flush()
  const mail = b.run('memoryView("old")'); b.requests.at(-1).resolve(memoryData('STALE PRIVATE SOURCE')); await flush()
  const oldAutomation = b.requests.at(-1)
  const drive = b.run('files({id:"admin-drive",name:"CURRENT DRIVE",rootId:"folder"},"folder")')
  b.requests.at(-1).resolve({ files: [], truncated: false }); await drive
  oldAutomation.resolve(automationData); await mail
  assert.match(b.nodes.files.textContent, /CURRENT DRIVE/); assert.doesNotMatch(b.nodes.files.textContent, /STALE PRIVATE SOURCE/)
})

test('starting mailbox disconnect invalidates pending private responses before the mutation completes', async () => {
  const b = browser(); await flush()
  const mail = b.run('memoryView("old")'); const old = b.requests.at(-1)
  const change = b.run('change({op:"mail_disconnect"})'); const mutation = b.requests.at(-1)
  old.resolve(memoryData('STALE PRIVATE SOURCE')); await mail
  assert.doesNotMatch(b.nodes.files.textContent, /STALE PRIVATE SOURCE/)
  b.disconnect(); mutation.resolve({ state: 'not_connected' }); await change
  assert.equal(b.nodes.files.textContent, '')
})

test('mail semantic originals and rebuild queue use distinct bilingual labels from thread analysis', async () => {
  for (const [locale, pending, failed, remaining] of [['zh', '尚待建立索引的原信 153', '原信索引失敗 2', '尚待排隊的原信 150'],
    ['en', 'Originals awaiting indexing 153', 'Original indexing failures 2', 'Originals awaiting rebuild queue 150']]) {
    const b = browser(locale); await flush()
    const view = b.run('memoryView()'); b.requests.at(-1).resolve(memoryData('SOURCE')); await view
    assert.ok(b.nodes.files.textContent.includes(pending), locale)
    assert.ok(b.nodes.files.textContent.includes(failed), locale)
    assert.ok(b.nodes.files.textContent.includes(remaining), locale)
  }
})
