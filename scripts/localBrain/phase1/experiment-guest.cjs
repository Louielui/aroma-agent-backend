
'use strict'
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {randomBytes}=require('node:crypto')
const {setTimeout:wait}=require('node:timers/promises')
const {createManager}=require('../../../src/localBrain/next/engines')
const {turn,createSession}=require('../../../src/localBrain/next/dialogue')
const {EXPERIMENTS,ID,MAX_REQUEST_MS,validChat,readSigned,publish}=require('../../../src/localBrain/next/experiment')

const [input,output,settings,runRoot]=process.argv.slice(2)
const key=fs.readFileSync(path.join(settings,'key.hex'),'utf8').trim()
const proof=JSON.parse(fs.readFileSync(path.join(settings,'asset-proof.json'),'utf8'))
const seal=JSON.parse(fs.readFileSync(path.join(settings,'engine-job.json'),'utf8'))
const boot=randomBytes(16).toString('hex')
const trace=(name,event)=>fs.appendFileSync(path.join(output,name),JSON.stringify({boot,at:Date.now(),...event})+'\n')
const manager=createManager({proof,root:runRoot,job:{path:path.join(settings,'EngineJob.exe'),sha256:seal.sha256},
  idleMs:180000,strataRamReserve:26,minRamGiB:{strata:36,ollama:20},probe:async()=>({freeRamBytes:os.freemem(),freeVramMiB:null}),
  event:event=>trace('engines.jsonl',event)})
async function offline(){
  if(Object.values(os.networkInterfaces()).flat().some(x=>!x.internal))throw Error('unexpected_network_interface')
  try{await fetch('http://192.0.2.1:80',{signal:AbortSignal.timeout(3500)})}
  catch(error){if(error.cause?.code==='ENETUNREACH')return error.cause.code}
  throw Error('guest_network_isolation_unproven')
}
async function run(){
  const network=await offline()
  fs.mkdirSync(runRoot,{recursive:true})
  trace('guest.jsonl',{type:'guest_os_network',network,totalRamBytes:os.totalmem()})
  let slot=0
  const heartbeat=()=>publish(output,slot++%2?'ready-alt.json':'ready.json',key,{boot,at:Date.now(),network})
  heartbeat()
  const pulse=setInterval(heartbeat,3000)
  const spent=new Map()
  try{
    while(true){
      const now=Date.now()
      for(const [id,deadline] of spent)if(deadline<now)spent.delete(id)
      for(const file of fs.readdirSync(input)){
        const id=file.slice(0,-5)
        if(!file.endsWith('.json')||!ID.test(id)||spent.has(id))continue
        const location=path.join(input,file),req=readSigned(location,key)
        if(!req||req.boot!==boot||req.id!==id||!Number.isSafeInteger(req.deadline)||req.deadline<=now||req.deadline>now+MAX_REQUEST_MS)continue
        spent.set(id,req.deadline)
        const controller=new AbortController()
        const gone=setInterval(()=>{if(!fs.existsSync(location)||Date.now()>=req.deadline)controller.abort()},150)
        try{
          let result
          if(req.action==='release'&&req.body&&Object.keys(req.body).length===0){
            await manager.release()
            result={state:manager.state().state}
          }else if(req.action==='chat'&&validChat(req.body)){
            const {profile,message,history}=req.body,session=createSession()
            session.history=history
            session.arm=profile
            const actual=await turn({manager,session,arm:profile,message,signal:controller.signal,
              trace:event=>trace('turns.jsonl',{request:id,profile,...event})})
            if(actual.model!==EXPERIMENTS[profile].model)throw Error('experiment_model_mismatch')
            result={...EXPERIMENTS[profile],calls:actual.calls,text:actual.text}
          }else throw Error('experiment_input_invalid')
          if(!controller.signal.aborted&&fs.existsSync(location))publish(output,file,key,{boot,id,result})
        }catch(error){
          trace('guest.jsonl',{type:'guest_failed',request:id,code:error.code||error.message})
          if(!controller.signal.aborted&&fs.existsSync(location))publish(output,file,key,{boot,id,error:'experiment_generation_failed'})
        }finally{clearInterval(gone)}
      }
      await wait(140)
    }
  }finally{clearInterval(pulse);await manager.close()}
}
run().catch(error=>{trace('guest.jsonl',{type:'guest_stopped',code:error.code||error.message});process.exitCode=1})
