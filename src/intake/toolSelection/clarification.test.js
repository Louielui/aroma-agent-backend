'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { randomUUID } = require('node:crypto')
const { fixture, read, MODEL } = require('../../../scripts/u2/fixture.cjs')
const { createSelectionTaskRunner } = require('./taskRunner')
const { createStore } = require('../../browserRead/store'), { createBrowserRead } = require('../../browserRead/service')
const { createUnifiedIntake } = require('../unifiedIntake'), tasks = require('../../store/store')

function setup({ resource = 'drive.company_files', choice = 2, beforeRead, onEvent, complete, synthesize = false } = {}) {
  const f = fixture({ beforeRead, proposal: { ...read(resource + '.search', { query: 'tea' }), dependency: { from: 0, id: resource + '.get', result: 'sourceId' } }, complete: async (prompt, options) => {
    if (complete) return complete(prompt, options)
    if (options.invocationPhase === 'clarification') return { model: MODEL, text: JSON.stringify({ choice }) }
    if (options.invocationPhase === 'evidence_review') return { model: MODEL, billing: 'chatgpt-subscription', text: JSON.stringify({ reviews: [{ id: 'c1', decision: 'supported', reason: 'matches_reference' }] }) }
    if (options.invocationPhase === 'result_synthesis') return { model: MODEL, billing: 'chatgpt-subscription', text: JSON.stringify({ claims: [{ id: 'c1', text: 'Steep for 7 minutes.', kind: 'observation', evidenceState: 'supported', temporalScope: 'historical', references: [{ sourceId: 'S1', recordId: 'r1', field: 'content', value: 'Steep for 7 minutes.' }] }] }) }
    return { model: MODEL, text: JSON.stringify({ ...read(resource + '.search', { query: 'tea' }), dependency: { from: 0, id: resource + '.get', result: 'sourceId' } }) }
  } })
  f.rows[resource] = [{ id: 'fixture_first', title: 'Green tea', text: 'Tea discovery index.', fields: { synthetic: true } }, { id: 'fixture_second', title: 'Black tea', text: 'Tea discovery index.', fields: { synthetic: true } }]
  f.detailRows[resource] = f.rows[resource].map(r => ({ ...r, text: 'Steep for 7 minutes.' }))
  f.context.synthesisSharing = true
  if(synthesize)f.model.billing='chatgpt-subscription' // Simulated contract adapter, never a real model receipt.
  const readsDir=fs.mkdtempSync(path.join(os.tmpdir(), 'u3b-reads-')), reads = createStore(readsDir)
  const intake = createUnifiedIntake({ store: tasks, reads, enabled: () => true })
  const runner = createSelectionTaskRunner({ bindings: f.bindings, authorize: f.authorize, evidenceMode: 'synthetic_fixture', synthesizeResults: synthesize, dependentReads: true, clarificationEnabled: true })
  const observed = { ...runner, run(a) { return runner.run({ ...a, onEvent(e) { a.onEvent(e); onEvent?.(e, f) } }) } }
  const restart = () => createBrowserRead({ store: reads, selection: () => ({ model: MODEL, effort: 'high' }), provider: () => f.model, taskRunner: observed, unifiedIntake: intake })
  const browser = restart()
  const start = { version: 1, operation: 'start', clientSubmissionId: randomUUID(), message: 'Find the tea record, read it and summarize it.', conversationId: f.context.conversationId, taskRef: null, expectedRevision: null, contextRefs: [] }
  const view = id => intake.view(id, { principal: 'owner', surface: 'main' })
  const response = (v, text = '請讀第二份') => ({ version: 1, operation: 'clarification_response', clientSubmissionId: randomUUID(), conversationId: f.context.conversationId, taskRef: v.taskId, expectedRevision: v.revision, clarificationId: v.clarification.id, response: text })
  return { ...f, reads, readsDir, intake, runner, browser, restart, start, view, response, resource }
}

test('U3-B persists waiting, resumes the same Task/Goal and binds the second ID through three actual reads', async () => {
  const f = setup({ synthesize: true }), first = await f.browser.handleMain(f.start), v = f.view(first.unifiedTask.taskId)
  assert.equal(v.executionState, 'WAITING_CLARIFICATION'); assert.equal(f.calls.length, 1)
  const answer = await f.browser.handleMain(f.response(v)), after = f.view(v.taskId)
  assert.equal(answer.state, 'completed'); assert.equal(after.executionState, 'CLARIFICATION_COMPLETED')
  assert.equal(after.goalId, v.goalId); assert.equal(after.objective, f.start.message)
  assert.notEqual(answer.unifiedTask.attemptId, first.unifiedTask.attemptId)
  assert.deepEqual(f.calls.map(c => c.operation), ['search', 'search', 'get'])
  assert.equal(Object.values(f.calls[2].input)[0], 'fixture_second')
  assert.match(answer.result.text, /7 minutes/); assert.notEqual(after.goalStatus, 'GOAL_COMPLETED')
})

