'use strict'
const express=require('express'),{sameOrigin}=require('../core/operating/chatRequest')
function createChatRouter({chat}){
 const router=express.Router()
 router.post('/api/v1/demo/scheduler-actions',async(req,res)=>{
  if(!sameOrigin(req))return res.status(403).json({error:'same_origin_required'})
  if(!req.is('application/json'))return res.status(400).json({error:'invalid_request'})
  try{return res.set('Cache-Control','no-store').json(await chat.handle(req.body))}
  catch(e){const safe=['invalid_request','investigation_unavailable','target_changed','task_not_idle','already_in_requested_state','approval_unavailable','rollback_unavailable','target_locked','investigation_stale','audit_unavailable'];return res.status(e.message==='invalid_request'?400:409).json({error:safe.includes(e.message)?e.message:'action_unavailable'})}
 })
 return router
}
module.exports={createChatRouter}
