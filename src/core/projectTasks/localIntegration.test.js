'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process')
const {createTasks}=require('./service'),{createRegistry}=require('./contract'),{createRunStore}=require('../operating/runStore'),{createStore}=require('../../actions/store'),{createRepositoryBudget}=require('./repositoryBudget'),{createInventory}=require('./repositoryScope'),usage=require('../../actions/usageBudget'),{digest}=require('../../workers/execution/windowsSandbox'),{createProjectWork}=require('../projectWork/service')
const OWNER={id:'owner',role:'owner'}
const generated={testCode:"const test=require('node:test'),assert=require('node:assert/strict');\n"+[1,2,3].map(value=>`test('returns increment ${value}',()=>assert.equal(require('../src/logic.js')(${value}),${value+1}));`).join('\n'),expectedTests:3}
function fixture(t,{visible=false,failure=false,draftResult=null,structured=false,exampleSource=false,selectedFiles=null,reviewResult=null,sourceLogic='module.exports=value=>value;\n'}={}){
 const appProjectRoot='C:/isolated-app-project'
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'repository-flow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'repo');fs.mkdirSync(path.join(root,'src'),{recursive:true});fs.writeFileSync(path.join(root,'src/logic.js'),sourceLogic);fs.writeFileSync(path.join(root,'src/readonly.js'),'module.exports=true;\n')
 if(exampleSource){const saved=require('../../../test/localBrain/fixtures/case-baseline-native-v1.json');selectedFiles=JSON.parse(JSON.parse(saved.draftInputRaw).messages.find(m=>m.role==='user').content).files}
 for(const [name,text]of Object.entries(selectedFiles||{})){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text)}
 const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init');git('add','src');git('-c','user.name=Offline Test','-c','user.email=offline@example.invalid','-c','core.hooksPath=','commit','-m','offline fixture');const head=git('rev-parse','HEAD')
 const inventory=createInventory({root,health:async()=>({status:'ok',bootCommit:head})}),store=createRunStore({dir:path.join(dir,'tasks'),workflow:'project_task'}),workStore=createRunStore({dir:path.join(dir,'work'),workflow:'project_work'}),budget=createRepositoryBudget({dir:path.join(dir,'usage'),modeFor:id=>store.get(id)?.input.execution,runtimeCommit:()=>head}),locks=createStore({dir:path.join(dir,'locks')});let promotion=0,work
 let sends=0,cloud=0,sandboxRuns=0;const events=[],selection=require('../../workers/execution/localCodingProvider').SELECTION
 const local=require('../workerFlow/localProviders').createLocalProviders({root:path.join(dir,'local-work'),onEvent:e=>events.push(e),executor:{readiness:async()=>({ready:true}),isBusy:()=>false,run:async pack=>{sandboxRuns++;assert.deepEqual(pack.tests,['acceptance/registered-task.test.cjs']);assert.equal(pack.files[pack.tests[0]],generated.testCode);assert.equal(pack.files['src/readonly.js'],'module.exports=true;\n');return sandboxRuns===1?{exitCode:1,total:3,failed:3,passed:0,skipped:0,cancelled:0}:{exitCode:0,total:3,passed:3,failed:0,skipped:0,cancelled:0}}},fetchFn:async(url,o)=>{
  assert.ok(url.startsWith('http://127.0.0.1:11435/'));assert.equal(o.redirect,'error');if(url.endsWith('/api/tags'))return{ok:true,json:async()=>({models:[{name:'qwen3.5:9b',digest:selection.digest}]})}
  assert.ok(url.endsWith('/api/chat'));sends++;if(failure)throw Error('simulated transport failure');const body=JSON.parse(o.body);assert.equal(body.model,'qwen3.5:9b');assert.equal(body.think,false)
  let reply=sends===1?(draftResult||generated):sends===3?{changes:[{file:'src/logic.js',content:'module.exports=value=>value+1;\n'}],summary:'Increment only'}:{verdict:'pass',summary:'Contract checked',findings:[]}
  if(sends===1&&structured){const p=JSON.parse(body.messages.find(v=>v.role==='user').content),spec=p.draftContract.casePlan
   assert.ok(body.messages[0].content.includes('CASE FIELD GUIDE'));assert.ok(body.messages[0].content.includes('BigInt(Number.MAX_SAFE_INTEGER)'))
   const row=body.format.properties.tests.properties.c1.properties.groups.items.properties.rows.items;assert.equal(row.minItems,2);assert.ok(row.description.includes('slot 1'));assert.ok(row.items.description.includes('quoted'))
   reply={protocol:spec.version,tests:Object.fromEntries(spec.tests.map((v,i)=>[v.id,{title:'Synthetic structured '+i,groups:[{method:'equal',rows:[[String(i+1),String(i+2)]]}],rejections:Object.fromEntries(v.rejections.map(r=>[r.id,[r.expression,r.error]]))}]))};if(structured==='missing')delete reply.tests.c3.rejections.r1}
  if(sends===2&&reviewResult){reply=reviewResult(JSON.parse(body.messages.find(v=>v.role==='user').content));}
  else if(sends===2){const packet=JSON.parse(body.messages.find(v=>v.role==='user').content),anchor=packet.target.files[0].lines.find(l=>l.kind==='assertion').anchorId;assert.equal(packet.stage,'test_draft');assert.equal(packet.target.files[0].lines[0].text,structured?"'use strict'":generated.testCode.split('\n')[0]);assert.equal(packet.baseline.role,'unchanged_reference_expected_to_fail');reply={...reply,binding:packet.binding,coverage:packet.criteria.map(v=>({criterion:v.id,status:'covered',checks:v.checks.map(check=>({id:check.id,status:'covered',anchors:[anchor],reason:'Offline increment check.'}))})),baseline:{expectation:'expected_failure',anchor,reason:'Unchanged identity function fails the increment assertion.'}}}
  return{ok:true,body:(async function*(){yield Buffer.from(JSON.stringify({message:{content:typeof reply==='string'?reply:JSON.stringify(reply)},done:true,prompt_eval_count:20,eval_count:10})+'\n')})()}
 }})
 const never=new Proxy({}, {get:()=>()=>{cloud++;throw Error('CLOUD MUST NOT RUN')}})
 const registry=createRegistry(store),source=require('../projectWork/source').createSource({root,resolveRecipe:registry.resolve,health:async()=>({status:'ok',bootCommit:head})})
 const makeWork=()=>work=createProjectWork({source,providers:never,localProviders:local,store:workStore,visibleCodexWork:visible,appProjectRoot,resolveCodexThread:id=>store.get(id)?.codexThread||null,enabled:()=>true,resolveRecipe:registry.resolve,repositoryBudget:budget,onAccepted:()=>{promotion++}});makeWork()
 const options={store,localProviders:local,visibleCodexWork:visible,appProjectRoot,enabled:()=>true,sourceFor:inventory.sourceFor,provider:never,review:never.review,prepareWork:input=>work.prepare(OWNER,input),repository:{inventory,budget,lock:()=>locks.lockRun('d970a642-61b1-47a1-8baf-6b33e910ac05'),provider:never}}
 return{get sends(){return sends},get cloud(){return cloud},get sandboxRuns(){return sandboxRuns},events,dir,root,head,store,workStore,budget,inventory,sourceFor:inventory.sourceFor,make:(extra={})=>createTasks({...options,...extra,repository:{...options.repository,...extra.repository}}),makeWork,get work(){return work},get promotion(){return promotion}}
}

