'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createWorkReader } = require('./workRecords')
test('Owner work metadata pins its approved root, strips worker bodies and records live workflow occupancy without dispatch', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'xx-work-metadata-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.mkdirSync(path.join(dir,'project-tasks'))
  const id = '22222222-2222-4222-8222-222222222222'
  fs.writeFileSync(path.join(dir,'project-tasks',id+'.json'), JSON.stringify({ state:'failed',reason:'worker_timeout',finishedAt:'2026-10-07T01:00:00Z',input:{goal:'Navigation'},generated:{testCode:'PRIVATE_SOURCE'},approvalHash:'PRIVATE_NONCE' }))
  const r = await createWorkReader({ workerRoot:dir,repoRoot:dir,activity:()=>[{role:'development',state:'occupied',model:'gpt-6.1-sol'}] }).read()
  assert.equal(r.latestFailureId,id); assert.equal(r.records[0].reason,'worker_timeout')
  assert.equal(r.workflows[0].state,'occupied')
  assert.equal(r.records[0].currentRunningState,'unknown')
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE|testCode|approvalHash/)
})
test('work metadata rejects a redirected root or nested record and cannot mistake failed reads for zero work', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'xx-work-redirect-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const real=path.join(dir,'real'),link=path.join(dir,'link');fs.mkdirSync(real);fs.mkdirSync(path.join(real,'project-runs'))
  fs.symlinkSync(real,link,'junction')
  const r=await createWorkReader({workerRoot:link,repoRoot:real}).read()
  assert.equal(r.state,'unavailable'); assert.equal(r.records.length,0)
  fs.mkdirSync(path.join(real,'outside'));fs.symlinkSync(path.join(real,'outside'),path.join(real,'project-tasks'),'junction')
  const nested=await createWorkReader({workerRoot:real,repoRoot:real}).read()
  assert.equal(nested.coverage.find(r=>r.kind==='worker/project-tasks').state,'unavailable')
})