test('U3-B generic continuation also reads an Aroma record and English reply', async () => {
  const f = setup({ resource: 'aroma.invoices', choice: 1 }), r = await f.browser.handleMain(f.start)
  await f.browser.handleMain(f.response(f.view(r.unifiedTask.taskId), 'The first one, please.'))
  assert.deepEqual(f.calls[2].input, { sourceId: 'fixture_first' })
})

test('U3-B ambiguous reply reissues a generation without reads; a changed choice can then continue', async () => {
  let choice = null
  const f = setup({ complete: async (p, o) => ({ model: MODEL, text: JSON.stringify(o.invocationPhase === 'clarification' ? { choice } : { ...read('drive.company_files.search', { query: 'tea' }), dependency: { from: 0, id: 'drive.company_files.get', result: 'sourceId' } }) }) })
  const first = await f.browser.handleMain(f.start), v = f.view(first.unifiedTask.taskId), b = f.response(v, 'That one')
  await f.browser.handleMain(b)
  const waiting = f.view(v.taskId); assert.equal(waiting.executionState, 'WAITING_CLARIFICATION'); assert.notEqual(waiting.clarification.id, v.clarification.id)
  assert.equal(f.calls.length, 1); choice = 1
  await assert.rejects(f.browser.handleMain({ ...b, clientSubmissionId: randomUUID() }))
  await f.browser.handleMain(f.response(waiting, 'Actually the first one.'))
  assert.equal(Object.values(f.calls[2].input)[0], 'fixture_first')
})

for (const change of ['missing', 'changed', 'order', 'duplicate', 'revoked']) test('U3-B fails closed for ' + change + ' before detail', async () => {
  const f = setup(), first = await f.browser.handleMain(f.start), v = f.view(first.unifiedTask.taskId)
  if (change === 'missing') f.rows[f.resource].pop()
  if (change === 'changed') f.rows[f.resource][1].text = 'Changed discovery content'
  if (change === 'order') f.rows[f.resource].reverse()
  if (change === 'duplicate') f.rows[f.resource][1].id = f.rows[f.resource][0].id
  if (change === 'revoked') f.versions.drive++
  const reply=f.response(v)
  try { await f.browser.handleMain(reply) } catch (_) {}
  assert.equal(f.calls.filter(c => c.operation === 'get').length, 0)
  assert.notEqual(f.view(v.taskId).executionState, 'CLARIFICATION_COMPLETED')
  if(change!=='revoked'){assert.equal(f.calls.length,2);assert.equal(f.view(v.taskId).executionState,'CLARIFICATION_FAILED');await assert.rejects(f.browser.handleMain({...reply,clientSubmissionId:randomUUID()}))}
})

test('U3-B concurrent, duplicate and replayed replies execute at most one detail', async () => {
  const f = setup(), first = await f.browser.handleMain(f.start), v = f.view(first.unifiedTask.taskId), b = f.response(v)
  await Promise.allSettled([f.browser.handleMain(b), f.browser.handleMain(b), f.browser.handleMain({ ...b, clientSubmissionId: randomUUID() })])
  const n = f.calls.length; await f.browser.handleMain(b)
  assert.equal(f.calls.length, n); assert.equal(f.calls.filter(c => c.operation === 'get').length, 1)
})

test('U3-B waiting cancellation is durable and prevents reply execution', async () => {
  const f = setup(), r = await f.browser.handleMain(f.start), v = f.view(r.unifiedTask.taskId)
  f.intake.cancelClarification(v.taskId, v.revision, v.attemptId, { principal: 'owner', surface: 'main' })
  assert.equal(f.view(v.taskId).executionState, 'CLARIFICATION_CANCELLED')
  await assert.rejects(f.browser.handleMain(f.response(v))); assert.equal(f.calls.length, 1)
})

test('U3-B restart retains waiting without executing; explicit new Owner response can resume', async () => {
  const f = setup(), r = await f.browser.handleMain(f.start), v = f.view(r.unifiedTask.taskId), again = f.restart()
  assert.equal(f.view(v.taskId).executionState, 'WAITING_CLARIFICATION'); assert.equal(f.calls.length, 1)
  await again.handleMain(f.response(v)); assert.equal(f.calls.length, 3)
})

