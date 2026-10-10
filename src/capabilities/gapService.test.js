'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createGapService } = require('./gapService'), { detectGap, validGap } = require('./gapContract')
const { createMemoryRunStore } = require('../core/operating/runStore')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const OWNER = {id:'owner',role:'owner'}, REV = 'a'.repeat(40), NEW = 'b'.repeat(40)
const fact = (state, operation = null) => ({need:'staff clock-out records',necessity:'required',operation,readState:state})
const gap = (reason = 'no_mapped_operation', capability = null, state = 'no_system_operation') => detectGap({reason,plan:{requestedCapability:capability},state:{facts:[fact(state)]}})
function fixture (options = {}) {
  let time = Date.now(), reads = 0; const rows = new Map(), store = options.store || createMemoryRunStore(), starts = []
  const conversations = {get:id=>structuredClone(rows.get(id)),appendTurn:v=>{ const c = rows.get(v.id) || {id:v.id,messages:[]}; c.messages.push({role:'user',content:v.userText},{role:'assistant',content:v.replyText,capabilityGapRunId:v.capabilityGapRunId}); rows.set(v.id,c) }}
  const planner = {start:(a,v)=>{ starts.push(v); return {id:randomUUID(),profile:'context'} },get:()=>options.plan || null}
  const dependencies = {store,conversations,revision:REV,planner,now:()=>time,verifyLoaded:async()=>options.proof || null,resumeOriginal:async v=>{reads++; if(options.wait)await options.wait; return options.result || {mode:'chat',reply:'Fresh read result.',tasks:[],decision:null} }}
  const service = createGapService(dependencies), cid = randomUUID()
  function offer (g = gap(), message = 'Find employee clock-out times in an unregistered workforce system.') {
    const r = service.offer(OWNER,{conversationId:cid,requestId:randomUUID(),message,gap:g,model:'claude-opus-5-5',effort:'medium'})
    conversations.appendTurn({id:cid,userText:message,replyText:'Proposal displayed',capabilityGapRunId:r.id})
    return r
  }
  const approve = r => service.approve(OWNER,{id:r.id,conversationId:cid,hash:r.proposalHash})
  const resume = (r,requestId=randomUUID()) => service.resume(OWNER,{id:r.id,conversationId:cid,hash:r.proposalHash,requestId})
  return {service,store,conversations,cid,offer,approve,resume,starts,rows,dependencies,reads:()=>reads,advance:ms=>{time+=ms}}
}
test('external gap creates an exact saved proposal and approved development draft without new permissions or dispatch',async()=>{
  const f = fixture(), r = f.offer()
  assert.equal(r.gap.kind,'unmapped_read'); assert.equal(r.gap.capability,null); assert.equal(r.proposal.scope,null)
  assert.match(r.proposal.diagnosis,/unverified/); assert.match(r.proposal.risk,/not presumed/)
  const v = await f.approve(r)
  assert.equal(v.run.state,'awaiting_scope_registration'); assert.equal(v.run.developmentTask.goal,r.originalGoal)
  assert.deepEqual(v.run.developmentTask.originalRequest,{conversationId:f.cid,goal:r.originalGoal})
  assert.ok(v.run.developmentTask.exclusions.includes('business_writes')); assert.equal(f.starts.length,0); assert.equal(f.reads(),0)
  const again = await f.approve(r); assert.equal(again.replayed,true)
  const reboot = createGapService(f.dependencies); assert.equal(reboot.get(OWNER,r.id).state,'awaiting_scope_registration'); assert.equal(f.starts.length,0)
})
test('absence, failed source and turn authority have different evidence and remedies in both languages',()=>{
  const unknown = gap(); assert.equal(unknown.implementation,'unknown')
  const unimplemented = gap(null,'calendar.write'); assert.equal(unimplemented.kind,'not_implemented')
  const denied = gap('required_world_missing','calendar.read','not_authorised'); assert.equal(denied.kind,'not_authorised')
  const failed = gap('required_world_missing','calendar.read','failed'); assert.equal(failed.kind,'source_unavailable')
  assert.equal(gap('validation_unavailable').kind,'verification_unavailable')
  assert.equal(detectGap({plan:{requestedCapability:'calendar.read'}}),null)
  assert.equal(validGap({...unknown,capability:'7shifts.timeclock.read'}),false)
  const f=fixture(),zh=f.offer(denied,'幫我查員工下班時間'); assert.match(zh.proposal.diagnosis,/不能因此判定功能未開發/)
})
test('approval rejects other conversations, forged hashes, stale versions, expiry and intervening topics',async()=>{
  const f=fixture(),r=f.offer()
  await assert.rejects(f.service.approve(OWNER,{id:r.id,conversationId:randomUUID(),hash:r.proposalHash}),/proposal_changed/)
  await assert.rejects(f.service.approve(OWNER,{id:r.id,conversationId:f.cid,hash:'f'.repeat(64)}),/proposal_changed/)
  assert.equal(f.service.candidate('不要開始',f.cid),false); assert.equal(f.service.candidate('He said yes.',f.cid),false)
  assert.equal(f.service.candidate('yes',randomUUID()),false)
  f.advance(24*60*60*1000); await assert.rejects(f.approve(r),/proposal_stale/)
  const f2=fixture(),r2=f2.offer(); f2.conversations.appendTurn({id:f2.cid,userText:'New topic',replyText:'Different request'})
  assert.equal(f2.service.candidate('yes',f2.cid),false); await assert.rejects(f2.approve(r2),/conversation_changed/)
  const f3=fixture(),r3=f3.offer(),restart=createGapService({...f3.dependencies,revision:NEW})
  await assert.rejects(restart.approve(OWNER,{id:r3.id,conversationId:f3.cid,hash:r3.proposalHash}),/proposal_stale/)
  assert.equal(f.starts.length+f2.starts.length+f3.starts.length,0)
})
test('tampered saved plan or task scope cannot turn into coding authority',async()=>{
  const f=fixture(),r=f.offer(),row=f.store.get(r.id); row.proposal.scope={profile:'context',files:['.env']}; f.store.save(row)
  await assert.rejects(f.approve(r),/proposal_unavailable/); assert.equal(f.starts.length,0)
  assert.throws(()=>f.service.offer({id:'worker',role:'worker'},{}),/permission_denied/)
})
test('registered Context gaps hand off once to committed-source planning, never auto execute or adopt',async()=>{
  const f=fixture(),r=f.offer(gap('no_mapped_operation','aroma_system.read'),'核對目前查詢範圍快照')
  const [a,b]=await Promise.all([f.approve(r),f.approve(r)])
  assert.equal(f.starts.length,1); assert.equal(a.run.state,'development_planning'); assert.equal(b.replayed,true)
  assert.deepEqual(a.run.proposal.scope.files,require('../core/taskPlanner/contract').PROFILES.context)
  assert.equal(f.starts[0].model,'claude-opus-5-5'); assert.equal(f.starts[0].effort,'medium'); assert.equal(f.reads(),0)
  await assert.rejects(f.resume(r),/capability_unverified/)
})
test('worker completion alone and a loaded unrelated commit cannot resume original business request',async()=>{
  const workRunId=randomUUID(),plan={execution:{state:'completed',workRunId}},f=fixture({plan}),r=f.offer(gap('no_mapped_operation','aroma_system.read'))
  await f.approve(r); await assert.rejects(f.resume(r),/capability_unverified/); assert.equal(f.reads(),0)
  const f2=fixture({plan,proof:{state:'verified',workRunId:randomUUID(),bootCommit:NEW}}),r2=f2.offer(gap('no_mapped_operation','aroma_system.read'))
  await f2.approve(r2); await assert.rejects(f2.resume(r2),/capability_unverified/); assert.equal(f2.reads(),0)
})
test('verified adopted development resumes only the saved original request and handles concurrent retries once',async()=>{
  const workRunId=randomUUID(),f=fixture({plan:{execution:{state:'completed',workRunId}},proof:{state:'verified',workRunId,bootCommit:NEW}})
  const r=f.offer(gap('no_mapped_operation','aroma_system.read'),'核對原本查詢結果'),id=randomUUID(); await f.approve(r)
  const [a,b]=await Promise.all([f.resume(r,id),f.resume(r,id)])
  assert.equal(f.reads(),1); assert.equal(a.run.state,'completed'); assert.equal(b.result.reply,'Fresh read result.')
  const replay=await f.resume(r,id); assert.equal(replay.replayed,true); assert.equal(f.reads(),1)
  assert.ok(f.conversations.get(f.cid).messages.at(-1).content.includes('Fresh read result'))
})
test('resume cannot release executable outputs and interrupted read-back is never replayed',async()=>{
  const workRunId=randomUUID(),options={plan:{execution:{state:'completed',workRunId}},proof:{state:'verified',workRunId,bootCommit:NEW},result:{mode:'commit',reply:'changed payroll',tasks:[{}]}}
  const f=fixture(options),r=f.offer(gap('no_mapped_operation','aroma_system.read')),id=randomUUID(); await f.approve(r)
  await assert.rejects(f.resume(r,id),/resume_unconfirmed/); assert.equal(f.service.get(OWNER,r.id).state,'needs_attention')
  const reboot=createGapService(f.dependencies); await assert.rejects(reboot.resume(OWNER,{id:r.id,conversationId:f.cid,hash:r.proposalHash,requestId:id}),/resume_unconfirmed/)
  assert.equal(f.reads(),1)
})
test('unknown handoff outcomes preserve task identity and never dispatch again on restart or confirmation',async()=>{
  const f=fixture(); f.dependencies.planner.start=()=>{f.starts.push({});throw Error('transport lost')}
  const r=f.offer(gap('no_mapped_operation','aroma_system.read')); await f.approve(r); assert.equal(f.service.get(OWNER,r.id).state,'needs_attention')
  await f.approve(r); assert.equal(f.starts.length,1)
})

