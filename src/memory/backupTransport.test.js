'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createBridge}=require('../subscription/bridge')
test('authenticated canonical backup failures carry only safe phase metadata, never grant proof or cross into ordinary reads',async t=>{
 const token='f'.repeat(64),diagnostic={version:1,phase:'seal_bundle',lastCompletedPhase:'verify_database',elapsedMs:240000,phaseElapsedMs:120000}
 const server=createBridge({token,memoryEnabled:true,memoryStore:{request:async()=>{const e=Error('memory_backup_timeout');e.backupDiagnostic={...diagnostic,password:'secret-do-not-return'};throw e}}})
 server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()})
 const url='http://127.0.0.1:'+server.address().port+'/memory-store',post=(op,auth=true)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{})},body:JSON.stringify({op})})
 assert.equal((await post('backup',false)).status,401)
 const value=await(await post('backup')).json();assert.deepEqual(value,{error:'memory_backup_timeout',backupDiagnostic:diagnostic});assert.ok(!JSON.stringify(value).includes('secret'));assert.equal(value.result,undefined)
 const ordinary=await(await post('health')).json();assert.equal(ordinary.backupDiagnostic,undefined)
})