test('U3-B malicious model identity and extra fields cannot become an execution target', async () => {
  const f = setup({ complete: async (p, o) => ({ model: MODEL, text: JSON.stringify(o.invocationPhase === 'clarification' ? { choice: 2, sourceId: 'stolen' } : { ...read('drive.company_files.search', { query: 'tea' }), dependency: { from: 0, id: 'drive.company_files.get', result: 'sourceId' } }) }) })
  const r = await f.browser.handleMain(f.start)
  await f.browser.handleMain(f.response(f.view(r.unifiedTask.taskId)))
  assert.equal(f.calls.length, 1); assert.equal(f.view(r.unifiedTask.taskId).executionState, 'CLARIFICATION_FAILED')
})

test('U3-B current session/scope/sharing revocation and cancellation after verification stop detail',async()=>{
 for(const kind of ['role','principal','sharing','source','authorization','cancel']){
  let f
  f=setup({onEvent(e){if(e.stage==='u3_dependency_resolved'){
   if(kind==='role')f.context.actor.role='browser_service'
   if(kind==='principal')f.context.actor.id='another_owner'
   if(kind==='sharing')f.context.providerSharing=false
   if(kind==='source')f.context.sources=[]
   if(kind==='authorization')f.versions.drive++
   if(kind==='cancel'){const v=f.view(f.reads.all().find(r=>r.state==='processing').unifiedTask.taskId);f.intake.cancelClarification(v.taskId,v.revision,v.attemptId,{principal:'owner',surface:'main'})}
  }}})
  const r=await f.browser.handleMain(f.start),v=f.view(r.unifiedTask.taskId)
  await f.browser.handleMain(f.response(v));assert.equal(f.calls.length,2,kind);assert.equal(f.calls.some(c=>c.operation==='get'),false)
 }
})

test('U3-B cancellation at the final read-attempt receipt stops dispatch even after budget reservation',async()=>{
 let f
 f=setup({onEvent(e){if(e.stage==='u2_read_started'&&e.tool.endsWith('.get')){const v=f.view(f.reads.all().find(r=>r.state==='processing').unifiedTask.taskId);f.intake.cancelClarification(v.taskId,v.revision,v.attemptId,{principal:'owner',surface:'main'})}}})
 const r=await f.browser.handleMain(f.start),v=f.view(r.unifiedTask.taskId)
 await f.browser.handleMain(f.response(v));assert.equal(f.calls.length,2);assert.equal(f.view(v.taskId).executionState,'CLARIFICATION_CANCELLED')
})

test('U3-B actual new Node process observes durable waiting and interrupts a claimed-but-unstarted attempt without provider calls',async()=>{
 const f=setup(),r=await f.browser.handleMain(f.start),v=f.view(r.unifiedTask.taskId)
 const cp=require('node:child_process'),root=path.resolve(__dirname,'../../..')
 const restart=()=>JSON.parse(cp.execFileSync(process.execPath,['-e',`
  const root=${JSON.stringify(root)},reads=require(root+'/src/browserRead/store').createStore(${JSON.stringify(f.readsDir)}),tasks=require(root+'/src/store/store');
  const intake=require(root+'/src/intake/unifiedIntake').createUnifiedIntake({store:tasks,reads,enabled:()=>true});
  require(root+'/src/browserRead/service').createBrowserRead({store:reads,selection:()=>{throw Error('unexpected_selection')},provider:()=>{throw Error('unexpected_model')},taskRunner:{clarificationEnabled:true},unifiedIntake:intake});
  console.log(JSON.stringify(intake.view(${JSON.stringify(v.taskId)},{principal:'owner',surface:'main'})));
 `],{env:process.env,encoding:'utf8',windowsHide:true}))
 assert.equal(restart().executionState,'WAITING_CLARIFICATION');assert.equal(f.calls.length,1)
 const b=f.response(v),binding=f.intake.reserve(b,{principal:'owner',surface:'main',scope:f.runner.describe(),sourceHash:null})
 assert(binding.attemptId);assert.equal(restart().executionState,'CLARIFICATION_INTERRUPTED');assert.equal(f.calls.length,1)
 await assert.rejects(f.browser.handleMain(b));await assert.rejects(f.browser.handleMain({...b,clientSubmissionId:randomUUID()}));assert.equal(f.calls.length,1)
 const current=f.view(v.taskId)
 const fresh=await f.browser.handleMain({...f.start,operation:'continue',clientSubmissionId:randomUUID(),taskRef:v.taskId,expectedRevision:current.revision})
 assert.equal(fresh.unifiedTask.taskId,v.taskId);assert.equal(fresh.unifiedTask.goalId,v.goalId);assert.equal(f.calls.length,2)
})

