'use strict'
const {localRequest}=require('../../src/adapters/CodexSubscriptionAdapter')
function project (runtime,work,bridge) {
  const lanes=Array.isArray(runtime?.records) ? runtime.records.map(x=>({role:x.role,state:x.currentRunningState})) : []
  const workflows=Array.isArray(work?.workflows) ? work.workflows.map(x=>({role:x.role,state:x.state})) : []
  const ready=lanes.length===2 && ['chat_completion','memory_completion'].every(role=>lanes.some(x=>x.role===role && x.state==='idle')) &&
    ['test_draft','development','review','adoption'].every(role=>workflows.some(x=>x.role===role && x.state==='idle')) &&
    workflows.every(x=>x.state==='idle') && bridge?.component==='execution-bridge' && bridge.state==='ready' && Number.isSafeInteger(bridge.pid) && bridge.pid>0 && /^[a-f0-9]{40}$/.test(bridge.bootCommit || '')
  return {state:ready?'idle_verified':'not_idle_verified',pid:bridge?.pid || null,bootCommit:bridge?.bootCommit || null,lanes,workflows}
}
async function read () {
  const env=require('dotenv').parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../.env')))
  const values=await Promise.all(['/runtime-metadata','/work-metadata','/execution-health'].map(route=>localRequest(route,{},env,AbortSignal.timeout(7000))))
  return project(...values)
}
if(require.main===module)read().then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>{process.stdout.write(JSON.stringify({state:'not_idle_verified'}));process.exitCode=1})
module.exports={project}
