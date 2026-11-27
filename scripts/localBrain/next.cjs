'use strict'
const http=require('node:http'),fs=require('node:fs'),path=require('node:path')
const {randomBytes,timingSafeEqual}=require('node:crypto')
const {createHost,lab}=require('../../src/localBrain/next/host')
const phase1=process.env.XIANGXIANG_PHASE1_TRIAL==='1'
const profiles=new Set(['B','P'])
function phaseOptions(){
  const receipt=JSON.parse(fs.readFileSync(path.join(lab,'native','engine-job.json'),'utf8'))
  const idleMs=Number(process.env.XIANGXIANG_PHASE1_IDLE_MS||180000)
  if(receipt.binary!=='EngineJob.exe'||!(/^[a-f0-9]{64}$/).test(receipt.sha256)||!Number.isInteger(idleMs)||idleMs<1000||idleMs>3600000)throw Error('phase1_runtime_invalid')
  return {job:{path:path.join(lab,'native',receipt.binary),sha256:receipt.sha256},idleMs}
}
const host=createHost(phase1?phaseOptions():{})
const port=Number(process.argv[2]||17946),origin='http://127.0.0.1:'+port
const key=randomBytes(32).toString('hex')
const view=path.join(__dirname,'../../src/localBrain/next')
const assets={'/':['view.html','text/html; charset=utf-8'],'/style.css':['style.css','text/css'],'/view.js':['view.js','text/javascript']}
const safe=(candidate)=>typeof candidate==='string'&&candidate.length===key.length&&Buffer.byteLength(candidate)===key.length&&timingSafeEqual(Buffer.from(candidate),Buffer.from(key))
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
async function read(req){
  let text=''
  for await(const chunk of req){text+=chunk;if(text.length>72000)throw Error('request_too_large')}
  return JSON.parse(text)
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'")
  if(req.headers.host!=='127.0.0.1:'+port)return json(res,403,{error:'invalid_local_host'})
  if(req.method==='GET'&&Object.hasOwn(assets,req.url)){
    const [file,type]=assets[req.url];res.writeHead(200,{'Content-Type':type});return res.end(fs.readFileSync(path.join(view,file)))
  }
  if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['content-type']!=='application/json'))return json(res,403,{error:'same_origin_required'})
  try{
    if(req.method==='POST'&&req.url==='/authorize'){
      if(!safe((await read(req)).key))return json(res,403,{error:'owner_session_required'})

      return json(res,200,{authorized:true})
    }
    if(!safe(req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]))return json(res,401,{error:'owner_session_required'})
    if(req.method==='GET'&&req.url==='/status')return json(res,200,{scope:'isolated',cloudFallback:false,phase1,
      ...(phase1?{engine:host.manager.state(),profiles:[...profiles]}:{})})
    if(phase1&&req.method==='POST'&&req.url==='/release'){
      const body=await read(req)
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return json(res,400,{error:'release_shape_invalid'})
      await host.manager.release()
      return json(res,200,{engine:host.manager.state()})
    }
    if(phase1&&(req.method!=='POST'||req.url!=='/chat'))return json(res,404,{error:'unknown_route'})
    if(req.method!=='POST'||!['/chat','/approve'].includes(req.url))return json(res,404,{error:'unknown_route'})
    const args=await read(req)
    if(phase1&&(!args||!profiles.has(args.arm)||(args.mode!==undefined&&args.mode!=='chat')))return json(res,400,{error:'phase1_chat_only'})
    const session=args.conversation==null&&req.url==='/chat'?host.fresh():host.sessions.get(args.conversation)
    if(!session)return json(res,404,{error:'unknown_conversation'})
    if(req.url==='/approve')return json(res,200,host.approve(session,args.id))
    const controller=new AbortController()
    res.on('close',()=>{if(!res.writableEnded)controller.abort()})
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'})
    res.flushHeaders()
    const event=payload=>{if(!res.destroyed)res.write(JSON.stringify(payload)+'\n')}
    try{
      const final=await host.submit(session,args.arm,args.message,{mode:args.mode,signal:controller.signal,onDelta:delta=>event({delta})})
      event({final,conversation:session.id})
    }catch(error){event({error:error.code||error.message})}
    return res.end()
  }catch(error){return json(res,400,{error:error.code||error.message})}
})
server.listen(port,'127.0.0.1',()=>{
  const launch=path.join(lab,'owner-entry.html')
  const url=origin+'/#'+key
  fs.writeFileSync(launch,'<!doctype html><meta charset="utf-8"><title>香香本機入口</title><a href="'+url+'">開啟香香本機測試對話</a>')
  console.log(JSON.stringify({state:'ready',origin,entry:launch,evidence:host.root}))
})
async function close(){server.close();await host.manager.close()}
process.on('SIGINT',close)
process.on('SIGTERM',close)
