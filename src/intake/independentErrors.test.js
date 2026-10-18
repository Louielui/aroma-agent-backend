'use strict'
// Leaf composition tests only. These do not start Independent R1 or bypass its OS guard.
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { randomUUID } = require('node:crypto')
const { loadTaskStore, createFailureBoundary } = require('./independentErrors')
const { safeCode, safeFailure } = require('../../scripts/r1/startIndependent.cjs')

test('startup distinguishes damaged JSON, invalid schema and missing first-run state without writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-start-errors-')), file = path.join(dir, 'aroma-truth.json')
  for (const [text, reason] of [['{', 'corrupt_json'], ['null', 'invalid_schema'], ['[]', 'invalid_schema'], ['{"tasks":{}}', 'invalid_schema'], ['{"events":null}', 'invalid_schema']]) {
    fs.writeFileSync(file, text)
    assert.throws(() => loadTaskStore(file, () => assert.fail('must not import corrupt store')), e => e.message === 'independent_storage_corrupt' && e.reason === reason && safeCode(e) === 'independent_storage_corrupt' && !e.stack.includes(text + 'PRIVATE'))
    assert.equal(fs.readFileSync(file, 'utf8'), text)
  }
  assert.equal(loadTaskStore(path.join(dir, 'absent.json'), () => 'first-run'), 'first-run')
  fs.writeFileSync(file, '{"tasks":[],"extra":"compatible extension"}')
  assert.equal(loadTaskStore(file, () => 'loaded'), 'loaded')
})
for (const code of ['EACCES', 'EPERM', 'EIO', 'EBUSY', 'ENOTDIR']) test('startup propagates safe filesystem category ' + code, () => {
  const read = () => { throw Object.assign(Error('PRIVATE/path/credential'), { code, syscall: 'open' }) }
  assert.throws(() => loadTaskStore('unused', () => assert.fail(), read), e => e.message === 'independent_storage_unavailable' && e.reason === code && e.code === code && safeCode(e) === 'independent_storage_unavailable' && !e.stack.includes('PRIVATE'))
})
test('unexpected loader failure remains internal; module dependency is not called corruption', () => {
  for (const error of [Error('PRIVATE/internal'), Object.assign(Error('PRIVATE/module'), { code: 'MODULE_NOT_FOUND' })]) {
    assert.throws(() => loadTaskStore('unused', () => { throw error }, () => '{}'), e => e.reason === 'unknown_internal' && !e.stack.includes('PRIVATE') && safeCode(e) === (error.code === 'MODULE_NOT_FOUND' ? 'independent_dependencies_required' : 'independent_startup_unavailable'))
  }
})
test('real directory read reaches the unavailable branch; loader-time filesystem failures remain distinct', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r1-unavailable-'))
  assert.throws(()=>loadTaskStore(dir,()=>assert.fail()),e=>e.message==='independent_storage_unavailable' && ['EISDIR','EACCES','EPERM'].includes(e.code) && safeCode(e)==='independent_storage_unavailable')
  for(const code of ['EACCES','EPERM','EIO']) assert.throws(()=>loadTaskStore('unused',()=>{throw Object.assign(Error('PRIVATE/path'),{code})},()=>'{}'),e=>e.reason===code && !e.stack.includes('PRIVATE'))
})

