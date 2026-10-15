'use strict'
const express=require('express'),{sameOrigin}=require('../core/operating/chatRequest'),{UUID,GOAL}=require('./procurementContract')
function createRouter({chat,serviceGuard,scheduledRequest=b=>require('../adapters/CodexSubscriptionAdapter').localRequest('/procurement-tick',b,process.env,AbortSignal.timeout(180000))}){
 const router=express.Router()
 router.get('/api/v1/procurement',async(req,res)=>{try{res.set('Cache-Control','no-store').json(await chat.status())}catch{res.status(503).json({error:'schedule_unavailable'})}})
 router.post('/api/v1/demo/procurement-actions',async(req,res)=>{const b=req.body;if(!sameOrigin(req))return res.status(403).json({error:'same_origin_required'});if(!req.is('application/json')||!b||Object.keys(b).sort().join(',')!=='conversationId,hash,id,op,requestId'||!['present','approve'].includes(b.op)||!UUID.test(b.id)||!GOAL.test(b.hash)||!UUID.test(b.conversationId)||!UUID.test(b.requestId))return res.status(400).json({error:'invalid_request'});try{res.set('Cache-Control','no-store').json(await chat[b.op](b))}catch{res.status(409).json({error:'approval_unavailable'})}})
 router.post('/api/v1/procurement/tick',serviceGuard||((req,res)=>res.status(503).json({error:'service_authentication_unavailable'})),async(req,res)=>{if(!req.is('application/json')||!req.body||Array.isArray(req.body)||Object.keys(req.body).length)return res.status(400).json({error:'invalid_request'});try{const result=await scheduledRequest({});res.set('Cache-Control','no-store').status(result.error||result.run?.state==='FAILED'?503:200).json(result)}catch{res.status(503).json({error:'procurement_unavailable'})}})
 return router
}
module.exports={createRouter}
