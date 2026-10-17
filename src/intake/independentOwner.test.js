'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { fork } = require('node:child_process'), { randomUUID, createHash } = require('node:crypto')
const codeRoot = path.resolve(__dirname, '../..'), probe = path.join(codeRoot, 'scripts/r1/independentProbe.cjs')
const fixtures = require('../../scripts/r1/independentFixture.cjs'), hostInstances = new Map(), openChildren = new Set()
test.after(async () => { for (const close of openChildren) await close() })
function rootFixture(parent = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-r1-')), options = {}) {
  const owned = fixtures.createFixture(parent, { sharing: { goal: true, content: true, source: true }, ...options })
  hostInstances.set(owned.root, owned)
  return owned.root
}
async function child(root, overrides = {}, environment = {}) {
  const env = fixtures.cleanEnvironment(root)
  Object.assign(env, environment)
  const p = fork(probe, [], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const errors = [], pending = new Map(); let sequence = 0
  p.stderr.on('data', b => errors.push(b.toString())); p.stdout.on('data', () => {})
  p.on('message', m => { const v = pending.get(m.id); if (v) { pending.delete(m.id); clearTimeout(v.timer); m.error ? v.reject(Error(m.error)) : v.resolve(m) } })
  p.on('exit', code => { for (const v of pending.values()) { clearTimeout(v.timer); v.reject(Error('probe_exit_' + code + ':' + errors.join(''))) } pending.clear() })
  const rpc = message => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('probe_deadline')) }, 15000); pending.set(id, { resolve, reject, timer }); p.send({ ...message, id }) })
  const options = { ...hostInstances.get(root), password: 'synthetic-private-password', cookieName: 'aroma_independent_' + randomUUID().replaceAll('-', ''), ...overrides }
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
  const close = async () => { if (!p.connected) { openChildren.delete(close); return } const closed = await rpc({ op: 'close' }); await new Promise(resolve => p.exitCode !== null ? resolve() : p.once('exit', resolve)); openChildren.delete(close); const owned = hostInstances.get(root); owned.hostEvidence = fixtures.retainClose(owned, closed.receipt); owned.resumeReceipt = closed.receipt }
  openChildren.add(close)
  return { root, origin, options, pid: ready.pid, request, login, snapshot: () => rpc({ op: 'snapshot', root }), control: () => rpc({ op: 'observerControl' }),
    holdSource: () => rpc({ op: 'holdSource' }), releaseSource: () => rpc({ op: 'releaseSource' }),
    holdPersistence: (stage, barrier) => rpc({ op: 'holdPersistence', stage, barrier }),
    crash: () => rpc({ op: 'crash' }),
    close }
}
const goal = () => ({ version: 1, operation: 'start', clientSubmissionId: randomUUID(), conversationId: randomUUID(), message: 'Find the synthetic tea record and summarize its instruction.', taskRef: null, expectedRevision: null, contextRefs: [] })
const route = '/api/v1/demo/task-intake'

test('persisted synthetic provenance cannot assert real subscription verification', async () => {
  const root = rootFixture(), f = await child(root)
  try {
    const cookie = await f.login(), result = await f.request(route, { cookie, body: goal() })
    assert.equal(result.status, 200)
    const files = fs.readdirSync(path.join(root, 'data/browser-context-reads')).filter(n => n.endsWith('.json'))
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'data/browser-context-reads', files[0]), 'utf8'))
    assert(!saved.timeline.some(e => e.stage === 'r1_subscription_verified'))
    assert.equal(saved.result.executionProvenance.executionMode, 'synthetic_fixture')
    assert.equal(saved.result.executionProvenance.billingVerified, false)
    assert.equal(saved.result.executionProvenance.modelInvocationVerified, false)
    assert.equal(saved.result.billing, 'synthetic-not-verified')
    assert.equal(saved.timeline.find(e => e.stage === 'r1_synthetic_contract_exercised').billing, 'synthetic-not-verified')
    assert(!JSON.stringify(saved).includes('"billing":"chatgpt-subscription"'))
    assert.equal(saved.result.executionProvenance.sourceReadVerification, 'synthetic_adapter_observed')
    assert.equal(saved.result.taskEvidence.run.executionProvenance.billingVerified, false)
    assert.equal(result.body.unifiedTask.investigation.executionProvenance.synthetic, true)
    const sameTask = (await f.snapshot()).tasks[0]
    assert(!JSON.stringify(sameTask).includes('"billing":"chatgpt-subscription"'))
    assert.equal(sameTask.ownerGoal.goalId, result.body.unifiedTask.goalId)
    assert.equal(sameTask.unifiedIntake.attempts[0].executionRef.id, saved.id)
    assert.equal(result.body.unifiedTask.investigation.goalVerifiedComplete, false)
  } finally { await f.close() }
})

