'use strict'
const {ID}=require('../browserRead/contract')
const READ_STATES=new Set(['awaiting_consent','processing','completed','failed','cancelled','interrupted'])
const READ_PHASES=new Set(['prepared_no_model_call','consent_consumed_before_dispatch','model_request_started','model_request_finished','read_task_started','read_task_finished','answer_saved','cancelled','failed_no_retry','process_restarted_no_retry'])
const OP_PHASES=new Set(['owner_started','vision_dispatched','vision_returned','input_sealed','input_claimed','native_input_returned','native_input_unknown','owner_stopped','answer_from_observation','failed_no_retry','action_refused'])
const OP_ACTIVE=new Set(['ready','planning','awaiting_input','executing'])
function time(v){const n=typeof v==='number'?v:typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(n)&&n>0?new Date(n).toISOString():null}
function text(v,max){return typeof v==='string'?v.slice(0,max):null}
function origin(v){try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.origin:null}catch{return null}}
function selection(v){return {model:text(v?.model,200),effort:text(v?.effort,20)}}
function answer(v){return v&&typeof v.text==='string'?{text:v.text.slice(0,120000),actualModel:text(v.actualModel,200),effort:text(v.effort,20),complete:typeof v.taskEvidence?.complete==='boolean'?v.taskEvidence.complete:null}:null}
function clock(start,end,now){if(!start)return null;const finish=end?Date.parse(end):now,duration=finish-Date.parse(start);return Number.isFinite(duration)&&duration>=0?Math.floor(duration/1000):null}
function readView(r,now){
 if(!ID.test(r?.id||'')||r.workflow!=='browser_context_read'||!READ_STATES.has(r.state)||typeof r.question!=='string'||!Array.isArray(r.timeline)||r.timeline.length>50)throw Error('browser_work_unavailable')
 const timeline=r.timeline.map(e=>({stage:READ_PHASES.has(e.stage)?e.stage:'unknown',at:time(e.at)})),last=timeline.at(-1),startedAt=timeline.find(e=>e.stage==='consent_consumed_before_dispatch')?.at||null,terminalStage={completed:'answer_saved',failed:'failed_no_retry',cancelled:'cancelled',interrupted:'process_restarted_no_retry'}[r.state],endedAt=terminalStage&&last?.stage===terminalStage?last.at:null
 const phase=last?.stage||'unknown',active=r.state==='processing'&&phase!=='unknown'&&!!last?.at&&!!startedAt
 return {id:r.id,state:r.state,phase,active,startedAt,endedAt,elapsedSeconds:clock(startedAt,endedAt,active?now:NaN),updatedAt:last?.at||null,question:r.question.slice(0,1000),selection:selection(r.selection),answer:answer(r.result),sourceOrigin:origin(r.source?.origin)}
}
function createBrowserWork({reads,operators=()=>[],audits=()=>[],now=Date.now}){
 function snapshot(){
  const unavailableSources=[],topics=[];let readJobs=0,operatorJobs=0,operatorAuditLimited=false
  try{
   const rows=reads.all();if(!Array.isArray(rows)||rows.length>500)throw Error('browser_work_unavailable');const raw=new Map(),groups=new Map()
   for(const r of rows){if(raw.has(r.id))throw Error('browser_work_unavailable');raw.set(r.id,r)}
   for(const r of rows){const seen=new Set();let ancestor=r;while(ancestor.parentId){if(seen.has(ancestor.id)||!ID.test(ancestor.parentId)||!raw.has(ancestor.parentId))throw Error('browser_work_unavailable');seen.add(ancestor.id);ancestor=raw.get(ancestor.parentId)}if(seen.has(ancestor.id))throw Error('browser_work_unavailable');const id=ancestor.id;groups.set(id,[...(groups.get(id)||[]),readView(r,now())])}
   const readTopics=[];for(const [id,turns]of groups){turns.sort((a,b)=>(Date.parse(a.updatedAt)||0)-(Date.parse(b.updatedAt)||0)||a.id.localeCompare(b.id));const root=raw.get(id),latest=turns.at(-1);readTopics.push({kind:'read',id,title:root.question.slice(0,180),turnCount:turns.length,latest,sourceOrigin:latest.sourceOrigin,turns,historyAvailable:true})}topics.push(...readTopics);readJobs=rows.length
  }catch{unavailableSources.push('read')}
  let live=[];try{live=operators();if(!Array.isArray(live)||live.length>100)throw Error('browser_work_unavailable')}catch{live=[];unavailableSources.push('operator')}
  let events=[];try{events=audits();if(!Array.isArray(events)||events.length>5000||events.some(e=>!ID.test(e?.id||'')||e.workflow!=='browser_operator'||!OP_PHASES.has(e.stage)||!time(e.at)))throw Error('browser_work_unavailable')}catch{events=[];unavailableSources.push('audit')}
  const grouped=new Map();for(const e of events)grouped.set(e.id,[...(grouped.get(e.id)||[]),{stage:e.stage,at:time(e.at),model:text(e.model,200),step:Number.isSafeInteger(e.step)?e.step:null}])
  const native=new Map();for(const j of live){if(!ID.test(j?.id||'')||native.has(j.id)){unavailableSources.push('operator');continue}native.set(j.id,j)}
  const ids=[...new Set([...native.keys(),...grouped.keys()])],nativeTopics=[]
  for(const id of ids){
   const j=native.get(id),timeline=(grouped.get(id)||[]).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),last=timeline.at(-1),startedAt=timeline.find(e=>e.stage==='owner_started')?.at||null
   let state=j?.state||({answer_from_observation:'completed',owner_stopped:'stopped',failed_no_retry:'failed',native_input_unknown:'failed'}[last?.stage]||'unavailable')
   if(j&&OP_ACTIVE.has(state)&&Number.isFinite(j.deadline)&&j.deadline<=now())state='expired'
   if(!OP_ACTIVE.has(state)&&!['completed','stopped','failed','expired','unavailable'].includes(state))state='unavailable'
   const phase=last?.stage||'unknown',active=!!j&&OP_ACTIVE.has(state)&&phase!=='unknown'&&!!startedAt,terminalStage=state==='completed'?'answer_from_observation':state==='stopped'?'owner_stopped':state==='failed'?'failed_no_retry':null
   const endedAt=terminalStage&&(last?.stage===terminalStage||state==='failed'&&last?.stage==='native_input_unknown')?last.at:null,scope=j?.scope
   const latest={id,state,phase,active,startedAt,endedAt,elapsedSeconds:clock(startedAt,endedAt,active?now():NaN),updatedAt:last?.at||null,question:text(j?.question,1000),selection:selection(j?.selection||{model:timeline.find(e=>e.model)?.model}),answer:answer(j?.result),sourceOrigin:origin(scope?.url),steps:Number.isSafeInteger(j?.steps)?j.steps:last?.step||null}
   nativeTopics.push({kind:'operator',id,title:text(j?.question,180),turnCount:1,latest,sourceOrigin:latest.sourceOrigin,turns:[latest],historyAvailable:!!j})
  }
  nativeTopics.sort((a,b)=>(Date.parse(b.latest.updatedAt)||0)-(Date.parse(a.latest.updatedAt)||0)||a.id.localeCompare(b.id));operatorJobs=nativeTopics.length;operatorAuditLimited=nativeTopics.length>100
  // Keep every current operation visible even when old audit history is large.
  const shownNative=nativeTopics.filter(t=>native.has(t.id)).concat(nativeTopics.filter(t=>!native.has(t.id)).slice(0,Math.max(0,100-native.size)))
  topics.push(...shownNative);topics.sort((a,b)=>(Date.parse(b.latest.updatedAt)||0)-(Date.parse(a.latest.updatedAt)||0)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id))
  return {topics,unavailableSources:[...new Set(unavailableSources)],coverage:{readJobs,operatorJobs,operatorAuditLimited},observedAt:time(now())}
 }
 const summary=t=>({...t,turns:undefined,latest:{...t.latest,question:undefined,answer:undefined}})
 function list(){const s=snapshot();return {...s,topics:s.topics.map(summary)}}
 function detail(kind,id){if(!['read','operator'].includes(kind)||!ID.test(id||''))throw Error('invalid_browser_work_request');const s=snapshot();if(s.unavailableSources.includes(kind))throw Error('browser_work_unavailable');const topic=s.topics.find(t=>t.kind===kind&&(t.id===id||t.turns.some(r=>r.id===id)));if(!topic)throw Error('browser_work_not_found');return {...topic,latest:{...topic.latest,question:undefined,answer:undefined},unavailableSources:s.unavailableSources,observedAt:s.observedAt}}
 return {list,detail}
}
function createAuditReader(directory){
 const fs=require('node:fs'),path=require('node:path')
 return()=>{let names;try{names=fs.readdirSync(directory)}catch(e){if(e.code==='ENOENT')return[];throw Error('browser_work_unavailable')}if(names.length>5000)throw Error('browser_work_unavailable');return names.map(name=>{if(!ID.test(name.replace(/\.json$/,''))||!name.endsWith('.json'))throw Error('browser_work_unavailable');const file=path.join(directory,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw Error('browser_work_unavailable');return JSON.parse(fs.readFileSync(file,'utf8'))})}
}
module.exports={createBrowserWork,createAuditReader}
