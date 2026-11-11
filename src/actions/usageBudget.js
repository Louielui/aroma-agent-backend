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
// Inert proposal for the remaining Markdown presentation case. The spent root
// remains resident until separate Owner closure; source installation grants none.
const MARKDOWN_PROFILE=Object.freeze({id:'f0d3cc98-ab8a-42f8-8576-f9ccae9d01b7',identity:'owner-planning-markdown-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Proposed draft-intent retest only; no allowance exists on installation. The
// paused Markdown root remains selected until separately approved closure.
const DRAFT_PROFILE=Object.freeze({id:'dfdc4b48-8463-4ac1-8629-d2beed9cecf7',identity:'owner-proposal-draft-intent-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Inert context-handoff verification proposal. The paused draft root remains
// selected until separately approved closure; this definition grants no usage.
const HANDOFF_PROFILE=Object.freeze({id:'2b1ae609-da43-460f-a18e-445b91adda88',identity:'owner-planning-context-handoff-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Inert final-verifier retest proposal. Installation cannot close the paused
// handoff root, transfer unused attempts or activate this separate definition.
const VERIFIER_PROFILE=Object.freeze({id:'08cb9cff-cad8-4b3c-9aea-323a947dd253',identity:'owner-final-verifier-context-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Inert exact-edit retest proposal: installation does not close or reactivate
// the paused final-verifier root and grants no model allowance.
const EDIT_PROFILE=Object.freeze({id:'95f9ab4d-7d67-4a72-b679-1b4f4f058ffb',identity:'owner-advice-edit-contract-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Inert proposed-object retest; the paused advice-edit root remains selected.
// No installation, restart or child task can create or transfer this allowance.
const SCOPE_PROFILE=Object.freeze({id:'588208a8-ec9b-4ddf-86c4-0ff410e7e7b5',identity:'owner-proposal-clause-scope-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Inert learning-continuity proposal. Neither installation nor a closed prior
// window grants this allowance; separate Owner activation is still required.
const LEARNING_PROFILE=Object.freeze({id:'22f0a3c0-2c6b-4eaa-976f-13cb17169f92',identity:'owner-learning-continuity-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',models:[{model:'claude-opus-5-5',effort:'medium'},{model:'claude-sonnet',effort:'low'}],turns:3,helper:18,website:0})
// Inert latency comparison proposal. Installation cannot close the exhausted
// learning window, transfer unused attempts or activate this separate root.
const LATENCY_PROFILE=Object.freeze({id:'f1d1f674-3820-4619-85ed-3b8fdeb01e98',identity:'owner-chat-latency-acceptance-20261105',model:'claude-opus-5-5',effort:'medium',turns:3,helper:18,website:0})
// Proposed independent retest only. The previous root must remain paused and
// byte-preserved; deployment does not create or activate this allowance.
const MEMORY_ARBITRATION_PROFILE=Object.freeze({id:'6181f0ad-90d7-4c89-9886-39671ce75a05',identity:'owner-memory-arbitration-acceptance-20261106',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Inert AI-list acceptance proposal. Both historical windows stay paused;
// neither installation nor deployment creates this ledger or transfers capacity.
const DELEGATION_LIST_PROFILE=Object.freeze({id:'c31f97a9-f3d5-4510-a04f-ec257a843747',identity:'owner-ai-delegation-list-acceptance-20261108',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
const DELEGATION_RETEST_PROFILE=Object.freeze({id:'71adc697-16fd-4df3-9cbd-59e94d16c5c1',identity:'owner-ai-delegation-list-retest-20261108',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Inert speed retest. All four paused predecessors are byte-bound; installation grants no allowance.
const SPEED_PROFILE=Object.freeze({id:'483bd416-3f28-4133-bad7-5493963f4bd0',identity:'owner-ai-list-speed-acceptance-20261110',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
// Inert foreground retest: five paused predecessors stay byte-bound. Source
// installation grants no allowance and cannot revive the spent speed turn.
const FOREGROUND_PROFILE=Object.freeze({id:'d4654bf0-3e8a-4991-8c51-81aa34359960',identity:'owner-ai-model-foreground-retest-20261111',model:'claude-opus-5-5',effort:'medium',turns:1,helper:6,website:0})
function isAcceptanceRoot(id){return id===PROFILE.id||id===UNDERSTANDING_PROFILE.id||id===ADVICE_PROFILE.id||id===PRIORITY_PROFILE.id||id===CONVERSATION_PROFILE.id||id===GOAL_PROFILE.id||id===CLARITY_PROFILE.id||id===PLANNING_PROFILE.id||id===CONTINUATION_PROFILE.id||id===MARKDOWN_PROFILE.id||id===DRAFT_PROFILE.id||id===HANDOFF_PROFILE.id||id===VERIFIER_PROFILE.id||id===EDIT_PROFILE.id||id===SCOPE_PROFILE.id||id===LEARNING_PROFILE.id||id===LATENCY_PROFILE.id||id===MEMORY_ARBITRATION_PROFILE.id||id===DELEGATION_LIST_PROFILE.id||id===DELEGATION_RETEST_PROFILE.id||id===SPEED_PROFILE.id||id===FOREGROUND_PROFILE.id}
const SHAPES={usage_activate:['op'],usage_status:['op'],usage_pause:['op'],usage_close:['op'],usage_reconcile:['op'],usage_bind_turn:['op','turnId','conversationId']}
SHAPES.usage_acceptance_activate=['op','rootId','predecessorHash']
SHAPES.usage_extension_prepare=['op','workId','commit','attemptsHash']
SHAPES.usage_extension_approve=['op','id','hash','nonce']
const ERRORS=new Set(['usage_store_required','usage_not_enabled','usage_busy','usage_audit_unavailable','usage_run_not_active','usage_scope_required','usage_run_closed','usage_binding_conflict','usage_turn_limit_reached','usage_unresolved_work','usage_turn_replayed','usage_child_limit','usage_evidence_too_large','usage_model_not_allowed','usage_attempt_replayed','usage_limit_reached','usage_kind_mismatch','usage_api_not_allowed','usage_idle_required','usage_operation_not_allowed'])
for(const code of ['usage_extension_unavailable','usage_extension_expired','usage_allocation_required','usage_allocation_exhausted'])ERRORS.add(code)
ERRORS.add('usage_profile_not_allowed')
const validInput=b=>!!b&&!Array.isArray(b)&&Object.hasOwn(SHAPES,b.op)&&Object.keys(b).sort().join(',')===SHAPES[b.op].slice().sort().join(',')&&(b.op!=='usage_bind_turn'||ID.test(b.turnId||'')&&ID.test(b.conversationId||''))
const error=code=>Object.assign(Error(code),{code})
const scopeKeys='childId,conversationId,requestId,rootId,turnId'
function validScope(s){return !!s&&Object.keys(s).sort().join(',')===scopeKeys&&[s.rootId,s.turnId,s.conversationId,s.requestId].every(v=>ID.test(v||''))&&(s.childId===null||ID.test(s.childId||''))}
function developmentProfile(id){if(!ID.test(id||'')||isAcceptanceRoot(id))throw error('usage_profile_not_allowed');return{id,identity:'owner-repository-repair:'+id,turns:1,helper:8,website:0,models:[{model:'gpt-6.1-sol',effort:'high'},{model:'claude-sonnet-5-5',effort:'medium'}]}}
function createUsageBudget({store,evidenceDir,now=Date.now,activationReady=null,profile=PROFILE,extensionWitness=null,approvals=require('../agent/ownerApprovalStore').createOwnerApprovalStore({now}),processAlive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}}}={}){
 if(!store?.lockRun)throw error('usage_store_required')
 profile=structuredClone(profile)
 if(hash(profile)!==hash(PROFILE)&&hash(profile)!==hash(UNDERSTANDING_PROFILE)&&hash(profile)!==hash(ADVICE_PROFILE)&&hash(profile)!==hash(PRIORITY_PROFILE)&&hash(profile)!==hash(CONVERSATION_PROFILE)&&hash(profile)!==hash(GOAL_PROFILE)&&hash(profile)!==hash(CLARITY_PROFILE)&&hash(profile)!==hash(PLANNING_PROFILE)&&hash(profile)!==hash(CONTINUATION_PROFILE)&&hash(profile)!==hash(MARKDOWN_PROFILE)&&hash(profile)!==hash(DRAFT_PROFILE)&&hash(profile)!==hash(HANDOFF_PROFILE)&&hash(profile)!==hash(VERIFIER_PROFILE)&&hash(profile)!==hash(EDIT_PROFILE)&&hash(profile)!==hash(SCOPE_PROFILE)&&hash(profile)!==hash(LEARNING_PROFILE)&&hash(profile)!==hash(LATENCY_PROFILE)&&hash(profile)!==hash(MEMORY_ARBITRATION_PROFILE)&&hash(profile)!==hash(DELEGATION_LIST_PROFILE)&&hash(profile)!==hash(DELEGATION_RETEST_PROFILE)&&hash(profile)!==hash(SPEED_PROFILE)&&hash(profile)!==hash(FOREGROUND_PROFILE)&&hash(profile)!==hash(developmentProfile(profile.id)))throw error('usage_profile_not_allowed')
 const predecessors=profile.id===FOREGROUND_PROFILE.id?[LATENCY_PROFILE,MEMORY_ARBITRATION_PROFILE,DELEGATION_LIST_PROFILE,DELEGATION_RETEST_PROFILE,SPEED_PROFILE]:profile.id===SPEED_PROFILE.id?[LATENCY_PROFILE,MEMORY_ARBITRATION_PROFILE,DELEGATION_LIST_PROFILE,DELEGATION_RETEST_PROFILE]:profile.id===DELEGATION_RETEST_PROFILE.id?[LATENCY_PROFILE,MEMORY_ARBITRATION_PROFILE,DELEGATION_LIST_PROFILE]:profile.id===DELEGATION_LIST_PROFILE.id?[LATENCY_PROFILE,MEMORY_ARBITRATION_PROFILE]:profile.id===MEMORY_ARBITRATION_PROFILE.id?[LATENCY_PROFILE]:[],independent=predecessors.length>0
 function predecessorHash(){
  const bindings=predecessors.map(p=>{
   const previous=createUsageBudget({store,profile:p}).readStatus(),row=store.get(p.id)
   if(previous.state!=='paused'||previous.helper.unresolved||previous.website.unresolved||previous.turns.some(t=>t.entered&&!t.finished)||row.children.some(c=>!c.finished))throw error('usage_unresolved_work')
   return{rootId:p.id,hash:hash(row)}
  })
  return bindings.length===1?bindings[0].hash:hash(bindings)
 }
 const limits={turns:profile.turns,helper:profile.helper,website:profile.website}
 const acceptsModel=input=>(profile.models||[{model:profile.model,effort:profile.effort}]).some(m=>m.model===input.model&&m.effort===input.effort)
 const profileHash=hash(profile)
 const extensionTickets=new Map(),isDevelopment=profile.identity==='owner-repository-repair:'+profile.id
 function load(locked=false){if(!locked){try{if(store.exists?.(profile.id)===false)return null}catch{throw error('usage_audit_unavailable')};return change(r=>r)}let r;try{r=store.get(profile.id)}catch{throw error('usage_audit_unavailable')};if(!r)return null
  if(r.profileHash!==profileHash||r.identity!==profile.identity||JSON.stringify(r.limits)!==JSON.stringify(limits)||!['active','paused','closed'].includes(r.state)||!Array.isArray(r.turns)||r.turns.length>limits.turns||!Array.isArray(r.attempts)||!Array.isArray(r.children)||r.children.length>128||new Set(r.turns.map(t=>t.id)).size!==r.turns.length||new Set(r.attempts.map(t=>t.id)).size!==r.attempts.length||r.attempts.filter(a=>a.kind==='helper').length>limits.helper+(r.extension&&isDevelopment?2:0)||r.attempts.filter(a=>a.kind==='website').length>limits.website||r.attempts.some(a=>!ID.test(a.id||'')||!['helper','website'].includes(a.kind)||!['reserved','dispatched','succeeded','failed'].includes(a.state)||!r.turns.some(t=>t.id===a.turnId)||a.kind==='helper'&&!acceptsModel(a)))throw error('usage_audit_unavailable')
  try{if(r.extension&&(!isDevelopment||!extension.validGrant(r,profileHash))||!r.extension&&r.attempts.some(a=>a.extensionId||a.allocation))throw error('usage_audit_unavailable')}catch{throw error('usage_audit_unavailable')}
  if(r.turns.some(t=>!ID.test(t.id||'')||!ID.test(t.conversationId||'')||typeof t.entered!=='boolean'||typeof t.finished!=='boolean'||t.entered&&(!ID.test(t.requestId||'')||!Number.isSafeInteger(t.hostPid)))||r.children.some(c=>!ID.test(c.id||'')||typeof c.finished!=='boolean'||!r.turns.some(t=>t.id===c.turnId))||r.attempts.some(a=>!Number.isSafeInteger(a.hostPid)||a.dispatchedAt&&!['cli_process_started','provider_turn_start'].includes(a.dispatchBasis)))throw error('usage_audit_unavailable')
  if(independent&&r.predecessorHash!==predecessorHash())throw error('usage_binding_conflict')
  return r
 }
 function change(fn){const releases=[];try{for(const p of predecessors)releases.push(store.lockRun(p.id));releases.push(store.lockRun(profile.id))}catch{releases.reverse().forEach(release=>release());throw error('usage_busy')};try{const r=load(true);const value=fn(r);return value}finally{releases.reverse().forEach(release=>release())}}
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
  if(b.op==='usage_acceptance_activate'&&!independent)throw error('usage_profile_not_allowed')
  if(independent&&b.op==='usage_activate')throw error('usage_operation_not_allowed')
  if(b.op==='usage_extension_prepare'||b.op==='usage_extension_approve')return extensionAction(b)
  change(old=>{let r=old
   if(b.op==='usage_acceptance_activate'){
    if(b.rootId!==profile.id)throw error('usage_profile_not_allowed')
    if(r)throw error('usage_attempt_replayed')
    if(!/^[a-f0-9]{64}$/.test(b.predecessorHash||'')||b.predecessorHash!==predecessorHash())throw error('usage_binding_conflict')
    if(!activationReady||activationReady()!==true)throw error('usage_idle_required')
    r={id:profile.id,identity:profile.identity,profileHash,limits:{...limits},predecessorHash:b.predecessorHash,state:'active',turns:[],children:[],attempts:[],timeline:[]}
    save(r,'activated',{actor:'owner',independent:true,predecessorId:predecessors.at(-1).id,...(predecessors.length>1?{predecessorIds:predecessors.map(p=>p.id)}:{}),predecessorHash:b.predecessorHash});return
   }
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
 function nativeRejection(code){const e=rejection(code);const s=context.getStore()?.scope;if(s)change(r=>{assertScope(r,s).nativeBlocked=code;save(r,'native_refused',{turnId:s.turnId,code})});return e}
 function turnFailure(s){const r=load();return r?.turns.find(t=>t.id===s.turnId)?.blocked||null}
 function childScope(id){const s=context.getStore()?.scope;if(!ID.test(id||''))throw error('usage_scope_required');change(r=>{assertScope(r,s);const prior=r.children.find(c=>c.id===id);if(prior&&(prior.turnId!==s.turnId||prior.finished))throw error('usage_binding_conflict');if(!prior){if(r.children.length>=128)throw error('usage_child_limit');r.children.push({id,turnId:s.turnId,finished:false});save(r,'child_bound',{childId:id,turnId:s.turnId})}});return Object.freeze({...s,childId:id})}
 function finishChild(s){change(r=>{assertScope(r,s);const c=r.children.find(c=>c.id===s.childId);if(!c)throw error('usage_scope_required');c.finished=true;save(r,'child_finished',{childId:s.childId})})}
 function capture(kind,value,s=context.getStore()?.scope){if(!s)return null;const bytes=JSON.stringify(value===undefined?null:value);if(Buffer.byteLength(bytes)>2000000)throw error('usage_evidence_too_large');if(!/^[a-z_]{1,40}$/.test(kind)||!evidenceDir)throw error('usage_audit_unavailable');const id=crypto.randomUUID(),file=path.join(evidenceDir,id+'.json');fs.mkdirSync(evidenceDir,{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});const ref={id,kind,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)};change(r=>{assertScope(r,s);save(r,'evidence',{turnId:s.turnId,...ref})});return ref}
 function reserve(kind,input={},attemptId=crypto.randomUUID()){
  const s=context.getStore()?.scope,r=load();if(!s&&(!r||r.state!=='active'))return null;if(!s)throw error('usage_scope_required');if(!['helper','website'].includes(kind)||!ID.test(attemptId||''))throw error('invalid_request');if(kind==='helper'&&!acceptsModel(input))throw rejection('usage_model_not_allowed')
  const blocked=assertScope(r,s).nativeBlocked;if(blocked)throw error(blocked)
  change(row=>{assertScope(row,s);if(row.attempts.some(a=>a.id===attemptId))throw error('usage_attempt_replayed');const allocation=kind==='helper'&&row.extension?extension.assertDispatch(row,extensionWitness,context.getStore()?.allocation,now(),input):{},cap=row.limits[kind]+(kind==='helper'&&row.extension?2:0);if(row.attempts.filter(a=>a.kind===kind).length>=cap){row.turns.find(t=>t.id===s.turnId).blocked='usage_limit_reached';save(row,'limit_refused',{kind,turnId:s.turnId});throw error('usage_limit_reached')}row.attempts.push({id:attemptId,kind,turnId:s.turnId,childId:s.childId,hostPid:process.pid,model:input.model||null,effort:input.effort||null,...allocation,state:'reserved',reservedAt:new Date(now()).toISOString()});save(row,'reserved',{attemptId,kind,turnId:s.turnId})})
  let done=false
  const selected=Object.freeze({model:input.model||null,effort:input.effort||null})
  const permit={kind,id:attemptId,service:api,scope:s,matchesSelection:value=>value.model===selected.model&&value.effort===selected.effort,claimNative(native={}){return change(row=>{const blocked=assertScope(row,s).nativeBlocked;if(blocked)throw error(blocked);const a=row.attempts.find(a=>a.id===attemptId);if(!a)throw error('usage_attempt_replayed');if(a.nativeClaimed)return false;if(a.state!=='reserved')throw error('usage_attempt_replayed');a.nativeClaimed=true;if(kind==='helper'){a.nativeModel=native.model||null;a.nativeEffort=native.effort||null}save(row,'native_claimed',{attemptId});return true})},dispatched(basis,pid=null){if(!['cli_process_started','provider_turn_start'].includes(basis))throw error('invalid_request');change(row=>{const a=row.attempts.find(a=>a.id===attemptId);if(!a||done||!['reserved','dispatched'].includes(a.state))throw error('usage_attempt_replayed');if(a.dispatchedAt)return;a.dispatchedAt=new Date(now()).toISOString();a.dispatchBasis=basis;if(Number.isSafeInteger(pid)&&pid>0)a.dispatchPid=pid;a.state='dispatched';save(row,'dispatched',{attemptId,basis})})},finish(err,result){if(done)return;change(row=>{const a=row.attempts.find(a=>a.id===attemptId);if(!a||!['reserved','dispatched'].includes(a.state))throw error('usage_attempt_replayed');a.state=err?'failed':'succeeded';a.finishedAt=new Date(now()).toISOString();a.failureCode=err?/^[a-z_]+$/.test(err.code||err.message)?err.code||err.message:'provider_failed':null;save(row,'finished',{attemptId,state:a.state,dispatched:!!a.dispatchedAt})});done=true},capture:(name,value)=>capture(name,value,s)}
  return Object.freeze(permit)
 }
 function encode(s,token){if(!validScope(s)||!/^([a-f0-9]{64})$/.test(token||''))throw error('usage_scope_required');const data=Buffer.from(JSON.stringify(s)).toString('base64url');return data+'.'+crypto.createHmac('sha256',token).update('usage-scope-v1:'+data).digest('hex')}
 function withHeader(header,token,fn){if(header===undefined)return context.run({service:api,scope:null,permit:null},fn);if(typeof header!=='string'||header.length>900||!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(header)||!/^[a-f0-9]{64}$/.test(token||''))throw error('usage_scope_required');const[data,signature]=header.split('.'),expected=crypto.createHmac('sha256',token).update('usage-scope-v1:'+data).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw error('usage_scope_required');let s;try{s=JSON.parse(Buffer.from(data,'base64url'))}catch{throw error('usage_scope_required')};return withScope(s,fn)}
 const api={acceptsModel,handle,status,readStatus,enterTurn,finishTurn,withScope,withAllocation,childScope,finishChild,capture,reserve,encode,withHeader,rejection,nativeRejection,turnFailure,setActivationWitness:fn=>{activationReady=fn},isActive:()=>load()?.state==='active'};return api
}
// A long-lived Bridge and backend resolve the same durable selection on every
// call, not only at boot. No selection file or second accounting store exists.
function createIndependentAcceptanceEntry({store,evidenceDir}={}){
 const previous=createUsageBudget({store,evidenceDir,profile:LATENCY_PROFILE}),next=createUsageBudget({store,evidenceDir,profile:MEMORY_ARBITRATION_PROFILE}),delegation=createUsageBudget({store,evidenceDir,profile:DELEGATION_LIST_PROFILE}),retest=createUsageBudget({store,evidenceDir,profile:DELEGATION_RETEST_PROFILE}),speed=createUsageBudget({store,evidenceDir,profile:SPEED_PROFILE}),foreground=createUsageBudget({store,evidenceDir,profile:FOREGROUND_PROFILE})
 // Selection participates in the existing writer lock. In particular Windows
 // readers must not hold the destination open during another host's rename.
 const selected=()=>foreground.status().state!=='not_activated'?foreground:speed.status().state!=='not_activated'?speed:retest.status().state!=='not_activated'?retest:delegation.status().state!=='not_activated'?delegation:next.status().state==='not_activated'?previous:next
 return new Proxy(next,{get(target,key){
  if(key==='setActivationWitness')return fn=>{next.setActivationWitness(fn);delegation.setActivationWitness(fn);retest.setActivationWitness(fn);speed.setActivationWitness(fn);foreground.setActivationWitness(fn)}
  if(key==='handle')return(actor,b)=>{
   if(actor?.id!=='owner'||actor.role!=='owner')throw error('owner_required')
   if(!validInput(b))throw error('invalid_request')
   if(b.op==='usage_acceptance_activate')return(b.rootId===FOREGROUND_PROFILE.id?foreground:b.rootId===SPEED_PROFILE.id?speed:b.rootId===DELEGATION_RETEST_PROFILE.id?retest:b.rootId===DELEGATION_LIST_PROFILE.id?delegation:next).handle(actor,b)
   const current=selected()
   if(current===previous&&b.op!=='usage_status')throw error('usage_operation_not_allowed')
   return current.handle(actor,b)
  }
  if(typeof target[key]==='function')return(...args)=>selected()[key](...args)
  return target[key]
 }})
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
  const continuation=planning.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:CONTINUATION_PROFILE}):planning
  const markdown=continuation.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:MARKDOWN_PROFILE}):continuation
  const draft=markdown.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:DRAFT_PROFILE}):markdown
  const handoff=draft.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:HANDOFF_PROFILE}):draft
  const verifier=handoff.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:VERIFIER_PROFILE}):handoff
  const edit=verifier.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:EDIT_PROFILE}):verifier
  const scope=edit.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:SCOPE_PROFILE}):edit
  const learning=scope.readStatus().state==='closed'?createUsageBudget({store,evidenceDir,profile:LEARNING_PROFILE}):scope
  ownerBudget=learning.readStatus().state==='closed'?createIndependentAcceptanceEntry({store,evidenceDir}):learning
 }
 return ownerBudget
}
function service(){return context.getStore()?.service||owner()}
function currentScope(){return context.getStore()?.scope||null}
function currentHeader(token){const s=currentScope();return s?service().encode(s,token):null}
async function observe(kind,input,fn,evidence){const b=service(),p=b.reserve(kind,input);if(!p)return fn(null);return context.run({...context.getStore(),service:b,scope:p.scope,permit:p},async()=>{try{if(evidence)p.capture('provider_input',evidence);const value=await fn(p);p.capture('provider_output',value);p.finish(null,value);return value}catch(e){p.finish(e);throw e}})}
const normalizedModel=value=>String(value||'').replace(/\[1m\]$/,'')
function withClaudeSelection(input,resolvedModel,fn){
 const c=context.getStore();if(!c?.scope)return fn()
 const model=normalizedModel(resolvedModel),same=model===input.model,alias=input.model==='claude-sonnet'&&/^claude-sonnet-\d[\da-z.-]*$/.test(model)
 if(!service().acceptsModel(input)||!same&&!alias)throw service().nativeRejection('usage_model_not_allowed')
 return context.run({...c,nativeSelection:Object.freeze({requested:Object.freeze({model:input.model,effort:input.effort}),model,effort:input.effort})},fn)
}
function nativePermit(kind,input){
 const c=context.getStore(),native={model:normalizedModel(input.model),effort:input.effort},binding=kind==='helper'?c?.nativeSelection:null
 if(binding&&(native.model!==binding.model||native.effort!==binding.effort))throw service().nativeRejection('usage_model_not_allowed')
 const selected=binding?.requested||input
 if(c?.permit){if(c.permit.kind!==kind)throw service().rejection('usage_kind_mismatch');if(kind==='helper'&&(!service().acceptsModel(selected)||!c.permit.matchesSelection(selected)))throw service().nativeRejection('usage_model_not_allowed');if(c.permit.claimNative(native))return{permit:c.permit,owned:false}}
 const p=service().reserve(kind,selected);p?.claimNative(native);return{permit:p,owned:!!p}
}
function guardRPC(rpc,onOwned=()=>{}){return new Proxy(rpc,{get(target,key){if(key==='request')return async(method,params)=>{if(method!=='turn/start')return target.request(method,params);const active=context.getStore()?.permit,kind=active?.kind==='website'?'website':'helper',{permit,owned}=nativePermit(kind,{model:params?.model,effort:params?.effort});if(owned)onOwned(permit);try{permit?.dispatched('provider_turn_start');return await target.request(method,params)}catch(e){if(owned)permit.finish(e);throw e}};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}})}
async function withRPCBudget(rpc,operation){const owned=[];try{const result=await operation(guardRPC(rpc,p=>owned.push(p)));for(const p of owned){p.capture('native_result',result);p.finish(null,result)}return result}catch(e){for(const p of owned)p.finish(e);throw e}}
function blockAPI(){if(currentScope()||service().isActive())throw service().rejection('usage_api_not_allowed')}
// Interactive coding CLIs can make internal turns the host cannot meter. They
// cannot be started in this fixed, read-only conversation acceptance window.
function blockInteractiveWorker(){if(currentScope()||service().isActive())throw service().rejection('usage_operation_not_allowed')}
module.exports={PROFILE,UNDERSTANDING_PROFILE,ADVICE_PROFILE,PRIORITY_PROFILE,CONVERSATION_PROFILE,GOAL_PROFILE,CLARITY_PROFILE,PLANNING_PROFILE,CONTINUATION_PROFILE,MARKDOWN_PROFILE,DRAFT_PROFILE,HANDOFF_PROFILE,VERIFIER_PROFILE,EDIT_PROFILE,SCOPE_PROFILE,LEARNING_PROFILE,LATENCY_PROFILE,MEMORY_ARBITRATION_PROFILE,DELEGATION_LIST_PROFILE,DELEGATION_RETEST_PROFILE,SPEED_PROFILE,FOREGROUND_PROFILE,isAcceptanceRoot,developmentProfile,ERRORS,validInput,createUsageBudget,createIndependentAcceptanceEntry,ownerDirectory,owner,service,currentScope,currentHeader,observe,withClaudeSelection,nativePermit,guardRPC,withRPCBudget,blockAPI,blockInteractiveWorker}