test('client disconnect cannot release actual source operation before final persistence and graceful close', async () => {
  const root = rootFixture(), f = await child(root), cookie = await f.login(), body = goal()
  await f.holdSource()
  const q = require('node:http').request(f.origin + route, { method: 'POST', headers: { cookie, origin: f.origin, 'content-type': 'application/json' } })
  q.on('error', () => {}); q.end(JSON.stringify(body))
  let reached = false
  for (let n = 0; n < 100; n++) { if ((await f.snapshot()).held === 'source_reached') { reached = true; break } await new Promise(r => setTimeout(r, 10)) }
  assert(reached); q.destroy()
  await new Promise(r => setTimeout(r, 30))
  assert.equal((await f.snapshot()).activeRequests, 1)
  let released = false
  const closing = f.close().then(() => { released = true })
  await new Promise(r => setTimeout(r, 30))
  assert.equal(released, false); assert(fs.existsSync(path.join(root, '.independent-process.json')))
  assert.equal((await f.snapshot()).activeRequests, 1)
  await f.releaseSource(); await closing
  const files = fs.readdirSync(path.join(root, 'data/browser-context-reads')).filter(n => n.endsWith('.json'))
  const record = JSON.parse(fs.readFileSync(path.join(root, 'data/browser-context-reads', files[0])))
  assert.equal(record.state, 'completed'); assert.equal(record.result.billing, 'synthetic-not-verified')
  const history = JSON.parse(fs.readFileSync(path.join(root, 'data/conversations', body.conversationId + '.json')))
  assert(history.messages.some(m => String(m.content).includes('four minutes')))
  assert(!fs.existsSync(path.join(root, '.independent-process.json')))
  if (process.env.INDEPENDENT_R1_EVIDENCE) fs.writeFileSync(path.join(process.env.INDEPENDENT_R1_EVIDENCE, 'disconnect-final-' + body.clientSubmissionId + '.json'), JSON.stringify({ task: record.unifiedTask, state: record.state, timeline: record.timeline, taskEvidence: record.result.taskEvidence, historySaved: true, safeClosed: hostInstances.get(root).resumeReceipt.safeClosed }), { flag: 'wx' })
})

for (const stage of ['task','browserResult']) test('disconnect and graceful close retain ownership through synchronous ' + stage + ' persistence', async () => {
  const root = rootFixture(), f = await child(root), cookie = await f.login(), body = goal()
  const barrier = path.join(fs.mkdtempSync(path.join(path.dirname(root), 'r1-persistence-')), 'barrier')
  await f.holdPersistence(stage, barrier)
  const q = require('node:http').request(f.origin + route, { method: 'POST', headers: { cookie, origin: f.origin, 'content-type': 'application/json' } })
  q.on('error', () => {}); q.end(JSON.stringify(body))
  let reached = false
  for (let n = 0; n < 200; n++) { if (fs.existsSync(barrier + '.reached')) { reached = true; break } await new Promise(r => setTimeout(r, 10)) }
  assert(reached, stage + ' actual persistence boundary reached')
  q.destroy(); const closing = f.close()
  assert(fs.existsSync(path.join(root, '.independent-process.json')))
  fs.writeFileSync(barrier + '.release', 'explicit test release', { flag: 'wx' }); await closing
  const files = fs.readdirSync(path.join(root, 'data/browser-context-reads')).filter(n => n.endsWith('.json'))
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/browser-context-reads', files[0]))).state, 'completed')
  assert(JSON.parse(fs.readFileSync(path.join(root, 'data/conversations', body.conversationId + '.json'))).messages.some(m => String(m.content).includes('four minutes')))
  assert(!fs.existsSync(path.join(root, '.independent-process.json')))
})