// These transport/executor doubles verify composition only. Real OS Sandbox
// boundaries and corrected example behavior have separate retained evidence.
test('local registered work uses one real adapter/budget through all approvals, without any cloud or App thread',async t=>{
 const f=fixture(t,{visible:true}),tasks=f.make(),c=require('../../subscription/controlledDispatch').createControlledDispatch({projectTasks:tasks,projectWork:f.work,bootCommit:f.head,enabled:()=>true,localEnabled:()=>true,subscriptionReady:()=>false,executionReady:()=>true})
 const call=(target,input)=>c.handle(OWNER,{target,input}),goal='Repair increment; isolated Node only',request={op:'request',execution:'local',bootCommit:f.head,requestId:randomUUID(),goal}
 const id=(await call('task',request)).run.id;assert.equal((await call('task',{...request,requestId:randomUUID()})).run.id,id);assert.equal(f.sends,0)
 await assert.rejects(call('task',{...request,execution:undefined,requestId:randomUUID()}),/invalid_request/)
 assert.throws(()=>tasks.request(OWNER,{bootCommit:f.head,requestId:request.requestId,goal}),/request_conflict/)
 const scoped=await call('task',{op:'scope',id,bootCommit:f.head,criteria:['Return increment','Preserve read-only dependency'],editable:['src/logic.js'],readonly:['src/readonly.js']})
 assert.equal(scoped.run.scopeMaterial.usage.model,'qwen3.5:9b');assert.equal(f.budget.status(id).state,'not_activated')
 await call('task',{op:'authorize',id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled();const ready=tasks.get(OWNER,id);assert.equal(ready.run.state,'awaiting_approval',JSON.stringify(ready.run));assert.equal(f.sends,2);assert.equal(ready.run.codexThread,undefined)
 assert.equal(ready.run.acceptanceReview.billing,'local');assert.equal(f.budget.status(id).helper.dispatched,2)
 await call('task',{op:'approve',id,hash:ready.approval.hash,nonce:ready.approval.nonce});const prepared=await call('task',{op:'prepare',id,requestId:randomUUID()}),wid=prepared.work.run.id
 f.work.approve(OWNER,{id:wid,hash:prepared.work.approval.hash,nonce:prepared.work.approval.nonce});await f.work.settled();const r=f.work.get(OWNER,wid)
 assert.equal(r.state,'completed',JSON.stringify(r));assert.equal(r.result.billing,'local');assert.equal(r.result.model,'local:qwen3.5:9b');assert.equal(r.repositoryPromotion.state,'held');assert.equal(r.codexThread,undefined);assert.equal(f.promotion,0);assert.equal(f.cloud,0);assert.equal(f.sends,4);assert.equal(f.sandboxRuns,2)
 assert.deepEqual(f.events.filter(e=>e.type==='model_start').map(e=>e.phase),['local_test_draft','local_test_review','local_coding','local_code_review']);assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.dispatched,4)
 assert.equal(fs.readFileSync(path.join(f.root,'src/logic.js'),'utf8'),'module.exports=value=>value;\n')
 const bytes=fs.readFileSync(path.join(f.dir,'usage',id+'.json'));assert.equal(createRepositoryBudget({dir:path.join(f.dir,'usage'),modeFor:()=> 'local',runtimeCommit:()=>f.head}).status(id).helper.dispatched,4);assert.deepEqual(fs.readFileSync(path.join(f.dir,'usage',id+'.json')),bytes)
 await assert.rejects(f.work.prepareRecovery(OWNER,{id:wid,requestId:randomUUID(),bootCommit:f.head}),/recovery_unavailable/)
})
test('local transport failure is preserved, counted once and pauses the same root without subscription fallback',async t=>{
 const f=fixture(t,{failure:true}),tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:'Repair increment',execution:'local'}).run.id
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:['Increment'],editable:['src/logic.js'],readonly:[]});await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const r=tasks.get(OWNER,id).run;assert.equal(r.state,'failed');assert.equal(r.reason,'local_transport_or_protocol_error');assert.equal(f.budget.status(id).state,'paused');assert.equal(f.sends,1);assert.equal(f.cloud,0);assert.equal(f.budget.status(id).helper.dispatched,1)
})

