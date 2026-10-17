'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { fork } = require('node:child_process'), { randomUUID, createHash } = require('node:crypto')
const codeRoot = path.resolve(__dirname, '../..'), probe = path.join(codeRoot, 'scripts/r1/independentProbe.cjs')
function rootFixture(parent = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-r1-'))) {
  const root = fs.mkdtempSync(path.join(parent, 'instance-'))
  for (const d of ['data', 'artifacts', 'config', 'profile', 'profile/roaming', 'profile/local', 'temp', 'logs', 'lab']) fs.mkdirSync(path.join(root, d), { recursive: true })
  fs.writeFileSync(path.join(root, 'config/model-selection.json'), JSON.stringify({ version: 1, mode: 'synthetic_fixture', brain: { model: 'gpt-6-astra', effort: 'high' } }))
  fs.writeFileSync(path.join(root, 'config/synthetic-source.json'), JSON.stringify({ mode: 'synthetic_fixture', sourceId: 'synthetic_tea', content: 'Steep synthetic tea for four minutes.' }))
  fs.writeFileSync(path.join(root, 'data/company-access.json'), JSON.stringify({ version: 1, revision: 0, users: [{ id: 'owner', role: 'owner', email: 'owner@fixture.invalid', grants: ['company-drive'], verified: true, suspended: false }], sources: [{ id: 'company-drive', name: 'Synthetic files', kind: 'drive', state: 'registered', rootId: 'synthetic_root', driveId: 'synthetic_root' }], audit: [] }))
  return root
}
async function child(root, overrides = {}, environment = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['path', 'systemroot', 'windir', 'comspec', 'pathext'].includes(k.toLowerCase())))
  Object.assign(env, { HOME: path.join(root, 'profile'), USERPROFILE: path.join(root, 'profile'), APPDATA: path.join(root, 'profile/roaming'), LOCALAPPDATA: path.join(root, 'profile/local'), TEMP: path.join(root, 'temp'), TMP: path.join(root, 'temp') })
  Object.assign(env, environment)
  const p = fork(probe, [], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const errors = [], pending = new Map(); let sequence = 0
  p.stderr.on('data', b => errors.push(b.toString())); p.stdout.on('data', () => {})
  p.on('message', m => { const v = pending.get(m.id); if (v) { pending.delete(m.id); clearTimeout(v.timer); m.error ? v.reject(Error(m.error)) : v.resolve(m) } })
  p.on('exit', code => { for (const v of pending.values()) { clearTimeout(v.timer); v.reject(Error('probe_exit_' + code + ':' + errors.join(''))) } pending.clear() })
  const rpc = message => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('probe_deadline')) }, 15000); pending.set(id, { resolve, reject, timer }); p.send({ ...message, id }) })
  const options = { root, password: 'synthetic-private-password', cookieName: 'aroma_independent_' + randomUUID().replaceAll('-', ''), ...overrides }
  let ready
  try { ready = await rpc({ op: 'start', options }) } catch (e) { if (p.connected) p.disconnect(); throw e }
  options.cookieName = ready.cookieName
  const origin = ready.origin
  async function request(route, { cookie, body, method = body ? 'POST' : 'GET', headers = {} } = {}) {
    const r = await fetch(origin + route, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
    const text = await r.text(); let data; try { data = JSON.parse(text) } catch (_) { data = text }
    return { status: r.status, body: data, cookie: r.headers.get('set-cookie') }
  }
  const login = async () => { const r = await request('/owner/login', { body: 'password=' + encodeURIComponent(options.password), headers: { 'content-type': 'application/x-www-form-urlencoded' } }); assert.equal(r.status, 302); return r.cookie.split(';')[0] }
  return { root, origin, options, pid: ready.pid, request, login, snapshot: () => rpc({ op: 'snapshot', root }), control: () => rpc({ op: 'observerControl' }),
    close: async () => { if (!p.connected) return; await rpc({ op: 'close' }); await new Promise(resolve => p.exitCode !== null ? resolve() : p.once('exit', resolve)) } }
}
const goal = () => ({ version: 1, operation: 'start', clientSubmissionId: randomUUID(), conversationId: randomUUID(), message: 'Find the synthetic tea record and summarize its instruction.', taskRef: null, expectedRevision: null, contextRefs: [] })
const route = '/api/v1/demo/task-intake'
test('independent actual HTTP investigation persists grounded synthetic answer and same Task/Goal, without full app imports', async () => {
  const f = await child(rootFixture())
  try {
    const cookie = await f.login(), body = goal(), result = await f.request(route, { cookie, body })
    const initial = await f.snapshot()
    if (process.env.INDEPENDENT_R1_EVIDENCE) fs.writeFileSync(path.join(process.env.INDEPENDENT_R1_EVIDENCE, 'composed-observation-' + body.clientSubmissionId + '.json'), JSON.stringify({ body, result, observation: initial }, null, 2), { flag: 'wx' })
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.match(result.body.reply, /four minutes/)
    assert.match(result.body.reply, /合成|synthetic/i); assert.equal(result.body.unifiedTask.investigation.goalVerifiedComplete, false)
    const s = await f.snapshot()
    assert.deepEqual(s.calls.map(c => c.operation), ['search', 'get'])
    assert.equal(s.calls[1].input.fileId, 'synthetic_tea'); assert(s.modelCalls.length > 0); assert(s.modelCalls.every(c => c.execution === 'simulated_model'))
    assert.equal(s.tasks[0].id, result.body.unifiedTask.taskId); assert.equal(s.tasks[0].ownerGoal.goalId, result.body.unifiedTask.goalId)
    assert(s.files.some(f => f.file.startsWith('data/context-activity/'))); assert(s.files.some(f => f.file.startsWith('data/conversations/')))
    assert(s.files.some(f => f.file.startsWith('data/browser-context-reads/')))
    assert(!s.imports.some(p => /[/\\](?:app\.js|modelCenter[/\\]|nativeHost\.cjs|startBridge\.js|serviceSupervisor\.cjs|startHindsight\.cjs)$/.test(p)))
    assert.equal(s.observed.PROCESSWRAP || 0, 0); assert.equal(s.observed.TCPCONNECTWRAP || 0, 0)
    await f.request(route, { cookie, body }); assert.equal((await f.snapshot()).calls.length, 2)
    const control = await f.control(); assert(control.observed.TCPCONNECTWRAP > 0); assert(control.observed.FSREQCALLBACK > 0); assert(control.observed.PROCESSWRAP > 0)
    if (process.env.INDEPENDENT_R1_EVIDENCE) fs.writeFileSync(path.join(process.env.INDEPENDENT_R1_EVIDENCE, 'working-demo-' + body.clientSubmissionId + '.json'), JSON.stringify({ body, result, observation: s, observerControl: control, scope: 'synthetic composed HTTP, not OS containment or live-model acceptance' }, null, 2), { flag: 'wx' })
  } finally { await f.close() }
})
test('same-host private cookies coexist; foreign sessions, bearer and CSRF attempts reject without reads', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-r1-pair-')), a = await child(rootFixture(parent)), b = await child(rootFixture(parent))
  try {
    const ca = await a.login(), cb = await b.login(), both = ca + '; ' + cb
    assert.notEqual(ca.split('=')[0], cb.split('=')[0])
    for (const f of [a, b]) assert.equal((await f.request('/api/v1/independent/configuration', { cookie: both })).status, 200)
    const foreign = await b.request(route, { cookie: ca, body: goal() }); assert.equal(foreign.status, 403)
    for (const headers of [{ origin: 'http://evil.invalid' }, { origin: '' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await b.request(route, { cookie: cb, body: goal(), headers })).status, 403)
    assert.equal((await b.request(route, { body: goal(), headers: { authorization: 'Bearer synthetic-service-token' } })).status, 403)
    assert.equal((await b.request(route, { cookie: ca.replace(/^[^=]+/, 'aroma_owner_session'), body: goal() })).status, 403)
    const logout = await b.request('/owner/logout', { cookie: both, method: 'POST' })
    assert(logout.cookie.startsWith(b.options.cookieName + '=')); assert.equal((await a.request('/api/v1/independent/configuration', { cookie: both })).status, 200)
    assert.equal((await b.snapshot()).calls.length, 0)
    const ra = await a.request(route, { cookie: ca, body: goal() }); assert.equal(ra.status, 200)
    const before = await a.snapshot(); await b.close(); assert.deepEqual((await a.snapshot()).files, before.files)
  } finally { await a.close(); await b.close() }
})
test('startup fails closed for missing model config, invalid choice and legacy cookie identity', async () => {
  for (const kind of ['missing', 'model', 'legacy_cookie']) {
    const root = rootFixture()
    if (kind === 'missing') fs.unlinkSync(path.join(root, 'config/model-selection.json'))
    if (kind === 'model') fs.writeFileSync(path.join(root, 'config/model-selection.json'), JSON.stringify({ version: 1, mode: 'synthetic_fixture', brain: { model: 'unavailable-model', effort: 'high' } }))
    await assert.rejects(child(root, kind === 'legacy_cookie' ? { cookieName: 'aroma_owner_session' } : {}))
    assert(!fs.existsSync(path.join(root, 'data/aroma-truth.json')))
  }
})
test('startup rejects hardlinked fixture data and explicit ambient service credentials before listening', async () => {
  const root = rootFixture(), file = path.join(root, 'config/synthetic-source.json')
  fs.linkSync(file, path.join(root, 'config/linked.json'))
  await assert.rejects(child(root), /root_alias/)
  const other = rootFixture()
  await assert.rejects(child(other, {}, { HUB_TOKEN: 'synthetic-not-a-production-token' }), /clean_environment/)
  assert(!fs.existsSync(path.join(other, 'data/aroma-truth.json')))
})
test('corrupt own task store fails startup without erasure or any other fixture mutation', async () => {
  const root = rootFixture(), file = path.join(root, 'data/aroma-truth.json'), bytes = '{synthetic-corrupt'
  fs.writeFileSync(file, bytes)
  await assert.rejects(child(root))
  assert.equal(fs.readFileSync(file, 'utf8'), bytes)
})
test('instances use fixed injected choices from private files and cannot read a fake legacy modelCenter', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-r1-models-')), ra = rootFixture(parent), rb = rootFixture(parent)
  const sentinel = path.join(parent, 'fake-legacy-model-center.json'), original = '{"synthetic":"must remain unchanged"}'
  fs.writeFileSync(sentinel, original)
  fs.writeFileSync(path.join(rb, 'config/model-selection.json'), JSON.stringify({ version: 1, mode: 'synthetic_fixture', brain: { model: 'gpt-6-astra', effort: 'medium' } }))
  const a = await child(ra), b = await child(rb)
  try {
    for (const [f, effort] of [[a, 'high'], [b, 'medium']]) {
      const cookie = await f.login(), r = await f.request('/api/v1/independent/configuration', { cookie })
      assert.equal(r.body.brain.effort, effort); assert.equal(r.body.realModelInvocation, 'BLOCKED')
      assert(!(await f.snapshot()).imports.some(p => p.includes(path.sep + 'modelCenter' + path.sep)))
    }
    assert.equal(fs.readFileSync(sentinel, 'utf8'), original)
  } finally { await a.close(); await b.close() }
})
test('concurrent replay cannot multiply source execution; unavailable own source yields no fabricated content', async () => {
  const root = rootFixture(), f = await child(root)
  try {
    const cookie = await f.login(), body = goal()
    await Promise.all([f.request(route, { cookie, body }), f.request(route, { cookie, body }), f.request(route, { cookie, body })])
    assert.equal((await f.snapshot()).calls.length, 2)
    fs.unlinkSync(path.join(root, 'config/synthetic-source.json'))
    const next = await f.request(route, { cookie, body: goal() })
    assert(!next.body.reply.includes('four minutes')); assert.notEqual(next.body.unifiedTask?.goalStatus, 'GOAL_COMPLETED')
  } finally { await f.close() }
})
test('fresh Chromium profile observes same-host cookie collision control and independent login/logout coexistence', { skip: 'NOT EXERCISED in final suite: preserved Chrome/Edge private-profile launch failures; browser acceptance remains BLOCKED' }, async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-r1-browser-')), a = await child(rootFixture(parent)), b = await child(rootFixture(parent))
  let context
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['path', 'systemroot', 'windir', 'comspec', 'pathext'].includes(k.toLowerCase())))
    const profile = path.join(parent, 'browser-profile'), temporary = path.join(parent, 'browser-temp'); fs.mkdirSync(temporary)
    Object.assign(env, { USERPROFILE: profile, HOME: profile, APPDATA: path.join(profile, 'roaming'), LOCALAPPDATA: path.join(profile, 'local'), TEMP: temporary, TMP: temporary })
    context = await require('playwright-core').chromium.launchPersistentContext(profile, {
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, env,
      timeout: 20000,
      args: ['--no-first-run', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
      proxy: { server: a.origin, bypass: '127.0.0.1,localhost' }
    })
    const denied = [], origins = new Set([a.origin, b.origin])
    await context.route('**/*', r => origins.has(new URL(r.request().url()).origin) ? r.continue() : (denied.push(new URL(r.request().url()).origin), r.abort()))
    const pa = await context.newPage(), pb = await context.newPage()
    for (const [page, f] of [[pa, a], [pb, b]]) {
      await page.goto(f.origin + '/owner/login'); await page.locator('input[name=password]').fill(f.options.password)
      await Promise.all([page.waitForURL('**/demo'), page.locator('button[type=submit]').click()])
      const response = await page.goto(f.origin + '/api/v1/independent/configuration'); assert.equal(response.status(), 200)
    }
    await context.addCookies([{ name: 'aroma_owner_session', value: 'synthetic-control-a', url: a.origin, secure: true, httpOnly: true, sameSite: 'Strict' }])
    await context.addCookies([{ name: 'aroma_owner_session', value: 'synthetic-control-b', url: b.origin, secure: true, httpOnly: true, sameSite: 'Strict' }])
    const before = await context.cookies()
    assert.equal(before.filter(c => c.name === 'aroma_owner_session').length, 1)
    assert.equal(before.find(c => c.name === 'aroma_owner_session').value, 'synthetic-control-b')
    for (const f of [a, b]) assert(before.some(c => c.name === f.options.cookieName && c.secure && c.httpOnly))
    const logout = await pb.evaluate(async () => (await fetch('/owner/logout', { method: 'POST' })).status); assert.equal(logout, 200)
    const after = await context.cookies(); assert(!after.some(c => c.name === b.options.cookieName)); assert(after.some(c => c.name === a.options.cookieName))
    assert.equal((await pa.goto(a.origin + '/api/v1/independent/configuration')).status(), 200)
    assert.equal((await pb.goto(b.origin + '/api/v1/independent/configuration')).status(), 401)
    if (process.env.INDEPENDENT_R1_EVIDENCE) fs.writeFileSync(path.join(process.env.INDEPENDENT_R1_EVIDENCE, 'browser-cookie-evidence-' + randomUUID() + '.json'), JSON.stringify({ browser: context.browser()?.version() || 'Chromium',
      before: before.map(({ name, domain, path, secure, httpOnly, sameSite }) => ({ name, domain, path, secure, httpOnly, sameSite })),
      after: after.map(({ name, domain, path }) => ({ name, domain, path })), collisionControl: 'same-name cookie overwritten across ports', independentLogoutPreservedOtherSession: true,
      deniedPageOrigins: denied, scope: 'Disposable profile and synthetic HTTP only; not OS containment or exhaustive browser-network proof' }, null, 2))
  } finally { if (context) await context.close(); await a.close(); await b.close() }
})
test('same private root cannot start a second writer or run startup task recovery', async () => {
  const root = rootFixture(), f = await child(root)
  try { await assert.rejects(child(root), /EEXIST/); const cookie = await f.login(); assert.equal((await f.request(route, { cookie, body: goal() })).status, 200) }
  finally { await f.close() }
})
test('disabled independent Main rejects execution and has no app startup recovery effects in another instance', async () => {
  const root = rootFixture(), f = await child(root, { enabled: false })
  try {
    const cookie = await f.login(); assert.equal((await f.request(route, { cookie, body: goal() })).status, 403)
    const s = await f.snapshot(); assert.equal(s.calls.length, 0); assert.equal(s.modelCalls.length, 0)
    for (const p of ['/api/v1/browser-read', '/api/v1/scheduler-actions', '/company', '/api/v1/procurement/tick']) assert.equal((await f.request(p, { cookie })).status, 404)
  } finally { await f.close() }
})
test('fresh process restart retains own committed Task/Goal and history but invalidates old sessions and does not resume reads', async t => {
  const root = rootFixture(), first = await child(root), cookie = await first.login(), body = goal()
  t.after(() => first.close())
  const result = await first.request(route, { cookie, body }); assert.equal(result.status, 200)
  const snap = await first.snapshot(); await first.close()
  const second = await child(root)
  try {
    const next = await second.snapshot(); assert.equal(next.calls.length, 0); assert.equal(next.modelCalls.length, 0)
    assert.equal(next.tasks[0].id, snap.tasks[0].id); assert.equal(next.tasks[0].ownerGoal.goalId, snap.tasks[0].ownerGoal.goalId)
    assert.equal((await second.request(route, { cookie, body })).status, 403)
    const fresh = await second.login(); await second.request(route, { cookie: fresh, body }); assert.equal((await second.snapshot()).calls.length, 0)
  } finally { await second.close() }
})
module.exports = { rootFixture }
