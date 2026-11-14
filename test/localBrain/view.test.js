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
})
