'use strict'
const {ID,exact}=require('./contract')
// The extension cannot supply an action, HWND, frame, image, executable or URL to a model route.
function createOperatorBroker({request,executor}){
 const running=new Map()
 return async b=>{
  const shapes={operator_start:['op','requestId','question','consent','scope'],operator_next:['op','id','scope','text','targets'],operator_stop:['op','id'],operator_get:['op','id']}
  if(!b||!Object.hasOwn(shapes,b.op)||!exact(b,shapes[b.op])||!ID.test(b.op==='operator_start'?b.requestId:b.id))throw Error('invalid_operator_request')
  if(b.op==='operator_start')return request({...b,op:'start'})
  if(b.op==='operator_get')return request({op:'get',id:b.id})
  if(b.op==='operator_stop'){const result=await request({op:'stop',id:b.id});running.get(b.id)?.abort();return result}
  if(running.has(b.id))throw Error('operation_busy')
  const controller=new AbortController();running.set(b.id,controller)
  try{
   const job=await request({op:'get',id:b.id},controller.signal)
   if(job.state!=='ready')throw Error('operation_unavailable')
   // Bind to the authenticated job before any window observation.
   if(['tabId','windowId','width','height'].some(k=>job.scope[k]!==b.scope?.[k])||new URL(job.scope.url).origin!==new URL(b.scope?.url).origin)throw Error('operation_scope_changed')
   const u=new URL(b.scope.url),fixture=b.scope.url==='http://127.0.0.1:8090/browser-operator-fixture'
   if(!fixture&&(!Number.isSafeInteger(job.companyId)||u.origin!=='https://app.7shifts.com'||u.username||u.password||u.hash||!new RegExp('^/(?:company/'+job.companyId+'/employees(?:/list)?|location/\\d+/schedule/\\d{4}-\\d{2}-\\d{2})$').test(u.pathname)))throw Error('operation_scope_changed')
   const frame=await executor({op:'capture',url:b.scope.url,width:b.scope.width,height:b.scope.height,frame:null,action:null},controller.signal)
   if(controller.signal.aborted)throw Error('operation_stopped')
   const plan=await request({op:'plan',id:b.id,scope:b.scope,frame,text:b.text,targets:b.targets},controller.signal)
   if(plan.state!=='awaiting_input')return plan
   if(controller.signal.aborted)throw Error('operation_stopped')
   // The authenticated backend consumes the ticket once, before the first input.
   const sealed=await request({op:'claim',id:b.id,ticket:plan.ticket},controller.signal)
   if(controller.signal.aborted)return request({op:'stop',id:b.id})
   try{
    const input=await executor({op:'execute',url:sealed.scope.url,width:sealed.scope.width,height:sealed.scope.height,frame:sealed.frame,action:sealed.action},controller.signal)
    if(input?.success!==true)throw Error('native_input_unknown')
   }catch{
    const failed=await request({op:'report',id:b.id,success:false});return failed
   }
   return request({op:'report',id:b.id,success:true})
  }finally{running.delete(b.id)}
 }
}
module.exports={createOperatorBroker}
