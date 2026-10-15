'use strict'
const { randomUUID } = require('node:crypto')
const { TARGETS, hash, target, validInput } = require('./contract')
function createGateway ({ store = require('./store').createStore(), scheduler = require('./windowsScheduler').createScheduler(), approvals = require('../agent/ownerApprovalStore').createOwnerApprovalStore(), now = () => Date.now(), procurement = null } = {}) {
  const sessions=new Map(), tickets=new Map(), busy=new Set()
  const record = (r,phase,facts={}) => {r.timeline.push({at:new Date(now()).toISOString(),phase,actor:'owner',...facts});store.save(r)}
  const view = r => {if(!r)return null;const v=structuredClone(r);delete v.nonce;return v}
  const matching = (r,id) => r?.targetId === id && r.taskName===target(id).taskName && r.taskPath===target(id).taskPath
  const current = r => matching(r,r?.targetId) && Number.isFinite(Date.parse(r.at)) && Math.abs(now()-Date.parse(r.at))<=30000
  const idle = r => current(r) && ((r.runtime==='Ready' && r.enabled===true) || (r.runtime==='Disabled' && r.enabled===false))
  async function inspect () {
    const r={id:randomUUID(),state:'inspected',timeline:[],observations:[],duplicateState:'UNKNOWN',proposedBy:'owner-request',worker:'fixed-windows-scheduler',model:null}
    for(const t of TARGETS){try{const o=await scheduler.read(t.id);if(!current(o))throw Error('invalid_scheduler_receipt');r.observations.push({target:t,source:'Windows Task Scheduler fresh exact read',state:'CONFIRMED',snapshot:o})}catch(_){r.observations.push({target:t,state:'UNAVAILABLE'})}}
    record(r,'investigated',{duplicateState:'UNKNOWN'});return view(r)
  }
  async function prepare ({inspectionId,targetId,action}, restoreOf=null, context=null, recommendation=null) {
    target(targetId);const inspection=store.get(inspectionId), row=inspection?.observations?.find(o=>o.target.id===targetId)
    if(inspection?.state!=='inspected'||row?.state!=='CONFIRMED'||!current(row.snapshot))throw Error('investigation_stale')
    const before=await scheduler.read(targetId), enabled=action==='scheduler.resume'
    if(!idle(before))throw Error('task_not_idle')
    if(before.definitionHash!==row.snapshot.definitionHash||before.enabled!==row.snapshot.enabled)throw Error('target_changed')
    if(before.enabled===enabled)throw Error('already_in_requested_state')
    const r={id:randomUUID(),state:'awaiting_approval',timeline:[],target:target(targetId),capability:action,expected:before,desiredEnabled:enabled,inspectionId,restoreOf,previousState:before.enabled,expiresAt:now()+600000,proposedBy:'owner-request',worker:'fixed-windows-scheduler',model:null,
      rollback:{capability:before.enabled?'scheduler.resume':'scheduler.pause',targetId,requiresFreshApproval:true},impact:'future_triggers_only_no_running_process_termination',duplicateState:'UNKNOWN'}
    if(context)r.context=structuredClone(context)
    if(recommendation)r.recommendation=structuredClone(recommendation)
    r.hash=proposalHash(r)
    const sessionId=approvals.createSession();sessions.set(r.id,sessionId)
    if(!approvals.seal({workOrder:{approvalId:r.id,hash:r.hash},proposalId:r.id}).ok)throw Error('approval_unavailable')
    const nonce=approvals.issueNonce({approvalId:r.id,workOrderHash:r.hash,sessionId})
    tickets.set(r.id,nonce)
    record(r,'recommended',{inspectionId,hash:r.hash});return {...view(r),nonce}
  }
  async function approve (b) {
    const r=store.get(b.id), sessionId=sessions.get(b.id),sealed=approvals.loadSealed(b.id)
    if(!r||r.state!=='awaiting_approval'||r.expiresAt<=now()||!sealed.ok||!approvals.validSession(sessionId)||!approvals.consumeNonce({nonce:b.nonce,approvalId:b.id,displayedHash:b.hash,sessionId}).ok||r.hash!==b.hash||sealed.record.workOrder.hash!==r.hash)throw Error('approval_unavailable')
    const expectedHash=proposalHash(r)
    if(r.hash!==expectedHash)throw Error('approval_unavailable')
    tickets.delete(r.id)
    const locks=[r.target.id,...(r.recommendation?[r.recommendation.survivorId]:[])].sort(),releases=[]
    if(locks.some(id=>busy.has(id)))throw Error('target_locked')
    try{for(const id of locks)releases.push(store.lock(id))}catch(e){releases.reverse().forEach(fn=>fn());throw e}
    locks.forEach(id=>busy.add(id))
    try {
      r.state='approved';record(r,'approved',{approvalHash:r.hash,approvedBy:'authenticated_owner',channel:b.channel==='typed_confirmation'?'typed_confirmation':'proposal_button'})
      const before=await scheduler.read(r.target.id)
      if(!idle(before))throw Error('task_not_idle')
      if(before.definitionHash!==r.expected.definitionHash||before.enabled!==r.previousState)throw Error('target_changed')
      if(r.recommendation)await verifyRecommendation(r)
      r.before=before;r.state='executing';record(r,'dispatched',{worker:r.worker})
      // Persist before the side effect; a lost reply can never dispatch the same approval again.
      await scheduler.apply(r.target.id,{action:r.capability,definitionHash:before.definitionHash,enabled:before.enabled})
      record(r,'readback_started')
      const after=await scheduler.read(r.target.id);r.after=after
      if(!idle(after)||after.definitionHash!==before.definitionHash||after.enabled!==r.desiredEnabled)throw Error('verification_failed')
      if(r.recommendation){const survivor=await scheduler.read(r.recommendation.survivorId),expected=r.recommendation.references.find(x=>x.targetId===survivor.targetId);if(!current(survivor)||!survivor.enabled||survivor.definitionHash!==expected.definitionHash)throw Error('verification_failed');record(r,'survivor_verified',{targetId:survivor.targetId,enabled:true,definitionHash:survivor.definitionHash})}
      r.state='verified';record(r,'verified',{beforeEnabled:before.enabled,afterEnabled:after.enabled,running:false});return view(r)
    } catch(e) {
      r.state=r.state==='executing'?'outcome_unknown':'failed';r.reason=['target_changed','task_not_idle','verification_failed','scheduler_unavailable','invalid_scheduler_receipt','audit_unavailable'].includes(e.message)?e.message:'action_unavailable'
      // If saving fails, the last durable dispatched record remains uncertain. Never retry.
      record(r,'failed',{reason:r.reason});return view(r)
    } finally {locks.forEach(id=>busy.delete(id));releases.reverse().forEach(fn=>fn())}
  }
  async function restore (id,context=null) {
    const old=store.get(id);if(old?.state!=='verified')throw Error('rollback_unavailable')
    const i=await inspect(),o=i.observations.find(o=>o.target.id===old.target.id)
    if(o?.state!=='CONFIRMED'||o.snapshot.definitionHash!==old.after.definitionHash||o.snapshot.enabled!==old.after.enabled)throw Error('target_changed')
    return prepare({inspectionId:i.id,targetId:old.target.id,action:old.rollback.capability},id,context)
  }
  async function reconcile(id){
    const r=store.get(id)
    if(!r||!['executing','outcome_unknown'].includes(r.state)||r.hash!==proposalHash(r)||!TARGETS.some(t=>t.id===r.target?.id)||r.timeline.filter(e=>e.phase==='dispatched').length!==1)throw Error('reconciliation_unavailable')
    if(busy.has(r.target.id))throw Error('target_locked')
    const evidence={at:new Date(now()).toISOString(),state:'UNAVAILABLE',provesOriginalExecution:false}
    try{
      const snapshot=await scheduler.read(r.target.id)
      if(!current(snapshot))throw Error('invalid_scheduler_receipt')
      evidence.snapshot=snapshot
      evidence.state=snapshot.definitionHash!==r.expected.definitionHash?'DEFINITION_CHANGED':!idle(snapshot)?'NOT_IDLE':snapshot.enabled===r.desiredEnabled?'MATCHES_DESIRED':'DIFFERS_FROM_DESIRED'
    }catch(_){}
    // Current state does not prove who changed it or recover old approval.
    // Preserve crash locks. This read cannot apply, release a lock or allow rollback.
    r.state='outcome_unknown';r.currentReadback=evidence;record(r,'reconciled',{evidence})
    return view(r)
  }
  function proposalHash(r){return hash({target:r.target,capability:r.capability,expected:r.expected,desiredEnabled:r.desiredEnabled,inspectionId:r.inspectionId,restoreOf:r.restoreOf,expiresAt:r.expiresAt,...(r.context?{context:r.context}:{}),...(r.recommendation?{recommendation:r.recommendation}:{})})}
  async function verifyRecommendation(r){const i=await inspect(),a=require('./recommendations').assess(i,now()),v=a.recommendations.find(x=>x.targetId===r.target.id&&x.survivorId===r.recommendation.survivorId&&x.evidenceHash===r.recommendation.evidenceHash);if(!v)throw Error('target_changed')}
  function chatView(r){const v=view(r);if(v?.state==='awaiting_approval'&&v.expiresAt>now()&&approvals.validSession(sessions.get(v.id))&&approvals.loadSealed(v.id).ok&&tickets.has(v.id))v.nonce=tickets.get(v.id);return v}
  async function handle (actor,b) {
    if(actor?.id!=='owner'||actor.role!=='owner')throw Error('owner_required')
    if(typeof b?.op==='string'&&b.op.startsWith('procurement_')){if(!procurement)throw Error('procurement_not_enabled');return procurement.handle(actor,b)}
    if(!validInput(b))throw Error('invalid_request')
    if(b.op.startsWith('chat_')){
      const op=b.op.slice(5),context={conversationId:b.context.conversationId,investigationId:b.context.investigationId}
      if(op==='recommend'){const i=await inspect(),r=store.get(i.id);r.context=context;r.assessment=require('./recommendations').assess(i,now());record(r,'assessed',{context,configurationOnly:true});return {assessment:r.assessment}}
      if(op==='prepare_recommended'){
        const old=store.get(b.inspectionId),rec=old?.assessment?.recommendations?.find(x=>x.targetId===b.targetId)
        if(!rec||hash(old.context)!==hash(context)||now()-Date.parse(old.assessment.at)>30000)throw Error('investigation_stale')
        const i=await inspect(),assessment=require('./recommendations').assess(i,now()),fresh=assessment.recommendations.find(x=>x.targetId===rec.targetId&&x.survivorId===rec.survivorId&&x.evidenceHash===rec.evidenceHash)
        if(!fresh)throw Error('target_changed')
        return {run:await prepare({inspectionId:i.id,targetId:rec.targetId,action:'scheduler.pause'},null,context,{...fresh,assessmentId:old.id})}
      }
      if(op==='list')return {runs:store.list().filter(r=>r.target&&['scheduler.pause','scheduler.resume'].includes(r.capability)&&r.context&&hash(r.context)===hash(context)).map(chatView)}
      if(op==='prepare')return {run:await prepare(b,null,context)}
      const r=store.get(b.id)
      if(!r?.context||hash(r.context)!==hash(context))throw Error('approval_unavailable')
      if(op==='get')return {run:chatView(r)}
      if(op==='reconcile')return {run:await reconcile(b.id)}
      if(op==='present'||op==='approve_displayed'){
        const live=chatView(r)
        if(!live.nonce||r.hash!==b.hash||proposalHash(r)!==r.hash)throw Error('approval_unavailable')
        if(op==='present'){
          // Re-rendering the same sealed proposal is acknowledgement, never new authority.
          // The live ticket, expiry, context and hash checks above still run on every call.
          if(r.presentation?.hash!==r.hash){r.presentation={hash:r.hash,at:new Date(now()).toISOString()};record(r,'presented',{proposalHash:r.hash,context})}
          return {presented:true,id:r.id,hash:r.hash}
        }
        if(r.presentation?.hash!==r.hash)throw Error('presentation_required')
        return {run:await approve({id:r.id,hash:r.hash,nonce:live.nonce,channel:'typed_confirmation'})}
      }
      if(op==='approve'){tickets.delete(b.id);return {run:await approve(b)}}
      return {run:await restore(b.id,context)}
    }
    // A chat-bound proposal cannot be executed or restored from the generic center.
    if(['approve','restore'].includes(b.op)&&store.get(b.id)?.context)throw Error('approval_unavailable')
    if(b.op==='inspect')return {inspection:await inspect()}
    if(b.op==='list')return {targets:TARGETS,runs:store.list().map(view),duplicateState:'UNKNOWN'}
    if(b.op==='get')return {run:view(store.get(b.id))}
    if(b.op==='reconcile')return {run:await reconcile(b.id)}
    if(b.op==='prepare')return {run:await prepare(b)}
    if(b.op==='approve')return {run:await approve(b)}
    return {run:await restore(b.id)}
  }
  return {handle,procurementActive:()=>procurement?.isActive()===true,scheduledProcurement:()=>{if(!procurement)throw Error('procurement_not_enabled');return procurement.tick()},isActive:()=>busy.size>0||procurement?.isActive()===true}
}
module.exports = { createGateway }
