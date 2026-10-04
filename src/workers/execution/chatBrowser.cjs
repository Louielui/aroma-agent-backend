'use strict'
// This module runs only in the disposable offline guest, never against an Owner browser.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), { createHash, randomUUID } = require('node:crypto')
const { assemblePage } = require('../../demo/pageTemplate')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms)), hash = bytes => createHash('sha256').update(bytes).digest('hex')
function page (locale) {
  const before = process.env.XIANGXIANG_LOCALE; process.env.XIANGXIANG_LOCALE = locale
  try {
    const read = n => fs.readFileSync(path.join(__dirname, '../../demo/assets', n), 'utf8'), dot = read('dot.svg').replace(/ xmlns="[^"]*"/g, '').trim()
    return assemblePage({ template: read('index.html'), css: read('app.css'), sidebarCss: read('sidebar.css'), app: read('app.js'), sidebar: read('sidebar.js'),
      i18n: require('../../i18n/browserResolver').browserI18nSource(), dot, favicon: 'data:image/svg+xml,' + encodeURIComponent(read('dot.svg')),
      sourceLabels: ['Drive', 'Gmail', 'Calendar', 'GitHub'], subscription: true, buildStamp: 'offline-browser-fixture' })
  } finally { if (before === undefined) delete process.env.XIANGXIANG_LOCALE; else process.env.XIANGXIANG_LOCALE = before }
}
async function connect (url) {
  const ws = new WebSocket(url), pending = new Map(), listeners = []; let sequence = 0
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', () => reject(Error('browser_unavailable')), { once: true }) })
  ws.addEventListener('message', event => {
    const v = JSON.parse(event.data)
    if (v.id && pending.has(v.id)) { const p = pending.get(v.id); pending.delete(v.id); clearTimeout(p.timer); v.error ? p.reject(Error('browser_command_failed')) : p.resolve(v.result) }
    else if (v.method) for (const fn of listeners) fn(v)
  })
  return { on: fn => listeners.push(fn), call: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('browser_timeout')) }, 10000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  }), close () { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('browser_closed')) }; pending.clear(); ws.close() } }
}
async function run ({ locale, width, failedReads = false }) {
  if (!['zh', 'en'].includes(locale) || ![1280, 390].includes(width) || process.platform !== 'win32' || !/WDAGUtilityAccount/i.test(require('node:os').userInfo().username)) throw Error('offline_guest_required')
  const root = 'C:/XiangScratch', profile = root + '/edge-' + randomUUID(); fs.mkdirSync(profile, { recursive: true })
  const child = cp.spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let spawnError, rpc; child.on('error', () => { spawnError = true })
  const errors = [], blocked = [], routes = [], html = page(locale)
  try {
    let port
    for (let n = 0; n < 100; n++) { if (spawnError) throw Error('browser_unavailable'); try { port = Number(fs.readFileSync(profile + '/DevToolsActivePort', 'utf8').split('\n')[0]); break } catch (_) {} await wait(100) }
    if (!port) throw Error('browser_unavailable')
    const origin = 'http://127.0.0.1:' + port, version = await (await fetch(origin + '/json/version')).json(), targets = await (await fetch(origin + '/json/list')).json()
    const target = targets.find(t => t.type === 'page'); if (!target) throw Error('browser_unavailable')
    rpc = await connect(target.webSocketDebuggerUrl)
    const models = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol'].map(model => ({ model, name: model === 'gpt-6.1-sol' ? 'GPT-6.1 Sol' : model, available: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }))
    const fixtures = { '/api/v1/demo/models': { billing: 'chatgpt-subscription', defaultModel: 'gpt-6.1-sol', models }, '/api/v1/demo/greeting': { line: 'Browser fixture' }, '/api/v1/demo/version': { build: 'offline-browser-fixture' }, '/api/v1/conversations': { ok: true, conversations: [] }, '/api/v1/home/settings': { entries: [] }, '/manifest.webmanifest': {} }
    const planId = '00000000-0000-4000-8000-000000000001', planRoute = '/api/v1/task-plan/' + planId
    fixtures['/api/v1/demo/intake'] = { reply: 'Offline chat plan fixture', taskPlanRunId: planId, historySaved: false, lane: 'task_plan' }
    fixtures[planRoute] = { run: { id: planId, state: 'completed', evidence: { profile: 'chat', revision: 'a'.repeat(40), files: [] }, result: { goal: 'Chat page improvement', steps: ['Confirm the scope'], acceptanceChecks: ['Preserve model controls'], questions: [], risks: [], citations: [] } } }
    rpc.on(v => {
      if (v.method === 'Runtime.exceptionThrown') errors.push('javascript_exception')
      if (v.method !== 'Fetch.requestPaused') return
      const request = v.params.request, url = new URL(request.url), main = url.hostname === 'xiangxiang.invalid' && url.pathname === '/demo', known = url.hostname === 'xiangxiang.invalid' && Object.hasOwn(fixtures, url.pathname) && request.method === (url.pathname === '/api/v1/demo/intake' ? 'POST' : 'GET')
      if (!main && !known) { blocked.push(url.protocol + '//' + url.hostname + url.pathname); rpc.call('Fetch.failRequest', { requestId: v.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return }
      routes.push(url.pathname)
      rpc.call('Fetch.fulfillRequest', { requestId: v.params.requestId, responseCode: !main && failedReads && ![planRoute, '/api/v1/demo/intake'].includes(url.pathname) ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: main ? 'text/html; charset=utf-8' : 'application/json' }], body: Buffer.from(main ? html : JSON.stringify(fixtures[url.pathname])).toString('base64') }).catch(() => errors.push('fixture_response_failed'))
    })
    await rpc.call('Runtime.enable'); await rpc.call('Page.enable'); await rpc.call('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await rpc.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
    await rpc.call('Page.navigate', { url: 'http://xiangxiang.invalid/demo' })
    const evaluate = async expression => { const r = await rpc.call('Runtime.evaluate', { expression, returnByValue: true }); if (r.exceptionDetails) throw Error('browser_page_failed'); return r.result.value }
    for (let n = 0; n < 80; n++) { if (errors.length) throw Error('browser_page_startup_failed'); if (await evaluate("!!document.getElementById('brand-name')?.textContent")) break; await wait(100) }
    const initial = await evaluate("({brand:document.getElementById('brand-name').textContent, model:document.getElementById('picker-label').textContent, depth:document.getElementById('chat-level').value, options:Array.from(document.getElementById('chat-level').options,o=>({value:o.value,text:o.textContent})), placeholder:document.getElementById('msg').placeholder, disabled:document.getElementById('send').disabled})")
    if (!initial.brand || !initial.placeholder || initial.depth !== 'medium' || !initial.model.includes('GPT-6.1 Sol') || initial.disabled !== true || JSON.stringify(initial.options.map(o => o.value)) !== JSON.stringify(['low','medium','high','xhigh','max']) || initial.options.some(o => !o.text)) throw Error('browser_controls_failed')
    if (width === 390) await evaluate("document.getElementById('collapse').click()")
    const geometry = await evaluate("['msg','chat-level','picker','send'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {id,left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:s.display,visibility:s.visibility}})")
    if (geometry.some(r => r.width <= 0 || r.height <= 0 || r.left < -1 || r.right > width + 1 || r.bottom > 901 || r.display === 'none' || r.visibility === 'hidden')) throw Error('browser_layout_failed')
    await evaluate("document.getElementById('msg').focus()")
    await rpc.call('Input.insertText', { text: 'Offline keyboard check' })
    if (await evaluate("document.getElementById('send').disabled") !== false) throw Error('browser_keyboard_failed')
    await evaluate("document.getElementById('chat-level').focus()")
    await rpc.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 }); await rpc.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    if (await evaluate("document.getElementById('chat-level').value") !== 'max') throw Error('browser_depth_failed')
    await evaluate("document.getElementById('picker').click()")
    if (await evaluate("document.getElementById('picker-menu').classList.contains('hidden')")) throw Error('browser_picker_failed')
    await wait(150); await evaluate("document.getElementById('picker').click();document.getElementById('msg').blur()")
    if (errors.length || blocked.length) throw Error('browser_unexpected_request')
    const png = Buffer.from((await rpc.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64')
    // The send action reaches only the synthetic intercepted response. It cannot
    // contact a model, register a task or mutate any operational source.
    await evaluate("document.getElementById('send').click()")
    for (let n = 0; n < 50; n++) { if (await evaluate("!!document.querySelector('.chat-task-form')")) break; await wait(50) }
    const form = await evaluate("(()=>{const f=document.querySelector('.chat-task-form');if(!f)return null;return {files:Array.from(f.querySelectorAll('fieldset label'),e=>e.textContent),checks:Array.from(f.querySelectorAll('input'),e=>e.checked),disabled:f.querySelector('button').disabled}})()")
    if (!form || form.files.join(',') !== 'src/demo/assets/index.html,src/demo/assets/app.js,src/demo/assets/app.css' || form.checks.length !== 4 || form.checks.some(Boolean) || form.disabled !== true) throw Error('browser_chat_scope_failed')
    const consent = await evaluate("(()=>{const f=document.querySelector('.chat-task-form'),checks=f.querySelectorAll('input');checks[2].click();const disabled=f.querySelector('button').disabled;checks[3].click();return {disabled,enabled:!f.querySelector('button').disabled}})()")
    if (!consent.disabled || !consent.enabled || errors.length || blocked.length) throw Error('browser_confirmation_failed')
    const name = 'browser-' + locale + '-' + width, proof = { engine: 'edge-headless-offline-v1', browserVersion: version.Browser, locale, width, height: 900, failedReads, pageHash: hash(html), screenshotHash: hash(png), screenshotBytes: png.length, checks: { startup: true, labels: true, fiveDepths: true, mediumDefault: true, solDefault: true, layout: true, keyboard: true, picker: true, chatScope: true, explicitConfirmation: true, noPageErrors: true, onlyFixtureRequests: true }, routes }
    fs.writeFileSync(root + '/' + name + '.png', png); fs.writeFileSync(root + '/' + name + '.json', JSON.stringify(proof)); return proof
  } finally { if (rpc) { await rpc.call('Browser.close').catch(() => {}); rpc.close() }; child.kill() }
}
module.exports = { run, page }
