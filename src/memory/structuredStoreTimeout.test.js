'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream')
function fixture(){
 const timers=[],children=[],wire=[]
 const spawn=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin={end:()=>{}};child.kill=()=>{child.killed=true};children.push(child);return child}
 const module={exports:{}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'structuredStore.js'),'utf8'),{module,exports:module.exports,__dirname,process:{env:{}},Buffer,
  require:name=>name==='node:path'?path:name==='node:child_process'?{spawn}:name==='../testProcess'?{isTestProcess:()=>false}:name==='node:crypto'?{randomUUID:()=> 'fixture'}:name==='../adapters/liveEgressFence'?{fencedFetch:()=>async(url,init)=>{wire.push(init);return{ok:true,json:async()=>({result:{state:'verified'}})}}}:(()=>{throw Error('unexpected_fixture_dependency')})(),
  setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer},clearTimeout:()=>{},AbortSignal:{timeout:ms=>({deadline:ms})}})
 return{store:module.exports.createStructuredStore,timers,children,wire}
}
test('a measured 75-second backup completes inside its bounded worker deadline; ordinary reads retain short bounds',async()=>{
 const f=fixture(),promise=f.store({local:true}).backup(),child=f.children[0],timer=f.timers[0]
 // Reproduce elapsed work without spending 75 wall-clock seconds or opening a database.
 if(timer.ms<=75000)timer.fn();else{child.stdout.end('{"saved":{"state":"saved"},"restored":{"state":"verified"}}');child.emit('close',0)}
 const value=await promise
 assert.equal(value.restored.state,'verified');assert.equal(child.killed,undefined);assert.ok(timer.ms>75000&&timer.ms<=240000)
 const read=f.store({local:true}).health();assert.equal(f.timers[1].ms,15000);f.timers[1].fn();await assert.rejects(read,/memory_database_unavailable/)
})
test('backup transport outlives the worker while queue indexing keeps its existing deadline',async()=>{
 const f=fixture(),store=f.store({env:{CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64)}})
 await store.backup();await store.request({op:'queue_index'})
 assert.equal(f.wire[0].signal.deadline,270000);assert.equal(f.wire[1].signal.deadline,65000)
})
