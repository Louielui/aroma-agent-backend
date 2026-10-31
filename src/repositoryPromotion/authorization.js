'use strict'
const {randomUUID}=require('node:crypto')
const {hash}=require('../actions/contract')
const {SHA,VERSION,classifyChanges}=require('./policy')
const KINDS=Object.freeze(['scope','hold_release','deployment'])
const OPERATIONS=Object.freeze(['publish_checks','merge_exact_pr','reload_local_assistant','publish_existing_client','verify','rollback_exact_source'])
const authorities=new WeakSet()
const owner=actor=>{if(actor?.id!=='owner'||actor?.role!=='owner')throw Error('owner_required')}
function validateMaterial(material){
 if(!material||![material.commit,material.tree,material.base].every(s=>SHA.test(s||''))||!Number.isSafeInteger(material.pr)||material.pr<1||
  !Array.isArray(material.paths)||!material.paths.length||material.paths.some(p=>typeof p!=='string'||p.includes('..')||p.startsWith('/')||p.includes('\\'))||
  !Array.isArray(material.operations)||!material.operations.length||new Set(material.operations).size!==material.operations.length||material.operations.some(op=>!OPERATIONS.includes(op)))throw Error('invalid_promotion_material')
 if(classifyChanges(material.paths).some(c=>c!=='security_permission_change'))throw Error('unsupported_promotion_exception')
 return JSON.parse(JSON.stringify(material))
}
function createPromotionActions({store,approvals=require('../agent/ownerApprovalStore').createOwnerApprovalStore(),now=()=>Date.now()}={}){
 if(!store)throw Error('approval_store_required')
 const sessions=new Map()
 const record=(r,event,facts={})=>{r.timeline.push({at:new Date(now()).toISOString(),actor:'owner',event,...facts});store.save(r)}
 async function prepare(actor,input,kind){
  owner(actor);if(!KINDS.includes(kind))throw Error('invalid_approval_kind')
  const material=validateMaterial(input),id=randomUUID(),session=approvals.createSession(),r={id,kind,material,state:'awaiting_approval',expiresAt:now()+600000,recoveryUntil:now()+600000,timeline:[]}
  r.hash=hash({kind,material,expiresAt:r.expiresAt,recoveryUntil:r.recoveryUntil})
  if(!approvals.seal({workOrder:{approvalId:id,hash:r.hash},proposalId:id}).ok)throw Error('approval_unavailable')
  sessions.set(id,session);const nonce=approvals.issueNonce({approvalId:id,workOrderHash:r.hash,sessionId:session})
  record(r,'prepared');return{...structuredClone(r),nonce}
 }
 async function approve(actor,input){
  owner(actor);const r=store.get(input?.id),session=sessions.get(input?.id),sealed=approvals.loadSealed(input?.id)
  if(!r||r.state!=='awaiting_approval'||!approvals.validSession(session)||!sealed.ok||!approvals.consumeNonce({nonce:input.nonce,approvalId:r.id,displayedHash:input.hash,sessionId:session}).ok||
   r.expiresAt<=now()||r.hash!==input.hash||r.material.commit!==input.commit||r.kind!==input.decision||sealed.record.workOrder.hash!==r.hash||r.hash!==hash({kind:r.kind,material:r.material,expiresAt:r.expiresAt,recoveryUntil:r.recoveryUntil}))throw Error('approval_unavailable')
  r.state='approved';record(r,'approved',{commit:r.material.commit,kind:r.kind});return structuredClone(r)
 }
 function claim(actor,ids,input){
  owner(actor);const material=validateMaterial(input),rows=['scope','hold','deployment'].map(key=>store.get(ids?.[key]))
  if(rows.some((r,i)=>r?.kind!==KINDS[i])||new Set(rows.map(r=>r?.id)).size!==3)throw Error('distinct_approval_kinds_required')
  if(rows.some(r=>r.state==='claimed'))throw Error('approval_already_claimed')
  if(rows.some(r=>r.state!=='approved'||r.expiresAt<=now()||!sessions.has(r.id)||!approvals.loadSealed(r.id).ok))throw Error('approval_unavailable')
  if(rows.some(r=>hash(r.material)!==hash(material)||r.hash!==hash({kind:r.kind,material:r.material,expiresAt:r.expiresAt,recoveryUntil:r.recoveryUntil})))throw Error('approval_material_changed')
  const claimId=randomUUID(),expiry=Math.min(...rows.map(r=>r.expiresAt)),recoveryUntil=Math.min(...rows.map(r=>r.recoveryUntil)),materialHash=hash(material)
  // Persist consumption before returning a capability. Partial persistence can
  // only strand an approval; it cannot replay an already claimed deployment.
  for(const r of rows){r.state='claimed';r.claimId=claimId;record(r,'claimed',{claimId})}
  function assertMaterial(input){if(hash(validateMaterial(input))!==materialHash)throw Error('approval_material_changed');for(const r of rows){const current=store.get(r.id);if(current?.state!=='claimed'||current.claimId!==claimId||current.hash!==r.hash||current.hash!==hash({kind:current.kind,material:current.material,expiresAt:current.expiresAt,recoveryUntil:current.recoveryUntil}))throw Error('approval_unavailable')}}
  const authority={id:claimId,commit:material.commit,expiresAt:expiry,materialHash,
   assertForward(input){assertMaterial(input);if(now()>=expiry)throw Error('deployment_authorization_expired')},
   assertRecovery(input){assertMaterial(input);if(now()>=recoveryUntil||!material.operations.includes('rollback_exact_source'))throw Error('recovery_authorization_expired')},
   exceptions(commit,paths){this.assertForward(material);if(commit!==material.commit||hash(paths.slice().sort())!==hash(material.paths.slice().sort()))throw Error('approval_material_changed');return classifyChanges(paths).map(category=>({category,commit,policyVersion:VERSION,actor:'owner',source:'authenticated_owner',id:claimId}))},
   note(stage){if(!['checks','merge','deploy','verify','rollback'].includes(stage))throw Error('invalid_promotion_stage');record(store.get(rows[2].id),'stage',{stage,claimId})}
  }
  Object.freeze(authority);authorities.add(authority);return authority
 }
 async function handle(actor,input){
  if(input?.op==='promotion_prepare'&&Object.keys(input).sort().join(',')==='decision,material,op')return{run:await prepare(actor,input.material,input.decision)}
  if(input?.op==='promotion_approve'&&Object.keys(input).sort().join(',')==='commit,decision,hash,id,nonce,op'){const{op,...rest}=input;return{run:await approve(actor,rest)}}
  throw Error('invalid_request')
 }
 return{prepare,approve,claim,handle,snapshot:id=>{const r=store.get(id);return r?structuredClone(r):null}}
}
const isPromotionAuthority=value=>!!value&&authorities.has(value)
module.exports={createPromotionActions,isPromotionAuthority,validateMaterial,OPERATIONS,KINDS}
