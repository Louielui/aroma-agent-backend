'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process')
const python='C:/Aroma/hindsight-runtime/Scripts/python.exe'
test('bounded compact recovery keeps every file and accepts legacy manifests',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'backup-manifest-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const r=spawnSync(python,['-B','-X','utf8',path.join(__dirname,'backupManifest.fixture.py'),root],{encoding:'utf8',windowsHide:true,timeout:30000})
 assert.equal(r.status,0,r.stderr||r.stdout)
 assert.deepEqual(JSON.parse(r.stdout),{legacyRead:true,compactFiles:41,tagPreserved:true,invalidRowRejected:true,hardByteLimitHeld:true})
})
test('restore pipelines verified source reads and durable output without skipping any destination readback',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'backup-restore-'));t.after(()=>{
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true})
 })
 const r=spawnSync(python,['-B','-X','utf8',path.join(__dirname,'backupRestore.fixture.py'),root],{encoding:'utf8',windowsHide:true,timeout:30000})
 assert.equal(r.status,0,r.stderr||r.stdout);assert.deepEqual(JSON.parse(r.stdout),{
  files:40,sourceReadsParallel:true,parentDirectoriesReused:true,everyDestinationReadBack:true,
  objectDriftRejected:true,manifestDriftRejected:true,lateDestinationDriftRejected:true
 })
})
test('complete source capture is bounded and parallel while each original object and manifest order remain verified',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'backup-stage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const r=spawnSync(python,['-B','-X','utf8',path.join(__dirname,'backupStage.fixture.py'),root],{encoding:'utf8',windowsHide:true,timeout:30000})
 assert.equal(r.status,0,r.stderr||r.stdout);assert.deepEqual(JSON.parse(r.stdout),{files:32,sourceParallel:true,allHashes:true,orderedManifest:true,workersStopped:true})
})
test('source mutation, parallel aggregate limit, invalid JSON and worker failures cannot yield a receipt',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'backup-stage-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const r=spawnSync(python,['-B','-X','utf8',path.join(__dirname,'backupStageBoundary.fixture.py'),root],{encoding:'utf8',windowsHide:true,timeout:30000})
 assert.equal(r.status,0,r.stderr||r.stdout);assert.deepEqual(JSON.parse(r.stdout),{sourceMutation:'rejected',aggregateLimit:'rejected',invalidJson:'rejected',dedupWrites:1,workerFailure:'propagated',activeAfterFailure:0,pendingBound:16,walSnapshot:'verified_source_unchanged',zeroFilledTrace:'restored_exact_bytes',otherMalformedFiles:'rejected',falseMarker:'rejected'})
})
