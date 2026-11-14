'use strict'
const fs=require('node:fs'),path=require('node:path'),profile=Object.freeze(require('./deploymentProfile.json'))
let active=false,composition=null
function validateEnvironment(env){
 if(env.LOCAL_TEST_FIXTURES||env.LOCAL_MEMORY_SNAPSHOT||env.LOCAL_MEMORY_LEARNING||env.LOCAL_LEARNING_DIR)throw Error('production_fixture_refused')
 for(const key of ['LOCAL_MODEL_URL','LOCAL_OLLAMA_URL'])if(env[key]&&env[key]!==profile.endpoint)throw Error('local_endpoint_refused')
 if(env.LOCAL_TOKENIZER_URL)throw Error('local_tokenizer_model_mismatch')
 if(env.LOCAL_MODEL&&env.LOCAL_MODEL!==profile.model)throw Error('local_model_selection_mismatch')
}
function activate(){
 if(active)return
 validateEnvironment(process.env)
 Object.assign(process.env,{LOCAL_BRAIN_ONLY:'1',LLM_PROVIDER:'local',CHAT_BACKEND:'local',LOCAL_MODEL:profile.model,LOCAL_MODEL_DIGEST:profile.digest,LOCAL_MODEL_URL:profile.endpoint,LOCAL_MODEL_CONTEXT:String(profile.context),WORKER_INVOCATION:'off',DEVELOP_DISPATCH:'off',AGENT_BRIDGE:'off'})
 const dir=path.join(require('../store/dataDir').resolveDataDir(),'local-brain')
 const audit=event=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,require('node:crypto').randomUUID()+'.json'),JSON.stringify({...event,at:new Date().toISOString()}),{flag:'wx',mode:0o600})}
 require('./productionFence').install({audit});active=true
}
function createComposition({dataDir,store,adapter,readConversation,memoryEnabled=true}={}){
 dataDir=dataDir||require('../store/dataDir').resolveDataDir()
 const {LocalAdapter}=require('../adapters/LocalAdapter')
 const provider=adapter||new LocalAdapter()
 const memory=memoryEnabled?require('./productionMemory').createProductionMemory({store:store||require('../memory/structuredStore').createStructuredStore({local:false}),dir:path.join(dataDir,'memory-local-index'),productionDataDir:dataDir,adapter:provider,readConversation}):null
 const model='local:'+profile.model
 return {memory,provider,profile,selectionPolicy:{initialBrain:{model,effort:'auto'},validChoice:v=>v?.model===model&&v?.effort==='auto'},
  catalogue:async()=>{let available=false;try{await provider.preflight();available=true}catch{}return{billing:'local',models:[{model,name:'Local Qwen3.5 9B',provider:'local',available,efforts:['auto'],supportsEffort:false}]}},
  roles:()=>[{role:'Chat, planning and verification',selection:model,status:'Local inference; evidence guards retained'},{role:'Memory capture and consolidation',selection:model,status:'Canonical PostgreSQL; local derived quote index; candidates require Owner approval'},{role:'Subscribed workers and email analysis',selection:'Unavailable in local mode',status:'Not sent; no cloud fallback'}],
  close:()=>memory?.close()}
}
function runtime(){if(!active)return null;return composition||(composition=createComposition({memoryEnabled:process.env.XIANGXIANG_MEMORY==='on',readConversation:id=>require('../store/conversationStore').conversationStore.get(id)}))}
function unavailable(){throw Error('local_capability_unavailable')}
function routeBoundary(req,res,next){
 // Keep existing authentication ahead of this boundary. Read-only stored results
 // remain accessible; no new work or cloud maintenance can be started here.
 if(req.method==='GET'||req.method==='HEAD')return next()
 if(/^\/(?:api\/v1\/)?(?:worker-flow|project-work|project-tasks|project-adoption|development-plan|code-diagnosis|task-plan|scheduler-actions|scheduler-chat|procurement|capability-gaps|browser-operator|browser-read)(?:\/|$)/.test(req.path))return res.status(503).json({error:{code:'local_capability_unavailable',retryable:false}})
 next()
}
module.exports={profile,validateEnvironment,activate,createComposition,runtime,routeBoundary,unavailable,isActive:()=>active}
