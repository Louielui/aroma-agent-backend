'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
test('visible final state separates failure, source pointers and untrusted markup',async()=>{
  const nodes=new Map(),element=()=>({textContent:'',children:[],append(v){this.children.push(v)}})
  const document={querySelector(key){if(!nodes.has(key))nodes.set(key,element());return nodes.get(key)},createElement:element}
  const context=vm.createContext({document,crypto:{randomUUID:()=> 'test'},fetch:async()=>({ok:true,json:async()=>({model:'local'})})})
  const html=fs.readFileSync(path.join(__dirname,'../../src/localBrain/view.html'),'utf8')
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context)
  await new Promise(r=>setImmediate(r))
  context.receipt={body:{error:{code:'local_service_unavailable'}},timing:{totalMs:12}}
  assert.equal(vm.runInContext("renderFinal(receipt,'hello')",context),false)
  assert.match(nodes.get('#state').textContent,/未完成/);assert.equal(vm.runInContext('history.length',context),0)
  context.receipt={body:{reply:'<img src=x onerror=alert(1)>',memorySources:{kind:'memory_references_v1',claimsVerified:false,items:[{documentId:'xx-known',version:4,scope:'private:owner',date:null}]}},timing:{totalMs:10}}
  assert.equal(vm.runInContext("renderFinal(receipt,'hello')",context),true)
  const answer=nodes.get('#chat').children.at(-1)
  assert.equal(answer.textContent,'<img src=x onerror=alert(1)>');assert.equal(answer.innerHTML,undefined)
  assert.match(answer.children[0].textContent,/xx-known.*版本 4.*private:owner/)
  assert.equal(vm.runInContext('history.length',context),2)
  context.receipt={body:{reply:'A valid guarded answer.'},memoryReceipt:'unavailable',timing:{totalMs:11}}
  assert.equal(vm.runInContext("renderFinal(receipt,'another turn')",context),true)
  const partial=nodes.get('#chat').children.at(-1)
  assert.equal(partial.textContent,'A valid guarded answer.')
  assert.match(partial.children[0].textContent,/記憶保存未確認/)
  context.receipt={body:{reply:'Acknowledged.'},memoryReceipt:'queued',timing:{totalMs:11}}
  vm.runInContext("renderFinal(receipt,'fixture')",context)
  assert.match(nodes.get('#chat').children.at(-1).children[0].textContent,/入列.*批准.*有效記憶/)
})

test('isolated catalogue describes its actual local engine without changing production labels',()=>{
 const {buildHtml}=require('../../src/memory/governedView')
 const labels=html=>JSON.parse(html.match(/const L=(\{[^\n]+\});const el/)[1])
 const standard=labels(buildHtml()),local=labels(buildHtml({localOnly:true}))
 assert.equal(standard.localOnly,false);assert.equal(standard.storageLabel,'PostgreSQL')
 assert.equal(local.localOnly,true);assert.match(local.storageLabel,/SQLite/);assert.match(local.retrievalLabel,/字詞.*無向量/)
 assert.match(local.consolidationHelp,/本機.*批准/);assert.doesNotMatch(local.consolidationHelp,/Hindsight|訂閱|GPT/)
 assert.match(local.evidence,/本機/);assert.doesNotMatch(local.evidence,/GPT|訂閱/)
 assert.match(local.indexes,/字詞/)
})

test('local catalogue status uses the isolated endpoint and leaves missing counts unknown',async()=>{
 const html=require('../../src/memory/governedView').buildHtml({localOnly:true}),L=JSON.parse(html.match(/const L=(\{[^\n]+\});const el/)[1])
 const children=[],area={replaceChildren(){children.length=0},append(...items){children.push(...items)}},paths=[]
 const context=vm.createContext({L,el:()=>area,node:(tag,text)=>({tag,text}),fetch:async url=>{paths.push(url);return{ok:true,json:async()=>({model:'qwen3.5:9b',background:{capture:{pending:2},engine:{busy:false}}})}}})
 vm.runInContext(html.match(/async function loadOperations\(\)\{[\s\S]*?\r?\n\}\r?\n(?=async function api)/)[0],context)
 await vm.runInContext('loadOperations()',context)
 assert.deepEqual(paths,['/api/local/status']);assert.ok(children.some(x=>x.text.includes('qwen3.5:9b')));assert.ok(children.some(x=>x.text.endsWith(' · 2')))
 context.fetch=async()=>({ok:true,json:async()=>({model:'qwen3.5:9b'})})
 await vm.runInContext('loadOperations()',context);assert.ok(children.some(x=>x.text.endsWith(' · —')))
 assert.ok(children.every(x=>!/Hindsight|PostgreSQL|GPT|訂閱/.test(x.text)))
})
