'use strict'
const fs=require('node:fs'),path=require('node:path')
const {setTimeout:wait}=require('node:timers/promises')
const stage=path.resolve(__dirname,'../../..')
const ready=fs.readFileSync(path.join(stage,'owner-entry.html'),'utf8').match(/href="([^"]+)"/)?.[1]
const url=new URL(ready)
const engineLog=path.join(JSON.parse(fs.readFileSync(path.join(stage,'engine-owner.lock'),'utf8')).root,'engines.jsonl')
const prompts=[
 '就快收工，突然聽到樓下有人唱歌。用一句回應。',
 '「唔好急住收拾」用一句英文講。',
 '虛構雨傘架放喺窗右，換去門左。用一句講最終位置。',
 '有 17 個玻璃杯又加 19 個，合共幾多？一行。',
 '虛構記錄只講某批貨已出庫，收貨仲未通知。可以講已送到嗎？',
 '用粵語講「明天見，我要先走了」。只交一句。',
 '準備一個簡短嘅虛構名稱，適合夜間書展。',
 '感謝，今晚講到呢度就好。',
 '將「順路可交給同事」用一句英文講。',
 '有兩個星期六時間未揀。幫我用一句問邊個時間啱。',
 '用一句回應「忙完總算可以食飯」。'
]
function lastStart(){return fs.readFileSync(engineLog,'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(x=>x.type==='engine_start').at(-1)}
async function main(){
  const rows=[],started=performance.now()
  let pid=lastStart()?.pid??null
  for(const message of prompts){
    const answer=await fetch(url.origin+'/chat',{method:'POST',headers:{origin:url.origin,authorization:'Bearer '+url.hash.slice(1),'content-type':'application/json'},signal:AbortSignal.timeout(180000),body:JSON.stringify({arm:'B',message})})
    if(!answer.ok)throw Error('soak transport '+answer.status)
    const result=(await answer.text()).split('\n').filter(Boolean).map(JSON.parse).at(-1)
    if(!result.final||result.final.calls!==1)throw Error('soak missing final')
    const processId=lastStart().pid
    pid ??= processId
    if(pid!==processId)throw Error('soak observed engine restart')
    const row={at:new Date().toISOString(),pid,message,reply:result.final.text,totalMs:result.final.totalMs}
    rows.push(row)
    fs.appendFileSync(path.join(path.dirname(engineLog),'soak.jsonl'),JSON.stringify(row)+'\n')
    if(rows.length<prompts.length)await wait(60000)
  }
  const summary={completed:rows.length,elapsedMs:performance.now()-started,pid}
  fs.writeFileSync(path.join(path.dirname(engineLog),'SOAK-COMPLETE.json'),JSON.stringify(summary,null,2))
  console.log(JSON.stringify(summary))
}
main().catch(error=>{console.error(error);process.exitCode=1})
