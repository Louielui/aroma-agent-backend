'use strict'
// Fixed authenticated loopback control only. It cannot send /complete, memory,
// browser, website, shell or arbitrary provider requests. Never a chat fallback.
const http=require('node:http'),{validInput}=require('../subscription/controlledDispatch')
const enabled=env=>env.LOCAL_BRAIN_ONLY==='1'&&env.XIANGXIANG_CONTROLLED_DISPATCH==='on'
function controlledRequest(input,env=process.env,signal){
 if(!enabled(env))return Promise.reject(Error('controlled_dispatch_disabled'))
 if(!validInput(input)||!/^[a-f0-9]{64}$/.test(env.CODEX_CHAT_BRIDGE_TOKEN||''))return Promise.reject(Error('controlled_dispatch_unavailable'))
 return new Promise((resolve,reject)=>{
  const bytes=JSON.stringify(input),r=http.request({hostname:'127.0.0.1',port:8091,path:'/controlled-dispatch',method:'POST',signal,headers:{authorization:'Bearer '+env.CODEX_CHAT_BRIDGE_TOKEN,'content-type':'application/json','content-length':Buffer.byteLength(bytes)}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',v=>{text+=v;if(text.length>2000000)r.destroy(Error('controlled_dispatch_unavailable'))});res.on('error',()=>reject(Error('controlled_dispatch_unavailable')))
   res.on('end',()=>{try{if(res.statusCode!==200)throw Error();resolve(JSON.parse(text))}catch{reject(Error('controlled_dispatch_unavailable'))}})
  });r.setTimeout(65000,()=>r.destroy(Error('controlled_dispatch_unavailable')));r.on('error',()=>reject(Error('controlled_dispatch_unavailable')));r.end(bytes)
 })
}
function projectRequest(target,input,env=process.env,signal){return env.LOCAL_BRAIN_ONLY==='1'?controlledRequest({target,input},env,signal):require('./CodexSubscriptionAdapter').localRequest(target==='task'?'/project-tasks':'/project-work',input,env,signal)}
async function readStatus({env=process.env,bootCommit,request=controlledRequest,now=Date.now}={}){
 if(!enabled(env))return{state:'disabled',reason:'controlled_dispatch_disabled'}
 try{const v=await request({op:'status'},env,AbortSignal.timeout(5000));if(v.protocol!=='controlled-repository-dispatch-v1'||v.bootCommit!==bootCommit||v.state!=='connected'||v.inferenceStarted!==false||v.requiresScopeApproval!==true||v.requiresUsageApproval!==true||v.requiresCodingApproval!==true||v.cloudFallback!==false||v.workerInference!=='explicit_subscription_work_only'||v.automaticDeployment!==false||!Number.isFinite(Date.parse(v.checkedAt))||Math.abs(now()-Date.parse(v.checkedAt))>30000)throw Error();return{state:'connected',reason:null,bootCommit,scope:'registered_repository_repair',execution:'requires_owner_scope_usage_and_coding_approval',appVisibility:'not_verified',workerInference:'explicit_subscription_work_only'}}catch{return{state:'unavailable',reason:'controlled_dispatch_unconfirmed'}}
}
module.exports={enabled,controlledRequest,projectRequest,readStatus}
