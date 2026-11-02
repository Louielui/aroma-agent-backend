'use strict'
// Offline canonical-record and provider-receipt fixtures, never a real dispatch.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto')
const {randomUUID}=crypto,OWNER={id:'owner',role:'owner'},sha=b=>crypto.createHash('sha256').update(b).digest('hex')
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'work-progress-'));t.after(()=>{assert.equal(path.dirname(fs.realpathSync(dir)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());assert.ok(path.basename(dir).startsWith('work-progress-'));fs.rmSync(dir,{recursive:true,force:true})})
 const workerRoot=path.join(dir,'worker'),repoRoot=path.join(dir,'repo'),dataRoot=path.join(dir,'data'),invocationFile=path.join(dir,'invocations/ledger.json')
 for(const p of [workerRoot,repoRoot,dataRoot,path.dirname(invocationFile),...require('./workRecords').FOLDERS.map(p=>path.join(workerRoot,p)),path.join(workerRoot,'project-task-usage'),path.join(dataRoot,'code-diagnosis-runs')])fs.mkdirSync(p,{recursive:true})
 const save=(kind,r)=>fs.writeFileSync(path.join(workerRoot,kind,r.id+'.json'),JSON.stringify(r)),get=()=>require('./workProgress').createProgressReader({workerRoot,repoRoot,dataRoot,invocationFile}).read
 const record=(state='failed')=>({id:randomUUID(),workflow:'project_work',state,reason:state==='failed'?'subscription_unavailable':null,startedAt:'2026-11-01T01:00:00Z',finishedAt:state==='failed'?'2026-11-01T01:01:00Z':null,workOrder:{goal:'A bounded copy change'},steps:[{stage:'approved',at:'2026-11-01T01:00:01Z',facts:{actor:'owner'}},{stage:'coding',at:'2026-11-01T01:00:02Z'}],sections:[],result:null,appliedToLive:false})
 return{dir,workerRoot,repoRoot,dataRoot,invocationFile,save,record,read:options=>get()(options),writeLedger:records=>fs.writeFileSync(invocationFile,JSON.stringify({version:1,coverageStartedAt:'2026-11-01T00:00:00Z',omitted:0,records}))}
}
test('progress lists more than the diagnostic five-record sample without merging identical task titles',async t=>{
 const f=fixture(t),ids=[];for(let i=0;i<12;i++){const r=f.record();ids.push(r.id);f.save('project-runs',r)}f.writeLedger([])
 const v=await f.read({limit:20});assert.equal(v.records.length,12);assert.equal(new Set(v.records.map(r=>r.id)).size,12);assert.equal(v.readOnly,true);assert.ok(v.records.every(r=>r.currentRunning==='unknown'&&r.kind==='project-runs'));assert.equal(v.omitted,0)
})
test('an exact old work ID remains readable beyond scan limits; absent or corrupt sources never become zero work',async t=>{
 const f=fixture(t),target=f.record();target.id='ffffffff-ffff-4fff-8fff-ffffffffffff';f.save('project-runs',target)
 for(let i=0;i<251;i++){const r=f.record();r.id=i.toString(16).padStart(8,'0')+'-0000-4000-8000-000000000000';f.save('project-runs',r)}f.writeLedger([])
 const child=f.record('coding');child.taskRunId=target.id;child.steps.at(-1).at='2026-11-02T01:00:00Z';f.save('project-runs',child)
 const v=await f.read({id:target.id,limit:1});assert.equal(v.records[0].id,target.id);assert.ok(v.coverage.some(c=>c.omitted>0));assert.equal(v.state,'partial')
 fs.writeFileSync(path.join(f.workerRoot,'project-runs',target.id+'.json'),'{bad');const bad=await f.read({id:target.id});assert.equal(bad.lookup,'unavailable');assert.equal(bad.records.length,0)
})
test('actual model receipts require exact worker identities, and a snapshot never rewrites started invocations',async t=>{
 const f=fixture(t),r=f.record('coding'),trace={recordId:r.id,kind:'project-runs',runId:randomUUID(),workId:'work:'+sha(JSON.stringify(['worker/project-runs',r.id])),attempt:1};r.workerRuns=[{trace,startedAt:r.startedAt,state:'unknown',finishedAt:null}];r.model='declared-model';r.source={private:'PRIVATE_SOURCE'};r.review={summary:'PRIVATE_REVIEW'};r.approvalHash='PRIVATE_NONCE';f.save('project-runs',r)
 f.writeLedger([{invocationId:randomUUID(),role:'worker_completion',state:'started',workerTrace:trace,workerPhase:'development',candidateAttempt:1,model:'gpt-6.1-sol',effort:'high',startedAt:r.startedAt,dispatchedAt:'2026-11-01T01:00:03Z',dispatchBasis:'provider_turn_start'}])
 const before=sha(fs.readFileSync(f.invocationFile)),v=await f.read({id:r.id}),row=v.records[0];assert.equal(row.calls.observed,1);assert.equal(row.calls.dispatched,1);assert.equal(row.calls.receipts[0].actualModel,null);assert.equal(row.calls.receipts[0].requestedModel,'gpt-6.1-sol');assert.equal(row.currentRunning,'unknown');assert.equal(sha(fs.readFileSync(f.invocationFile)),before);assert.doesNotMatch(JSON.stringify(v),/PRIVATE_|declared-model/)
})
test('usage comes from the same validated ledger without locking, resetting or activating it',async t=>{
 const f=fixture(t),r=f.record(),rootId=randomUUID();r.workOrder.usageRoot=rootId;r.workOrder.registrationId=rootId;f.save('project-runs',r);f.writeLedger([])
 const usage=require('../actions/usageBudget'),store=require('../actions/store').createStore({dir:path.join(f.workerRoot,'project-task-usage')}),b=usage.createUsageBudget({profile:usage.developmentProfile(rootId),store,activationReady:()=>true});b.handle(OWNER,{op:'usage_activate'});b.handle(OWNER,{op:'usage_bind_turn',turnId:rootId,conversationId:rootId});const s=b.enterTurn(rootId,rootId,rootId);b.withScope(s,()=>{for(let i=0;i<7;i++){const p=b.reserve('helper',{model:'gpt-6.1-sol',effort:'high'});p.dispatched('provider_turn_start');p.finish(null)}})
 const file=path.join(f.workerRoot,'project-task-usage',rootId+'.json'),before=sha(fs.readFileSync(file));const v=await f.read({id:r.id});assert.equal(v.records[0].usage.helper.reserved,7);assert.equal(v.records[0].usage.helper.available,1);assert.equal(sha(fs.readFileSync(file)),before)
 const original={};for(const k of ['writeFileSync','mkdirSync','renameSync','unlinkSync','linkSync']){original[k]=fs[k];fs[k]=()=>{throw Error('unexpected_snapshot_write')}}const cp=require('child_process'),spawn=cp.spawn,exec=cp.execFileSync,http=require('http'),request=http.request;let forbiddenCalls=0;cp.spawn=cp.execFileSync=http.request=()=>{forbiddenCalls++;throw Error('unexpected_model_network_or_process')};try{assert.equal((await f.read({id:r.id})).records[0].usage.state,'validated_snapshot');assert.equal(forbiddenCalls,0)}finally{Object.assign(fs,original);cp.spawn=spawn;cp.execFileSync=exec;http.request=request}
})
test('completion separates test-draft, coding candidate, read-only diagnosis and actual deployment',async t=>{
 const f=fixture(t),r=f.record('completed');r.result={patchHash:'a'.repeat(64),isolatedRunId:randomUUID(),tests:{total:4,passed:4,failed:0,exitCode:0,skipped:0,cancelled:0}};r.review={verdict:'pass'};f.save('project-runs',r);f.writeLedger([])
 const v=await f.read({id:r.id}),row=v.records[0];assert.equal(row.completion.candidateRecorded,true);assert.equal(row.completion.appliedToLive,false);assert.equal(row.completion.liveVerified,false);assert.equal(row.completion.tests.passed,4);assert.equal(row.completion.reviewVerdict,'pass');assert.equal(row.usage.state,'not_bound')
 const d={...f.record('completed'),workflow:'code_diagnosis',verification:{matched:true,citationsVerified:true}};fs.writeFileSync(path.join(f.dataRoot,'code-diagnosis-runs',d.id+'.json'),JSON.stringify(d));assert.equal((await f.read({id:d.id})).records[0].completion.diagnosisVerified,true)
})
test('redirected files, duplicate invocation identities and missing usage are shown as unavailable',async t=>{
 const f=fixture(t),r=f.record();r.workOrder.usageRoot=randomUUID();f.save('project-runs',r);f.writeLedger([]);let v=await f.read({id:r.id});assert.equal(v.records[0].usage.state,'unavailable');assert.equal(v.records[0].usage.helper,null)
 const row={invocationId:randomUUID(),role:'worker_completion',state:'succeeded',model:'gpt-6.1-sol',startedAt:r.startedAt};f.writeLedger([row,row]);assert.equal((await f.read({id:r.id})).invocationCoverage.state,'unavailable')
 const folder=path.join(f.workerRoot,'project-runs'),elsewhere=path.join(f.dir,'outside');assert.equal(path.dirname(elsewhere),f.dir);assert.ok(path.resolve(folder).startsWith(path.resolve(f.dir)+path.sep));fs.renameSync(folder,elsewhere);fs.symlinkSync(elsewhere,folder,'junction');v=await f.read({id:r.id});assert.equal(v.lookup,'unavailable')
})
test('invalid IDs, arbitrary paths, mutation commands and unbounded list sizes are refused',async t=>{
 const f=fixture(t);for(const input of [{id:'../../.env'},{limit:10000},{op:'approve'},{directory:'C:/other'}])await assert.rejects(f.read(input),/invalid_progress_request/)
 const cli=require('../../scripts/connections/workProgress.cjs');assert.deepEqual(cli.argumentsOf(['--id','11111111-1111-4111-8111-111111111111','--format','json']),{id:'11111111-1111-4111-8111-111111111111',format:'json'});for(const a of [['--root','C:/other'],['--resume','true'],['--id','bad']])assert.throws(()=>cli.argumentsOf(a),/invalid_progress_argument/)
})
