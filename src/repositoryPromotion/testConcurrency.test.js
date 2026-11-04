'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {runTests}=require('./checks')
test('the real isolated runner executes every fixture with bounded file concurrency',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'promotion-concurrency-'))
 t.after(()=>{assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true})})
 const root=path.join(temp,'repo'),directory=path.join(temp,'receipt');fs.mkdirSync(root)
 for(let i=0;i<24;i++)fs.writeFileSync(path.join(root,'entry-'+i+'.test.cjs'),`const test=require('node:test'),fs=require('node:fs'),path=require('node:path');test('fixture ${i}',async()=>{const active=path.join(__dirname,'active-${i}');fs.writeFileSync(active,'');const count=fs.readdirSync(__dirname).filter(f=>f.startsWith('active-')).length;fs.writeFileSync(path.join(__dirname,'observed-${i}'),String(count));await new Promise(r=>setTimeout(r,750));fs.unlinkSync(active)})`)
 const receipt=await runTests({root,dependencies:process.env.NODE_PATH||'',directory})
 assert.equal(receipt.exitCode,0);assert.equal(receipt.total,24);assert.equal(receipt.passed,24);assert.equal(receipt.failed,0);assert.equal(receipt.skipped,0);assert.equal(receipt.cancelled,0)
 const observed=fs.readdirSync(root).filter(f=>f.startsWith('observed-')).map(f=>Number(fs.readFileSync(path.join(root,f),'utf8')))
 assert.equal(observed.length,24);assert.ok(receipt.fileConcurrency>=1&&receipt.fileConcurrency<=8);assert.ok(Math.max(...observed)<=receipt.fileConcurrency,'observed concurrent fixture count: '+Math.max(...observed))
 t.diagnostic('Observed peak active fixtures: '+Math.max(...observed))
})