test('local draft validation failure records a safe stage before review and pauses without another call',async t=>{
 const rejected={...generated,expectedTests:4,testCode:generated.testCode+'\n// rejected-private-marker'}
 const f=fixture(t,{draftResult:rejected}),tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:'Repair increment',execution:'local'}).run.id
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:['Increment'],editable:['src/logic.js'],readonly:[]})
 await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const r=tasks.get(OWNER,id).run
 assert.equal(r.state,'failed');assert.equal(r.reason,'invalid_worker_result');assert.equal(r.draftValidation.reason,'test_count')
 assert.equal(r.draftValidation.stage,'local_test_draft');assert.equal(r.draftValidation.attempt,1)
 assert.equal(r.draftValidation.expectedTests,3);assert.equal(r.draftValidation.declaredTests,4);assert.equal(r.draftValidation.observedTests,3)
 assert.ok(r.steps.some(s=>s.stage==='draft_invalid'&&s.facts.reason==='test_count'));assert.ok(!r.steps.some(s=>s.stage==='reviewing'))
 assert.equal(JSON.stringify(r).includes('rejected-private-marker'),false);assert.equal(r.registration,null)
 assert.equal(f.sends,1);assert.equal(f.cloud,0);assert.equal(f.sandboxRuns,0);assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.dispatched,1)
})
test('missing direct named assertion form stops after one local draft send and preserves the shared root',async t=>{
 const rejected={testCode:"const test=require('node:test'),assert=require('node:assert/strict');\nconst {increment}=require('../src/logic.js');\n"+[1,2,3].map(v=>`test('case ${v}',()=>assert.equal(increment(${v}),${v+1}));`).join('\n'),expectedTests:3}
 const f=fixture(t,{sourceLogic:'module.exports={increment:value=>value};\n',draftResult:rejected}),tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:'Repair increment',execution:'local'}).run.id
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:['Exercise increment'],editable:['src/logic.js'],readonly:[]});await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const r=tasks.get(OWNER,id).run;assert.equal(r.state,'failed');assert.equal(r.reason,'invalid_worker_result');assert.equal(r.draftValidation.reason,'assertion_form');assert.equal(r.draftValidation.missingForms,1);assert.equal(r.draftValidation.stage,'local_test_draft');assert.equal(r.registration,null);assert.ok(!r.steps.some(s=>s.stage==='reviewing'));assert.equal(f.sends,1);assert.equal(f.cloud,0);assert.equal(f.sandboxRuns,0);assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.dispatched,1)
})

