'use strict'
const fs=require('node:fs'),path=require('node:path')
const {createHost}=require('../../src/localBrain/next/host')
const {resources}=require('../../src/localBrain/next/engines')
const host=createHost()
const cases=require('../../src/localBrain/next/benchmark.json')
const out=path.join(host.root,'results.jsonl')
const append=row=>fs.appendFileSync(out,JSON.stringify(row)+'\n')
const timer=setInterval(()=>resources().then(x=>host.log('resources.jsonl',x)).catch(()=>{}),2500)
timer.unref()
async function run(){
  console.log(JSON.stringify({event:'start',evidence:host.root}))
  const arms=process.argv.slice(2).filter(x=>['A','B','C','D'].includes(x))
  for(const arm of arms.length?arms:['A','B','C','D']){
    for(const c of cases){
      const session=host.fresh()
      for(let i=0;i<c.turns.length;i++){
        const [message,criterion]=c.turns[i]
        const caseId=c.id+'-'+(i+1)
        const started=performance.now()
        let first=null
        const onTrace=e=>{if(e.type==='model_complete'&&first===null&&e.timing?.firstMs!=null)first=e.timing.firstMs}
        let row
        try{
          const answer=await host.submit(session,arm,message,{caseId,onTrace})
          row={caseId,arm,area:c.area,criterion,message,reply:answer.text,calls:answer.calls,firstMs:first,totalMs:answer.totalMs}
        }catch(error){row={caseId,arm,area:c.area,criterion,message,error:error.code||error.message,totalMs:performance.now()-started}}
        append(row)
        if(row.error||i+1===c.turns.length)console.log(JSON.stringify({arm,caseId,result:row.error||'complete'}))
      }
    }
  }
  if(!arms.length||arms.includes('B')){
    const checks=[
      ['Q01','tools','請用隔離庫存記錄 F-17 核對柚香醬實際在庫量。只講數字同單位。'],
      ['Q02','tools','請先讀隔離記憶 M-44，話俾我知嗰條偏好。'],
      ['Q03','tools','請以工具提出更新虛構庫存 F-17 的備註為「等下批覆核」。'],
      ['Q04','structured','只輸出 JSON，item 係 cedar，count 係 19。'],
      ['Q05','tools','請用隔離記錄 Z-99 證實有幾多個紫色籃。'],
      ['Q06','chat','用自然粵語寫一段約 180 字嘅虛構雨天試映指引，含入場、安靜同散場。']
    ]
    for(const [caseId,mode,message] of checks){
      const session=host.fresh()
      try{
        const first=await host.submit(session,'B',message,{caseId,mode})
        append({arm:'B',caseId,result:first})
        if(caseId==='Q03'){
          const pending=session.pending?.id
          const response=await host.submit(session,'B','好',{caseId:'Q03-chat',mode:'chat'})
          append({arm:'B',caseId:'Q03-chat',reply:response.text,stillPending:session.pending?.id===pending,applied:session.notes.size})
          if(pending){
            const approved=host.approve(session,pending)
            let replayRefused=false
            try{host.approve(session,pending)}catch{replayRefused=true}
            append({arm:'B',caseId:'Q03-ui',approved,replayRefused})
          }
        }
      }catch(error){append({arm:'B',caseId,error:error.code||error.message})}
    }
    await host.manager.restart()
    try{
      const response=await host.submit(host.fresh(),'B','將「雨停就行返過去」譯成一句英文。',{caseId:'Q07-restart'})
      append({arm:'B',caseId:'Q07-restart',reply:response.text,calls:response.calls})
    }catch(error){append({arm:'B',caseId:'Q07-restart',error:error.code||error.message})}
  }
  fs.writeFileSync(path.join(host.root,'COMPLETE.json'),JSON.stringify({cases:cases.length,arms:arms.length?arms:['A','B','C','D']}))
}
run().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{clearInterval(timer);await host.manager.close()})
