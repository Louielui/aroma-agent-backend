'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createLiveReadConnector,enabledSources}=require('./liveClients')
const {buildReadContext,intentFor,planFor}=require('./readContext')
const {projectConnections,CREDENTIAL,REASON}=require('./connectionState')
const env=()=>({READ_ACCESS:'on',CONTEXT_SEVEN_SHIFTS:'on',SEVEN_SHIFTS_COMPANY_ID:'123',SEVEN_SHIFTS_ACCESS_TOKEN:'synthetic-only'})
const now='2026-10-10T18:00:00.000Z'
test('an impossible calendar date is not silently replaced by a different query day',()=>{
  assert.equal(planFor('seven_shifts',{message:'查7shifts clock out 2026-02-30',now}),null)
  assert.equal(planFor('seven_shifts',{message:'7shifts time punches 2026-02-28',now}).params.timeMin,'2026-02-28T00:00:00.000Z')
})
test('Chinese and English clock-out requests reach the same real connector and carry bounded, dated evidence',async()=>{
  for(const message of ['幫我查7shifts員工的clock out時間 2026-10-05','Find 7shifts employee clock-out times on 2026-10-05']){
    const calls=[],e=env(),built=createLiveReadConnector({env:e,clock:()=>now,sevenShiftsFetch:async(u,o)=>{calls.push({u,o});return {ok:true,json:async()=>({data:[{company_id:123,id:1,user_id:7,clocked_in:'2026-10-05T15:00:00Z',clocked_out:'2026-10-05T22:00:00Z',deleted:false}],meta:{cursor:{next:null}}})}}})
    assert.equal(intentFor(message).sources[0],'seven_shifts')
    const v=await buildReadContext({connector:built.connector,message,sources:enabledSources(e),env:e,now})
    assert.equal(calls.length,1);assert.equal(calls[0].o.method,'GET');assert.equal(built.connector.hasWriteMethod(),false)
    const url=new URL(calls[0].u);assert.equal(url.searchParams.get('clocked_in[gte]'),'2026-10-05T00:00:00.000Z');assert.equal(url.searchParams.get('clocked_in[lte]'),'2026-10-05T23:59:59.999Z')
    assert.equal(v.perSource[0].trust,'live');assert.match(v.block,/2026-10-05T22:00:00Z/)
    assert.match(v.block,/clocked_in: 2026-10-05T00:00:00/);assert.match(v.block,/TOTAL IN THE WIDER SOURCE IS UNKNOWN/)
    assert.equal(JSON.stringify(v).includes('synthetic-only'),false)
  }
})
test('source presence, company setup and disabled reads are not live-connection proof and never make outbound requests',async()=>{
  for(const changes of [{CONTEXT_SEVEN_SHIFTS:'off'},{SEVEN_SHIFTS_ACCESS_TOKEN:''},{SEVEN_SHIFTS_COMPANY_ID:''}]){
    const e={...env(),...changes};let calls=0
    const built=createLiveReadConnector({env:e,sevenShiftsFetch:async()=>{calls++;throw Error('must not request')}})
    const v=await buildReadContext({connector:built.connector,message:'查7shifts clock out',sources:['seven_shifts'],env:e,now})
    assert.equal(calls,0);assert.equal(built.registered.includes('seven_shifts'),false)
    assert.equal(v.perSource[0].trust,'unavailable')
    const c=projectConnections(e).find(c=>c.key==='seven_shifts');assert.equal(c.registered,false);assert.equal(c.health,'unknown')
    if(changes.SEVEN_SHIFTS_ACCESS_TOKEN==='')assert.equal(c.credentialState,CREDENTIAL.MISSING)
    if(changes.SEVEN_SHIFTS_COMPANY_ID==='')assert.equal(c.reason,REASON.REGISTRATION_FAILED)
  }
})
