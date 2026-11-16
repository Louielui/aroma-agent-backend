'use strict'
// Host selection only. There is no subscription client or fallback in this provider.
const profile=require('../../localBrain/deploymentProfile.json')
const SELECTION=Object.freeze({model:'local:'+profile.model,digest:profile.digest,endpoint:profile.endpoint,context:profile.context,effort:'auto',billing:'local',cloudFallback:false})
function createLocalCodingProvider({env={},fetchFn=globalThis.fetch,onEvent,phase='local_coding'}={}){
  if(!['local_test_draft','local_test_review','local_coding','local_code_review'].includes(phase))throw Error('usage_operation_not_allowed')
  for(const [key,value]of Object.entries({LOCAL_MODEL_URL:profile.endpoint,LOCAL_MODEL:profile.model,LOCAL_MODEL_DIGEST:profile.digest,LOCAL_MODEL_CONTEXT:String(profile.context)}))if(env[key]!==undefined&&String(env[key])!==String(value))throw Error('local_model_selection_mismatch')
  const {LocalAdapter}=require('../../adapters/LocalAdapter')
  const adapter=new LocalAdapter({env:{LOCAL_MODEL_URL:profile.endpoint,LOCAL_MODEL:profile.model,LOCAL_MODEL_DIGEST:profile.digest,LOCAL_MODEL_CONTEXT:String(profile.context)},fetchFn,onEvent})
  function scoped(){const usage=require('../../actions/usageBudget');if(!usage.currentScope())throw Error('usage_scope_required');if(!usage.service().acceptsModel({model:profile.model,effort:'auto'}))throw Error('usage_model_not_allowed')}
  return{selection:SELECTION,async preflight({model=SELECTION.model,effort='auto'}={}){scoped();if(model!==SELECTION.model||effort!=='auto')throw Error('local_model_selection_mismatch');await adapter.preflight();return{model:SELECTION.model,effort:'auto',billing:'local',digest:profile.digest}},async complete(prompt,options={}){scoped();if(options.model!==SELECTION.model||options.effort!=='auto')throw Error('local_model_selection_mismatch');return adapter.complete(prompt,{...options,invocationPhase:phase,maxTokens:4096})}}
}
const ERRORS=new Set(["local_endpoint_invalid","local_endpoint_not_loopback","local_model_digest_invalid","local_model_invalid","local_tokenizer_model_mismatch","local_context_invalid","local_model_not_installed","local_model_digest_mismatch","local_service_unavailable","local_output_budget_invalid","local_schema_unsupported","local_tokenizer_unavailable","local_context_capacity_exceeded","local_cancelled","local_turn_call_limit","local_inference_error","local_output_limit","local_protocol_limit","local_incomplete_response","local_invalid_memory_references","local_timeout_or_cancelled","local_transport_or_protocol_error","local_coding_disabled","local_package_limit","local_model_selection_mismatch"]);for(let status=100;status<=599;status++)ERRORS.add('local_http_'+status)
module.exports={createLocalCodingProvider,SELECTION,ERRORS}
