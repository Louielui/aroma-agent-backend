'use strict'
const path=require('node:path'),usage=require('../../actions/usageBudget'),{createStore}=require('../../actions/store')
const OWNER={id:'owner',role:'owner'}
function createRepositoryBudget({dir}){
 const store=createStore({dir}),get=id=>usage.createUsageBudget({profile:usage.developmentProfile(id),store,evidenceDir:path.join(dir,'evidence'),activationReady:()=>true})
 return {
  activate(id){const b=get(id);if(b.status().state!=='not_activated')throw Error('usage_attempt_replayed');b.handle(OWNER,{op:'usage_activate'});b.handle(OWNER,{op:'usage_bind_turn',turnId:id,conversationId:id});return b.enterTurn(id,id,id)},
  status:id=>get(id).status(),
  async run(id,fn){const b=get(id),s=b.status();if(s.state!=='active'||s.helper.unresolved)throw Error('usage_unresolved_work');const t=s.turns.find(t=>t.id===id);if(!t?.entered||t.finished)throw Error('usage_scope_required');return b.withScope({rootId:id,turnId:id,conversationId:id,requestId:id,childId:null},fn)}
 }
}
module.exports={createRepositoryBudget}
