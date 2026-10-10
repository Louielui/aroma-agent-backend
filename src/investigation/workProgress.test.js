'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createMailMemory}=require('../company/mailMemory')
const {createRuntime}=require('../memory/runtime')
const {createBackendRuntimeReader}=require('./runtimeEvidence')
const {buildWorkPurpose,renderWorkPurpose,projectProgress}=require('./workPurpose')
const at='2026-10-10T12:00:00.000Z'
const never=()=>{throw Error('unexpected_network_model_or_write')}
test('mail progress counts captured threads, protects lease, and does no network, inference or writes',async()=>{
 let permitted=true
 const rows=['ready','failed',null].map(state=>({source:{kind:'admin_mail_thread'},details:{mailbox:'private@test',analysis:{state},text:'SECRET'}}))
 rows.push({source:{kind:'admin_mail_thread'},details:{mailbox:'other@test',analysis:{state:'ready'}}})
 const mailbox={status:()=>({mailbox:'private@test'}),lease:()=>()=>{if(!permitted)throw Error('denied')},check:never,read:never,scan:never}
 const service=createMailMemory({mailbox,store:{mailRows:async()=>rows,get:async()=>({details:{pageToken:'SECRET_TOKEN'}}),commit:never},analyzer:{analyze:never},engine:{forMailSource:never},clock:()=>at})
 const p=await service.progressStatus()
 assert.deepEqual(p.mail_analysis.counts,{total:3,ready:1,pending:2,failed:1})
 assert.equal(p.mail_analysis.unit,'captured_thread');assert.equal(p.mail_analysis.syncHasMore,true)
 assert.doesNotMatch(JSON.stringify(p),/private@test|other@test|SECRET/)
 const racing=createMailMemory({mailbox,store:{mailRows:async()=>{permitted=false;return rows},get:async()=>null},clock:()=>at})
 await assert.rejects(racing.progressStatus(),/denied/)
 permitted=false;await assert.rejects(service.progressStatus(),/denied/)
})
test('memory progress separates saved facts, raw-only records, candidates and pending work without health or engine reads',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'xx-progress-'))
 try{
  const rows=['saved','raw_only','pending','unconfirmed','source_only'].map(state=>({status:'active',type:'episodic',scope:'private:owner',text:'Private memory',source:{kind:'conversation',attribution:'owner_statement'},index:{state},details:{}}))
  rows[0].details.consolidation={state:'done'};rows[1].details.consolidation={state:'empty'};rows[3].details.consolidation={state:'failed'}
  rows.push({status:'candidate',source:{kind:'consolidation'},text:'SECRET',index:{state:'pending'},details:{}})
  rows.push({status:'active',source:{kind:'admin_mail_thread'},text:'MAIL_SECRET',index:{state:'saved'},details:{}})
  const service=createRuntime({dir:path.join(dir,'outbox'),store:{generalRows:async()=>rows,health:never,commit:never,all:never},engine:{forScope:never}})
  const p=await service.progressStatus()
  assert.deepEqual(p.memory_index.counts,{total:5,saved:1,raw_only:1,pending:1,unconfirmed:1,source_only:1,other:0})
  assert.deepEqual(p.memory_consolidation.counts,{total:5,pending:2,running:0,done:1,empty:1,failed:1,other:0,candidates:1})
  assert.equal(p.memory_outbox.counts.pending,0);assert.doesNotMatch(JSON.stringify(p),/SECRET|Private memory/)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('runtime reader attaches safe progress independently of process probes and retains unavailable evidence',async()=>{
 const p={mail_analysis:{version:1,at,unit:'captured_thread',scope:'captured_mail_threads',counts:{total:0,ready:0,pending:0,failed:0},syncHasMore:null}}
 const r=await createBackendRuntimeReader({clock:()=>at,mailMemory:{runtimeStatus:()=>({enabled:true,analysisActive:false}),progressStatus:async()=>p},memory:{status:()=>({enabled:true}),progressStatus:async()=>{throw Error('SECRET')}}}).read()
 assert.equal(r.records.find(r=>r.role==='mail_analysis').progress.counts.total,0)
 assert.equal(r.records.find(r=>r.role==='memory_index').progressState,'unavailable')
 assert.doesNotMatch(JSON.stringify(r),/SECRET/)
})
test('an unreadable outbox stays unavailable without hiding readable canonical memory counters',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'xx-progress-failed-'))
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const outbox=path.join(dir,'not-a-directory');fs.writeFileSync(outbox,'isolated fixture')
 const service=createRuntime({dir:outbox,store:{generalRows:async()=>[]},engine:{}})
 const result=await createBackendRuntimeReader({memory:service}).read()
 assert.equal(result.records.find(r=>r.role==='memory_index').progress.counts.total,0)
 assert.equal(result.records.find(r=>r.role==='memory_outbox').progressState,'unavailable')
 assert.equal(result.records.find(r=>r.role==='memory_outbox').progress,null)
})
const receipt=(counts={total:3,ready:1,pending:2,failed:1},time=at)=>({version:1,at:time,unit:'captured_thread',scope:'captured_mail_threads',counts,syncHasMore:true})
function report(progress=receipt(),extra={}){return {sections:[{section:'configuration',state:'partial',sourceId:'configuration:local',records:[{sourceId:'backend:mail_analysis',role:'mail_analysis',at:progress.at,evidenceBasis:'live_process_snapshot',progressState:'ok',progress,...extra}]}]}}
test('fresh scoped counts produce bilingual purpose/results/remaining work without claiming mailbox completion or saved candidates approved',()=>{
 const r=buildWorkPurpose(report(),{now:Date.parse(at)})
 assert.equal(r.jobs[0].progressState,'CONFIRMED');assert.equal(r.jobs[0].ownerRequestState,'UNKNOWN')
 assert.equal(r.jobs[0].recommendation,'inspect_unresolved_records')
 for(const message of ['電郵和記憶做了什麼？','What did email analysis and memory processing accomplish?']){
  const view=renderWorkPurpose(r,{message})
  assert.match(view.text,/3.*討論串|3 captured/);assert.match(view.text,/其中失敗 1|including 1 failed/)
  assert.match(view.text,/未收集|Uncaptured/);assert.match(view.text,/最初.*要求|originating Owner/i)
  assert.doesNotMatch(view.text,/⟦\?|SECRET/);assert.equal(view.references[0].recordId,'backend:mail_analysis')
 }
 assert.equal(r.executionAllowed,false)
 assert.equal(buildWorkPurpose(report(receipt({total:0,ready:0,pending:0,failed:0})),{now:Date.parse(at)}).jobs[0].progressState,'CONFIRMED')
})
test('invalid, stale, inaccessible or conflicting counters never become zero or completion',()=>{
 for(const counts of [{total:3,ready:2,pending:2,failed:0},{total:3,ready:1,pending:2,failed:3},{total:3,ready:1,pending:-1,failed:0},{total:3,ready:1,pending:2,failed:'1'}])assert.equal(projectProgress('mail_analysis',receipt(counts)),null)
 const stale=buildWorkPurpose(report(),{now:Date.parse(at)+300001});assert.equal(stale.jobs[0].progressState,'UNKNOWN');assert.equal(stale.jobs[0].progress,null)
 const inaccessible=buildWorkPurpose(report(receipt(),{progressState:'unavailable'}),{now:Date.parse(at)});assert.equal(inaccessible.jobs[0].progressState,'UNAVAILABLE')
 const conflict=report();conflict.sections[0].records.push({...conflict.sections[0].records[0],progress:receipt({total:4,ready:1,pending:3,failed:1})})
 assert.equal(buildWorkPurpose(conflict,{now:Date.parse(at)}).jobs[0].progressState,'CONTRADICTED')
 const older=report();older.sections[0].records.push({...older.sections[0].records[0],at:'2026-10-10T11:50:00Z',progress:receipt({total:4,ready:1,pending:3,failed:1},'2026-10-10T11:50:00Z')})
 assert.equal(buildWorkPurpose(older,{now:Date.parse(at)}).jobs[0].progressState,'CONFIRMED')
})
test('sampled host outcomes use exact work/run identities and do not change canonical backlog',()=>{
 const r=report(),run={runId:'one',outcomeState:'SUPPORTED',hostOutcome:{basis:'host_checkpoint_report',state:'ready',at}}
 r.executionUsage={chains:[{kind:'background_work',workKind:'mail_analysis',identity:'exact_host_work_and_run_id',runs:[run,run],references:[]},
  {kind:'bridge_lane',workKind:'mail_analysis',identity:'unlinked_lane_call',runs:[{...run,runId:'unlinked'}],references:[]}]}
 const v=buildWorkPurpose(r,{now:Date.parse(at)}).jobs[0]
 assert.deepEqual(v.observedHostOutcomes,{ready:1});assert.equal(v.progress.counts.ready,1);assert.equal(v.progress.counts.pending,2)
 assert.equal(v.outcomeScope,'sampled_historical_runs_not_unique_records_or_current_queue')
})
test('read-only inspection route receives the running backend reader rather than building an unwired connector',async t=>{
 const express=require('express'),app=express();let calls=0
 const old=process.env.READ_ACCESS,oldSource=process.env.CONTEXT_XIANGXIANG_OPERATIONS;process.env.READ_ACCESS='on';process.env.CONTEXT_XIANGXIANG_OPERATIONS='on';t.after(()=>{if(old===undefined)delete process.env.READ_ACCESS;else process.env.READ_ACCESS=old;if(oldSource===undefined)delete process.env.CONTEXT_XIANGXIANG_OPERATIONS;else process.env.CONTEXT_XIANGXIANG_OPERATIONS=oldSource})
 const reader=async()=>{calls++;return {records:[]}}
 app.locals.operationsBackgroundReader=reader
 app.use(require('../routes/contextRouter').createContextRouter({buildConnector:(env,options)=>{
  assert.equal(options.operationsOptions.backgroundReader,reader);return{connector:{}}
 },buildReadContextFn:async()=>{await reader();return{status:'READY',perSource:[],block:'local counters'}}}))
 const server=app.listen(0,'127.0.0.1');t.after(()=>server.close())
 await new Promise(r=>server.once('listening',r))
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/context/recent')
 assert.equal(response.status,200);assert.equal(calls,1)
})
