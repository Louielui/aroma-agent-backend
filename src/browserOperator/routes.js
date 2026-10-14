'use strict'
const express=require('express')
function createRouter({service}){
 const router=express.Router()
 router.post('/api/v1/browser-operator',async(req,res)=>{
  res.set('Cache-Control','no-store')
  if(req.headers.origin)return res.status(403).json({error:'native_broker_required'})
  if(!req.is('application/json'))return res.status(415).json({error:'invalid_operator_request'})
  try{res.json(await service.handle(req.body))}catch(e){res.status(409).json({error:/^(?:operation_|invalid_operator_|input_ticket_|model_unavailable)/.test(e.message)&&/^[a-z_]+$/.test(e.message)?e.message:'operation_unavailable'})}
 })
 return router
}
module.exports={createRouter}
