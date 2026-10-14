'use strict'
const express=require('express')
const ERRORS=new Set(['invalid_request','invalid_source','site_not_allowed','capture_stale','source_changed','consent_required','approval_unavailable','read_not_found','request_changed','model_unavailable','browser_read_busy','audit_unavailable','read_capacity_reached','conversation_source_changed','conversation_limit_reached','conversation_unavailable','task_unavailable'])
function createRouter({service}){
 const router=express.Router()
 router.post('/api/v1/browser-read',async(req,res)=>{
  res.set('Cache-Control','no-store')
  // Native broker only: never relax the browser-origin/CSRF boundary.
  if(req.headers.origin)return res.status(403).json({error:'native_broker_required'})
  if(!req.is('application/json'))return res.status(415).json({error:'invalid_request'})
  try{return res.json(await service.handle(req.body))}catch(e){return res.status(409).json({error:ERRORS.has(e.message)?e.message:'browser_read_unavailable'})}
 })
 return router
}
module.exports={createRouter}