test('malformed unauthenticated and authenticated request floods have zero diagnostic writes and do not close admission', async () => {
  const root = rootFixture(), f = await child(root)
  try {
    for (let i = 0; i < 80; i++) assert.equal((await f.request(route, { body: '{bad' })).status, 403)
    for (let i = 0; i < 10; i++) assert.equal((await f.request('/owner/login', { body: '{bad' })).status, 400)
    assert.deepEqual(fs.readdirSync(path.join(root, 'logs')), [])
    const cookie = await f.login()
    for (let i = 0; i < 80; i++) assert.equal((await f.request(route, { cookie, body: '{bad' })).status, 400)
    assert.deepEqual(fs.readdirSync(path.join(root, 'logs')), [])
    assert.equal((await f.request(route, { cookie, body: goal() })).status, 200)
  } finally { await f.close() }
})

test('strict own history and Main errors are unavailable, correlated and bounded rather than empty or successful', async () => {
  const root = rootFixture(), f = await child(root)
  try {
    const cookie = await f.login(), id = randomUUID(), dir = path.join(root, 'data/conversations')
    assert.equal((await f.request('/api/v1/conversations')).status, 401)
    assert.equal((await f.request('/api/v1/conversations/' + id)).status, 401)
    assert.deepEqual((await f.request('/api/v1/conversations', { cookie })).body, { ok: true, conversations: [] })
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, id + '.json'), '{private-corrupt')
    for (const endpoint of ['/api/v1/conversations', '/api/v1/conversations/' + id]) {
      const r = await f.request(endpoint, { cookie }); assert.equal(r.status, 503); assert.match(r.body.correlationId, /^[a-f0-9-]{36}$/)
    }
    const b = { ...goal(), conversationId: id }, failure = await f.request(route, { cookie, body: b })
    assert.equal(failure.status, 503); assert.match(failure.body.correlationId, /^[a-f0-9-]{36}$/)
    for (let n = 0; n < 70; n++) assert.equal((await f.request(route, { cookie, body: b })).status, 503)
    const names = fs.readdirSync(path.join(root, 'logs')); assert(names.length <= 64)
    const logs = names.map(n => fs.readFileSync(path.join(root, 'logs', n), 'utf8')).join('')
    assert(!logs.includes('private-corrupt')); assert(!logs.includes(root)); assert(!logs.includes(f.options.password))
    fs.unlinkSync(path.join(dir, id + '.json')); fs.rmdirSync(dir); fs.writeFileSync(dir, 'synthetic unavailable directory')
    assert.equal((await f.request('/api/v1/conversations', { cookie })).status, 503)
    fs.unlinkSync(dir)
  } finally { await f.close() }
})

test('failed audit is a durable failed read with an HTTP failure and private correlation', async () => {
  const root = rootFixture(), f = await child(root)
  try {
    const cookie = await f.login(), dir = path.join(root, 'data/context-activity')
    if (fs.existsSync(dir)) fs.rmdirSync(dir)
    fs.writeFileSync(dir, 'synthetic unavailable audit')
    const r = await f.request(route, { cookie, body: goal() })
    assert.equal(r.status, 503); assert.match(r.body.correlationId, /^[a-f0-9-]{36}$/)
    assert.notEqual(r.body.unifiedTask?.investigation?.goalVerifiedComplete, true)
    const files = fs.readdirSync(path.join(root, 'data/browser-context-reads')).filter(n => n.endsWith('.json'))
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/browser-context-reads', files[0]))).state, 'failed')
    fs.unlinkSync(dir)
  } finally { await f.close() }
})

