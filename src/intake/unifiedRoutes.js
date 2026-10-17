'use strict'
const {SESSION_COOKIE,readCookie}=require('../governance/ownerAuth')
const {validate,TASK}=require('./unifiedContract')
function createRouter({intake,browserRead,conversations}){
 const router=require('express').Router(),base='/api/v1/demo/task-intake'
 const sessionValid=req=>{try{return req.app.locals.conversationDemo===true&&req.app.locals.ownerSessions?.valid(readCookie(req,SESSION_COOKIE))===true}catch{return false}}
 router.use(base,(req,res,next)=>{
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff')
  const valid=sessionValid(req)
  const origin=req.get('origin'),host=req.get('host'),site=req.get('sec-fetch-site')
  if(!valid||!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host||'')||['cross-site','same-site'].includes(site)||(origin&&origin!=='http://'+host))return res.status(403).json({error:'owner_session_required'})
  if(Object.keys(req.query).length)return res.status(400).json({error:'invalid_unified_request'})
  next()
 })
 const errors=new Set(['unified_intake_disabled','task_not_found','submission_conflict','revision_conflict','new_objective_requires_new_task','prior_attempt_active','intake_interrupted_no_retry','task_attempt_limit','clarification_pending','clarification_unavailable','clarification_scope_changed','clarification_interrupted','clarification_evidence_changed'])
 const failed=(res,e)=>res.status(e.message==='owner_session_required'?403:e.message==='invalid_unified_request'?400:errors.has(e.message)?409:503).json({error:errors.has(e.message)||['invalid_unified_request','owner_session_required'].includes(e.message)?e.message:'task_intake_unavailable'})
 router.get(base+'/configuration',(req,res)=>res.json({enabled:intake.enabled()===true}))
 router.get(base+'/:id',(req,res)=>{try{if(!TASK.test(req.params.id))throw Error('invalid_unified_request');res.json(intake.view(req.params.id,{principal:'owner',surface:'main'}))}catch(e){failed(res,e)}})
 router.post(base+'/:id/cancel',async(req,res)=>{
  try{
   const b=req.body
   if(!req.is('application/json')||!b||Object.keys(b).sort().join(',')!=='attemptId,expectedRevision'||!TASK.test(req.params.id))throw Error('invalid_unified_request')
   const v=intake.view(req.params.id,{principal:'owner',surface:'main'})
   if(b.expectedRevision!==v.revision||b.attemptId!==v.attemptId)throw Error('revision_conflict')
   if(!v.executionRef)throw Error('task_not_found')
   if(['WAITING_CLARIFICATION','PROCESSING_CLARIFICATION'].includes(v.executionState))intake.cancelClarification(v.taskId,b.expectedRevision,b.attemptId,{principal:'owner',surface:'main'})
   await browserRead.cancelMain(v.executionRef.id)
   res.json(intake.view(req.params.id,{principal:'owner',surface:'main'}))
  }catch(e){failed(res,e)}
 })
 router.post(base,async(req,res)=>{
  try{
   if(!req.is('application/json'))throw Error('invalid_unified_request')
   const b=validate(req.body)
   // Existing conversation IDs are checked by the store, not trusted as scope.
   // A new UUID is a new Owner conversation; a missing/deleted old task binding
   // is never used to load private history into the native transport.
   conversations.get(b.conversationId)
   const verifyOwner=()=>{if(!sessionValid(req))throw Error('owner_session_required')}
   const result=await browserRead.handleMain(b,b.operation==='clarification_response'?verifyOwner:undefined)
   if(b.operation==='clarification_response')verifyOwner()
   const projection=intake.viewAttempt(result.unifiedTask.taskId,result.unifiedTask.attemptId,{principal:'owner',surface:'main'})
   let historySaved=false
   if(['completed','failed','cancelled','interrupted'].includes(result.state))try{conversations.appendTurn({id:b.conversationId,userText:b.operation==='clarification_response'?b.response:b.message,replyText:result.result?.text||projection.executionState,unifiedTask:result.unifiedTask});historySaved=true}catch{}
   return res.json({reply:result.result?.text||projection.executionState,lane:'chat',historySaved,unifiedTask:projection})
  }catch(e){failed(res,e)}
 })
 return router
}
module.exports={createRouter}