test('durable store and conversation reload preserve the approved original task without replaying work',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capability-gap-restart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const {createRunStore}=require('../core/operating/runStore'),{createConversationStore}=require('../store/conversationStore')
  const store=createRunStore({dir:path.join(dir,'gaps'),workflow:'capability_gap'}),f=fixture({store})
  const conversations=createConversationStore({dataDir:dir}),s=createGapService({...f.dependencies,conversations})
  const r=s.offer(OWNER,{conversationId:f.cid,requestId:randomUUID(),message:'幫我找員工下班時間',gap:gap(),model:'claude-opus-5-5',effort:'medium'})
  conversations.appendTurn({id:f.cid,userText:r.originalGoal,replyText:'方案',capabilityGapRunId:r.id})
  await s.approve(OWNER,{id:r.id,conversationId:f.cid,hash:r.proposalHash})
  const reboot=createGapService({...f.dependencies,store:createRunStore({dir:path.join(dir,'gaps'),workflow:'capability_gap'}),conversations:createConversationStore({dataDir:dir})})
  assert.equal(reboot.get(OWNER,r.id).developmentTask.originalRequest.goal,r.originalGoal)
  assert.equal((await reboot.confirm(OWNER,'好',f.cid)).capabilityGapResolution.id,r.id);assert.equal(f.starts.length,0)
})

