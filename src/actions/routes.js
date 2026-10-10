'use strict'
const express=require('express'), {sameOrigin}=require('../core/operating/chatRequest'), {validInput}=require('./contract')
const ERRORS=new Set(['invalid_request','target_not_allowed','investigation_stale','task_not_idle','target_changed','already_in_requested_state','approval_unavailable','rollback_unavailable','target_locked','audit_unavailable'])
function createRouter ({request=b=>require('../adapters/CodexSubscriptionAdapter').localRequest('/scheduler-action',b,process.env,AbortSignal.timeout(60000))}={}) {
  const router=express.Router()
  router.get('/action-center',(req,res)=>res.set('Cache-Control','no-store').type('html').send(require('./view').page()))
  const call=async(res,b)=>{try{res.set('Cache-Control','no-store').json(await request(b))}catch(e){res.status(409).json({error:ERRORS.has(e.message)?e.message:'action_unavailable'})}}
  router.get('/api/v1/scheduler-actions',(req,res)=>call(res,{op:'list'}))
  router.post('/api/v1/scheduler-actions',(req,res)=>{
    if(!sameOrigin(req))return res.status(403).json({error:'same_origin_required'})
    if(!req.is('application/json')||!validInput(req.body)||req.body.op.startsWith('chat_'))return res.status(400).json({error:'invalid_request'})
    return call(res,req.body)
  })
  return router
}
module.exports={createRouter}
