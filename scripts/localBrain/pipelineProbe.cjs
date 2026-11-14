'use strict'
// Explicit integration test: the existing intake runs once; no HTTP service,
// background job, production store, subscription channel or worker is started.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
async function main(){
 const evidence='C:/Users/louis/Documents/Codex/local-candidates/local-brain-20261114'
 const dataDir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/pipeline-')
 Object.assign(process.env,{LOCAL_BRAIN_ONLY:'1',LLM_PROVIDER:'local',CHAT_BACKEND:'local',LOCAL_MODEL_CONTEXT:process.env.LOCAL_MODEL_CONTEXT||'32768',AROMA_DATA_DIR:dataDir,READ_ACCESS:'on',XIANGXIANG_MEMORY:'on',A4_KNOWLEDGE_ROUTING:'on',GOAL_DECOMPOSER:'on',TURN_ROUTER:'on',CONVERSATION_DEMO:'on'})
 if(!process.env.LOCAL_MODEL||process.env.LOCAL_MODEL==='qwen3:8b')process.env.LOCAL_TOKENIZER_URL='http://127.0.0.1:11437'
 for(const key of Object.keys(process.env))if(/API_KEY|HUB_TOKEN|BRIDGE_TOKEN|OWNER_PASSWORD|DATABASE_URL|PGPASSWORD/.test(key))delete process.env[key]
 const egress=[];require('../../src/localBrain/isolation').install({tokenizerPort:11437,audit:e=>egress.push(e)})
 const {createGateway,OWNER}=require('../../src/memory/governed')
 const rows=JSON.parse(fs.readFileSync(evidence+'/memory-source-snapshot.json','utf8'))
 const gateway=createGateway({store:{get:async id=>rows.find(r=>r.id===id)||null,all:async()=>structuredClone(rows),generalRows:async()=>structuredClone(rows),grants:async()=>[]}})
 const {LocalAdapter,events}=require('../../src/adapters/LocalAdapter'),trace=[],start=performance.now()
 const emit=e=>trace.push({...e,atMs:performance.now()-start})
 emit.budget={sent:0,limit:12}
 const scenarioArg=process.argv.find(a=>a.startsWith('--scenario='))
 if(scenarioArg)emit.scenario=scenarioArg.slice('--scenario='.length)
 const memoryClient=Object.fromEntries(['recall','get','preferences'].map(method=>[method,async(...args)=>{const t=performance.now();try{return await gateway[method](OWNER,...args)}finally{emit({type:'memory_complete',method,durationMs:performance.now()-t})}}]))
 let readContextDeps
 if(process.argv.includes('--fixture')){process.env.CONTEXT_AROMA_SYSTEM='on';readContextDeps={...require('../../src/intake/a4Runtime').createA4RuntimeDependencies({env:process.env}).deps,connector:require('../../src/localBrain/fixtures').createFixtureConnector({context:()=>events.getStore()})}}
 const message=process.argv[2]||'香香，早安。請用一句簡短中文回應。'
 const {processIntake}=require('../../src/intake/intakeService')
 let result,error
 await events.run(emit,async()=>{try{result=await processIntake(message,new LocalAdapter(),[],{demo:true,interactionMode:'chat',memoryClient,readContextDeps,requestId:crypto.randomUUID(),latencySink:(label,body)=>{try{emit({type:'pipeline_phase',label,...JSON.parse(body)})}catch{}}})}catch(e){error={code:e.code||e.name,message:e.message}}})
 const receipt={at:new Date().toISOString(),message,model:process.env.LOCAL_MODEL||'qwen3:8b',totalMs:performance.now()-start,result,error,trace,egress,dataDir}
 const file=path.join(evidence,'pipeline-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(receipt,null,2))
 console.log(JSON.stringify({file,totalMs:receipt.totalMs,reply:result?.reply,error,calls:trace.filter(e=>e.type==='model_complete').length,failed:trace.filter(e=>e.type==='model_failed'),egressDenied:egress.filter(e=>e.type==='egress_denied').length}))
}
main().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1})
