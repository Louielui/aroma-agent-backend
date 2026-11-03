'use strict'
// Reuses the actual coding thread. No thread creation, inference, tools or polling.
const {ID,hash}=require('../actions/contract')
function titleFor(v){const state=v.state==='completed'&&v.appliedToLive!==true?'candidate ready; not deployed':v.state;return('Xiangxiang | '+String(v.goal||v.id).replace(/[\r\n]/g,' ').slice(0,70)+' | '+state+' | '+v.id.slice(0,8)).slice(0,160)}
function createClient(options){return{async rename(threadId,name){const c=require('./codexClient'),rpc=c.connect({...options,timeoutMs:7000,config:c.LOCKED_CONFIG});try{await rpc.request('initialize',{clientInfo:{name:'xiangxiang_work_progress',version:'1.0.0'}});rpc.notify('initialized');await rpc.request('thread/name/set',{threadId,name})}finally{rpc.close()}}}}
function createPublisher({client,store,now=()=>new Date().toISOString()}){
 const queued=new Map(),active=new Map()
 function update(v){
  if(!v||!ID.test(v.id||'')||!/^[a-f0-9-]{36}$/.test(v.threadId||'')||!['queued','checking','coding','reviewing','completed','failed','cancelled','needs_attention','interrupted','timed_out'].includes(v.state)||!Number.isFinite(Date.parse(v.at)))return Promise.resolve({state:'unavailable'})
  const pending=queued.get(v.id);if(pending&&Date.parse(pending.at)>Date.parse(v.at))return active.get(v.id)
  queued.set(v.id,structuredClone(v));if(active.has(v.id))return active.get(v.id)
  const task=Promise.resolve().then(async()=>{let result;while(queued.has(v.id)){const next=queued.get(v.id);queued.delete(v.id);let release;try{release=store.lockRun(next.id);const old=store.get(next.id);if(old&&(old.threadId!==next.threadId||old.timeline.length>=1024))throw Error('title_binding_unavailable');const version=hash({threadId:next.threadId,state:next.state,phase:next.phase,at:next.at,appliedToLive:next.appliedToLive}),name=titleFor(next);if(old?.version===version&&old.state==='published'){result=old;continue}if(old&&Date.parse(old.eventAt)>Date.parse(next.at)){result=old;continue}const row={id:next.id,threadId:next.threadId,version,state:'publishing',eventAt:next.at,phase:next.phase,title:name,timeline:[...(old?.timeline||[]),{at:now(),phase:'title_requested',version}]};store.save(row);try{await client.rename(next.threadId,name);row.state='published';row.timeline.push({at:now(),phase:'title_published',version});store.save(row);result=row}catch{row.state='unavailable';row.timeline.push({at:now(),phase:'title_unconfirmed',version});store.save(row);result=row}}catch{result={state:'unavailable'}}finally{release?.()}}return result}).finally(()=>{active.delete(v.id);if(queued.has(v.id))update(queued.get(v.id)).catch(()=>{})});active.set(v.id,task);return task
 }
 return{update,settled:async()=>{while(active.size)await Promise.allSettled([...active.values()])}} 
}
module.exports={createClient,createPublisher,titleFor}