test('history absence and corruption remain distinct actual HTTP failures', async () => {
  const root = rootFixture(), f = await child(root)
  try {
    const cookie = await f.login(), id = randomUUID(), endpoint = '/api/v1/independent/conversations/' + id
    assert.equal((await f.request(endpoint, { cookie })).status, 404)
    fs.mkdirSync(path.join(root, 'data/conversations'), { recursive: true })
    fs.writeFileSync(path.join(root, 'data/conversations', id + '.json'), '{broken-synthetic-history')
    const failed = await f.request(endpoint, { cookie })
    assert.equal(failed.status, 503); assert.equal(failed.body.error, 'conversation_unavailable')
    assert.match(failed.body.correlationId, /^[a-f0-9-]{36}$/)
    assert.equal(fs.readFileSync(path.join(root, 'data/conversations', id + '.json'), 'utf8'), '{broken-synthetic-history')
    const logs = fs.readdirSync(path.join(root, 'logs')).map(n => fs.readFileSync(path.join(root, 'logs', n), 'utf8')).join('')
    assert(!logs.includes(root)); assert(!logs.includes('broken-synthetic-history')); assert(logs.includes(failed.body.correlationId))
  } finally { await f.close() }
})

test('sharing defaults deny and no selected tool confers content authority', async () => {
  const root = rootFixture(), f = await child(root, { sharing: {} })
  try {
    const cookie = await f.login(), result = await f.request(route, { cookie, body: goal() })
    assert.equal(result.status, 503)
    assert.equal((await f.snapshot()).calls.length, 0)
    assert(!result.body.reply.includes('four minutes'))
  } finally { await f.close() }
})

test('offline entry rejects replacement transports, unknown roots, changed fixtures and ambient preloads', async () => {
  for (const key of ['request','createContext']) await assert.rejects(child(rootFixture(), { [key]: 'replacement' }), /offline_dependencies_fixed/)
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS','DATABASE_URL','PROVIDER_SECRET','NODE_PATH','CODEX_HOME']) {
    await assert.rejects(child(rootFixture(), {}, { [key]: 'synthetic-denied-value' }), /clean_environment/)
  }
  await assert.rejects(child(rootFixture(), {}, { NODE_OPTIONS: '--trace-warnings' }), /clean_environment/)
  const unqualified = fs.mkdtempSync(path.join(os.tmpdir(), 'unqualified-'))
  await assert.rejects(child(unqualified))
  assert.deepEqual(fs.readdirSync(unqualified), [])
  const root = rootFixture()
  fs.writeFileSync(path.join(root, 'config/unexpected.json'), '{}')
  await assert.rejects(child(root), /fixture_changed/)
  assert(!fs.existsSync(path.join(root, '.independent-process.json')))
})

test('sharing intersection rejects absent source sharing, missing source grants and suspended Owner', async () => {
  for (const sharing of [{ goal: false, content: true, source: true }, { goal: true, content: false, source: true }, { goal: true, content: true, source: false }]) {
    const f = await child(rootFixture(), { sharing })
    try { const cookie = await f.login(); await f.request(route, { cookie, body: goal() }); assert.equal((await f.snapshot()).calls.length, 0) }
    finally { await f.close() }
  }
  for (const options of [{ sourceGranted: false }, { ownerSuspended: true }]) {
    const f = await child(rootFixture(undefined, options))
    try { const cookie = await f.login(); await f.request(route, { cookie, body: goal() }); assert.equal((await f.snapshot()).calls.length, 0) }
    finally { await f.close() }
  }
})

