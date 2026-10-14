'use strict'
const {SESSION_COOKIE,readCookie}=require('../governance/ownerAuth')
function createRouter({view}){
 const router=require('express').Router(),base='/api/v1/demo/browser-work'
 router.use(base,(req,res,next)=>{
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff')
  let valid=false;try{valid=req.app.locals.conversationDemo===true&&req.app.locals.ownerSessions?.valid(readCookie(req,SESSION_COOKIE))===true}catch{}
  const origin=req.get('origin'),host=req.get('host'),site=req.get('sec-fetch-site')
  if(!valid||!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host||'')||['cross-site','same-site'].includes(site)||(origin&&origin!=='http://'+host))return res.status(403).json({error:'owner_session_required'})
  if(req.method!=='GET')return res.status(405).set('Allow','GET').json({error:'browser_work_read_only'})
  if(Object.keys(req.query).length)return res.status(400).json({error:'invalid_browser_work_request'})
  next()
 })
 const respond=(res,fn)=>{try{res.json(fn())}catch(e){const status=e.message==='invalid_browser_work_request'?400:e.message==='browser_work_not_found'?404:503;res.status(status).json({error:status===400?'invalid_browser_work_request':status===404?'browser_work_not_found':'browser_work_unavailable'})}}
 router.get(base,(req,res)=>respond(res,()=>view.list()))
 router.get(base+'/:kind/:id',(req,res)=>respond(res,()=>view.detail(req.params.kind,req.params.id)))
 return router
}
module.exports={createRouter}
