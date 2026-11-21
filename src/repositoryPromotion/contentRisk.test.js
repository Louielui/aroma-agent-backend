'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{contentRiskText}=require('./checks'),{classifyChanges}=require('./policy')
const header='diff --git a/src/memory/transport.js b/src/memory/transport.js\n--- a/src/memory/transport.js\n+++ b/src/memory/transport.js\n@@ -1,3 +1,3 @@\n'
const old="      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(['backup', 'queue_index'].includes(request.op) ? 65000 : 20000),"
const changed="      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(request.op === 'backup' ? 270000 : request.op === 'queue_index' ? 65000 : 20000),"
const before="     const response = await fetch('http://127.0.0.1:8091/memory-store', {",after="       headers: { authorization: existingToken }, body: JSON.stringify(request)"
test('a pure deadline change on the identical transport has no new write verb; full diff remains reviewable',()=>{
 const diff=header+[before,'-'+old,'+'+changed,after].join('\n'),risk=contentRiskText([diff])
 assert.deepEqual(classifyChanges([],risk.addedText),[]);assert.equal(risk.adjustments.length,1)
 assert.ok(risk.addedText.includes('270000'));assert.ok(diff.includes("method: 'POST'"))
})
test('new writes, changed methods, destination/payload changes and side-effectful deadline expressions retain business-write protection',()=>{
 const cases=[header+'+'+changed,
 header+[before,'-'+old,'+'+changed.replace("'POST'","'DELETE'"),after].join('\n'),
 header+['-'+before.trimStart(),'+'+before.replace('memory-store','external-writer'),'%-'.replace('%','')+old,'+'+changed,after].join('\n'),
 header+[before,'-'+old,'+'+changed,'-'+after.trimStart(),'+'+after.replace('request','newPayload')].join('\n'),
 header+[before,'-'+old,'+'+changed.replace('270000','writeSomething()'),after].join('\n')]
 for(const diff of cases)assert.ok(classifyChanges([],contentRiskText([diff]).addedText).includes('business_data_write'),diff)
})

test('the exact archived test stays reviewable while mutations and other writes keep their normal classification',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
 const {reviewPacket}=require('./checks'),{digest}=require('./repository'),{execFileSync}=require('node:child_process')
 const file='test/localBrain/fixtures/pr205-knowledge-pack-v1.json'
 const text=fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8').replace(/\r\n/g,'\n')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-pack-gate-'))
 t.after(()=>{
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))
  fs.rmSync(root,{recursive:true,force:true})
 })
 const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','-C',root,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']})
 const ref=()=>git('rev-parse','HEAD').toString().trim()
 const write=(name,body)=>{const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body)}
 const commit=(message)=>{git('add','.');git('commit','-m',message);return ref()}
 git('init','-b','main')
 write('base.js','module.exports=1\n')
 const base=commit('base')
 write(file,text)
 const pinned=commit('add exact archive')
 const packet=reviewPacket({root,commit:pinned,base,tests:{}})
 const raw=git('diff','--binary','--no-ext-diff',base,pinned).toString('utf8')
 assert.equal(packet.batches.join(''),raw)
 assert.equal(packet.reviewedDiffHash,digest(raw))
 assert.ok(packet.changedPaths.includes(file))
 assert.match(raw,/method:\s*'POST'/)
 assert.deepEqual(classifyChanges(packet.changedPaths,packet.addedText),['security_permission_change'])
 assert.deepEqual(packet.contentAdjustments,[{file,reason:'pinned_archived_test_method'}])
 write('src/newWriter.js',"fetch(url,{method:'POST'});\n")
 write('src/newMigration.js','const query = "DROP TABLE records";\n')
 const withWrites=reviewPacket({root,commit:commit('add real writes'),base,tests:{}})
 assert.deepEqual(classifyChanges(withWrites.changedPaths,withWrites.addedText),
  ['business_data_write','destructive_database_migration','security_permission_change'])
 const addition=raw.replace('new file mode 100644','new file mode 100755')
 const moved=raw.replaceAll(file,'test/localBrain/fixtures/copied-knowledge-pack.json')
 const modified=raw.replace('PRIVATE_SENTINEL','CHANGED_SENTINEL')
 assert.notEqual(modified,raw)
 for(const piece of [addition,moved,modified,raw.replace(/method:\s*'POST'/,"method:'DELETE'")]){
  const risk=contentRiskText([piece])
  assert.ok(classifyChanges([],risk.addedText).includes('business_data_write'))
  assert.deepEqual(risk.adjustments,[])
 }
})