test('malformed JSON does not persist diagnostics; internal diagnostic failure closes admission and retains ownership', async () => {
  const root = rootFixture(), f = await child(root)
  const cookie = await f.login()
  const invalid = await f.request(route, { cookie, body: '{invalid' })
  assert.equal(invalid.status, 400); assert.equal(invalid.body.correlationId, undefined)
  assert.equal(fs.readdirSync(path.join(root, 'logs')).length, 0)
  fs.renameSync(path.join(root, 'logs'), path.join(root, 'logs-preserved'))
  fs.writeFileSync(path.join(root, 'logs'), 'synthetic-diagnostic-failure')
  const conversationId = randomUUID(); fs.mkdirSync(path.join(root, 'data/conversations')); fs.writeFileSync(path.join(root, 'data/conversations', conversationId + '.json'), '{broken')
  assert.equal((await f.request('/api/v1/conversations/' + conversationId, { cookie })).status, 503)
  assert.equal((await f.request(route, { cookie, body: goal() })).status, 503)
  assert.equal((await f.snapshot()).calls.length, 0)
  await assert.rejects(f.close(), /recovery_required/)
  assert(fs.existsSync(path.join(root, '.independent-process.json')))
  await assert.rejects(f.crash(), /probe_exit_73/)
})

test('a hard-crash ownership marker cannot be replaced by a new fixture hash or resume receipt', async () => {
  const root = rootFixture(), marker = path.join(root, '.independent-process.json')
  fs.writeFileSync(marker, JSON.stringify({ mode: 'synthetic_fixture', id: randomUUID(), pid: 999999 }))
  await assert.rejects(child(root), /EEXIST/)
  assert(fs.existsSync(marker))
})

test('actual disposable child interruption preserves ownership and cannot automatically restart', async () => {
  const root = rootFixture(), f = await child(root), cookie = await f.login()
  await f.request(route, { cookie, body: goal() })
  await assert.rejects(f.crash(), /probe_exit_73/)
  assert(fs.existsSync(path.join(root, '.independent-process.json')))
  await assert.rejects(child(root), /EEXIST/)
})

test('manual CLI launches a clean operational child and releases only its verified marker', async () => {
  const root = rootFixture(), config = { ...hostInstances.get(root), password: 'synthetic-cli-password', cookieName: 'aroma_independent_cli' }
  const cli = fork(path.join(codeRoot, 'scripts/r1/startIndependent.cjs'), [], { execArgv: [], cwd: codeRoot,
    env: { ...fixtures.cleanEnvironment(root), DATABASE_URL: 'synthetic-must-not-reach-child', PROVIDER_SECRET: 'synthetic-must-not-reach-child' },
    windowsHide: true, stdio: ['pipe','pipe','pipe','ipc'] })
  let lines = '', errors = ''; cli.stdout.on('data', b => { lines += b }); cli.stderr.on('data', b => { errors += b })
  cli.stdin.end(JSON.stringify(config))
  const ready = await new Promise((resolve, reject) => {
    const onData = () => { const line = lines.split('\n').find(l => l.startsWith('{"event":"ready"')); if (line) { cli.stdout.removeListener('data', onData); resolve(JSON.parse(line)) } }
    cli.stdout.on('data', onData); cli.once('exit', code => reject(Error('cli_refused_' + code + ':' + errors)))
  })
  assert.equal((await fetch(ready.origin + '/owner/login')).status, 200)
  cli.send({ op: 'close' }); await new Promise(resolve => cli.once('exit', resolve))
  const closed = lines.split('\n').find(l => l.startsWith('{"event":"closed"'))
  assert(closed); assert.equal(JSON.parse(closed).receipt.safeClosed, true)
  assert(!fs.existsSync(path.join(root, '.independent-process.json')))
})