test('actual Main-router HTTP classifications retain expected errors without internal diagnostics', async () => {
  const express = require('express'), auth = require('../governance/ownerAuth'), app = express(), logs = []
  const boundary = createFailureBoundary(code => { const id = randomUUID(); logs.push({ code, id }); return id })
  const sessions = auth.createSessionStore(), cookieName = 'aroma_independent_error_test', session = sessions.issue()
  app.locals.ownerSessions = sessions; app.locals.conversationDemo = true; app.use(express.json())
  let failure, beforeReturn, calls = 0, timeline = []
  const view = { taskId: 'task_12345678', attemptId: 'attempt', executionState: 'failed' }
  app.use(require('./unifiedRoutes').createRouter({ cookieName,
    intake: { viewAttempt: () => view }, conversations: { get: () => null, appendTurn: () => {} },
    operation: (_req, _res, execute) => boundary.within(execute),
    reportFailure: boundary.reportFailure,
    browserRead: { async handleMain() { calls++; if (beforeReturn) await beforeReturn(); return boundary.projectResult({ state: 'failed', error: failure, timeline, unifiedTask: view }) } }
  }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const post = async (cookie = cookieName + '=' + session) => {
    const r = await fetch(origin + '/api/v1/demo/task-intake', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, operation: 'start', clientSubmissionId: randomUUID(), conversationId: randomUUID(), message: 'Synthetic error test', taskRef: null, expectedRevision: null, contextRefs: [] }) })
    return { status: r.status, body: await r.json() }
  }
  try {
    assert.equal((await post('')).status, 403); assert.equal(calls, 0); assert.equal(logs.length, 0)
    for (const [code, status] of [['owner_session_required',403],['selection_not_authorized',403],['permission_denied',403],['selection_scope_changed',403],['source_access_changed',403],['task_scope_changed',403],['cross_source_not_authorized',403],['synthesis_not_authorized',403],['task_not_authorised',403],['subscription_unavailable',503],['subscription_login_required',503],['subscription_limit_reached',503],['subscription_model_unavailable',503],['read_timeout',504],['audit_unavailable',503],['PRIVATE/internal/path',503]]) {
      failure = code; beforeReturn = null; const count = logs.length, result = await post()
      assert.equal(result.status, status, code)
      assert.equal(result.body.error, code.startsWith('PRIVATE') ? 'independent_unavailable' : code)
      assert.match(result.body.correlationId, /^[0-9a-f-]{36}$/)
      assert.equal(result.body.historySaved, true); assert.equal(result.body.unifiedTask.taskId, view.taskId)
      assert.equal(logs.length - count, ['audit_unavailable','PRIVATE/internal/path'].includes(code) ? 1 : 0)
      assert(!JSON.stringify(result).includes('PRIVATE'))
    }
    // Browser Read's existing lossy enum is unchanged. Capture only within this operation.
    failure = 'read_unavailable'; beforeReturn = async () => { try { await boundary.observe(async () => { throw Error('synthesis_not_authorized') }) } catch {} }
    const count = logs.length, denied = await post()
    assert.equal(denied.body.error, 'synthesis_not_authorized'); assert.equal(denied.status,403); assert.equal(logs.length,count)
    beforeReturn = null; timeline=[{stage:'independent_failure_classified',error:'synthesis_not_authorized'}]
    assert.equal((await post()).body.error,'synthesis_not_authorized');assert.equal(logs.length,count)
    timeline=[];assert.equal((await post()).body.error,'independent_unavailable')
    assert.equal(logs.length,count+1)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('failure capture cannot bleed across concurrent requests or mask a later audit failure', async () => {
  const b = createFailureBoundary(() => randomUUID())
  const response = () => ({ status(n) { this.statusCode=n; return this }, json(body) { return body } })
  const [denied, unknown] = await Promise.all([
    b.within(async () => { try { await b.observe(async () => { await new Promise(r=>setImmediate(r)); throw Error('selection_not_authorized') }) } catch {} return b.reportFailure(response(),Error('read_unavailable')) }),
    b.within(async () => b.reportFailure(response(),Error('read_unavailable')))
  ])
  assert.equal(denied.error,'selection_not_authorized'); assert.equal(unknown.error,'independent_unavailable')
  await b.within(async () => { try { await b.observe(async () => { throw Error('synthesis_not_authorized') }) } catch {} assert.equal(b.reportFailure(response(),Error('audit_unavailable')).error,'audit_unavailable') })
})
test('diagnostic failure stays unavailable without exposing an exception or pretending logging succeeded', () => {
  const b=createFailureBoundary(()=>{throw Error('PRIVATE/log/path')})
  const res={status(n){this.statusCode=n;return this},json(body){return body}}
  assert.deepEqual(b.reportFailure(res,Error('PRIVATE/fault')),{error:'diagnostic_unavailable'});assert.equal(res.statusCode,503)
})
test('startup JSON projection preserves safe reasons and drops private paths and arbitrary reasons', () => {
  for(const reason of ['corrupt_json','invalid_schema','unknown_internal']) assert.equal(safeFailure(Object.assign(Error('PRIVATE/path'),{reason})).reason,reason)
  assert.deepEqual(safeFailure(Object.assign(Error('independent_storage_unavailable'),{code:'EACCES',reason:'EACCES',path:'PRIVATE'})),{error:'independent_storage_unavailable',reason:'EACCES'})
  assert.deepEqual(safeFailure(Object.assign(Error('PRIVATE/path'),{reason:'PRIVATE/path'})),{error:'independent_startup_unavailable'})
})
test('expected failure is persisted on existing disk timeline and classified identically on replay', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r1-denial-reload-')),store=require('../browserRead/store').createStore(dir)
  const row={id:randomUUID(),workflow:'browser_context_read',state:'failed',error:'read_unavailable',timeline:[]},b=createFailureBoundary(()=>assert.fail('expected denial must not log internal error'))
  await assert.rejects(b.within(()=>b.observe(async()=>{throw Error('synthesis_not_authorized')},event=>{row.timeline.push(event);store.save(row)})),/synthesis_not_authorized/)
  const reloaded=require('../browserRead/store').createStore(dir).get(row.id),result=b.projectResult(reloaded)
  assert.equal(result.error,'synthesis_not_authorized');assert.equal(reloaded.error,'read_unavailable')
  const res={status(n){this.statusCode=n;return this},json(body){return body}}
  assert.equal(b.reportFailure(res,Error(result.error)).error,'synthesis_not_authorized');assert.equal(res.statusCode,403)
  assert.equal(b.projectResult({...reloaded,error:'audit_unavailable'}).error,'audit_unavailable')
  assert.equal(b.projectResult({...reloaded,timeline:[]}).error,'read_unavailable')
  const failedAudit=()=>{throw Error('audit_unavailable')}
  await assert.rejects(b.observe(async()=>{throw Error('synthesis_not_authorized')},failedAudit),/audit_unavailable/)
})
