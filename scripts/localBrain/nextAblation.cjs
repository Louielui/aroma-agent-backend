'use strict'
const fs=require('node:fs'),path=require('node:path')
const {createHost}=require('../../src/localBrain/next/host')
const {TREATMENTS,runTreatment}=require('./ablation/factors.cjs')
const {resources}=require('../../src/localBrain/next/engines')
const cases=require('../../src/localBrain/next/ablation/corpus.json')
const args=process.argv.slice(2)
const ids=args.length?args:[...Object.keys(TREATMENTS),'C','H']
if(!ids.every(x=>x==='C'||x==='H'||Object.hasOwn(TREATMENTS,x)))throw Error('invalid treatment')
const host=createHost()
const monitor=setInterval(()=>resources().then(r=>host.log('resources.jsonl',r)).catch(()=>{}),2500)
monitor.unref()
async function trial(id,c,thermal){
  const arm=['C','H'].includes(id)?id:'B'
  if(c.exclude?.includes(id))return
  const session=host.fresh()
  session.history.push(...(c.history||[]))
  let delivered=null,calls=0,inputTokens=0,outputTokens=0,missingUsage=0,first=-1
  const start=performance.now()
  const events=[]
  const opts={mode:c.mode,caseId:thermal+'-'+id+'-'+c.id,treatment:arm==='B'?id:undefined,
    experiment:arm==='B'?input=>runTreatment({...input,id}):undefined,
    onDelta:part=>{if(first<0&&part.trim())first=performance.now()-start},
    onTrace:e=>{
      if(e.type==='model_start')calls++
      if(e.type==='model_complete'){
        if(Number.isFinite(e.usage?.prompt_tokens)&&Number.isFinite(e.usage?.completion_tokens)){
          inputTokens+=e.usage.prompt_tokens
          outputTokens+=e.usage.completion_tokens
        }else missingUsage++
      }
      if(e.type==='hybrid_route'||e.type==='ablation_verdict'||e.type==='fixture_read'||e.type==='hybrid_tool'){
        events.push(e)
      }
    }}
  let error
  try{delivered=await host.submit(session,arm,c.message,opts)}
  catch(e){error=e.code||e.message}
  const ms=performance.now()-start
  const row={id,thermal,case:c.id,criterion:c.criterion,category:c.category,ok:Boolean(delivered),error,firstMs:delivered?(first<0?ms:first):null,ms,
    calls,inputTokens,outputTokens,missingUsage,route:delivered?.route,body:delivered?.text,events}
  host.log('results.jsonl',row)
  console.log(JSON.stringify({id,thermal,case:c.id,calls,ok:row.ok,ms:Math.round(ms),error}))
}
async function main(){
  console.log(JSON.stringify({event:'started',root:host.root}))
  for(const id of ids){
    await host.manager.restart()
    await trial(id,cases[0],'cold')
  }
  for(const [index,c] of cases.entries()){
    const ordered=[...ids.slice(index%ids.length),...ids.slice(0,index%ids.length)]
    for(const id of ordered)await trial(id,c,'warm')
  }
  fs.writeFileSync(path.join(host.root,'COMPLETE.json'),JSON.stringify({ids,cases:cases.length}))
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{clearInterval(monitor);await host.manager.close()})
