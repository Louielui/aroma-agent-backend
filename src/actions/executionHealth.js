'use strict'
// A live authenticated read only. Never use a cached ready file as bridge liveness.
async function readHealth({request=(...args)=>require('../adapters/CodexSubscriptionAdapter').localRequest(...args),env=process.env,now=Date.now}={}){
 const checkedAt=new Date(now()).toISOString()
 if(!/^[a-f0-9]{64}$/.test(env.CODEX_CHAT_BRIDGE_TOKEN||''))return {state:'unavailable',reason:'not_configured',checkedAt}
 try{
  const value=await request('/execution-health',{},env,AbortSignal.timeout(5000))
  if(value?.component!=='execution-bridge'||value.state!=='ready'||!Number.isInteger(value.pid)||!Number.isFinite(Date.parse(value.checkedAt))||Math.abs(now()-Date.parse(value.checkedAt))>30000)throw Error('invalid_health')
  return {state:'ready',reason:null,checkedAt,bootCommit:value.bootCommit,supervisor:value.supervisor}
 }catch(_){return {state:'unavailable',reason:'connection_unconfirmed',checkedAt}}
}
function supervisorEvidence({read=()=>require('node:fs').readFileSync(require('node:path').join(process.env.LOCALAPPDATA||require('node:path').join(require('node:os').homedir(),'AppData','Local'),'AromaXiangXiang','memory-supervisors','bridge-status.json'),'utf8'),alive=pid=>{try{process.kill(pid,0);return true}catch(_){return false}},now=Date.now}={}){
 try{const s=JSON.parse(read());if(s.component!=='bridge'||!Number.isFinite(Date.parse(s.checkedAt))||now()-Date.parse(s.checkedAt)<0||now()-Date.parse(s.checkedAt)>30000||!Number.isInteger(s.pid)||!Number.isInteger(s.supervisorPid)||!alive(s.pid)||!alive(s.supervisorPid))return {state:'unknown',reason:'stale_or_unavailable'}
  return {state:['ready','starting','unavailable','degraded','foreign','disabled'].includes(s.state)?s.state:'unknown',checkedAt:s.checkedAt,starts:Number.isInteger(s.starts)?s.starts:null,lastExit:s.lastExit?{at:Number.isFinite(Date.parse(s.lastExit.at))?s.lastExit.at:null,code:Number.isInteger(s.lastExit.code)?s.lastExit.code:null,cause:'not_established'}:null}
 }catch(_){return {state:'unknown',reason:'stale_or_unavailable'}}
}
module.exports={readHealth,supervisorEvidence}
