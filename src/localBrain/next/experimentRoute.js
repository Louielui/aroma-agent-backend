
'use strict'
const {sameOrigin}=require('../../core/operating/chatRequest')
const {EXPERIMENTS}=require('./experiment')

function register(router,demoGuard,ownerSession,relay){
  const prefix='/api/v1/demo/experimental'
  const authorize=(req,res,next)=>{
    res.set('Cache-Control','no-store')
    if(!relay)return res.status(404).json({error:'experiment_disabled'})
    if(!ownerSession(req))return res.status(401).json({error:'owner_auth_required'})
    if(req.method==='POST'&&(!sameOrigin(req)||!req.is('application/json')))return res.status(403).json({error:'same_origin_required'})
    next()
  }
  router.get(prefix+'/status',demoGuard,authorize,(_req,res)=>{
    try { res.json({enabled:true,ready:relay.ready(),profiles:EXPERIMENTS,...relay.preference.read()}) }
    catch (_) { res.status(503).json({error:'experiment_preference_unavailable'}) }
  })
  router.post(prefix+'/selection',demoGuard,authorize,async(req,res)=>{
    try { res.json(await relay.preference.save(req.body)) }
    catch (error) {
      const invalid=error.message==='experiment_input_invalid', conflict=error.message==='revision_conflict'
      res.status(invalid?400:conflict?409:503).json({error:invalid?'experiment_input_invalid':conflict?'experiment_revision_conflict':'experiment_preference_unavailable'})
    }
  })
  const submit=action=>async(req,res)=>{
    const cancel=new AbortController()
    res.once('close',()=>{if(!res.writableEnded)cancel.abort()})
    try{
      const result=await relay.call(action,req.body,{signal:cancel.signal})
      if(!cancel.signal.aborted)res.json(result)
    }catch(error){
      if(cancel.signal.aborted)return
      const code=error.message
      const status=code==='experiment_input_invalid'?400:code==='experiment_busy'?409:503
      res.status(status).json({error:/^experiment_[a-z_]{1,55}$/.test(code)?code:'experiment_unavailable'})
    }
  }
  router.post(prefix+'/chat',demoGuard,authorize,submit('chat'))
  router.post(prefix+'/release',demoGuard,authorize,submit('release'))
}

module.exports={register}