test('U3-B damaged cross-store evidence blocks continuation and remains reconciliation-required after restart',async()=>{
 const f=setup(),r=await f.browser.handleMain(f.start),v=f.view(r.unifiedTask.taskId),original=f.reads.get(r.id)
 f.reads.save({...original,result:{...original.result,text:'Modified evidence',taskEvidence:{...original.result.taskEvidence,extra:'changed'}}})
 await assert.rejects(f.browser.handleMain(f.response(v)));assert.equal(f.calls.length,1)
 f.restart();assert.equal(f.view(v.taskId).executionState,'CLARIFICATION_RECONCILIATION_REQUIRED')
 f.reads.save(original);f.restart();assert.equal(f.view(v.taskId).executionState,'CLARIFICATION_RECONCILIATION_REQUIRED')
})

test('U3-B missing completion commit is never reported as completed and cannot replay reads',async()=>{
 const f=setup(),r=await f.browser.handleMain(f.start),v=f.view(r.unifiedTask.taskId),b=f.response(v)
 f.intake.finishClarification=()=>{throw Error('simulated_task_store_write_failure')}
 const result=await f.browser.handleMain(b);assert.equal(result.reconciliationRequired,true)
 assert.equal(f.view(v.taskId).executionState,'CLARIFICATION_RECONCILIATION_REQUIRED');assert.equal(f.calls.length,3)
 f.restart();assert.equal(f.view(v.taskId).executionState,'CLARIFICATION_RECONCILIATION_REQUIRED')
 await f.browser.handleMain(b);assert.equal(f.calls.length,3)
})

test('U3-B replay envelope, general objective and Main boundary remain closed',async()=>{
 const f=setup(),r=await f.browser.handleMain(f.start),v=f.view(r.unifiedTask.taskId),b=f.response(v)
 await assert.rejects(f.browser.handleMain({...f.start,operation:'continue',taskRef:v.taskId,expectedRevision:v.revision,message:'second one',clientSubmissionId:randomUUID()}),/new_objective_requires_new_task/)
 assert.throws(()=>f.intake.reserve(b,{principal:'owner',surface:'chrome',scope:f.runner.describe()}),/owner_session_required/)
 await assert.rejects(f.browser.handle({op:'get',id:r.id}),/owner_session_required/)
 await f.browser.handleMain(b)
 for(const mutate of [{response:'First'},{conversationId:randomUUID()},{expectedRevision:b.expectedRevision+1}])await assert.rejects(f.browser.handleMain({...b,...mutate}),/submission_conflict/)
 assert.equal(f.calls.length,3)
})

test('U3-B authenticated HTTP boundary records actual reply under the same Task/Goal; Native bearer alone is denied',async t=>{
 const f=setup(),express=require('express'),app=express(),conversations=require('../../store/conversationStore').createConversationStore({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'u3b-conv-'))})
 app.locals.conversationDemo=true;app.locals.ownerSessions={valid:token=>token==='synthetic-owner-session'}
 app.use(express.json());app.use(require('../unifiedRoutes').createRouter({intake:f.intake,browserRead:f.browser,conversations}))
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const url='http://127.0.0.1:'+server.address().port+'/api/v1/demo/task-intake',cookie=require('../../governance/ownerAuth').SESSION_COOKIE+'=synthetic-owner-session'
 const post=(body,headers={cookie})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
 const start=await (await post(f.start)).json(),v=start.unifiedTask,b=f.response(v)
 const denied=await post(b,{authorization:'Bearer synthetic-native-service-token'});assert.equal(denied.status,403);assert.equal(f.calls.length,1)
 const result=await (await post(b)).json();assert.equal(result.historySaved,true);assert.equal(result.unifiedTask.goalId,v.goalId)
 const history=conversations.get(f.context.conversationId).messages
 assert.equal(history[2].content,b.response);assert.equal(history[3].unifiedTask.goalId,history[1].unifiedTask.goalId);assert.equal(history[3].unifiedTask.taskId,history[1].unifiedTask.taskId)
 assert.equal(f.calls.length,3)
})

test('U3-B closed clarification envelope rejects invented identities, grants, altered versions and overlong replies',()=>{
 const validate=require('../unifiedContract').validate,b={version:1,operation:'clarification_response',clientSubmissionId:randomUUID(),conversationId:randomUUID(),taskRef:'task_'+randomUUID(),expectedRevision:2,clarificationId:randomUUID(),response:'second'}
 assert.deepEqual(validate(b),b)
 for(const altered of [{...b,fileId:'guessed'},{...b,permission:'owner'},{...b,version:2},{...b,response:'x'.repeat(1001)}])assert.throws(()=>validate(altered),/invalid_unified_request/)
})