test('continuation status needs passed acceptance and the exact loaded adoption, with unavailable distinct from absent',async()=>{
  const {loadedProof}=require('./gapService'),workRunId=randomUUID()
  const good={workRunId,action:'adopt',state:'completed',appliedToLive:true,commit:NEW,loaded:{bootCommit:NEW},tests:{total:3,passed:3,failed:0,exitCode:0,skipped:0,cancelled:0}}
  assert.equal(loadedProof([good],workRunId,NEW).state,'verified')
  for(const patch of [{action:'rollback'},{state:'awaiting_restart'},{workRunId:randomUUID()},{loaded:{bootCommit:REV}},{tests:{failed:0}},{tests:{...good.tests,skipped:1}}])assert.equal(loadedProof([{...good,...patch}],workRunId,NEW),null)
  const f=fixture({plan:{execution:{state:'completed',workRunId}},proof:{state:'verified',workRunId,bootCommit:NEW}}),r=f.offer(gap('no_mapped_operation','aroma_system.read'));await f.approve(r)
  assert.equal((await f.service.status(OWNER,r.id)).resumeAvailable,true)
  const unavailable=createGapService({...f.dependencies,verifyLoaded:async()=>{throw Error('store unavailable')}})
  const v=await unavailable.status(OWNER,r.id);assert.equal(v.verificationState,'unavailable');assert.equal(v.resumeAvailable,false);assert.equal(f.reads(),0)
  f.dependencies.planner.get=()=>{throw Error('child store unavailable')}
  const childUnavailable=await unavailable.status(OWNER,r.id);assert.equal(childUnavailable.originalGoal,r.originalGoal);assert.equal(childUnavailable.development.state,'unavailable');assert.equal(childUnavailable.resumeAvailable,false)
})

