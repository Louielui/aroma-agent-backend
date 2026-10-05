'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), { randomUUID } = require('node:crypto')
const { CATALOGUE } = require('../i18n/catalogue')
// Execute the complete assembled page, including script boundaries. This is a DOM
// behaviour fixture, not browser layout evidence; no network or model call is made.
function page () {
  if (process.env.XIANGXIANG_BOOT_TEST_HTML) return fs.readFileSync(process.env.XIANGXIANG_BOOT_TEST_HTML, 'utf8')
  const before = process.env.CHAT_BACKEND
  try { process.env.CHAT_BACKEND = 'codex-subscription'; return require('./demoHtml').buildDemoHtml() }
  finally { if (before === undefined) delete process.env.CHAT_BACKEND; else process.env.CHAT_BACKEND = before }
}
function dom (html) {
  const ids = new Map()
  function make (tag) {
    const n = { tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: {}, events: {}, style: {}, value: '', className: '', textContent: '', scrollHeight: 40, scrollTop: 0, disabled: false,
      get childNodes () { return this.children }, get firstChild () { return this.children[0] || null },
      appendChild (c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; return c },
      insertBefore (c, before) { if (!before) return this.appendChild(c); if (c.parentNode) c.parentNode.removeChild(c); const index = this.children.indexOf(before); assert.ok(index >= 0); this.children.splice(index, 0, c); c.parentNode = this; return c },
      removeChild (c) { const index = this.children.indexOf(c); assert.ok(index >= 0); this.children.splice(index, 1); c.parentNode = null; return c },
      setAttribute (k, v) { this.attrs[k] = String(v) }, getAttribute (k) { return this.attrs[k] ?? null },
      addEventListener (k, f) { this.events[k] = f }, focus () {},
      querySelector (selector) { return this.children.find(c => selector[0] === '.' && c.className.split(/\s+/).includes(selector.slice(1))) || null },
      contains (c) { return c === this || this.children.some(child => child.contains(c)) }
    }
    n.classList = { add (v) { if (!this.contains(v)) n.className = (n.className + ' ' + v).trim() }, remove (v) { n.className = n.className.split(/\s+/).filter(c => c !== v).join(' ') }, contains (v) { return n.className.split(/\s+/).includes(v) }, toggle (v, force) { if (force === undefined ? this.contains(v) : !force) this.remove(v); else this.add(v) } }
    return n
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = make(match[1]); node.id = match[3]; node.className = match[2].match(/class="([^"]*)"/)?.[1] || ''; node.value = match[2].match(/value="([^"]*)"/)?.[1] || ''; node.selected = /\bselected\b/.test(match[2]); ids.set(node.id, node)
  }
  const select = ids.get('chat-level')
  for (const id of ['chat-level-low', 'chat-level-medium', 'chat-level-high', 'chat-level-xhigh', 'chat-level-max']) { const option = ids.get(id); select.appendChild(option); if (option.selected) select.value = option.value }
  const body = make('body')
  body.appendChild(ids.get('app')); ids.get('app').appendChild(ids.get('sidebar')); ids.get('app').appendChild(ids.get('main'))
  ids.get('main').appendChild(ids.get('topbar')); ids.get('topbar').appendChild(ids.get('expand')); ids.get('topbar').appendChild(ids.get('conv-title'))
  const sideTop = make('div'); sideTop.className = 'side-top'; ids.get('sidebar').appendChild(sideTop); sideTop.appendChild(ids.get('brand-name')); sideTop.appendChild(ids.get('collapse'))
  ids.get('sidebar').appendChild(ids.get('workspace-nav'))
  return { ids, document: { title: '', body, getElementById: id => ids.get(id) || null, createElement: make, createTextNode: text => Object.assign(make('#text'), { textContent: text }), addEventListener () {} } }
}
async function boot (locale, unavailable = false) {
  const html = page(), f = dom(html), requests = [], errors = []
  const models = [{ model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', available: true }]
  const fetch = async (url, options) => {
    requests.push({ url, options }); assert.ok(!options?.method || options.method === 'GET', 'boot must never write')
    if (unavailable) throw Error('fixture unavailable')
    const body = url === '/api/v1/demo/models' ? { billing: 'chatgpt-subscription', models } : url === '/api/v1/demo/greeting' ? { line: 'Fixture greeting' } : url === '/api/v1/home/settings' ? { entries: [] } : url === '/api/v1/conversations' ? { ok: true, conversations: [] } : {}
    return { ok: true, status: 200, json: async () => body }
  }
  const ctx = vm.createContext({ document: f.document, window: { crypto: { randomUUID }, location: { href: '', search: '' } }, fetch, console: { log () {}, error: error => errors.push(error) }, URL, URLSearchParams, AbortController, setTimeout: () => 0, clearTimeout () {}, setInterval: () => 0, clearInterval () {} })
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  assert.equal(scripts.length, 1)
  vm.runInContext(scripts[0][1].replace(/var INITIAL_LOCALE = "(?:zh|en)";/, 'var INITIAL_LOCALE = ' + JSON.stringify(locale) + ';'), ctx, { timeout: 2000, filename: 'served-demo.js' })
  for (let i = 0; i < 25; i++) await Promise.resolve()
  assert.deepEqual(errors, [])
  return { ...f, requests }
}
for (const locale of ['zh', 'en']) for (const unavailable of [false, true]) test('complete page boots visible labels and model controls in ' + locale + (unavailable ? ' despite failed reads' : ''), async () => {
  const f = await boot(locale, unavailable), ids = f.ids
  for (const [id, key] of [['brand-name', 'shell.title'], ['home-label', 'nav.home'], ['new-chat-label', 'shell.newConversation'], ['memory-label', 'memory.title']]) assert.equal(ids.get(id).textContent, CATALOGUE[key][locale])
  assert.equal(ids.get('msg').attrs.placeholder, CATALOGUE['shell.composerPlaceholder'][locale]); assert.equal(ids.get('send').disabled, true)
  assert.equal(ids.get('chat-level').classList.contains('hidden'), false); assert.equal(ids.get('chat-level').value, 'medium')
  for (const [id, key] of [['chat-level-low', 'chat.low'], ['chat-level-medium', 'chat.medium'], ['chat-level-high', 'chat.high'], ['chat-level-xhigh', 'chat.xhigh'], ['chat-level-max', 'chat.max']]) assert.equal(ids.get(id).textContent, CATALOGUE[key][locale])
  assert.match(ids.get('picker-label').textContent, /GPT-6\.1 Sol/); assert.equal(ids.get('workspace-nav').children.length, 3)
  assert.equal(ids.get('sidebar').contains(ids.get('workspace-nav')), false)
  assert.equal(ids.get('topbar').contains(ids.get('workspace-nav')), true)
  ids.get('msg').value = 'Fixture text'; ids.get('msg').events.input(); assert.equal(ids.get('send').disabled, false)
  assert.ok(f.requests.some(r => r.url === '/api/v1/conversations')); assert.ok(f.requests.some(r => r.url === '/api/v1/demo/models'))
})