test('graceful close drains an admitted HTTP body through its final persistence before releasing ownership', async () => {
  const root = rootFixture(), f = await child(root), cookie = await f.login(), payload = JSON.stringify(goal())
  const http = require('node:http')
  let responseRequest
  const response = new Promise((resolve, reject) => {
    const q = http.request(f.origin + route, { method: 'POST', headers: { origin: f.origin, cookie, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, r => {
      let text = ''; r.on('data', b => { text += b }); r.on('end', () => resolve({ status: r.statusCode, text }))
    })
    q.on('error', reject); q.write(payload.slice(0, 10)); responseRequest = q
  })
  // Explicitly observe admission, rather than assume that a client send is admission.
  let admitted = false
  for (let n = 0; n < 50; n++) { if ((await f.snapshot()).activeRequests === 1) { admitted = true; break } await new Promise(r => setTimeout(r, 20)) }
  assert(admitted)
  const closed = f.close()
  assert(fs.existsSync(path.join(root, '.independent-process.json')))
  responseRequest.end(payload.slice(10))
  const result = await response; assert.equal(result.status, 200); assert.match(result.text, /four minutes/)
  await closed
  assert(!fs.existsSync(path.join(root, '.independent-process.json')))
  const saved = fs.readdirSync(path.join(root, 'data/browser-context-reads')).find(n => n.endsWith('.json'))
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/browser-context-reads', saved))).state, 'completed')
})
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
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-r1-pair-')), a = await child(rootFixture(parent), { cookieName: 'aroma_independent_shared' }), b = await child(rootFixture(parent), { cookieName: 'aroma_independent_shared' })
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
test('corrupt retained own task store reaches loader and fails startup without erasure', async () => {
  const root = rootFixture(), f = await child(root), file = path.join(root, 'data/aroma-truth.json'), bytes = '{synthetic-corrupt'
  fs.writeFileSync(file, bytes)
  await f.close()
  await assert.rejects(child(root), /independent_storage_corrupt/)
  assert.equal(fs.readFileSync(file, 'utf8'), bytes)
})
test('instances use fixed injected choices from private files and cannot read a fake legacy modelCenter', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-r1-models-')), ra = rootFixture(parent), rb = rootFixture(parent, { effort: 'medium' })
  const sentinel = path.join(parent, 'fake-legacy-model-center.json'), original = '{"synthetic":"must remain unchanged"}'
  fs.writeFileSync(sentinel, original)
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
    const sourceFile = path.join(root, 'config/synthetic-source.json'), sourceBytes = fs.readFileSync(sourceFile)
    fs.unlinkSync(sourceFile)
    const next = await f.request(route, { cookie, body: goal() })
    assert(!next.body.reply.includes('four minutes')); assert.notEqual(next.body.unifiedTask?.goalStatus, 'GOAL_COMPLETED')
    fs.writeFileSync(sourceFile, sourceBytes)
  } finally { await f.close() }
})
test('fresh Chromium profile observes same-host cookie collision control and independent login/logout coexistence', async () => {
  assert.match(os.userInfo().username, /WDAGUtilityAccount/i, 'mandatory browser acceptance requires the existing offline OS boundary')
  assert(Object.values(os.networkInterfaces()).flat().every(n => n.internal), 'browser requires independently disabled VM networking')
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-r1-browser-')), a = await child(rootFixture(parent)), b = await child(rootFixture(parent))
  let context
  try {
    const guestHome = os.userInfo().homedir
    const env = { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PATH: 'C:\\Windows\\System32',
      USERPROFILE: guestHome, HOME: guestHome, APPDATA: path.join(guestHome, 'AppData/Roaming'), LOCALAPPDATA: path.join(guestHome, 'AppData/Local') }
    const profile = path.join(parent, 'browser-profile'), temporary = path.join(parent, 'browser-temp'); fs.mkdirSync(temporary)
    Object.assign(env, { TEMP: temporary, TMP: temporary })
    context = await require('playwright-core').chromium.launchPersistentContext(profile, {
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, env,
      timeout: 20000,
      args: ['--no-first-run', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    })
    const denied = [], origins = new Set([a.origin, b.origin])
    const attacker = require('node:http').createServer((_q, r) => r.end('<!doctype html><title>Synthetic cross-origin fixture</title>'))
    await new Promise(resolve => attacker.listen(0, '127.0.0.1', resolve))
    const attackerOrigin = 'http://127.0.0.1:' + attacker.address().port
    origins.add(attackerOrigin)
    context.on('close', () => attacker.close())
    await context.route('**/*', r => origins.has(new URL(r.request().url()).origin) ? r.continue() : (denied.push(new URL(r.request().url()).origin), r.abort()))
    const pa = await context.newPage(), pb = await context.newPage()
    for (const [page, f] of [[pa, a], [pb, b]]) {
      assert.equal((await page.goto(f.origin + '/api/v1/independent/configuration')).status(), 401)
      await page.goto(f.origin + '/owner/login'); await page.locator('input[name=password]').fill(f.options.password)
      await Promise.all([page.waitForURL('**/demo'), page.locator('button[type=submit]').click()])
      const response = await page.goto(f.origin + '/api/v1/independent/configuration'); assert.equal(response.status(), 200)
    }
    const replyResponse = pa.waitForResponse(r => r.url() === a.origin + route && r.request().method() === 'POST')
    await pa.goto(a.origin + '/demo')
    await pa.locator('#msg').fill(goal().message)
    await pa.getByRole('button', { name: 'Start shared task', exact: true }).click()
    const actualResponse = await replyResponse, submitted = actualResponse.request().postDataJSON(), reply = await actualResponse.json()
    assert.equal(reply.historySaved, true); assert.equal(reply.unifiedTask.investigation.goalVerifiedComplete, false)
    await pa.getByText('Steep synthetic tea for four minutes.', { exact: false }).first().waitFor()
    const history = await pa.evaluate(async id => (await fetch('/api/v1/independent/conversations/' + id)).json(), submitted.conversationId)
    assert(history.ok); assert(history.conversation.messages.some(m => JSON.stringify(m).includes('four minutes')))
    // Real sidebar restoration after a real reload, then a user click loads history.
    await pa.reload({ waitUntil: 'load' })
    const historyButton = pa.locator('button.conv').filter({ hasText: 'Find the synthetic tea record' }).first()
    await historyButton.waitFor(); await historyButton.click()
    await pa.getByText('Steep synthetic tea for four minutes.', { exact: false }).first().waitFor()
    assert((await pa.locator('#log').innerText()).includes('four minutes'))
    if (process.env.INDEPENDENT_R1_EVIDENCE) {
      const screenshot = await pa.screenshot({ fullPage: true })
      fs.writeFileSync(path.join(process.env.INDEPENDENT_R1_EVIDENCE, 'browser-refresh-' + submitted.conversationId + '.png'), screenshot, { flag: 'wx' })
      fs.writeFileSync(path.join(process.env.INDEPENDENT_R1_EVIDENCE, 'browser-refresh-' + submitted.conversationId + '.json'), JSON.stringify({ conversationId: submitted.conversationId, task: reply.unifiedTask.taskId, goal: reply.unifiedTask.goalId, sidebarTitle: await historyButton.innerText(), restoredAnswer: await pa.locator('#log').innerText(), screenshotHash: createHash('sha256').update(screenshot).digest('hex'), at: new Date().toISOString(), synthetic: true }), { flag: 'wx' })
    }
    await pb.goto(attackerOrigin)
    const crossOrigin = pb.waitForResponse(r => r.url() === a.origin + '/owner/logout' && r.request().method() === 'POST')
    const rejectedNavigation = pb.waitForURL(a.origin + '/owner/logout', { waitUntil: 'load' })
    await pb.evaluate(target => { const f = document.createElement('form'); f.method = 'POST'; f.action = target + '/owner/logout'; document.body.appendChild(f); f.submit() }, a.origin)
    assert.equal((await crossOrigin).status(), 403)
    await rejectedNavigation
    assert.equal((await a.snapshot()).calls.length, 2)
    await pb.goto(b.origin + '/demo')
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
