'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto')
const {proposalFor,detectGap}=require('./gapContract')
function fixture(options={}){
  const id=randomUUID(),cid=randomUUID(),calls=[],nested=[],timers=[],confirms=[]
  const gap=detectGap({reason:'no_mapped_operation',state:{facts:[{need:'employee clock-out times',necessity:'required',readState:'no_system_operation',operation:null}]}})
  let row={id,conversationId:cid,state:'awaiting_approval',originalGoal:'<script>employee request</script>',proposal:proposalFor('Find 7shifts clock-outs',gap,'en'),proposalHash:'a'.repeat(64),steps:[],...options.row}
  function el(tag,className='',textContent=''){return {tag,className,textContent,children:[],events:{},dataset:{},isConnected:true,appendChild(n){this.children.push(n)},replaceChildren(){this.children=[]},addEventListener(k,f){this.events[k]=f}}}
  const body=el('div'),conv={cid},flat=n=>[n,...n.children.flatMap(flat)]
  const source=fs.readFileSync(path.join(__dirname,'../demo/assets/app.js'),'utf8'),fn=source.slice(source.indexOf('  function renderCapabilityGap ('),source.indexOf('  function renderTaskPlan ('))
  const sandbox={el,t:k=>k,body,runId:id,conv,initial:options.history?null:row,active:conv,document:{visibilityState:options.hidden?'hidden':'visible'},crypto:{randomUUID},AbortController,setTimeout:(f,ms)=>{timers.push({f,ms});return 1},clearTimeout(){},window:{confirm:s=>{confirms.push(s);return options.cancel!==true}},renderTaskPlan:(turn,child)=>nested.push(child),fetch:async(url,opts)=>{
    const b=opts.body?JSON.parse(opts.body):null;calls.push({url,body:b,credentials:opts.credentials,redirect:opts.redirect})
    if(!b&&options.waitRead)await options.waitRead
    if(b&&options.failWrite)throw Error('response lost')
    if(b)row={...row,state:b.op==='approve'?'awaiting_scope_registration':'completed',...(b.op==='resume'?{resumeResult:{reply:'verified original result'}}:{})}
    return {ok:true,json:async()=>({run:row})}
  }}
  vm.runInNewContext(fn+';renderCapabilityGap({body},runId,initial,conv)',sandbox)
  const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}
  const button=label=>flat(body).find(n=>n.tag==='button'&&n.textContent===label)
  return {id,cid,calls,nested,timers,confirms,flush,nodes:()=>flat(body),button,sandbox}
}
test('gap UI shows a readable original goal and safe text, asks for exact scope approval and never auto-dispatches',async()=>{
  const f=fixture();await f.flush()
  assert.ok(f.nodes().some(n=>n.textContent==='<script>employee request</script>'));assert.equal(f.nodes().some(n=>n.tag==='script'),false)
  assert.equal(f.calls.filter(c=>c.body).length,0);const b=f.button('gap.approve');assert.equal(b.disabled,false)
  const one=b.events.click(),two=b.events.click();await Promise.all([one,two]);await f.flush()
  const writes=f.calls.filter(c=>c.body);assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{op:'approve',id:f.id,conversationId:f.cid,hash:'a'.repeat(64)})
  assert.equal(writes[0].credentials,'same-origin');assert.equal(writes[0].redirect,'error');assert.match(f.confirms[0],/gap.scopePending/)
  assert.ok(f.nodes().some(n=>n.textContent==='gap.awaitingScopeRegistration'));assert.equal(f.nested.length,0);assert.equal(f.button('gap.resume'),undefined)
})
test('cancelled confirmation, topic change and restored history never approve or execute automatically',async()=>{
  const cancel=fixture({cancel:true});await cancel.flush();await cancel.button('gap.approve').events.click();assert.equal(cancel.calls.filter(c=>c.body).length,0)
  const changed=fixture();await changed.flush();changed.sandbox.active={cid:randomUUID()};await changed.button('gap.approve').events.click();assert.equal(changed.calls.filter(c=>c.body).length,0)
  const restored=fixture({history:true,row:{state:'awaiting_scope_registration',developmentTask:{goal:'Saved request'}}});await restored.flush()
  assert.equal(restored.calls.length,1);assert.equal(restored.calls[0].body,null);assert.ok(restored.nodes().some(n=>n.textContent==='gap.awaitingScopeRegistration'));assert.equal(restored.button('gap.approve'),undefined)
})
test('worker completion does not show continuation until loaded proof is verified; resume retry reuses one request id',async()=>{
  const work={state:'completed',workRunId:randomUUID()},unverified=fixture({row:{state:'development_planning',development:work,resumeAvailable:false}});await unverified.flush()
  assert.equal(unverified.button('gap.resume'),undefined);assert.ok(unverified.nodes().some(n=>n.textContent==='gap.unverified'))
  const ready=fixture({failWrite:true,row:{state:'development_planning',development:work,resumeAvailable:true}});await ready.flush()
  await ready.button('gap.resume').events.click();await ready.button('gap.resume').events.click()
  const writes=ready.calls.filter(c=>c.body);assert.equal(writes.length,2);assert.equal(writes[0].body.requestId,writes[1].body.requestId)
  assert.deepEqual(Object.keys(writes[0].body).sort(),['conversationId','hash','id','op','requestId']);assert.ok(ready.nodes().some(n=>n.textContent==='gap.failed'))
})
test('registered planning embeds the existing progress card without coding commands and does not redraw a pending approval',async()=>{
  const child=randomUUID(),registered=fixture({row:{state:'development_planning',taskPlanRunId:child,proposal:{...proposalFor('Context read',detectGap({reason:'no_mapped_operation',plan:{requestedCapability:'aroma_system.read'},state:{facts:[]}}),'en')}}});await registered.flush()
  assert.deepEqual(registered.nested,[child]);assert.equal(registered.calls.filter(c=>c.body).length,0)
  let release;const waitRead=new Promise(r=>{release=r}),race=fixture({waitRead});await race.button('gap.approve').events.click();release();await race.flush()
  assert.ok(race.nodes().some(n=>n.textContent==='gap.awaitingScopeRegistration'));assert.equal(race.button('gap.approve'),undefined)
})
