'use strict'
// Native-send substitute only: no HTTP connection or real model is made here.
const usage=require('./usageBudget'),store=require('./store').createStore({dir:process.argv[2]}),s=JSON.parse(process.argv[3]),deployment=require('../localBrain/deploymentProfile.json')
const budget=usage.createUsageBudget({store,evidenceDir:require('node:path').join(process.argv[2],'evidence'),profile:usage.LOCAL_ACCEPTANCE_PROFILE,now:()=>1000000,runtimeCommit:()=>process.argv[4]}),{LocalAdapter}=require('../adapters/LocalAdapter');let sent=0
const adapter=new LocalAdapter({env:{LOCAL_MODEL:deployment.model,LOCAL_MODEL_DIGEST:deployment.digest,LOCAL_MODEL_CONTEXT:String(deployment.context)},fetchFn:async url=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:deployment.model,digest:deployment.digest}]});sent++;await new Promise(r=>setTimeout(r,50));return new Response(JSON.stringify({message:{content:'{}'},done:true})+'\n')}})
budget.readStatus()
Promise.resolve().then(()=>budget.withScope(s,async()=>{for(let i=0;i<8;i++)try{await adapter.complete('offline')}catch(e){if(e.code!=='usage_limit_reached'&&e.code!=='usage_busy')throw e};process.send({sent})})).catch(e=>{process.send({error:e.code||e.message,attempts:budget.readStatus().attempts});process.exitCode=1})
