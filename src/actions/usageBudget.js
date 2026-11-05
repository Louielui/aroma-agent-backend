'use strict'
// Bounds acceptance windows; definitions stay inert until Owner activation. No provider, quota purchase,
// new credential or model-selected grant. All reservations use the Action store.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks')
const {ID,hash}=require('./contract')
const extension=require('./usageExtension')
const context=new AsyncLocalStorage()
const PROFILE=Object.freeze({id:'a57b0b98-3638-42b2-8e65-d5f220261031',identity:'owner-context-understanding-acceptance-20261031',model:'claude-opus-5-5',effort:'medium',turns:9,helper:40,website:2})
// A separate, initially inert window. Deploying this definition neither activates
// it nor reopens the historical acceptance. The authenticated Owner action and
// existing shared-service idle witness remain required before any reservation.
const UNDERSTANDING_PROFILE=Object.freeze({id:'e217d640-2bf9-45d0-9b43-b228b4dd2c6e',identity:'owner-natural-understanding-acceptance-20261103',model:'claude-opus-5-5',effort:'medium',turns:5,helper:30,website:0})
// Inert proposal for the next explicitly approved two-case acceptance. The
// previous window must be closed, never reset, before resident selection changes.
const ADVICE_PROFILE=Object.freeze({id:'d9347ceb-7b9c-4fd6-ae46-05b2175de4ad',identity:'owner-advice-premise-acceptance-20261104',model:'claude-opus-5-5',effort:'medium',turns:2,helper:12,website:0})
// Proposed next verification window only. Source installation grants nothing:
// the old window must be explicitly closed and the new one Owner-activated.
const PRIORITY_PROFILE=Object.freeze({id:'d40ae8a1-bbb9-4cc5-9f1c-6e2eec645b74',identity:'owner-advice-priority-acceptance-20261104',model:'claude-opus-5-5',effort:'medium',turns:2,helper:12,website:0})
// Inert next-window proposal, not an allowance. A paused previous root remains
// selected until separately authorized closure; deployment never activates this.
const CONVERSATION_PROFILE=Object.freeze({id:'42a79086-f301-43d0-a38e-276e14db7694',identity:'owner-conversation-evidence-acceptance-20261104',model:'claude-opus-5-5',effort:'medium',turns:2,helper:12,website:0})
// Inert one-case proposal for the remaining corrected-goal regression. It is
// neither selected while the prior root is paused nor activated by deployment.
const GOAL_PROFILE=Object.freeze({id:'076a60e0-490d-4695-8915-4b337fd49d9b',identity:'owner-corrected-goal-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Proposed clarity verification only. No ledger or allowance exists until the
// Owner separately closes the spent goal window and activates this exact root.
const CLARITY_PROFILE=Object.freeze({id:'2ab7ab45-1f53-4df7-ba98-4605bcfb7cde',identity:'owner-conversation-clarity-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:3,helper:18,website:0})
// Inert foreground-planning retest proposal. The paused clarity ledger remains
// selected until explicit Owner closure; installation grants no new allowance.
const PLANNING_PROFILE=Object.freeze({id:'d7b1e1b3-9801-4549-bc14-9a5818c2138b',identity:'owner-foreground-planning-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:2,helper:12,website:0})
// Proposed single failed-case retest only. No ledger, closure or allowance is
// created by installing this definition; the spent planning root stays selected.
const CONTINUATION_PROFILE=Object.freeze({id:'2921b7f7-711e-4724-a47f-8b1d09a4c24c',identity:'owner-proposal-continuation-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
function isAcceptanceRoot(id){return id===PROFILE.id||id===UNDERSTANDING_PROFILE.id||id===ADVICE_PROFILE.id||id===PRIORITY_PROFILE.id||id===CONVERSATION_PROFILE.id||id===GOAL_PROFILE.id||id===CLARITY_PROFILE.id||id===PLANNING_PROFILE.id||id===CONTINUATION_PROFILE.id}
const SHAPES={usage_activate:['op'],usage_status:['op'],usage_pause:['op'],usage_close:['op'],usage_reconcile:['op'],usage_bind_turn:['op','turnId','conversationId']}
SHAPES.usage_extension_prepare=['op','workId','commit','attemptsHash']
SHAPES.usage_extension_approve=['op','id','hash','nonce']
const ERRORS=new Set(['usage_store_required','usage_not_enabled','usage_busy','usage_audit_unavailable','usage_run_not_active','usage_scope_required','usage_run_closed','usage_binding_conflict','usage_turn_limit_reached','usage_unresolved_work','usage_turn_replayed','usage_child_limit','usage_evidence_too_large','usage_model_not_allowed','usage_attempt_replayed','usage_limit_reached','usage_kind_mismatch','usage_api_not_allowed','usage_idle_required','usage_operation_not_allowed'])
for(const code of ['usage_extension_unavailable','usage_extension_expired','usage_allocation_required','usage_allocation_exhausted'])ERRORS.add(code)
const validInput=b=>!!b&&!Array.isArray(b)&&Object.hasOwn(SHAPES,b.op)&&Object.keys(b).sort().join(',')===SHAPES[b.op].slice().sort().join(',')&&(b.op!=='usage_bind_turn'||ID.test(b.turnId||'')&&ID.test(b.conversationId||''))
const error=code=>Object.assign(Error(code),{code})
const scopeKeys='childId,conversationId,requestId,rootId,turnId'
function validScope(s){return !!s&&Object.keys(s).sort().join(',')===scopeKeys&&[s.rootId,s.turnId,s.conversationId,s.requestId].every(v=>ID.test(v||''))&&(s.childId===null||ID.test(s.childId||''))}
function developmentProfile(id){if(!ID.test(id||'')||isAcceptanceRoot(id))throw error('usage_profile_not_allowed');return{id,identity:'owner-repository-repair:'+id,turns:1,helper:8,website:0,models:[{model:'gpt-6.1-sol',effort:'high'},{model:'claude-sonnet-5-5',effort:'medium'}]}}
function createUsageBudget({store,evidenceDir,now=Date.now,activationReady=null,profile=PROFILE,extensionWitness=null,approvals=require('../agent/ownerApprovalStore').createOwnerApprovalStore({now}),processAlive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}}}={}){
 if(!store?.lockRun)throw error('usage_store_required')
 profile=structuredClone(profile)
 if(hash(profile)!==hash(PROFILE)&&hash(profile)!==hash(UNDERSTANDING_PROFILE)&&hash(profile)!==hash(ADVICE_PROFILE)&&hash(profile)!==hash(PRIORITY_PROFILE)&&hash(profile)!==hash(CONVERSATION_PROFILE)&&hash(profile)!==hash(GOAL_PROFILE)&&hash(profile)!==hash(CLARITY_PROFILE)&&hash(profile)!==hash(PLANNING_PROFILE)&&hash(profile)!==hash(CONTINUATION_PROFILE)&&hash(profile)!==hash(developmentProfile(profile.id)))throw error('usage_profile_not_allowed')
 const limits={turns:profile.turns,helper:profile.helper,website:profile.website}
 const acceptsModel=input=>(profile.models||[{model:profile.model,effort:profile.effort}]).some(m=>m.model===input.model&&m.effort===input.effort)
 const profileHash=hash(profile)
 const extensionTickets=new Map(),isDevelopment=profile.identity==='owner-repository-repair:'+profile.id
 function load(locked=false){if(!locked){try{if(store.exists?.(profile.id)===false)return null}catch{throw error('usage_audit_unavailable')};return change(r=>r)}let r;try{r=store.get(profile.id)}catch{throw error('usage_audit_unavailable')};if(!r)return null
  if(r.profileHash!==profileHash||r.identity!==profile.identity||JSON.stringify(r.limits)!==JSON.stringify(limits)||!['active','paused','closed'].includes(r.state)||!Array.isArray(r.turns)||r.turns.length>limits.turns||!Array.isArray(r.attempts)||!Array.isArray(r.children)||r.children.length>128||new Set(r.turns.map(t=>t.id)).size!==r.turns.length||new Set(r.attempts.map(t=>t.id)).size!==r.attempts.length||r.attempts.filter(a=>a.kind==='helper').length>limits.helper+(r.extension&&isDevelopment?2:0)||r.attempts.filter(a=>a.kind==='website').length>limits.website||r.attempts.some(a=>!ID.test(a.id||'')||!['helper','website'].includes(a.kind)||!['reserved','dispatched','succeeded','failed'].includes(a.state)||!r.turns.some(t=>t.id===a.turnId)||a.kind==='helper'&&!acceptsModel(a)))throw error('usage_audit_unavailable')
  try{if(r.extension&&(!isDevelopment||!extension.validGrant(r,profileHash))||!r.extension&&r.attempts.some(a=>a.extensionId||a.allocation))throw error('usage_audit_unavailable')}catch{throw error('usage_audit_unavailable')}
  if(r.turns.some(t=>!ID.test(t.id||'')||!ID.test(t.conversationId||'')||typeof t.entered!=='boolean'||typeof t.finished!=='boolean'||t.entered&&(!ID.test(t.requestId||'')||!Number.isSafeInteger(t.hostPid)))||r.children.some(c=>!ID.test(c.id||'')||typeof c.finished!=='boolean'||!r.turns.some(t=>t.id===c.turnId))||r.attempts.some(a=>!Number.isSafeInteger(a.hostPid)||a.dispatchedAt&&!['cli_process_started','provider_turn_start'].includes(a.dispatchBasis)))throw error('usage_audit_unavailable')
  return r
 }
 function change(fn){let release;try{release=store.lockRun(profile.id)}catch{throw error('usage_busy')};try{const r=load(true);const value=fn(r);return value}finally{release()}}
 function save(r,event,facts={}){r.timeline.push({at:new Date(now()).toISOString(),event,...facts});try{store.save(r)}catch{throw error('usage_audit_unavailable')}}
 function assertScope(r,s){if(!r||r.state!=='active')throw error('usage_run_not_active');if(!validScope(s)||s.rootId!==r.id)throw error('usage_scope_required');const t=r.turns.find(t=>t.id===s.turnId),child=s.childId&&r.children.find(c=>c.id===s.childId&&c.turnId===s.turnId&&!c.finished);if(!t||!t.entered||t.finished&&!child||t.conversationId!==s.conversationId||t.requestId!==s.requestId||s.childId&&!child)throw error('usage_scope_required');return t}
 function statusOf(r){if(!r)return{state:'not_activated',id:profile.id,identity:profile.identity,limits:{...limits},turnsUsed:0,helper:{reserved:0,available:limits.helper},website:{reserved:0,available:limits.website}}
  const counts=kind=>{const a=r.attempts.filter(a=>a.kind===kind),dispatched=a.filter(v=>v.dispatchedAt).length,cap=r.limits[kind]+(kind==='helper'&&r.extension?2:0),expired=kind==='helper'&&r.extension&&now()>=r.extension.expiresAt;return{limit:cap,reserved:a.length,dispatched,failed:a.filter(v=>v.state==='failed').length,succeeded:a.filter(v=>v.state==='succeeded').length,unresolved:a.filter(v=>['reserved','dispatched'].includes(v.state)).length,reservedNotDispatched:a.length-dispatched,available:expired?0:cap-a.length,...(expired?{unusedExpired:cap-a.length}:{})}}
  return{id:r.id,identity:r.identity,state:r.state,limits:r.limits,...(r.extension?{extension:structuredClone(r.extension)}:{}),turnsUsed:r.turns.length,turns:r.turns,helper:counts('helper'),website:counts('website'),attempts:r.attempts.map(a=>({...a})),timeline:r.timeline,semantics:'Reservations are conservative attempt capacity, not billing. Failed/uncertain reservations are never automatically refunded.'}
 }
 function status(){return statusOf(load())}
 // A host observer reads one atomic JSON snapshot, without obtaining a writer
 // lock or reconciling state. Every existing profile/grant invariant still runs.
 function readStatus(){return statusOf(load(true))}
 function extensionAction(b){
  if(!isDevelopment||!extensionWitness)throw error('usage_extension_unavailable')
  if(b.op==='usage_extension_prepare')return change(r=>{
   if(!ID.test(b.workId||'')||!/^[a-f0-9]{40}$/.test(b.commit||'')||!/^[a-f0-9]{64}$/.test(b.attemptsHash||''))throw error('invalid_request')
   if(!r||r.state!=='active'||r.extension||r.attempts.length!==8||r.attempts.some(a=>a.kind!=='helper'||['reserved','dispatched'].includes(a.state))||r.turns.length!==1||!r.turns[0].entered||r.turns[0].finished||r.turns[0].id!==r.id||hash(r.attempts)!==b.attemptsHash)throw error('usage_extension_unavailable')
   const w=extension.witnessFor(extensionWitness,b.workId);if(w.commit!==b.commit||w.eligible!==true)throw error('usage_binding_conflict');if(w.idle!==true)throw error('usage_idle_required')
   const id=crypto.randomUUID(),session=approvals.createSession(),material={rootId:r.id,workId:b.workId,commit:b.commit,approvalHash:w.approvalHash,profileHash,attemptsHash:b.attemptsHash,baseHelpers:8,extraHelpers:2,turns:1,website:0,useUntil:now()+3600000},h=hash(material)
   const sealed=approvals.seal({workOrder:{approvalId:id,hash:h,material},proposalId:r.id});if(!sealed.ok)throw error('approval_unavailable')
   // Preparation persists no allowance. Only the existing one-use sealed session can apply it.
   save(r,'extension_prepared',{extensionId:id,hash:h,extraHelpers:2,modelsSent:0});extensionTickets.clear();extensionTickets.set(id,session);return{extension:{id,hash:h,material,expiresAt:sealed.record.expiresAt,nonce:approvals.issueNonce({approvalId:id,workOrderHash:h,sessionId:session})}}
  })
  const session=extensionTickets.get(b.id),sealed=approvals.loadSealed(b.id)
  if(!session||!approvals.validSession(session)||!sealed.ok||!approvals.consumeNonce({nonce:b.nonce,approvalId:b.id,displayedHash:b.hash,sessionId:session}).ok)throw error('approval_unavailable')
  extensionTickets.delete(b.id)
  return change(r=>{
   const m=sealed.record.workOrder.material
   if(!r||r.state!=='active'||r.extension||b.hash!==hash(m)||m.rootId!==r.id||m.profileHash!==profileHash||r.attempts.length!==8||hash(r.attempts)!==m.attemptsHash||r.attempts.some(a=>['reserved','dispatched'].includes(a.state))||r.turns[0]?.finished||now()>=m.useUntil)throw error('usage_binding_conflict')
   const w=extension.witnessFor(extensionWitness,m.workId);if(w.commit!==m.commit||w.approvalHash!==m.approvalHash||w.eligible!==true)throw error('usage_binding_conflict');if(w.idle!==true)throw error('usage_idle_required')
   r.extension={id:b.id,kind:'repository_usage_extension_v1',material:m,hash:b.hash,appliedAt:now(),expiresAt:m.useUntil}
   save(r,'extension_applied',{extensionId:b.id,hash:b.hash,actor:'owner',extraHelpers:2,noReset:true});return{budget:statusUnlocked(r)}
  })
 }
 function statusUnlocked(r){return{rootId:r.id,extension:structuredClone(r.extension),helperLimit:10,modelsSent:0}}
 function handle(actor,b){if(actor?.id!=='owner'||actor.role!=='owner')throw error('owner_required');if(!validInput(b))throw error('invalid_request');if(b.op==='usage_status')return{budget:status()}
  if(b.op==='usage_extension_prepare'||b.op==='usage_extension_approve')return extensionAction(b)
  change(old=>{let r=old
   if(b.op==='usage_activate'){if(r?.state==='closed')throw error('usage_run_closed');if(r?.state==='active')return;if(!activationReady||activationReady()!==true)throw error('usage_idle_required');if(!r)r={id:profile.id,identity:profile.identity,profileHash,limits:{...limits},state:'active',turns:[],children:[],attempts:[],timeline:[]};r.state='active';save(r,'activated',{sameApproval:true});return}
   if(!r||r.state!=='active')throw error('usage_run_not_active')
   if(b.op==='usage_bind_turn'){const oldTurn=r.turns.find(t=>t.id===b.turnId);if(oldTurn){if(oldTurn.conversationId!==b.conversationId)throw error('usage_binding_conflict');return}if(r.turns.length>=r.limits.turns)throw error('usage_turn_limit_reached');r.turns.push({id:b.turnId,conversationId:b.conversationId,entered:false,finished:false});save(r,'turn_bound',{turnId:b.turnId});return}
   if(b.op==='usage_reconcile'){if(!activationReady||activationReady()!==true)throw error('usage_idle_required');const pending=r.attempts.filter(a=>['reserved','dispatched'].includes(a.state)),turns=r.turns.filter(t=>t.entered&&!t.finished);if([...pending.flatMap(a=>[a.hostPid,...(a.dispatchPid?[a.dispatchPid]:[])]),...turns.map(t=>t.hostPid)].some(processAlive))throw error('usage_unresolved_work');for(const a of pending){a.state='failed';a.failureCode='interrupted_unknown';a.finishedAt=new Date(now()).toISOString()}for(const t of turns)t.finished=true;for(const c of r.children)c.finished=true;save(r,'owner_reconciled',{attempts:pending.map(a=>a.id),noRefund:true});return}
   if(r.attempts.some(a=>['reserved','dispatched'].includes(a.state))||r.turns.some(t=>t.entered&&!t.finished)||r.children.some(c=>!c.finished))throw error('usage_unresolved_work')
   r.state=b.op==='usage_close'?'closed':'paused';save(r,r.state)
  });return{budget:status()}
 }
 function enterTurn(turnId,conversationId,requestId){return change(r=>{if(!r||r.state!=='active')throw error('usage_run_not_active');const t=r.turns.find(t=>t.id===turnId);if(!t||t.conversationId!==conversationId||!ID.test(requestId||''))throw error('usage_scope_required');if(t.entered)throw error('usage_turn_replayed');t.entered=true;t.requestId=requestId;t.hostPid=process.pid;save(r,'turn_entered',{turnId});return Object.freeze({rootId:r.id,turnId,conversationId,requestId,childId:null})})}
 function finishTurn(s){change(r=>{assertScope(r,s);r.turns.find(t=>t.id===s.turnId).finished=true;save(r,'turn_finished',{turnId:s.turnId})})}
 function withScope(s,fn){const r=load();assertScope(r,s);return context.run({service:api,scope:Object.freeze({...s}),permit:null},fn)}
 function withAllocation(workId,purpose,fn){const c=context.getStore(),r=load();assertScope(r,c?.scope);if(!r.extension)return fn();if(workId!==r.extension.material.workId||!Object.hasOwn(extension.MODELS,purpose))throw error('usage_binding_conflict');return context.run({...c,allocation:{workId,purpose}},fn)}
 function rejection(code,s=context.getStore()?.scope){if(s)change(r=>{assertScope(r,s);r.turns.find(t=>t.id===s.turnId).blocked=code;save(r,'refused',{turnId:s.turnId,code})});return error(code)}
 function turnFailure(s){const r=load();return r?.turns.find(t=>t.id===s.turnId)?.blocked||null}
 function childScope(id){const s=context.getStore()?.scope;if(!ID.test(id||''))throw error('usage_scope_required');change(r=>{assertScope(r,s);const prior=r.children.find(c=>c.id===id);if(prior&&(prior.turnId!==s.turnId||prior.finished))throw error('usage_binding_conflict');if(!prior){if(r.children.length>=128)throw error('usage_child_limit');r.children.push({id,turnId:s.turnId,finished:false});save(r,'child_bound',{childId:id,turnId:s.turnId})}});return Object.freeze({...s,childId:id})}
 function finishChild(s){change(r=>{assertScope(r,s);const c=r.children.find(c=>c.id===s.childId);if(!c)throw error('usage_scope_required');c.finished=true;save(r,'child_finished',{childId:s.childId})})}
 function capture(kind,value,s=context.getStore()?.scope){if(!s)return null;const bytes=JSON.stringify(value===undefined?null:value);if(Buffer.byteLength(bytes)>2000000)throw error('usage_evidence_too_large');if(!/^[a-z_]{1,40}$/.test(kind)||!evidenceDir)throw error('usage_audit_unavailable');const id=crypto.randomUUID(),file=path.join(evidenceDir,id+'.json');fs.mkdirSync(evidenceDir,{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});const ref={id,kind,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)};change(r=>{assertScope(r,s);save(r,'evidence',{turnId:s.turnId,...ref})});return ref}
 function reserve(kind,input={},attemptId=crypto.randomUUID()){
  const s=context.getStore()?.scope,r=load();if(!s&&(!r||r.state!=='active'))return null;if(!s)throw error('usage_scope_required');if(!['helper','website'].includes(kind)||!ID.test(attemptId||''))throw error('invalid_request');if(kind==='helper'&&!acceptsModel(input))throw rejection('usage_model_not_allowed')
  change(row=>{assertScope(row,s);if(row.attempts.some(a=>a.id===attemptId))throw error('usage_attempt_replayed');const allocation=kind==='helper'&&row.extension?extension.assertDispatch(row,extensionWitness,context.getStore()?.allocation,now(),input):{},cap=row.limits[kind]+(kind==='helper'&&row.extension?2:0);if(row.attempts.filter(a=>a.kind===kind).length>=cap){row.turns.find(t=>t.id===s.turnId).blocked='usage_limit_reached';save(row,'limit_refused',{kind,turnId:s.turnId});throw error('usage_limit_reached')}row.attempts.push({id:attemptId,kind,turnId:s.turnId,childId:s.childId,hostPid:process.pid,model:input.model||null,effort:input.effort||null,...allocation,state:'reserved',reservedAt:new Date(now()).toISOString()});save(row,'reserved',{attemptId,kind,turnId:s.turnId})})
  let done=false
  const permit={kind,id:attemptId,service:api,scope:s,claimNative(){return change(row=>{assertScope(row,s);const a=row.attempts.find(a=>a.id===attemptId);if(!a)throw error('usage_attempt_replayed');if(a.nativeClaimed)return false;if(a.state!=='reserved')throw error('usage_attempt_replayed');a.nativeClaimed=true;save(row,'native_claimed',{attemptId});return true})},dispatched(basis,pid=null){if(!['cli_process_started','provider_turn_start'].includes(basis))throw error('invalid_request');change(row=>{const a=row.attempts.find(a=>a.id===attemptId);if(!a||done||!['reserved','dispatched'].includes(a.state))throw error('usage_attempt_replayed');if(a.dispatchedAt)return;a.dispatchedAt=new Date(now()).toISOString();a.dispatchBasis=basis;if(Number.isSafeInteger(pid)&&pid>0)a.dispatchPid=pid;a.state='dispatched';save(row,'dispatched',{attemptId,basis})})},finish(err,result){if(done)return;change(row=>{const a=row.attempts.find(a=>a.id===attemptId);if(!a||!['reserved','dispatched'].includes(a.state))throw error('usage_attempt_replayed');a.state=err?'failed':'succeeded';a.finishedAt=new Date(now()).toISOString();a.failureCode=err?/^[a-z_]+$/.test(err.code||err.message)?err.code||err.message:'provider_failed':null;save(row,'finished',{attemptId,state:a.state,dispatched:!!a.dispatchedAt})});done=true},capture:(name,value)=>capture(name,value,s)}
  return Object.freeze(permit)
 }
 function encode(s,token){if(!validScope(s)||!/^([a-f0-9]{64})$/.test(token||''))throw error('usage_scope_required');const data=Buffer.from(JSON.stringify(s)).toString('base64url');return data+'.'+crypto.createHmac('sha256',token).update('usage-scope-v1:'+data).digest('hex')}
 function withHeader(header,token,fn){if(header===undefined)return context.run({service:api,scope:null,permit:null},fn);if(typeof header!=='string'||header.length>900||!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(header)||!/^[a-f0-9]{64}$/.test(token||''))throw error('usage_scope_required');const[data,signature]=header.split('.'),expected=crypto.createHmac('sha256',token).update('usage-scope-v1:'+data).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw error('usage_scope_required');let s;try{s=JSON.parse(Buffer.from(data,'base64url'))}catch{throw error('usage_scope_required')};return withScope(s,fn)}
 const api={acceptsModel,handle,status,readStatus,enterTurn,finishTurn,withScope,withAllocation,childScope,finishChild,capture,reserve,encode,withHeader,rejection,turnFailure,setActivationWitness:fn=>{activationReady=fn},isActive:()=>load()?.state==='active'};return api
}
let ownerBudget
// The resident LocalService and Owner bridge already share the operational data
// directory. USERPROFILE would silently create two ledgers for these identities.
// resolveDataDir also provides the existing hermetic test redirection.
function ownerDirectory(){return path.join(require('../store/dataDir').resolveDataDir(),'scheduler-action-runs','usage-budget')}
function owner(){
 if(!ownerBudget){
  const dir=ownerDirectory(),store=require('./store').createStore({dir}),evidenceDir=path.join(dir,'evidence')
  // Never hide a paused/active legacy window by selecting an empty ledger.
  const legacy=createUsageBudget({store,evidenceDir})
  if(!['not_activated','closed'].includes(legacy.readStatus().state))throw error('usage_unresolved_work')
  const previous=createUsageBudget({store,evidenceDir,profile:UNDERSTANDING_PROFILE})
  const advice=previous.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:ADVICE_PROFILE}):previous
  const priority=advice.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:PRIORITY_PROFILE}):advice
  const conversation=priority.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:CONVERSATION_PROFILE}):priority
  const goal=conversation.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:GOAL_PROFILE}):conversation
  const clarity=goal.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:CLARITY_PROFILE}):goal
  const planning=clarity.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:PLANNING_PROFILE}):clarity
  ownerBudget=planning.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:CONTINUATION_PROFILE}):planning
 }
 return ownerBudget
}
function service(){return context.getStore()?.service||owner()}
function currentScope(){return context.getStore()?.scope||null}
function currentHeader(token){const s=currentScope();return s?service().encode(s,token):null}
async function observe(kind,input,fn,evidence){const b=service(),p=b.reserve(kind,input);if(!p)return fn(null);return context.run({...context.getStore(),service:b,scope:p.scope,permit:p},async()=>{try{if(evidence)p.capture('provider_input',evidence);const value=await fn(p);p.capture('provider_output',value);p.finish(null,value);return value}catch(e){p.finish(e);throw e}})}
function nativePermit(kind,input){const c=context.getStore();if(c?.permit){if(c.permit.kind!==kind)throw service().rejection('usage_kind_mismatch');if(kind==='helper'&&!service().acceptsModel({model:String(input.model||'').replace(/\[1m\]$/,''),effort:input.effort}))throw service().rejection('usage_model_not_allowed');if(c.permit.claimNative())return{permit:c.permit,owned:false}}const p=service().reserve(kind,input);p?.claimNative();return{permit:p,owned:!!p}}
function guardRPC(rpc,onOwned=()=>{}){return new Proxy(rpc,{get(target,key){if(key==='request')return async(method,params)=>{if(method!=='turn/start')return target.request(method,params);const active=context.getStore()?.permit,kind=active?.kind==='website'?'website':'helper',{permit,owned}=nativePermit(kind,{model:params?.model,effort:params?.effort});if(owned)onOwned(permit);try{permit?.dispatched('provider_turn_start');return await target.request(method,params)}catch(e){if(owned)permit.finish(e);throw e}};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}})}
async function withRPCBudget(rpc,operation){const owned=[];try{const result=await operation(guardRPC(rpc,p=>owned.push(p)));for(const p of owned){p.capture('native_result',result);p.finish(null,result)}return result}catch(e){for(const p of owned)p.finish(e);throw e}}
function blockAPI(){if(currentScope()||service().isActive())throw service().rejection('usage_api_not_allowed')}
// Interactive coding CLIs can make internal turns the host cannot meter. They
// cannot be started in this fixed, read-only conversation acceptance window.
function blockInteractiveWorker(){if(currentScope()||service().isActive())throw service().rejection('usage_operation_not_allowed')}
module.exports={PROFILE,UNDERSTANDING_PROFILE,ADVICE_PROFILE,PRIORITY_PROFILE,CONVERSATION_PROFILE,GOAL_PROFILE,CLARITY_PROFILE,PLANNING_PROFILE,CONTINUATION_PROFILE,isAcceptanceRoot,developmentProfile,ERRORS,validInput,createUsageBudget,ownerDirectory,owner,service,currentScope,currentHeader,observe,nativePermit,guardRPC,withRPCBudget,blockAPI,blockInteractiveWorker}
