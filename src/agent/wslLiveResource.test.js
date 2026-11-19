'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto')
const {acquire}=require('./wslLiveResource.fixture.cjs')
test('real shared-WSL fixture owners serialize across OS processes without skipping tests or borrowing another lock',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsl-test-resource-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let entered=0,left=0
 const code="const release=require(process.argv[1]).acquire({dir:process.argv[2],timeoutMs:5000});const fs=require('node:fs'),mark=require('node:path').join(process.argv[2],'active');fs.closeSync(fs.openSync(mark,'wx'));process.send({phase:'entered'});setTimeout(()=>{fs.unlinkSync(mark);process.send({phase:'left'});release();process.disconnect()},60)"
 await Promise.all([0,1,2].map(()=>new Promise((resolve,reject)=>{const c=cp.spawn(process.execPath,['-e',code,require.resolve('./wslLiveResource.fixture.cjs'),dir],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});let stderr='';c.stderr.on('data',v=>stderr+=v);c.on('message',v=>{if(v.phase==='entered')entered++;else left++});c.once('error',reject);c.once('exit',n=>n?reject(Error(stderr)):resolve())})))
 assert.equal(entered,3);assert.equal(left,3);assert.equal(fs.existsSync(path.join(dir,'active')),false)
})
test('a held or changed fixture lock refuses rather than removing it or weakening native WSL tests',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsl-test-resource-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const release=acquire({dir,timeoutMs:10}),file=path.join(dir,'source-clone.lock')
 assert.throws(()=>acquire({dir,timeoutMs:10}),/wsl_test_resource_busy/);const before=fs.readFileSync(file,'utf8');assert.ok(before.includes(String(process.pid)))
 fs.writeFileSync(file,'changed owner');release();assert.equal(fs.readFileSync(file,'utf8'),'changed owner')
})

test('different artifact roots still serialize the same fixed distro across test runs',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsl-cross-run-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const code="const release=require(process.argv[1]).acquire();const fs=require('node:fs'),mark=require('node:path').join(process.argv[2],'active');fs.closeSync(fs.openSync(mark,'wx'));process.send('entered');setTimeout(()=>{fs.unlinkSync(mark);release();process.disconnect()},300)"
 let entered=0
 const child=()=>new Promise((resolve,reject)=>{
  const c=cp.spawn(process.execPath,['-e',code,require.resolve('./wslLiveResource.fixture.cjs'),dir],{env:{...process.env,AROMA_ARTIFACT_DIR:path.join(dir,'artifacts-'+crypto.randomUUID())},windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});let err=''
  c.stderr.on('data',v=>err+=v);c.on('message',()=>{entered++});c.once('error',reject);c.once('exit',n=>n?reject(Error(err)):resolve())
 })
 const results=await Promise.allSettled([child(),child()]);for(const r of results)assert.equal(r.status,'fulfilled',r.reason?.message);assert.equal(entered,2);assert.equal(fs.existsSync(path.join(dir,'active')),false)
})
