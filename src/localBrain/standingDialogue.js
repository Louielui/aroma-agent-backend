'use strict'

const path = require('node:path')
const usage = require('../actions/usageBudget')
const {hash,ID} = require('../actions/contract')
const {UsageBudgetError} = require('../actions/usageError')
const {profile,CONTROL} = require('../actions/dailyDialoguePolicy')
const deployment = require('./deploymentProfile.json')
const {openStandingStore,dayOf} = require('./standingDialogueStore')

const perMessageLimit = 12
const owner = Object.freeze({id:'owner',role:'owner'})
const fail = code => { throw new UsageBudgetError(code) }

function materialFor(id,commit) {
  if (typeof id!=='string'||!ID.test(id)||id===CONTROL||id!==id.toLowerCase()||
      typeof commit!=='string'||!(/^[a-f0-9]{40}$/).test(commit)) fail('usage_binding_conflict')
  return {id,commit,perMessageLimit,model:deployment.model,digest:deployment.digest}
}

function createStandingDialogue({dir,now,runtimeCommit}) {
  function open(mode,fn) {
    const store=openStandingStore(dir,mode)
    if (!store) return null
    try { return fn(store) } finally { store.close() }
  }
  function checkMaterial(material) {
    if (hash(material)!==hash(materialFor(material.id,runtimeCommit()))) fail('usage_binding_conflict')
  }
  function status(store,grant) {
    const {material,state,epoch}=grant
    const helper=store.totals(material.id)
    const day=dayOf(now()), sourceMatches=material.commit===runtimeCommit()&&
      material.model===deployment.model&&material.digest===deployment.digest
    return {mode:'standing',...material,epoch,state,sourceMatches,expiresAt:null,
      helper:{...helper,limit:null,available:state==='active'&&sourceMatches?null:0},
      today:{date:day,timeZone:'America/Winnipeg',...store.totals(material.id,day)}}
  }
  function manage(operation,id,commit,expectedEpoch) {
    const material=materialFor(id,commit)
    if (commit!==runtimeCommit()) fail('usage_binding_conflict')
    const changed=open(operation==='activate'?'create':'write',store=>store.atomic(()=>{
      const prior=store.grant(id)
      if (operation==='activate') {
        if (prior||store.current()) fail('usage_binding_conflict')
        store.changeGrant(material,'active',1,now())
      } else {
        if (!prior||prior.state==='revoked'||expectedEpoch!==undefined&&expectedEpoch!==prior.epoch)
          fail('usage_binding_conflict')
        if (operation==='resume') checkMaterial(prior.material)
        const next={pause:'paused',resume:'active',revoke:'revoked'}[operation]
        if (!next||next===prior.state) fail('usage_run_not_active')
        store.changeGrant(prior.material,next,prior.epoch+1,now())
      }
      return status(store,store.grant(id))
    }))
    if (!changed) fail('usage_binding_conflict')
    return changed
  }
  function budget(store,grant,requestId,epoch) {
    // An existing strict native budget owns one message. Its internal deadline
    // bounds the message, while the Owner grant itself has no deadline.
    const allocation=profile(requestId,perMessageLimit,86400000)
    return usage.createUsageBudget({store:store.turnStore(requestId,grant.material.id,epoch),
      now,profile:allocation,activationReady:()=>true,evidenceDir:path.join(dir,'standing-evidence'),
      runtimeCommit:()=>{
        const latest=store.grant(grant.material.id)
        if (!latest||latest.state!=='active'||latest.epoch!==epoch) fail('usage_run_not_active')
        checkMaterial(latest.material)
        return runtimeCommit()
      }})
  }
  function admit(conversationId,requestId) {
    const store=openStandingStore(dir,'write')
    if (!store) return null
    let grant, transferred=false
    try {
      grant=store.current()
      if (!grant) return null
      if (grant.state!=='active') fail('usage_run_not_active')
      if (!ID.test(requestId||'')||!ID.test(conversationId||'')) fail('usage_scope_required')
      checkMaterial(grant.material)
      if (usage.isAcceptanceRoot(requestId)||store.turn(requestId)) fail('usage_turn_replayed')
      const b=budget(store,grant,requestId,grant.epoch)
      try {
        b.handle(owner,{op:'usage_local_acceptance_activate',rootId:requestId,predecessorHash:hash([]),commit:grant.material.commit})
      } catch (error) {
        if (error.code==='usage_attempt_replayed') fail('usage_turn_replayed')
        throw error
      }
      const scope=b.enterDailyTurn(conversationId,requestId)
      transferred=true
      return {b,scope,close:store.close}
    } catch (error) {
      if (grant) error.standingGrantId=grant.material.id
      throw error
    } finally { if (!transferred) store.close() }
  }
  function afterTurn(grantId,conversationId,requestId) {
    return open('write',store=>{
      const grant=store.grant(grantId)
      if (!grant) return null
      const saved=store.turn(requestId)
      if (!saved||saved.grantId!==grantId) fail('usage_binding_conflict')
      const snapshot=budget(store,grant,requestId,saved.epoch).status()
      const turn=snapshot.turns.find(t=>t.conversationId===conversationId&&t.requestId===requestId)
      if (!turn?.finished) fail('turn_not_complete')
      return {grantId,turn,attempts:snapshot.attempts,helper:snapshot.helper}
    })
  }
  return {
    currentStatus:()=>open('read',store=>store.snapshot(()=>{const grant=store.current();return grant&&status(store,grant)})),
    status:id=>open('read',store=>store.snapshot(()=>{const grant=store.grant(id);return grant&&status(store,grant)})),
    hasCurrent:()=>open('read',store=>!!store.current()),
    manage,admit,afterTurn
  }
}

module.exports = {createStandingDialogue,materialFor}