test('structured local draft retains raw evidence and provenance through exact test approval, before any coding',async t=>{
 const f=fixture(t,{structured:true,sourceLogic:'module.exports={increment};function increment(value){return value}\n'}),tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:'Repair increment(value)',execution:'local'}).run.id
 const criteria=["Require require('../src/logic.js').increment(1) to return 2", "Require require('../src/logic.js').increment(2) to return 3", "Require require('../src/logic.js').increment(3) to return 4; Reject -1 with RangeError"]
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria,editable:['src/logic.js'],readonly:[]});await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const ready=tasks.get(OWNER,id),r=ready.run;assert.equal(r.state,'awaiting_approval',JSON.stringify(r));assert.equal(f.sends,2);assert.equal(f.cloud,0);assert.equal(f.sandboxRuns,0)
 assert.equal(r.draftOrigin.protocol,'local_case_plan_v1');assert.equal(r.draftOrigin.modelAuthoredJavaScript,false);assert.equal(r.draftOrigin.testsExecuted,false);assert.deepEqual(r.acceptanceReview.reviewBasis.draftOrigin,r.draftOrigin)
 assert.ok(r.steps.some(s=>s.stage==='draft_rendered'&&s.facts.rawOutputSha256===r.draftOrigin.rawOutputSha256));assert.ok(ready.approval.hash);assert.equal(r.workRunId,null)
 const hash=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');assert.equal(hash(r.generated.testCode),r.draftOrigin.renderedTestSha256)
 const evidenceDir=path.join(f.dir,'usage','evidence'),evidence=fs.readdirSync(evidenceDir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(evidenceDir,n),'utf8')))
 const raw=evidence.find(v=>v.text?.includes('local_case_plan_v1'));assert.ok(raw,JSON.stringify(evidence.map(v=>Object.keys(v))));assert.equal(hash(raw.text),r.draftOrigin.rawOutputSha256);assert.equal(JSON.parse(raw.text).testCode,undefined)
 tasks.cancel(OWNER,id);assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.dispatched,2)
})

