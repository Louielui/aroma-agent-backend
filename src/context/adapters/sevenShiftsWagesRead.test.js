'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createSevenShiftsWagesReader}=require('./sevenShiftsWagesRead')
const env=()=>({READ_ACCESS:'on',CONTEXT_SEVEN_SHIFTS:'on',SEVEN_SHIFTS_COMPANY_ID:'17',SEVEN_SHIFTS_ACCESS_TOKEN:'fixture-token'})
function fixture({roles=false,users,wages,settings,transport}={}){
 const calls=[],e=env(),now=()=> '2026-10-13T18:00:00Z'
 const fetchFn=async(url,options)=>{calls.push({url,options});if(transport)return transport(url,options)
  const u=new URL(url);let data
  if(u.pathname.endsWith('/labor_settings'))data={data:settings||{company_id:17,wage_based_roles_enabled:roles}}
  else if(u.pathname.endsWith('/users'))data={data:u.searchParams.get('status')==='inactive'?[]:users||[{id:1,company_id:17,first_name:'Fixture',last_name:'Employee',active:true,email:'PRIVATE-EMAIL'}],meta:{cursor:{next:null}}}
  else if(u.pathname.endsWith('/role_assignments'))data={data:[{company_id:17,role_id:7,name:'Cook'}]}
  else data={data:{current_wages:wages||[{id:9,effective_date:'2026-01-01',role_id:null,wage_type:'hourly',wage_cents:1750}],upcoming_wages:[]}}
  return {ok:true,status:200,text:async()=>JSON.stringify(data)}
 }
 return {reader:createSevenShiftsWagesReader({env:e,fetchFn,clock:now}),calls,env:e}
}
test('wages reader retrieves real values through fixed company GET endpoints and excludes private profile fields',async()=>{
 const f=fixture(),r=await f.reader.read({status:'active'})
 assert.equal(r.state,'live');assert.equal(r.rows[0].wages[0].wageCents,1750);assert.equal(r.complete,true)
 assert.equal(r.companyId,17);assert.ok(!JSON.stringify(r).includes('PRIVATE-EMAIL'));assert.ok(!JSON.stringify(r).includes('fixture-token'))
 assert.ok(f.calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error'&&new URL(c.url).origin==='https://api.7shifts.com'))
})
test('role wages use assigned roles and latest effective wages without treating weekly salary as hourly',async()=>{
 const f=fixture({roles:true,wages:[{id:1,effective_date:'2026-01-01',role_id:7,wage_type:'hourly',wage_cents:1800},{id:2,effective_date:'2025-01-01',role_id:7,wage_type:'hourly',wage_cents:1600},{id:3,effective_date:'2026-01-01',role_id:99,wage_type:'hourly',wage_cents:9900}]})
 const r=await f.reader.read({status:'all'});assert.equal(r.rows[0].wages[0].wageCents,1800);assert.equal(r.rows[0].wages[0].roleName,'Cook');assert.equal(r.rows[0].wages.length,1)
 const s=await fixture({wages:[{id:4,effective_date:'2026-01-01',role_id:null,wage_type:'weekly_salary',wage_cents:100000}]}).reader.read({status:'active'})
 assert.equal(s.rows[0].wages[0].wageType,'weekly_salary');assert.equal(s.rows[0].wages[0].wageCents,100000)
})
test('access disabled, forged scope, redirects and malformed settings cannot cause extra reads',async()=>{
 const f=fixture();f.env.READ_ACCESS='off';assert.equal((await f.reader.read({status:'active'})).state,'unavailable');assert.equal(f.calls.length,0)
 await assert.rejects(f.reader.read({status:'all',companyId:999}),/invalid_request/)
 const bad=fixture({settings:{company_id:999,wage_based_roles_enabled:false}});assert.equal((await bad.reader.read({status:'active'})).state,'unavailable');assert.equal(bad.calls.length,1)
 const redirect=fixture({transport:async()=>({ok:false,status:302})});assert.equal((await redirect.reader.read({status:'active'})).state,'unavailable');assert.equal(redirect.calls.length,1)
})
test('employee pagination continues and a denial for one wage remains missing rather than zero',async()=>{
 let count=0
 const f=fixture({transport:async url=>{const u=new URL(url);let body
  if(u.pathname.endsWith('/labor_settings'))body={data:{company_id:17,wage_based_roles_enabled:false}}
  else if(u.pathname.endsWith('/users'))body={data:[{id:++count,company_id:17,first_name:'Fixture',last_name:String(count),active:true}],meta:{cursor:{next:count===1?'next-fixture':null}}}
  else if(u.pathname.includes('/1/wages'))return {ok:false,status:403}
  else body={data:{current_wages:[{id:9,effective_date:'2026-01-01',role_id:null,wage_type:'hourly',wage_cents:0}],upcoming_wages:[]}}
  return {ok:true,status:200,text:async()=>JSON.stringify(body)}
 }})
 const r=await f.reader.read({status:'active'});assert.equal(r.rows.length,2);assert.equal(r.complete,false);assert.equal(r.rows[0].wages,null);assert.equal(r.rows[1].wages[0].wageCents,0);assert.ok(f.calls.some(c=>new URL(c.url).searchParams.get('cursor')==='next-fixture'));assert.deepEqual(r.coverage,{version:1,roster:{count:2,pages:2,complete:true,limitReason:null},values:{verifiedRows:1,unresolvedRows:1}})
})
test('revoked token, abort and repeated cursors stop execution without leaking response bodies',async()=>{
 const f=fixture({transport:async()=>{f.env.SEVEN_SHIFTS_ACCESS_TOKEN='changed';return {ok:true,status:200,text:async()=>'{"private":"secret"}'}}})
 const r=await f.reader.read({status:'all'});assert.equal(r.state,'unavailable');assert.ok(!JSON.stringify(r).includes('secret'));assert.equal(f.calls.length,1)
 const a=fixture(),controller=new AbortController();controller.abort();await a.reader.read({status:'all',signal:controller.signal});assert.equal(a.calls.length,0)
 let user=0;const repeated=fixture({transport:async url=>({ok:true,status:200,text:async()=>JSON.stringify(url.endsWith('/labor_settings')?{data:{company_id:17,wage_based_roles_enabled:false}}:{data:[{id:++user,company_id:17,active:true}],meta:{cursor:{next:'same'}}})})});assert.equal((await repeated.reader.read({status:'active'})).state,'unavailable');assert.equal(repeated.calls.length,3)
})
test('wage schema errors, future wages and contradictory current rates remain unavailable rather than guessed',async()=>{
 for(const wages of [[{id:1,effective_date:'2026-02-30',role_id:null,wage_type:'hourly',wage_cents:1800}],[{id:1,effective_date:'2026-10-14',role_id:null,wage_type:'hourly',wage_cents:1800}],[{id:1,effective_date:'2026-01-01',role_id:null,wage_type:'hourly',wage_cents:1800},{id:2,effective_date:'2026-01-01',role_id:null,wage_type:'hourly',wage_cents:2000}]]){
  const r=await fixture({wages}).reader.read({status:'active'});assert.equal(r.complete,false);assert.equal(r.rows[0].wages,null)
 }
})
test('bounded roster pagination reports partial coverage and an abort-unaware transport still terminates',async()=>{
 let user=0;const capped=fixture({transport:async url=>({ok:true,status:200,text:async()=>JSON.stringify(url.endsWith('/labor_settings')?{data:{company_id:17,wage_based_roles_enabled:false}}:url.includes('/users?')?{data:[{id:++user,company_id:17,active:true}],meta:{cursor:{next:'cursor-'+user}}}:{data:{current_wages:[],upcoming_wages:[]}})})})
 const r=await capped.reader.read({status:'active'});assert.equal(r.rosterComplete,false);assert.equal(r.complete,false);assert.equal(r.rows.length,3)
 const timeout=createSevenShiftsWagesReader({env:env(),fetchFn:()=>new Promise(()=>{}),timeoutMs:100});const result=await timeout.read({status:'all'});assert.equal(result.state,'unavailable');assert.equal(result.reason,'read_timeout')
})

test('an internal deadline retains verified wages and labels unfinished employees without claiming completeness',async()=>{
 const fetchFn=async url=>url.includes('/2/wages')?new Promise(()=>{}):fixtureResponse(url)
 function fixtureResponse(url){const u=new URL(url);let body=u.pathname.endsWith('/labor_settings')?{data:{company_id:17,wage_based_roles_enabled:false}}:u.pathname.endsWith('/users')?{data:[{id:1,company_id:17,first_name:'Verified',active:true},{id:2,company_id:17,first_name:'Pending',active:true}],meta:{cursor:{next:null}}}:{data:{current_wages:[{id:9,effective_date:'2026-01-01',role_id:null,wage_type:'hourly',wage_cents:1750}]}};return {ok:true,status:200,text:async()=>JSON.stringify(body)}}
 const r=await createSevenShiftsWagesReader({env:env(),fetchFn,timeoutMs:100}).read({status:'active'})
 assert.equal(r.state,'live');assert.equal(r.reason,'read_timeout');assert.equal(r.complete,false);assert.equal(r.rosterComplete,true);assert.equal(r.rows.length,2);assert.equal(r.rows[0].wages[0].wageCents,1750);assert.equal(r.rows[1].wages,null);assert.equal(r.rows[1].error,'read_timeout')
})

test('Owner cancellation and revoked access discard partial wage results',async()=>{
 for(const revoke of [false,true]){const e=env(),controller=new AbortController();const fetchFn=async url=>{let body;if(url.endsWith('/labor_settings'))body={data:{company_id:17,wage_based_roles_enabled:false}};else if(new URL(url).pathname.endsWith('/users'))body={data:[{id:1,company_id:17,first_name:'Fixture',active:true}],meta:{cursor:{next:null}}};else{if(revoke)e.READ_ACCESS='off';else controller.abort();return new Promise(()=>{})}return {ok:true,status:200,text:async()=>JSON.stringify(body)}};const r=await createSevenShiftsWagesReader({env:e,fetchFn,timeoutMs:100}).read({status:'active',signal:controller.signal});assert.equal(r.state,'unavailable');assert.equal(r.rows,null)}
})

test('a mixed roster caps the final page to remaining capacity and returns an explicitly partial read',async()=>{
 let nextId=0;const limits=[];const f=fixture({transport:async url=>{const u=new URL(url);let body;if(u.pathname.endsWith('/labor_settings'))body={data:{company_id:17,wage_based_roles_enabled:false}};else if(u.pathname.endsWith('/users')){const active=u.searchParams.get('status')==='active',limit=Number(u.searchParams.get('limit'));limits.push(limit);body={data:Array.from({length:active?28:limit},()=>({id:++nextId,company_id:17,first_name:'Fixture',active})),meta:{cursor:{next:active?null:'page-'+nextId}}}}else body={data:{current_wages:[{id:9,effective_date:'2026-01-01',role_id:null,wage_type:'hourly',wage_cents:1750}]}};return {ok:true,status:200,text:async()=>JSON.stringify(body)}}})
 const r=await f.reader.read({status:'all'});assert.equal(r.state,'live');assert.equal(r.rows.length,300);assert.equal(r.complete,false);assert.equal(r.rosterComplete,false);assert.deepEqual(limits,[100,100,100,72]);assert.ok(r.rows.every(r=>r.wages[0].wageCents===1750))
})

test('company-scoped role responses may omit company_id but an explicit foreign company is rejected',async()=>{
 for(const companyId of [undefined,999]){const transport=async url=>{const path=new URL(url).pathname;const body=path.endsWith('/labor_settings')?{data:{company_id:17,wage_based_roles_enabled:true}}:path.endsWith('/users')?{data:[{id:1,company_id:17,first_name:'Fixture',active:true}],meta:{cursor:{next:null}}}:path.endsWith('/role_assignments')?{data:[{role_id:7,name:'Cook',...(companyId===undefined?{}:{company_id:companyId})}]}:{data:{current_wages:[{id:9,effective_date:'2026-01-01',role_id:7,wage_type:'hourly',wage_cents:1750}]}};return {ok:true,status:200,text:async()=>JSON.stringify(body)}};const r=await createSevenShiftsWagesReader({env:env(),fetchFn:transport}).read({status:'active'});if(companyId===undefined){assert.equal(r.complete,true);assert.equal(r.rows[0].wages[0].wageCents,1750)}else{assert.equal(r.complete,false);assert.equal(r.rows[0].wages,null);assert.equal(r.rows[0].error,'invalid_source_response')}}
})

test('one missing assigned-role wage preserves other verified roles and never becomes a zero rate',async()=>{
 const fetchFn=async url=>{const p=new URL(url).pathname;const body=p.endsWith('/labor_settings')?{data:{company_id:17,wage_based_roles_enabled:true}}:p.endsWith('/users')?{data:[{id:1,company_id:17,first_name:'Fixture',active:true}],meta:{cursor:{next:null}}}:p.endsWith('/role_assignments')?{data:[{role_id:7,name:'Verified role'},{role_id:8,name:'Missing role'}]}:{data:{current_wages:[{id:9,effective_date:'2026-01-01',role_id:7,wage_type:'hourly',wage_cents:1750}]}};return {ok:true,status:200,text:async()=>JSON.stringify(body)}}
 const r=await createSevenShiftsWagesReader({env:env(),fetchFn}).read({status:'active'});assert.equal(r.complete,false);assert.equal(r.rows[0].wages[0].wageCents,1750);assert.equal(r.rows[0].wages[1].wageCents,null);const answer=require('../../intake/readTask').renderWageResult(r,'列出員工時薪');assert.match(answer.text,/17\.50/);assert.match(answer.presentation.details,/Missing role.*未能讀取/);assert.ok(!answer.text.includes('0.00'))
})
