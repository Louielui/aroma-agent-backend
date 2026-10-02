'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createOwnerCalendarReader}=require('./calendarReadOnlyClient')
test('Calendar SDK stays in closure and only primary metadata/list/get fixed reads are reachable',async()=>{
  const calls=[];const oauth={transporter:{defaults:{}},getAccessToken:async()=>({token:'fixture-secret'}),getTokenInfo:async()=>({scopes:['https://www.googleapis.com/auth/calendar.readonly']})}
  const client={calendars:{get:async(args,opts)=>{calls.push({method:'metadata',args,opts});return {data:{id:'chef@example.test'}}}},events:{list:async(args,opts)=>{calls.push({method:'list',args,opts});return {data:{items:[]}}},get:async(args,opts)=>{calls.push({method:'get',args,opts});return {data:{id:args.eventId}}}}}
  const reader=createOwnerCalendarReader({oauthFactory:()=>oauth,serviceFactory:(name,version)=>{assert.equal(name,'calendar');assert.equal(version,'v3');return client}})
  assert.deepEqual(Object.keys(reader),['identity','metadata','listEvents','getEvent']);assert.ok(Object.isFrozen(reader))
  const identity=await reader.identity();assert.ok(!JSON.stringify(identity).includes('fixture-secret'))
  await reader.metadata();await reader.listEvents({timeMin:'2026-10-01T05:00:00Z',timeMax:'2026-10-02T05:00:00Z',q:'review',pageToken:'page2',calendarId:'other',url:'https://evil.test'});await reader.getEvent('event12')
  assert.ok(calls.every(c=>c.args.calendarId==='primary'&&c.opts.retry===false&&c.opts.maxRedirects===0))
  assert.equal(calls[1].args.singleEvents,true);assert.equal(calls[1].args.showDeleted,false);assert.equal(calls[1].args.maxResults,50);assert.equal(calls[1].args.timeZone,'America/Winnipeg');assert.equal(calls[1].args.q,'review');assert.equal(calls[1].args.url,undefined)
  assert.match(calls[1].args.fields,/nextSyncToken/);assert.ok(!calls[1].args.fields.includes('attendees'))
})
