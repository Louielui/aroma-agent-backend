'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const {createSevenShiftsReadAdapter,validateQuery} = require('./sevenShiftsRead')
const query={timeMin:'2026-10-01T00:00:00Z',timeMax:'2026-10-07T23:59:59.999Z'}
const env=()=>({READ_ACCESS:'on',CONTEXT_SEVEN_SHIFTS:'on',SEVEN_SHIFTS_COMPANY_ID:'123',SEVEN_SHIFTS_ACCESS_TOKEN:'synthetic-reader-secret'})
const punch=(id=1)=>({company_id:123,id,user_id:7,location_id:4,clocked_in:'2026-10-05T10:00:00-05:00',clocked_out:'2026-10-05T17:00:00-05:00',approved:false,deleted:false,hourly_wage:2000,notes:'private',modified:'2026-10-05T23:00:00Z'})
const response=(data,next=null)=>({ok:true,json:async()=>({data,meta:{cursor:{next}},object:'time_punches'})})

test('reader binds GET transport and evidence to the exact company and clock-in window, preserving clock-out offsets and excluding sensitive fields',async()=>{
  const calls=[],reader=createSevenShiftsReadAdapter({env:env(),fetchFn:async(u,o)=>{calls.push([u,o]);return response([punch(),{...punch(2),clocked_out:null}])}})
  const v=await reader.methods.listTimePunches(query),url=new URL(calls[0][0]),opts=calls[0][1]
  assert.equal(url.origin,'https://api.7shifts.com');assert.equal(url.pathname,'/v2/company/123/time_punches');assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer synthetic-reader-secret')
  assert.equal(url.searchParams.get('clocked_in[gte]'),'2026-10-01T00:00:00.000Z');assert.equal(v.evidence.queryScope.companyId,123);assert.equal(v.evidence.completeWithinScope,true)
  assert.equal(v.evidence.matchingTotal,2);assert.equal(v.evidence.sourceTotal,null)
  assert.equal(v.results[0].fields.clockedOut,punch().clocked_out);assert.equal(v.results[1].fields.clockedOut,null);assert.equal(v.results[0].sourceId,'123:1')
  for(const absent of ['synthetic-reader-secret','hourly_wage','private'])assert.equal(JSON.stringify(v).includes(absent),false)
  assert.deepEqual(Object.keys(reader.methods),['listTimePunches','listClockOuts','listAttendance','listShifts'])
})

test('missing authorisation or connection is unavailable without any egress; access changes during a read invalidate the result',async()=>{
  for(const changes of [{READ_ACCESS:'off'},{CONTEXT_SEVEN_SHIFTS:'off'},{SEVEN_SHIFTS_ACCESS_TOKEN:''},{SEVEN_SHIFTS_COMPANY_ID:'bad'}]){
    let calls=0;const reader=createSevenShiftsReadAdapter({env:{...env(),...changes},fetchFn:async()=>{calls++;throw Error('unexpected')}})
    await assert.rejects(reader.methods.listTimePunches(query),/read_access_disabled|connection_not_configured/);assert.equal(calls,0)
  }
  const e=env(),reader=createSevenShiftsReadAdapter({env:e,fetchFn:async()=>{e.SEVEN_SHIFTS_COMPANY_ID='999';return response([punch()])}})
  await assert.rejects(reader.methods.listTimePunches(query),/source_access_changed/)
})

test('pagination follows opaque cursors on the fixed endpoint and reports missing metadata and page bounds honestly',async()=>{
  let n=0;const calls=[],reader=createSevenShiftsReadAdapter({env:env(),fetchFn:async(u)=>{calls.push(u);return response([punch(++n)],n===1?'next-one':null)}})
  const v=await reader.methods.listTimePunches(query);assert.equal(v.results.length,2);assert.equal(v.evidence.completeWithinScope,true);assert.equal(new URL(calls[1]).searchParams.get('cursor'),'next-one')
  let pages=0;const bounded=createSevenShiftsReadAdapter({env:env(),fetchFn:async()=>response([punch(++pages)],'next-'+pages)})
  const partial=await bounded.methods.listTimePunches(query);assert.equal(pages,3);assert.equal(partial.evidence.completeWithinScope,false);assert.equal(partial.evidence.truncated,true)
  const unknown=createSevenShiftsReadAdapter({env:env(),fetchFn:async()=>({ok:true,json:async()=>({data:[]})})})
  assert.equal((await unknown.methods.listTimePunches(query)).evidence.completeWithinScope,false)
  const repeated=createSevenShiftsReadAdapter({env:env(),fetchFn:async()=>response([],'same')})
  await assert.rejects(repeated.methods.listTimePunches(query),/invalid_source_response/)
})

test('bad company, range, filters and source responses cannot become live payroll evidence or leak upstream errors',async()=>{
  for(const bad of [{companyId:999},{url:'https://evil.test'}, {timeMax:'2027-01-01T00:00:00Z'},{userId:'7'},{timeMin:'invalid'},{method:'POST'},{timeMin:'2026-02-30T00:00:00Z'}])assert.throws(()=>validateQuery({...query,...bad}),/invalid_request/)
  for(const bad of [{company_id:999},{clocked_in:'2026-08-01T00:00:00Z'},{user_id:0},{clocked_out:'invalid'}]){
    const reader=createSevenShiftsReadAdapter({env:env(),fetchFn:async()=>response([{...punch(),...bad}])})
    await assert.rejects(reader.methods.listTimePunches(query),/invalid_source_response/)
  }
  const denied=createSevenShiftsReadAdapter({env:env(),fetchFn:async()=>({ok:false,status:403,json:async()=>{throw Error('must not read')}})})
  await assert.rejects(denied.methods.listTimePunches(query),/source_not_authorised/)
  const failed=createSevenShiftsReadAdapter({env:env(),fetchFn:async()=>{throw Error('upstream synthetic-reader-secret')}})
  await assert.rejects(failed.methods.listTimePunches(query),e=>e.message==='source_unavailable' && !e.message.includes('synthetic-reader-secret'))
})
