'use strict'
// Host selection only. There is no subscription client or fallback in this provider.
const profile=require('../../localBrain/deploymentProfile.json')
const SELECTION=Object.freeze({model:'local:'+profile.model,digest:profile.digest,endpoint:profile.endpoint,context:profile.context,effort:'auto',billing:'local',cloudFallback:false})
function createLocalCodingProvider({env={},fetchFn=globalThis.fetch,onEvent}={}){
  for(const [key,value]of Object.entries({LOCAL_MODEL_URL:profile.endpoint,LOCAL_MODEL:profile.model,LOCAL_MODEL_DIGEST:profile.digest,LOCAL_MODEL_CONTEXT:String(profile.context)}))if(env[key]!==undefined&&String(env[key])!==String(value))throw Error('local_model_selection_mismatch')
  const {LocalAdapter}=require('../../adapters/LocalAdapter')
  const adapter=new LocalAdapter({env:{LOCAL_MODEL_URL:profile.endpoint,LOCAL_MODEL:profile.model,LOCAL_MODEL_DIGEST:profile.digest,LOCAL_MODEL_CONTEXT:String(profile.context)},fetchFn,onEvent})
  function scoped(){const usage=require('../../actions/usageBudget');if(!usage.currentScope())throw Error('usage_scope_required');if(!usage.service().acceptsModel({model:profile.model,effort:'auto'}))throw Error('usage_model_not_allowed')}
  return{selection:SELECTION,async preflight({model=SELECTION.model,effort='auto'}={}){scoped();if(model!==SELECTION.model||effort!=='auto')throw Error('local_model_selection_mismatch');await adapter.preflight();return{model:SELECTION.model,billing:'local',digest:profile.digest}},async complete(prompt,options={}){scoped();if(options.model!==SELECTION.model||options.effort!=='auto')throw Error('local_model_selection_mismatch');return adapter.complete(prompt,{...options,invocationPhase:'local_coding',maxTokens:4096})}}
}
module.exports={createLocalCodingProvider,SELECTION}
