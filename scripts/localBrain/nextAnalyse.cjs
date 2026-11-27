'use strict'
const fs=require('node:fs'), path=require('node:path')
const directory=process.argv[2]
const read=name=>{const p=path.join(directory,name);return fs.existsSync(p)?fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse):[]}
const r=read('results.jsonl'), trace=read('turns.jsonl'), hardware=read('resources.jsonl'), engines=read('engines.jsonl'), network=read('process-network.jsonl')
const cases=r.filter(row=>row.caseId.startsWith('J'))
const scoresPath=path.join(directory,'scores.json')
const grades=fs.existsSync(scoresPath)?JSON.parse(fs.readFileSync(scoresPath,'utf8')):{}
const quantile=(v,p)=>{const values=v.filter(Number.isFinite).sort((a,b)=>a-b);if(!values.length)return null;const i=(values.length-1)*p;return values[Math.floor(i)]+(values[Math.ceil(i)]-values[Math.floor(i)])*(i%1)}
const arms={}
const entries=[]
for(const arm of ['A','B','C','D']){
  for(const c of cases.filter(x=>x.arm===arm)){
    const rows=trace.filter(t=>t.arm===arm&&t.caseId===c.caseId)
    const start=rows.find(t=>t.type==='turn_start')
    const tasks=rows.filter(t=>t.type==='model_start')
    const first=rows.find(t=>t.type==='model_complete'&&t.timing?.firstMs!==null)
    const call=tasks.find(t=>t.id===first?.id)
    const userFirst=c.error?null:arm==='C'?c.totalMs:call&&start?Date.parse(call.at)-Date.parse(start.at)+first.timing.firstMs:null
    const score=grades[arm]?.[c.caseId]
    const lastModel=rows.filter(t=>t.type==='model_complete').at(-1)
    entries.push({...c,calls:tasks.length,firstVisibleMs:userFirst,score:score??null,
      lastModelText:lastModel?.text??null,modelPhases:tasks.map(t=>t.phase),stageNames:rows.filter(t=>t.type==='pipeline_phase').map(t=>t.phase)})
  }
  const group=entries.filter(x=>x.arm===arm)
  const successful=group.filter(x=>!x.error)
  const values=group.filter(x=>x.score!==null)
  arms[arm]={attempted:group.length,complete:successful.length,calls:group.reduce((n,x)=>n+x.calls,0),
    callsOne:group.filter(x=>x.calls===1).length,
    firstVisibleP50Ms:quantile(successful.map(x=>x.firstVisibleMs),.5),firstVisibleP95Ms:quantile(successful.map(x=>x.firstVisibleMs),.95),
    completeP50Ms:quantile(successful.map(x=>x.totalMs),.5),completeP95Ms:quantile(successful.map(x=>x.totalMs),.95),attemptP95Ms:quantile(group.map(x=>x.totalMs),.95),
    scored:values.length,gradeSum:values.reduce((n,x)=>n+x.score,0),
    full:values.filter(x=>x.score===1).length,partial:values.filter(x=>x.score===.5).length}
}
const peerSet=[...new Set(network.flatMap(s=>s.processes.flatMap(p=>p.peers.map(x=>x.host))))].sort()
const q06=trace.find(t=>t.caseId==='Q06'&&t.type==='model_complete')
const output={arms,entries,qualifications:r.filter(x=>x.caseId.startsWith('Q')),
  longAnswer:q06?{outputTokens:q06.usage?.completion_tokens,tokensPerSecond:q06.timing?.predicted_per_second,completeMs:q06.timing?.totalMs}:null,
  runtime:{engineStarts:engines.filter(e=>e.type==='engine_start'),engineStops:engines.filter(e=>e.type==='engine_stopped'),
    engineReady:engines.filter(e=>e.type==='engine_ready'),minFreeRamBytes:Math.min(...hardware.map(e=>e.freeRamBytes)),
    peakVramMiB:Math.max(...hardware.map(e=>e.usedVramMiB)),maxGpuTempC:Math.max(...hardware.map(e=>e.temperatureC)),
    peakProcessRssBytes:Math.max(...network.flatMap(e=>e.processes.filter(p=>['strata.exe','ollama.exe','llama-server.exe'].includes(p.name)).map(p=>p.rssBytes))),
    sampledPeerHosts:peerSet,networkSamples:network.length,
    networkErrors:network.flatMap(e=>e.errors).length,
    cAllowed:trace.filter(e=>e.type==='egress_allowed').length,cDenied:trace.filter(e=>e.type==='egress_denied').length}}
fs.writeFileSync(path.join(directory,'analysis.json'),JSON.stringify(output,null,2))
console.log(JSON.stringify({arms,qualifications:output.qualifications,longAnswer:output.longAnswer,runtime:output.runtime}))