test('a new conversation turn during loaded-state verification prevents resuming an old request',async()=>{
  const workRunId=randomUUID(),f=fixture({plan:{execution:{state:'completed',workRunId}}}),r=f.offer(gap('no_mapped_operation','aroma_system.read'));await f.approve(r)
  let release;const proof=new Promise(resolve=>{release=resolve}),s=createGapService({...f.dependencies,verifyLoaded:async()=>proof})
  const running=s.resume(OWNER,{id:r.id,conversationId:f.cid,hash:r.proposalHash,requestId:randomUUID()});await new Promise(resolve=>setImmediate(resolve))
  f.conversations.appendTurn({id:f.cid,userText:'另一個問題',replyText:'新話題'})
  release({state:'verified',workRunId,bootCommit:NEW});await assert.rejects(running,/conversation_changed/);assert.equal(f.reads(),0)
})

test('a late read result remains on its original card rather than replacing a newer conversation topic',async()=>{
  let release;const wait=new Promise(r=>{release=r}),workRunId=randomUUID(),f=fixture({plan:{execution:{state:'completed',workRunId}},proof:{state:'verified',workRunId,bootCommit:NEW},wait})
  const r=f.offer(gap('no_mapped_operation','aroma_system.read'));await f.approve(r);const resumed=f.resume(r);await new Promise(resolve=>setImmediate(resolve))
  f.conversations.appendTurn({id:f.cid,userText:'New request',replyText:'Current topic'})
  release();const v=await resumed;assert.equal(v.result.reply,'Fresh read result.');assert.equal(f.conversations.get(f.cid).messages.at(-1).content,'Current topic')
  assert.equal(v.run.steps.at(-1).facts.historyAttachment,'original_card_only');assert.equal(f.reads(),1)
})

test('real registered planner retains the business goal as sealed context rather than misclassifying it as a production modification',async()=>{
  const {createPlanner}=require('../core/taskPlanner/service'),{READ_PROFILES,hash}=require('../core/taskPlanner/contract')
  const f=fixture(),goal='幫我查 Aroma System即時庫存',evidence={project:'aroma-agent-backend',profile:'context',revision:REV,bootCommit:REV,committedOnly:true,files:READ_PROFILES.context.map((name,i)=>({path:name,evidenceId:'plan-'+i,content:"'use strict'",sha256:hash("'use strict'"),lineCount:1}))}
  let calls=0,workWrites=0
  const planner=createPlanner({source:{verify:()=>{},read:async()=>({state:'ok',retrievedAt:new Date().toISOString(),evidence,hash:hash(JSON.stringify(evidence))})},store:createMemoryRunStore(),bootCommit:REV,timeoutMs:1000,
    provider:{preflight:async()=>({model:'claude-opus-5-5',billing:'claude-subscription'}),complete:async prompt=>{
      calls++;const input=JSON.parse(prompt);assert.ok(input.dialogue.ownerRequests.includes(goal));assert.equal(input.dialogue.confirmation,'yes')
      return {model:'claude-opus-5-5',billing:'claude-subscription',text:JSON.stringify({goal,steps:['Repair existing reader routing'],acceptanceChecks:['Verify the original read'],questions:[],risks:['No external writes'],capability:{status:'supported',explanation:'Existing context routing only',missingCapabilities:[]},editableFiles:READ_PROFILES.context,citations:[{evidenceId:'plan-0',startLine:1,endLine:1,quote:"'use strict'"}]})}
    }},prepareWork:async()=>{workWrites++}})
  const s=createGapService({...f.dependencies,planner}),r=s.offer(OWNER,{conversationId:f.cid,requestId:randomUUID(),message:goal,gap:gap('no_mapped_operation','aroma_system.read'),model:'claude-opus-5-5',effort:'medium'})
  f.conversations.appendTurn({id:f.cid,userText:goal,replyText:'方案',capabilityGapRunId:r.id})
  const a=await s.approve(OWNER,{id:r.id,conversationId:f.cid,hash:r.proposalHash},'yes');assert.equal(a.run.state,'development_planning')
  await planner.wait(a.run.taskPlanRunId);assert.equal(planner.get(OWNER,a.run.taskPlanRunId).state,'completed');assert.equal(calls,1);assert.equal(workWrites,0)
  assert.equal(s.get(OWNER,r.id).development.state,'completed')
})
