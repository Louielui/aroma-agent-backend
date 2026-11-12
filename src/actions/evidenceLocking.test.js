'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),{randomUUID}=require('node:crypto')
const usage=require('./usageBudget'),{hash}=require('./contract'),OWNER={id:'owner',role:'owner'},MODEL={model:'claude-opus-5-5',effort:'medium'}
const REPLY='已核對的流程預設模型：\n- 開發流程: gpt-6.1-sol\n- 審閱流程: sonnet\n這些是流程預設，並非已測試接單的回執。'
function fixture(t,lockWaitMs=250){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usage-evidence-lock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=require('./store').createStore({dir}),evidenceDir=path.join(dir,'evidence'),budget=usage.createUsageBudget({store,evidenceDir,profile:usage.GOAL_PROFILE,activationReady:()=>true,lockWaitMs})
 budget.handle(OWNER,{op:'usage_activate'});const turnId=randomUUID(),conversationId=randomUUID();budget.handle(OWNER,{op:'usage_bind_turn',turnId,conversationId})
 return{dir,store,evidenceDir,budget,turnId,conversationId,scope:()=>budget.enterTurn(turnId,conversationId,randomUUID()),files:()=>fs.existsSync(evidenceDir)?fs.readdirSync(evidenceDir):[]}
}
async function holder(f,ms=80){
 const script="const s=require(process.argv[1]).createStore({dir:process.argv[2]}),release=s.lockRun(process.argv[3]);process.send({locked:true});setTimeout(()=>{release();process.disconnect()},Number(process.argv[4]))"
 const child=cp.spawn(process.execPath,['-e',script,require.resolve('./store'),f.dir,usage.GOAL_PROFILE.id,String(ms)],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']})
 let stderr='';child.stderr.on('data',x=>stderr+=x)
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code?reject(Error(stderr)):resolve())});done.catch(()=>{})
 await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject)})
 return{done}
}
test('transient real-host contention registers exactly one evidence file and hash before returning',async t=>{
 const f=fixture(t),s=f.scope()
 await f.budget.withScope(s,async()=>{
  const {done}=await holder(f);let ref;try{ref=f.budget.capture('route_guard',{reply:REPLY})}finally{await done}
  assert.equal(hash(JSON.parse(fs.readFileSync(path.join(f.evidenceDir,ref.id+'.json')))),hash({reply:REPLY}))
  assert.equal(ref.sha256,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(f.evidenceDir,ref.id+'.json'))).digest('hex'))
 });const refs=f.budget.readStatus().timeline.filter(x=>x.event==='evidence');assert.equal(refs.length,1);assert.equal(f.files().length,1)
})
test('permanent contention stops within a bound and records a diagnostic without an unbound success file',t=>{
 const f=fixture(t,20),s=f.scope();f.budget.withScope(s,()=>{const unlock=f.store.lockRun(usage.GOAL_PROFILE.id);try{assert.throws(()=>f.budget.capture('route_guard',{reply:REPLY}),/usage_busy/)}finally{unlock()}})
 const files=f.files();assert.equal(files.length,1);assert.match(files[0],/^lock-failure-/)
 const diagnostic=JSON.parse(fs.readFileSync(path.join(f.evidenceDir,files[0])));assert.equal(diagnostic.code,'usage_busy');assert.equal(diagnostic.lockCode,'EEXIST');assert.equal(diagnostic.turnId,s.turnId);assert.equal(diagnostic.bound,false)
 assert.equal(f.budget.readStatus().timeline.filter(x=>x.event==='evidence').length,0)
})
test('filesystem lock failure is audit unavailable without retry or raw sensitive error text',t=>{
 const f=fixture(t),s=f.scope();f.budget.withScope(s,()=>{const link=fs.linkSync;let links=0
  fs.linkSync=()=>{links++;throw Object.assign(Error('private-token-and-path'),{code:'EACCES',path:'private-owner-path'})}
  try{assert.throws(()=>f.budget.capture('route_guard',{reply:REPLY}),/usage_audit_unavailable/)}finally{fs.linkSync=link}
  assert.equal(links,1)
 });const diagnostic=fs.readFileSync(path.join(f.evidenceDir,f.files()[0]),'utf8');assert.ok(diagnostic.includes('EACCES'));assert.ok(!diagnostic.includes('private-token-and-path'));assert.ok(!diagnostic.includes('private-owner-path'))
 assert.equal(f.budget.readStatus().timeline.filter(x=>x.event==='evidence').length,0)
})
test('a save failure after evidence creation is never replayed or silently called registered',t=>{
 const f=fixture(t),s=f.scope();f.budget.withScope(s,()=>{const save=f.store.save;let calls=0;f.store.save=()=>{calls++;throw Error('offline_disk_failure')}
  try{assert.throws(()=>f.budget.capture('route_guard',{reply:REPLY}),/usage_audit_unavailable/)}finally{f.store.save=save};assert.equal(calls,1)
 });assert.equal(f.budget.readStatus().timeline.filter(x=>x.event==='evidence').length,0)
 const diagnostic=JSON.parse(fs.readFileSync(path.join(f.evidenceDir,f.files().find(n=>n.startsWith('lock-failure-')))))
 assert.equal(diagnostic.phase,'evidence_register');assert.equal(diagnostic.evidenceKind,'route_guard');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.evidenceDir,diagnostic.evidenceId+'.json'))),{reply:REPLY})
})
test('scope is revalidated after lock wait; a paused run cannot gain an evidence receipt',async t=>{
 const f=fixture(t),s=f.scope();await f.budget.withScope(s,async()=>{
  const script="const s=require(process.argv[1]).createStore({dir:process.argv[2]}),id=process.argv[3],release=s.lockRun(id);process.send({locked:true});setTimeout(()=>{const r=s.get(id);r.state='paused';s.save(r);release();process.disconnect()},80)"
  const child=cp.spawn(process.execPath,['-e',script,require.resolve('./store'),f.dir,usage.GOAL_PROFILE.id],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']})
  const done=new Promise((resolve,reject)=>child.once('exit',code=>code?reject(Error('holder_failed')):resolve()));await new Promise(resolve=>child.once('message',resolve))
  try{assert.throws(()=>f.budget.capture('route_guard',{reply:REPLY}),/usage_run_not_active/)}finally{await done}
 });assert.equal(f.files().length,0);assert.equal(f.budget.readStatus().state,'paused')
})
test('lock waiting is host-only bounded plumbing and never changes the fixed allowance',t=>{
 const f=fixture(t);for(const lockWaitMs of [-1,1001,NaN,Infinity,'250'])assert.throws(()=>usage.createUsageBudget({store:f.store,profile:usage.GOAL_PROFILE,lockWaitMs}),/invalid_request/)
 assert.deepEqual(f.budget.readStatus().limits,{turns:1,helper:6,website:0})
})
test('native intake retains guard and turn output under a temporary real-host lock',async t=>{
 const f=fixture(t),app=require('express')();app.use(require('express').json());app.locals.conversationDemo=true
 app.use((req,res,next)=>f.budget.withHeader(undefined,'d'.repeat(64),next));let helpers=0
 app.use(require('../routes/demoRouter').createDemoRouter({getAdapterFn:()=>({providerName:'offline'}),processIntakeFn:async()=>{
  for(let i=0;i<3;i++){const p=usage.service().reserve('helper',MODEL);p.dispatched('cli_process_started');helpers++;p.finish(null,{text:'substituted retained output'})}
  const script="const r=require(process.argv[1]).createStore({dir:process.argv[2]}).lockRun(process.argv[3]);process.send({locked:true});setTimeout(()=>{r();process.disconnect()},80)"
  const child=cp.spawn(process.execPath,['-e',script,require.resolve('./store'),f.dir,usage.GOAL_PROFILE.id],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']})
  const end=new Promise((resolve,reject)=>child.once('exit',c=>c?reject(Error('holder_failed')):resolve()));await new Promise(resolve=>child.once('message',resolve))
  try{const guarded=require('../intake/routeEvidenceGuard').enforceRouteEvidence({reply:REPLY,message:'你可以派工的 AI 有哪幾個？',conversationEvidence:[],evidenceSets:[]});return{intent:'chit_chat',mode:'chat',reply:guarded.reply}}finally{await end}
 }}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)))
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json','x-xiangxiang-usage-turn':f.turnId},body:JSON.stringify({message:'你可以派工的 AI 有哪幾個？',interactionMode:'chat',history:[],conversationId:f.conversationId,chatModel:MODEL.model,chatLevel:'medium'})})
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.ok(JSON.stringify(body).includes('gpt-6.1-sol'));assert.equal(helpers,3)
 const r=f.budget.readStatus(),refs=r.timeline.filter(e=>e.event==='evidence');assert.equal(r.turns[0].finished,true);assert.equal(r.helper.reserved,3);assert.ok(refs.some(e=>e.kind==='route_guard'));assert.ok(refs.some(e=>e.kind==='turn_output'))
 for(const ref of refs)assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(f.evidenceDir,ref.id+'.json'))).digest('hex'),ref.sha256)
 f.budget.handle(OWNER,{op:'usage_pause'});assert.equal(f.budget.readStatus().state,'paused')
})
