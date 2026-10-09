'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createBridge}=require('./bridge')
const {readCodexEvidence,quota,usage}=require('./subscriptionEvidence')
const at='2026-10-09T13:00:00.000Z',reset=Date.parse('2026-10-09T14:00:00.000Z')/1000
const limits={rateLimitsByLimitId:{codex:{primary:{usedPercent:100,windowDurationMins:300,resetsAt:reset},credits:{hasCredits:true,unlimited:false,balance:'12.5'}}}}
function fixture(extra={}){
 const calls=[];let closed=false
 const replies={'account/read':{account:{type:'chatgpt',email:'private@example.com'}},'account/rateLimits/read':limits,'account/usage/read':{summary:{lifetimeTokens:0},dailyUsageBuckets:[{startDate:'2026-10-09',tokens:0}]},...extra}
 return{calls,options:{clock:()=>at,connect:()=>({request:async(name)=>{calls.push(name);const v=replies[name];if(v instanceof Error)throw v;return typeof v==='function'?v():v},notify:()=>{},close:()=>{closed=true}})},closed:()=>closed}
}
test('exhausted quota is still readable and zero activity is a real receipt, with only official read RPCs',async()=>{
 const f=fixture(),r=await readCodexEvidence(f.options)
 assert.deepEqual(f.calls,['initialize','account/read','account/rateLimits/read','account/usage/read','account/read']);assert.equal(f.closed(),true)
 assert.equal(r.records[0].quota.buckets[0].primary.remainingPercent,0);assert.equal(r.records[0].activity.summary.lifetimeTokens,0)
 assert.equal(r.provesCharge,false);assert.doesNotMatch(JSON.stringify(r),/private@example|accountId|threadUsage|resetCredit/)
})
test('API authentication and changed accounts withhold all account snapshots, without fallback or inference',async()=>{
 const api=fixture({'account/read':{account:{type:'apiKey'}}});assert.equal((await readCodexEvidence(api.options)).state,'unavailable');assert.deepEqual(api.calls,['initialize','account/read'])
 let n=0;const changed=fixture({'account/read':()=>({account:{type:'chatgpt',email:++n===1?'one':'two'}})});assert.deepEqual((await readCodexEvidence(changed.options)).records,[])
})
test('unsupported usage leaves actual quota intact; failed quota does not hide supported account activity',async()=>{
 const f=fixture({'account/usage/read':Error('private OAuth token')});const r=await readCodexEvidence(f.options)
 assert.equal(r.coverage.codexQuota,'partial');assert.equal(r.coverage.codexActivity,'unavailable');assert.equal(r.records[0].activity.retrievedAt,null);assert.doesNotMatch(JSON.stringify(r),/private OAuth/)
 const other=fixture({'account/rateLimits/read':Error('offline')});assert.equal((await readCodexEvidence(other.options)).records[0].activity.summary.lifetimeTokens,0)
})
test('missing, malformed or expired quota never becomes zero remaining; bucket map overrides legacy',()=>{
 const q=quota({...limits,rateLimits:{primary:{usedPercent:0}},rateLimitsByLimitId:{codex:{primary:{usedPercent:101,windowDurationMins:-1,resetsAt:reset},credits:{balance:'unknown'}},other:{primary:{usedPercent:50,windowDurationMins:60,resetsAt:reset-7200}}}},at)
 assert.equal(q.buckets[0].primary.remainingPercent,null);assert.equal(q.buckets[0].credits.balance,null);assert.equal(q.buckets[1].primary.remainingPercent,null)
 assert.deepEqual(quota({rateLimitsByLimitId:{},rateLimits:limits.rateLimitsByLimitId.codex},at).buckets,[])
 assert.equal(quota({rateLimits:{primary:{usedPercent:0,windowDurationMins:60,resetsAt:reset}}},at).buckets[0].primary.remainingPercent,100)
})
test('aggregate usage is bounded, conflicting dates withheld, negatives and invalid dates excluded',()=>{
 const days=Array.from({length:65},(_,i)=>({startDate:new Date(Date.parse('2026-10-09')-i*86400000).toISOString().slice(0,10),tokens:i}))
 const r=usage({summary:{lifetimeTokens:-1,peakDailyTokens:Number.MAX_SAFE_INTEGER+1,secret:'ignored'},dailyUsageBuckets:[...days,{startDate:'2026-10-09',tokens:99},{startDate:'2026-02-31',tokens:1},{startDate:'2026-01-01',tokens:-1}]},at)
 assert.equal(r.dailyUsageBuckets.length,60);assert.equal(r.omitted,5);assert.equal(r.dailyUsageBuckets[0].evidenceState,'CONTRADICTED');assert.equal(r.dailyUsageBuckets[0].tokens,null);assert.equal(r.invalidRecords,2);assert.equal(r.summary.lifetimeTokens,null);assert.doesNotMatch(JSON.stringify(r),/secret/)
})
test('subscription metadata stays available during inference, shares one read and never dispatches a turn',{timeout:5000},async t=>{
 const token='7'.repeat(64);let release,finish,reads=0,calls=0,ended=0
 const server=createBridge({token,subscriptionFn:async()=>{reads++;await new Promise(r=>{finish=r});return{state:'partial',records:[],provesCharge:false}},completeFn:async()=>{calls++;return new Promise(r=>{release=r})}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const send=(route,body,headers={})=>fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:JSON.stringify(body)})
 assert.equal((await send('/subscription-metadata',{}, {authorization:'bad'})).status,401)
 assert.equal((await send('/subscription-metadata',{}, {origin:'http://evil'})).status,401)
 assert.equal((await send('/subscription-metadata',{path:'.env'})).status,400)
 server.on('request',req=>{if(req.url==='/subscription-metadata')req.on('end',()=>{ended++})})
 const first=send('/complete',{prompt:'fixture'});while(!release)await new Promise(r=>setImmediate(r))
 try{
  const a=send('/subscription-metadata',{}),b=send('/subscription-metadata',{})
  while(!finish||ended<2)await new Promise(r=>setImmediate(r))
  await new Promise(r=>setImmediate(r))
  assert.equal(reads,1);finish();assert.equal((await a).status,200);assert.equal((await b).status,200)
  assert.equal((await send('/complete',{prompt:'duplicate'})).status,503);assert.equal(calls,1)
 }finally{release({output:'fixture'});await first}
})