test('missing structured boundary stops after one raw local send, without review, coding or automatic retry',async t=>{
 const f=fixture(t,{structured:'missing',sourceLogic:'module.exports={increment};function increment(value){return value}\n'}),tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:'Repair increment(value)',execution:'local'}).run.id
 const criteria=["Require require('../src/logic.js').increment(1) to return 2", "Require require('../src/logic.js').increment(2) to return 3", "Require require('../src/logic.js').increment(3) to return 4; Reject -1 with RangeError"]
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria,editable:['src/logic.js'],readonly:[]});await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const r=tasks.get(OWNER,id).run;assert.equal(r.state,'failed');assert.equal(r.reason,'invalid_worker_result');assert.equal(r.draftValidation.reason,'case_plan_boundary');assert.equal(r.draftOrigin,undefined);assert.equal(r.registration,null);assert.equal(f.sends,1);assert.equal(f.cloud,0);assert.equal(f.sandboxRuns,0);assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.dispatched,1);assert.ok(!r.steps.some(s=>s.stage==='reviewing'))
})

test('retained PR187 incomplete draft stops the registered flow after one offline send and pauses its temporary root',async t=>{
 const saved=require('../../../test/localBrain/fixtures/case-baseline-native-v1.json'),packet=JSON.parse(JSON.parse(saved.draftInputRaw).messages.find(m=>m.role==='user').content),raw=JSON.parse(saved.draftOutputRaw).text
 const f=fixture(t,{exampleSource:true,draftResult:raw}),tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:packet.goal,execution:'local'}).run.id
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:packet.criteria,editable:['src/localBrain/examples/duration.js'],readonly:['src/localBrain/examples/stock.js','src/localBrain/examples/examples.test.js']})
 await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const r=tasks.get(OWNER,id).run;assert.equal(r.state,'failed');assert.equal(r.draftValidation.reason,'case_plan_baseline_coverage');assert.equal(r.draftValidation.missingBaselineCases,20);assert.equal(r.draftValidation.wrongBaselineExpectedValues,1)
 assert.equal(r.registration,null);assert.equal(r.workRunId,null);assert.equal(f.sends,1);assert.equal(f.cloud,0);assert.equal(f.sandboxRuns,0);assert.ok(!r.steps.some(s=>s.stage==='reviewing'));assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.dispatched,1)
 const evidenceDir=path.join(f.dir,'usage','evidence'),evidence=fs.readdirSync(evidenceDir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(evidenceDir,n),'utf8')))
 assert.ok(evidence.some(e=>e.text===raw));assert.equal(r.draftOrigin,undefined)
})

test('retained PR190 tail-comma draft remains rejected with reference input, one temporary send and no review',async t=>{
 const saved=require('../../../test/localBrain/fixtures/case-atomic-native-v1.json'),packet=JSON.parse(JSON.parse(saved.inputRaw).messages.find(m=>m.role==='user').content),raw=JSON.parse(saved.outputRaw).text
 const f=fixture(t,{exampleSource:true,draftResult:raw}),tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:packet.goal,execution:'local'}).run.id
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:packet.criteria,editable:['src/localBrain/examples/duration.js'],readonly:['src/localBrain/examples/stock.js','src/localBrain/examples/examples.test.js']})
 await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const r=tasks.get(OWNER,id).run;assert.equal(r.state,'failed');assert.equal(r.draftValidation.reason,'case_plan_expression');assert.equal(r.registration,null);assert.equal(r.workRunId,null)
 assert.equal(f.sends,1);assert.equal(f.cloud,0);assert.equal(f.sandboxRuns,0);assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.dispatched,1);assert.ok(!r.steps.some(s=>s.stage==='reviewing'))
 const evidenceDir=path.join(f.dir,'usage','evidence'),evidence=fs.readdirSync(evidenceDir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(evidenceDir,n),'utf8'))),record=evidence.find(e=>e.messages)
 const sent=JSON.parse(record.messages.find(m=>m.role==='user').content);assert.equal(sent.draftContract.baselineContract.referenceCases.reduce((n,t)=>n+t.cases.length,0),52)
 assert.ok(evidence.some(e=>e.text===raw));assert.equal(r.draftOrigin,undefined)
})

