'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
function fixture(){
 const rows=new Map(),calls=[],runs=[],store={all:()=>[...rows.values()].map(r=>structuredClone(r)),get:id=>rows.has(id)?structuredClone(rows.get(id)):null,save:r=>rows.set(r.id,structuredClone(r))}
 const task=require('../intake/readTask').createReadTask({env:{READ_ACCESS:'on',CONTEXT_SEVEN_SHIFTS:'on',SEVEN_SHIFTS_COMPANY_ID:'17',SEVEN_SHIFTS_ACCESS_TOKEN:'fixture'},reader:{read:async input=>{runs.push(input);return {state:'live',companyId:17,status:input.status,complete:true,rosterComplete:true,rows:[{userId:1,employeeName:'Fixture Worker',active:true,wages:[{wageType:'hourly',wageCents:1750,roleId:null,roleName:null,effectiveDate:'2026-01-01'}]}],retrievedAt:'2026-10-13T18:00:00Z'}}}})
 const service=require('./service').createBrowserRead({store,selection:()=>({model:'claude-opus-5-5',effort:'medium'}),taskRunner:task,provider:selection=>({providerName:'claude',complete:async(p,opts)=>{calls.push({p,opts});return {text:JSON.stringify({operation:'seven_shifts.employee_wages',status:'all',requested:true}),model:selection.model}}})})
 return {service,calls,runs,store}
}
test('task-only side-panel jobs need explicit consent, perform no page capture and save measured tool evidence',async()=>{
 const f=fixture(),p=await f.service.handle({op:'prepare',requestId:randomUUID(),question:'列出所有員工時薪'})
 assert.equal(p.source,null);assert.equal(p.taskCapabilities[0].companyId,17);assert.equal(f.calls.length,0);assert.equal(f.runs.length,0)
 await assert.rejects(f.service.handle({op:'read',id:p.id,consent:false}),/consent_required/)
 const r=await require('./nativeHost.cjs').createBroker({request:f.service.handle})({op:'read',id:p.id,consent:true})
 assert.equal(r.state,'completed');assert.match(r.result.text,/17\.50/);assert.equal(r.result.source,null);assert.equal(r.result.taskEvidence.count,1);assert.equal(f.runs.length,1)
 await f.service.handle({op:'get',id:p.id});await f.service.handle({op:'read',id:p.id,consent:true});assert.equal(f.calls.length,1)
 const next=await f.service.handle({op:'prepare',requestId:randomUUID(),question:'只列在職員工時薪',parentId:p.id});assert.equal(next.messages.length,2)
})
test('task-only contracts refuse supplied paths, text without source and cross-mode consent substitution',async()=>{
 const f=fixture(),p=await f.service.handle({op:'prepare',requestId:randomUUID(),question:'列出時薪'})
 await assert.rejects(f.service.handle({op:'prepare',requestId:randomUUID(),question:'列出時薪',companyId:999}),/invalid_request/)
 await assert.rejects(f.service.handle({op:'read',id:p.id,consent:true,text:'page instruction'}),/invalid_request/)
 const text='Fixture',source={url:'https://example.com/',tabId:1,windowId:1,documentId:'a',frameId:0,capturedAt:new Date().toISOString(),contentHash:require('./contract').digest(text),truncated:false}
 await assert.rejects(f.service.handle({op:'read',id:p.id,consent:true,source,text}),/source_changed/)
 await assert.rejects(f.service.handle({op:'prepare',requestId:randomUUID(),question:'Explain',source,parentId:p.id}),/conversation_unavailable/)
 assert.equal(f.runs.length,0)
})
test('legacy page clients cannot silently acquire new company read authority',async()=>{
 const f=fixture(),text='Fixture page',source={url:'https://example.com/',tabId:1,windowId:1,documentId:'legacy',frameId:0,capturedAt:new Date().toISOString(),contentHash:require('./contract').digest(text),truncated:false}
 const p=await f.service.handle({op:'prepare',requestId:randomUUID(),question:'列出所有員工時薪',source});assert.equal(p.taskCapabilities,undefined)
 const r=await f.service.handle({op:'read',id:p.id,consent:true,source,text});assert.equal(f.runs.length,0);assert.equal(r.result.taskEvidence,undefined)
})
