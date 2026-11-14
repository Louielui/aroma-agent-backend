'use strict'
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks'),{events}=require('../adapters/LocalAdapter')
function middleware({dataDir}){return(req,res,next)=>{
 if(req.method!=='POST')return next()
 if(req.body?.chatModel&&req.body.chatModel!=='local:'+process.env.LOCAL_MODEL)return res.status(400).json({error:{code:'local_model_selection_mismatch',retryable:false}})
 // The formal Model Center owns the immutable local profile; cloud hints cannot
 // select another provider and a local model ID need not enter the cloud parser.
 if(req.body)delete req.body.chatModel
 const start=performance.now(),trace=[],stream=req.headers.accept==='text/event-stream',original=res.json.bind(res),abort=new AbortController()
 res.on('close',()=>{if(!res.writableEnded)abort.abort()})
 const emit=event=>{
  // Full model inputs/deltas are not written to a second production prompt log.
  if(event.type==='model_input'||event.type==='model_delta')return
  const safe={type:event.type,phase:event.phase,callId:event.callId,provider:event.provider,timing:event.timing,durationMs:event.durationMs,code:event.code,atMs:performance.now()-start}
  trace.push(safe)
  if(stream&&!res.writableEnded)require('./server').writeLocalEvent(res,safe)
 }
 emit.signal=abort.signal;emit.budget={sent:0,limit:12}
 res.json=body=>{
  if(res.destroyed)return res
  const timing={totalMs:performance.now()-start},receipt={at:new Date().toISOString(),requestId:body.requestId||null,provider:'local',model:process.env.LOCAL_MODEL,timing,trace,memoryReceipt:res.locals.memoryReceipt||null}
  const dir=path.join(dataDir,'local-brain');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,require('node:crypto').randomUUID()+'.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600})
  if(stream){require('./server').writeLocalEvent(res,{type:'final',body,timing,memoryReceipt:receipt.memoryReceipt});res.end();return res}
  return original({...body,localTiming:timing,memoryReceipt:receipt.memoryReceipt})
 }
 events.run(emit,next)
}}
module.exports={middleware}