test('saved PR191 failures stop at the actual draft or review gate and pause the temporary root', async t => {
 const archive=require('../../../test/localBrain/fixtures/clock-exact-red-native-v1.json').evidence
 const nativeDraft=JSON.parse(archive['draft-output'].raw).text
 const nativeReview=JSON.parse(JSON.parse(archive['review-output'].raw).text)
 const packet=JSON.parse(JSON.parse(archive['draft-input'].raw).messages.find(message=>message.role==='user').content)
 for(const phase of ['draft','review'])await t.test(phase,async child=>{
  // The review control corrects only the bad case in an in-memory copy so
  // the saved old-anchor response can reach its own independent gate.
  const draftResult=phase==='draft'?nativeDraft:nativeDraft.replace('25019998757901m 36s','2501999792983:36:31')
  const f=fixture(child,{exampleSource:true,draftResult,reviewResult:sent=>({...nativeReview,binding:sent.binding})})
  const tasks=f.make(),id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:packet.goal,execution:'local'}).run.id
  const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:packet.criteria,editable:['src/localBrain/examples/duration.js'],readonly:['src/localBrain/examples/stock.js','src/localBrain/examples/examples.test.js']})
  await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
  const record=tasks.get(OWNER,id)
  assert.equal(record.run.state,'failed');assert.equal(record.approval,null);assert.equal(record.run.workRunId,null)
  assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.unresolved,0)
  assert.equal(f.cloud,0);assert.equal(f.sandboxRuns,0)
  if(phase==='draft'){assert.equal(record.run.draftValidation.reason,'case_plan_new_expected');assert.equal(f.sends,1)}
  else{assert.equal(record.run.reviewValidation.stage,'red_anchor');assert.equal(f.sends,2)}
 })
})


test('saved stock variance draft stops before review and leaves the isolated work budget paused', async t => {
 const archive=require('../../../test/localBrain/fixtures/stock-case-proof-native-v1.json').evidence
 const packet=JSON.parse(JSON.parse(archive['draft-input'].raw).messages.find(message=>message.role==='user').content)
 const raw=JSON.parse(archive['draft-output'].raw).text
 const f=fixture(t,{selectedFiles:packet.files,draftResult:raw}),tasks=f.make()
 const id=tasks.request(OWNER,{bootCommit:f.head,requestId:randomUUID(),goal:packet.goal,execution:'local'}).run.id
 const scoped=await tasks.scope(OWNER,{id,bootCommit:f.head,criteria:packet.criteria,editable:Object.keys(packet.files),readonly:[]})
 await tasks.authorize(OWNER,{id,hash:scoped.approval.hash,nonce:scoped.approval.nonce});await tasks.settled()
 const value=tasks.get(OWNER,id),record=value.run
 assert.equal(record.state,'failed');assert.equal(value.approval,null);assert.equal(record.workRunId,null)
 assert.equal(record.draftValidation.reason,'case_plan_baseline_coverage');assert.equal(record.draftValidation.missingBaselineCases,18)
 assert.equal(f.sends,1);assert.equal(f.cloud,0);assert.equal(f.sandboxRuns,0)
 assert.equal(f.budget.status(id).state,'paused');assert.equal(f.budget.status(id).helper.unresolved,0)
 const evidenceDir=path.join(f.dir,'usage','evidence')
 const evidence=fs.readdirSync(evidenceDir).map(name=>JSON.parse(fs.readFileSync(path.join(evidenceDir,name),'utf8')))
 const sent=JSON.parse(evidence.find(v=>v.messages).messages.find(message=>message.role==='user').content)
 assert.deepEqual(sent.draftContract.baselineContract.referenceCases.map(v=>v.cases.length),[7,28])
 assert.equal(sent.draftContract.newExampleContract.rejectionCases.length,12)
 assert.ok(evidence.some(entry=>entry.text===raw))
})
