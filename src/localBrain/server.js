'use strict'
// Isolated composition of the existing authenticated demo intake and Memory Gateway.
// No production app startup or dispatch worker. Local learning is explicit opt-in.
const fs = require('node:fs'), path = require('node:path'), {performance}=require('node:perf_hooks')
function learningRequestAllowed(req,enabled){
 if(!enabled)return false
 if(req.method==='GET')return req.path==='/local/memory'||/^\/api\/v1\/memory\/catalog(?:\/xx-[a-f0-9-]+)?$/.test(req.path)
 return req.method==='POST'&&req.path==='/api/v1/memory/catalog'&&['observe','propose','transition','index','consolidate','reflect','recall','decision','consolidationSettings'].includes(req.body?.op)
}
function createLocalApp({dataDir, sourceRows = [], ownerPassword, onEvent = () => {}, connector} ) {
  if (process.env.LOCAL_BRAIN_ONLY !== '1' || !path.isAbsolute(dataDir)) throw Error('local_isolation_required')
  fs.mkdirSync(dataDir,{recursive:true})
  const sourceHash=require('./buildIdentity').buildIdentity(path.resolve(__dirname,'../..'))
  if(process.env.LOCAL_BUILD_SHA256&&process.env.LOCAL_BUILD_SHA256!==sourceHash)throw Error('local_source_changed_during_launch')
  const express=require('express'), app=express()
  const {LocalAdapter,events}=require('../adapters/LocalAdapter')
  const auth=require('../governance/ownerAuth'),sessions=auth.createSessionStore()
  const {createGateway,OWNER}=require('../memory/governed')
  const rows=structuredClone(sourceRows)
  const conversationStore=require('../store/conversationStore').createConversationStore({dataDir})
  const learning=process.env.LOCAL_MEMORY_LEARNING==='1'?require('./learning').createLearning({dir:process.env.LOCAL_LEARNING_DIR,adapter:new LocalAdapter({onEvent}),sourceRows:rows,readConversation:id=>conversationStore.get(id)}):null
  const gateway=learning?.gateway||createGateway({store:{get:async id=>rows.find(r=>r.id===id)||null,all:async()=>structuredClone(rows),generalRows:async()=>structuredClone(rows),grants:async()=>[]}})
  const measuredMemory=async(method,...args)=>{const start=performance.now();try{return await gateway[method](OWNER,...args)}finally{events.getStore()?.({type:'memory_complete',method,durationMs:performance.now()-start})}}
  const memoryClient={preferences:()=>measuredMemory('preferences'),recall:(q,o)=>measuredMemory('recall',q,o),get:id=>measuredMemory('get',id)}
  const selected='local:'+(process.env.LOCAL_MODEL||'qwen3:8b')
  const catalogue=async()=>{let available=false;try{await new LocalAdapter().preflight();available=true}catch{}return {billing:'local',models:[{model:selected,name:'本機 Qwen3',provider:'local',available,efforts:['auto'],supportsEffort:false}]}}
  const center=require('../modelCenter/service').createModelCenter({dataDir,catalogue,selectionPolicy:{initialBrain:{model:selected,effort:'auto'},validChoice:v=>v?.model===selected&&v?.effort==='auto'}})
  app.locals.conversationDemo=true; app.locals.ownerSessions=sessions
  if (connector) app.locals.a4ReadDepsOverride={connector}
  app.use(express.json({limit:'128kb'}))
  app.use(express.urlencoded({extended:false,limit:'4kb'}))
  app.use(require('../routes/ownerAuthRouter').createOwnerAuthRouter({sessions,isConfigured:()=>!!ownerPassword,resolvePassword:()=>ownerPassword}))
  app.use(auth.createRequireOwner({sessions,isConfigured:()=>!!ownerPassword,onUnauthenticated:(req,res)=>req.method==='GET'&&req.accepts('html')?res.redirect('/owner/login?next=/local'):res.status(401).json({error:'owner_auth_required'})}))
  // The isolated host exposes no command, worker, write or production API routes.
  app.use((req,res,next)=>{
    const allowed=learningRequestAllowed(req,!!learning)||(req.method==='GET'&&['/local','/api/local/status','/model-center','/api/v1/model-center'].includes(req.path))||
      (req.method==='PUT'&&req.path==='/api/v1/model-center/brain')||
      (req.method==='POST'&&req.path==='/api/v1/demo/intake')
    if(!allowed)return res.status(403).json({error:'local_operation_not_authorized'})
    if(req.method!=='GET'&&!require('../core/operating/chatRequest').sameOrigin(req))return res.status(403).json({error:'same_origin_required'})
    next()
  })
  app.get('/local',(req,res)=>res.type('html').send(fs.readFileSync(path.join(__dirname,'view.html'),'utf8')))
  app.get('/api/local/status',(req,res)=>res.set('Cache-Control','no-store').json({sourceHash,provider:'local',model:process.env.LOCAL_MODEL||'qwen3:8b',scope:'isolated',memory:learning?'isolated_local_learning':'source_snapshot_read_only',semanticMemory:'lexical_only',background:learning?{capture:learning.runtime.status(),consolidation:learning.runtime.consolidation.status(),engine:learning.engine.status()}:'not_started',cloudFallback:false,dispatch:'not_enabled'}))
  if(learning){
    app.get('/local/memory',(req,res)=>res.type('html').send(require('../memory/governedView').buildHtml().replace('<main>','<main><p>隔離記憶副本 · 本機抽取與整理 · 字詞檢索 · 候選須批准。正式資料、Agent 授權、備份及業務工作不在此頁操作範圍。</p>')))
    app.use(require('../memory/governedRoutes').createGovernedRouter({gateway,runtime:learning.runtime}))
  }
  app.use(require('../modelCenter/routes').createModelCenterRouter({center,catalogue,roles:()=>[{role:'對話、理解、規劃、驗證',selection:selected,status:'本機候選，待行為驗收'},{role:'記憶檢索',selection:learning?'既有 Memory Gateway＋本機持久索引':'既有 Memory Gateway 唯讀來源快照',status:'無雲端推理；字詞檢索，無向量索引'},{role:'背景學習',selection:learning?selected:'未啟動',status:learning?'僅隔離記憶抽取、整理；候選須批准':'沒有執行權限'},{role:'業務排程與派工',selection:'未啟動',status:'沒有執行權限'}]}))
  app.use('/api/v1/demo/intake',(req,res,next)=>{
    if (!require('../core/operating/chatRequest').sameOrigin(req)) return res.status(403).json({error:'same_origin_required'})
    if (req.body.interactionMode && req.body.interactionMode!=='chat') return res.status(403).json({error:'local_acceptance_chat_only'})
    if (req.body.chatModel && req.body.chatModel!=='local:'+(process.env.LOCAL_MODEL||'qwen3:8b')) return res.status(400).json({error:'local_model_selection_mismatch'})
    // Host selection is immutable for this isolated process; no cloud hint can change it.
    delete req.body.chatModel; req.body.interactionMode='chat'
    const start=performance.now(), trace=[]
    const cancellation=new AbortController()
    res.on('close',()=>{if(!res.writableEnded)cancellation.abort()})
    const stream=req.headers.accept==='text/event-stream', original=res.json.bind(res)
    const emit=event=>{trace.push({...event,atMs:performance.now()-start});onEvent(event);if(event.type==='model_input')return;if(stream&&!res.writableEnded){if(!res.headersSent)res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.write('data: '+JSON.stringify(event)+'\n\n')}}
    emit.signal=cancellation.signal
    emit.budget={sent:0,limit:12}
    const scenario=req.headers['x-local-scenario']
    if(process.env.LOCAL_TEST_FIXTURES==='1'&&['tool_failure','missing_data','injection'].includes(scenario))emit.scenario=scenario
    res.json=body=>{
      const receipt={type:'final',body,timing:{totalMs:performance.now()-start},trace}
      fs.appendFileSync(path.join(dataDir,'turns.jsonl'),JSON.stringify(receipt)+'\n')
      if(stream){emit({type:'final',body,timing:receipt.timing});res.end();return res}
      return original({...body,localTiming:receipt.timing})
    }
    events.run(emit,()=>{emit({type:'received',provider:'local'});next()})
  })
  const processIntake=require('../intake/intakeService').processIntake
  app.use(require('../routes/demoRouter').createDemoRouter({conversationStore,
    ...(learning?{memoryJournal:learning.runtime}:{}),
    getAdapterFn:()=>new LocalAdapter(),
    processIntakeFn:(message,adapter,history,opts)=>processIntake(message,adapter,history,{...opts,memoryClient,latencySink:(label,body)=>{try{events.getStore()?.({type:'pipeline_phase',label,...JSON.parse(body)})}catch{}}}),
    modelsFn:catalogue
  }))
  app.use((err,req,res,next)=>{if(!res.writableEnded)res.status(503).json({error:{code:err.localModelFailure?err.code:'local_pipeline_unavailable',retryable:false}})})
  learning?.start()
  return {app,sessions,gateway,learning,close:()=>learning?.close()}
}
module.exports={createLocalApp,learningRequestAllowed}
