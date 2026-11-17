'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process')
test('backup capture and restore keep every durable write/hash while bounding parallel I/O',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xx-backup-parallel-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const r=spawnSync('C:/Aroma/hindsight-runtime/Scripts/python.exe',['-B','-X','utf8',path.join(__dirname,'backupParallel.fixture.py'),root],{encoding:'utf8',windowsHide:true,timeout:30000})
 assert.equal(r.status,0,r.stderr||r.stdout);assert.deepEqual(JSON.parse(r.stdout),{files:25,uniqueObjects:24,boundedParallelDurableWrites:true,allRestoredHashes:true})
})
