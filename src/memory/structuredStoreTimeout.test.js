'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream')
function fixture(response={result:{state:'verified'}}){
 const timers=[],children=[],wire=[]
 const spawn=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin={end:()=>{}};child.kill=()=>{child.killed=true};children.push(child);return child}
 const module={exports:{}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'structuredStore.js'),'utf8'),{module,exports:module.exports,__dirname,process:{env:{}},Buffer,
  require:name=>name==='node:path'?path:name==='./backupDiagnostics'?require('./backupDiagnostics'):name==='node:child_process'?{spawn}:name==='../testProcess'?{isTestProcess:()=>false}:name==='node:crypto'?{randomUUID:()=> 'fixture'}:name==='../adapters/liveEgressFence'?{fencedFetch:()=>async(url,init)=>{wire.push(init);return{ok:true,json:async()=>response}}}:(()=>{throw Error('unexpected_fixture_dependency')})(),
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
test('phase progress cannot extend the backup deadline or convert a timeout into verified proof',async()=>{
 const f=fixture(),pending=f.store({local:true}).backup(),child=f.children[0],timer=f.timers[0]
 child.stderr.write(JSON.stringify({event:'BACKUP_PHASE',version:1,phase:'stage_files',state:'started'})+'\n')
 assert.equal(timer.ms,240000);assert.equal(f.timers.length,1);timer.fn()
 await assert.rejects(pending,e=>{assert.equal(e.message,'memory_backup_timeout');assert.equal(e.backupDiagnostic.phase,'stage_files');assert.equal(e.backupDiagnostic.lastCompletedPhase,null);return true});assert.equal(child.killed,true)
})
test('remote backup diagnostics stay bounded and are not attached to ordinary memory errors',async()=>{
 const diagnostic={version:1,phase:'stage_files',lastCompletedPhase:null,elapsedMs:240000,phaseElapsedMs:240000},f=fixture({error:'memory_backup_timeout',backupDiagnostic:{...diagnostic,password:'secret'}}),s=f.store({env:{CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64)}})
 await assert.rejects(s.backup(),e=>{assert.deepEqual(e.backupDiagnostic,diagnostic);assert.ok(!JSON.stringify(e.backupDiagnostic).includes('secret'));return true})
 await assert.rejects(s.health(),e=>e.backupDiagnostic===undefined)
})
