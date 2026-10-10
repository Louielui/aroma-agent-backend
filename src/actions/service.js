'use strict'
const { randomUUID } = require('node:crypto')
const { TARGETS, hash, target, validInput } = require('./contract')
function createGateway ({ store = require('./store').createStore(), scheduler = require('./windowsScheduler').createScheduler(), approvals = require('../agent/ownerApprovalStore').createOwnerApprovalStore(), now = () => Date.now() } = {}) {
  const sessions=new Map(), busy=new Set()
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
  async function prepare ({inspectionId,targetId,action}, restoreOf=null) {
    target(targetId);const inspection=store.get(inspectionId), row=inspection?.observations?.find(o=>o.target.id===targetId)
    if(inspection?.state!=='inspected'||row?.state!=='CONFIRMED'||!current(row.snapshot))throw Error('investigation_stale')
    const before=await scheduler.read(targetId), enabled=action==='scheduler.resume'
    if(!idle(before))throw Error('task_not_idle')
    if(before.definitionHash!==row.snapshot.definitionHash||before.enabled!==row.snapshot.enabled)throw Error('target_changed')
    if(before.enabled===enabled)throw Error('already_in_requested_state')
    const r={id:randomUUID(),state:'awaiting_approval',timeline:[],target:target(targetId),capability:action,expected:before,desiredEnabled:enabled,inspectionId,restoreOf,previousState:before.enabled,expiresAt:now()+600000,proposedBy:'owner-request',worker:'fixed-windows-scheduler',model:null,
      rollback:{capability:before.enabled?'scheduler.resume':'scheduler.pause',targetId,requiresFreshApproval:true},impact:'future_triggers_only_no_running_process_termination',duplicateState:'UNKNOWN'}
    r.hash=hash({target:r.target,capability:action,expected:before,desiredEnabled:enabled,inspectionId,restoreOf,expiresAt:r.expiresAt})
    const sessionId=approvals.createSession();sessions.set(r.id,sessionId)
    if(!approvals.seal({workOrder:{approvalId:r.id,hash:r.hash},proposalId:r.id}).ok)throw Error('approval_unavailable')
    const nonce=approvals.issueNonce({approvalId:r.id,workOrderHash:r.hash,sessionId})
    record(r,'recommended',{inspectionId,hash:r.hash});return {...view(r),nonce}
  }
  async function approve (b) {
    const r=store.get(b.id), sessionId=sessions.get(b.id),sealed=approvals.loadSealed(b.id)
    if(!r||r.state!=='awaiting_approval'||r.expiresAt<=now()||!sealed.ok||!approvals.validSession(sessionId)||!approvals.consumeNonce({nonce:b.nonce,approvalId:b.id,displayedHash:b.hash,sessionId}).ok||r.hash!==b.hash||sealed.record.workOrder.hash!==r.hash)throw Error('approval_unavailable')
    const expectedHash=hash({target:r.target,capability:r.capability,expected:r.expected,desiredEnabled:r.desiredEnabled,inspectionId:r.inspectionId,restoreOf:r.restoreOf,expiresAt:r.expiresAt})
    if(r.hash!==expectedHash)throw Error('approval_unavailable')
    if(busy.has(r.target.id))throw Error('target_locked')
    const release=store.lock(r.target.id);busy.add(r.target.id)
    try {
      r.state='approved';record(r,'approved',{approvalHash:r.hash,approvedBy:'authenticated_owner'})
      const before=await scheduler.read(r.target.id)
      if(!idle(before))throw Error('task_not_idle')
      if(before.definitionHash!==r.expected.definitionHash||before.enabled!==r.previousState)throw Error('target_changed')
      r.before=before;r.state='executing';record(r,'dispatched',{worker:r.worker})
      // Persist before the side effect; a lost reply can never dispatch the same approval again.
      await scheduler.apply(r.target.id,{action:r.capability,definitionHash:before.definitionHash,enabled:before.enabled})
      record(r,'readback_started')
      const after=await scheduler.read(r.target.id);r.after=after
      if(!idle(after)||after.definitionHash!==before.definitionHash||after.enabled!==r.desiredEnabled)throw Error('verification_failed')
      r.state='verified';record(r,'verified',{beforeEnabled:before.enabled,afterEnabled:after.enabled,running:false});return view(r)
    } catch(e) {
      r.state=r.state==='executing'?'outcome_unknown':'failed';r.reason=['target_changed','task_not_idle','verification_failed','scheduler_unavailable','invalid_scheduler_receipt','audit_unavailable'].includes(e.message)?e.message:'action_unavailable'
      // If saving fails, the last durable dispatched record remains uncertain. Never retry.
      record(r,'failed',{reason:r.reason});return view(r)
    } finally {busy.delete(r.target.id);release()}
  }
  async function restore (id) {
    const old=store.get(id);if(old?.state!=='verified')throw Error('rollback_unavailable')
    const i=await inspect(),o=i.observations.find(o=>o.target.id===old.target.id)
    if(o?.state!=='CONFIRMED'||o.snapshot.definitionHash!==old.after.definitionHash||o.snapshot.enabled!==old.after.enabled)throw Error('target_changed')
    return prepare({inspectionId:i.id,targetId:old.target.id,action:old.rollback.capability},id)
  }
  async function handle (actor,b) {
    if(actor?.id!=='owner'||actor.role!=='owner')throw Error('owner_required')
    if(!validInput(b))throw Error('invalid_request')
    if(b.op==='inspect')return {inspection:await inspect()}
    if(b.op==='list')return {targets:TARGETS,runs:store.list().map(view),duplicateState:'UNKNOWN'}
    if(b.op==='get')return {run:view(store.get(b.id))}
    if(b.op==='prepare')return {run:await prepare(b)}
    if(b.op==='approve')return {run:await approve(b)}
    return {run:await restore(b.id)}
  }
  return {handle,isActive:()=>busy.size>0}
}
module.exports = { createGateway }
