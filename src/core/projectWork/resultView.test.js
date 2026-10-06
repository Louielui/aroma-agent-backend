'use strict'
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm')
const { buildHtml }=require('./view')
const ID='f5f8b397-34e4-46c8-8ba8-c86ae6e5e401', OTHER='00000000-0000-4000-8000-000000000002'
function run(id=ID){return {id,state:'completed',startedAt:'2026-10-05T22:41:52Z',source:{evidence:{revision:'a'.repeat(40)}},workOrder:{recipe:'registered-task-example',allowedFiles:['sidebar.css']},review:{verdict:'pass'},result:{summary:'Spacing adjusted',changes:[],baseline:{browser:[{name:'browser-zh-1280.png'}]},tests:{browser:[{name:'browser-zh-1280.png'}]}}}}
function fixture(search='?run='+ID, options={}){
 const calls=[], elements=new Map(), timers=[]
 const make=tag=>({tag,children:[],hidden:false,disabled:false,classList:{add(){}},append(...n){this.children.push(...n)},replaceChildren(...n){this.children=n},setAttribute(k,v){this[k]=v},scrollIntoView(){}})
 const html=buildHtml();for(const m of html.matchAll(/id="([^"]+)"/g))elements.set(m[1],make('div'))
 elements.get('recipe').options=[{},{},{}]
 const flat=n=>[n,...n.children.flatMap(flat)], all=()=>[...elements.values()].flatMap(flat)
 let failed=false, prepared=null
 const ctx=vm.createContext({document:{body:make('body'),getElementById:id=>elements.get(id),createElement:make,querySelectorAll:()=>all().filter(n=>n.dataset?.action)},location:{search,pathname:'/project-work'},URLSearchParams,encodeURIComponent,crypto:{randomUUID:()=>OTHER},setInterval:f=>timers.push(f),fetch:async(url,opts)=>{
  calls.push({url,body:opts?.body&&JSON.parse(opts.body)})
  if(failed)throw Error('offline')
  if(opts?.body)prepared={id:OTHER,workRunId:ID,state:'awaiting_approval',action:'adopt',source:{evidence:{revision:'a'.repeat(40)}},before:{},after:{}}
  const value=opts?.body?{run:prepared,approval:{id:OTHER,hash:'h',nonce:'n'}}:url.includes('project-adoption')?{runs:prepared?[prepared]:options.adoptions||[]}:url.endsWith('/'+ID)?{run:options.missing?null:run(options.mismatch?OTHER:ID)}:{runs:[run(OTHER),run()]}
  return {status:options.unauthorized?401:200,ok:!options.unauthorized,json:async()=>value}
 }})
 // Browser creates dataset on every element.
 const original=ctx.document.createElement;ctx.document.createElement=tag=>Object.assign(original(tag),{dataset:{}})
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx)
 return {calls,elements,all,tick:()=>timers[0](),fail:()=>{failed=true},flush:async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}}
}
test('chat result loads exact task, opens protected previews and never prepares or adopts on GET',async()=>{
 const f=fixture();await f.flush()
 assert.equal(f.calls[0].url,'/api/v1/project-work/'+ID)
 assert.equal(f.elements.get('preparePanel').hidden,true);assert.equal(f.elements.get('adoptPanel').hidden,true)
 assert.equal(f.elements.get('runs').children.length,1)
 assert.ok(f.all().some(n=>n.tag==='details'&&n.open===true))
 assert.ok(f.all().some(n=>n.tag==='img'&&n.src==='/api/v1/project-work/'+ID+'/browser/browser-zh-1280.png'))
 assert.ok(f.calls.every(c=>!c.body))
 const adopt=f.all().find(n=>n.dataset?.action==='adopt');assert.ok(adopt)
 await adopt.onclick();await f.flush()
 assert.equal(f.calls.filter(c=>c.body).length,1);assert.equal(f.calls.find(c=>c.body).body.runId,ID)
 assert.equal(f.calls.find(c=>c.body).body.op,'prepare');assert.equal(f.elements.get('adoptPanel').hidden,false)
 assert.equal(f.elements.get('adoptApprove').disabled,true)
})
test('unselected overview still lists work; previews remain collapsed',async()=>{
 const f=fixture('');await f.flush();assert.equal(f.calls[0].url,'/api/v1/project-work');assert.equal(f.elements.get('runs').children.length,2);assert.ok(!f.all().some(n=>n.open))
})

test('targeted result compares original and candidate screenshots without preparing any work',async()=>{
 const f=fixture();await f.flush()
 const before=f.all().find(n=>n.tag==='button'&&n.dataset?.phase==='before'),after=f.all().find(n=>n.tag==='button'&&n.dataset?.phase==='after')
 assert.ok(before&&after);assert.equal(after['aria-pressed'],'true')
 before.onclick()
 assert.ok(f.all().some(n=>n.tag==='img'&&n.src.endsWith('?phase=before')))
 assert.equal(before['aria-pressed'],'true');assert.equal(after['aria-pressed'],'false')
 after.onclick();assert.ok(f.all().some(n=>n.tag==='img'&&n.src.endsWith('/browser-zh-1280.png')))
 assert.ok(f.calls.every(c=>!c.body))
})
test('invalid, missing or mismatched task never substitutes another task',async()=>{
 for(const [query,options] of [['?run=../bad',{}],['?run=',{}],['?run='+ID,{missing:true}],['?run='+ID,{mismatch:true}]]){
  const f=fixture(query,options);await f.flush();assert.equal(f.elements.get('runs').children.length,0);assert.match(f.elements.get('message').textContent,/找不到|could not be found/);assert.ok(f.calls.every(c=>!c.body))
 }
})
test('login preserves targeted result URL and shows no task or actions',async()=>{
 const f=fixture('?run='+ID,{unauthorized:true});await f.flush();assert.equal(f.elements.get('login').hidden,false);assert.equal(f.elements.get('login').href,'/owner/login?next='+encodeURIComponent('/project-work?run='+ID));assert.equal(f.elements.get('runs').children.length,0)
})
test('polling failure disables stale adoption actions',async()=>{
 const f=fixture();await f.flush();f.fail();await f.tick();assert.ok(f.all().filter(n=>n.dataset?.action).every(n=>n.disabled));assert.ok(f.calls.every(c=>!c.body))
})
test('targeted results omit unrelated adoptions and suppress repeat adoption',async()=>{
 const f=fixture('?run='+ID,{adoptions:[{id:OTHER,workRunId:OTHER,state:'completed',action:'adopt'},{id:ID,workRunId:ID,state:'completed',action:'adopt',source:{evidence:{revision:'a'.repeat(40)}},loaded:{bootCommit:'a'.repeat(40)}}]});await f.flush()
 assert.equal(f.elements.get('adoptions').children.length,1);assert.ok(!f.all().some(n=>n.dataset?.action==='adopt'));assert.ok(f.all().some(n=>n.dataset?.action==='rollback'))
})
