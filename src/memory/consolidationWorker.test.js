'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createWorker } = require('./consolidationWorker')
test('automatic consolidation is bounded, pausable, restart-aware and independent of receipt indexing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'consolidation-worker-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  let now = Date.parse('2026-09-29T00:00:00Z'), calls = 0, allowed = true
  const row = { id:'source', status:'active', type:'episodic', scope:'private:owner', text:'Use green folders.', source:{attribution:'owner_statement'}, createdAt:'2026-09-29T00:00:00Z', details:{} }
  const gateway = { list: async()=>[row], consolidate:async()=>{ calls++; row.details.consolidation={state:'empty',checkedAt:new Date(now).toISOString()}; return row.details.consolidation } }
  const worker = createWorker({gateway,dir,allowed:()=>allowed,clock:()=>now})
  worker.configure(false); await worker.tick(); assert.equal(calls,0)
  worker.configure(true); allowed=false; await worker.tick(); assert.equal(calls,0)
  allowed=true; await worker.tick(); assert.equal(calls,1)
  const resumed=createWorker({gateway,dir,allowed:()=>true,clock:()=>now}); await resumed.tick();assert.equal(calls,1)
  row.details.consolidation={state:'failed',attempts:3,checkedAt:new Date(now).toISOString(),nextRetryAt:null};now+=400000
  await resumed.tick();assert.equal(calls,1)
})

test('review capacity, retry dates and interrupted jobs bound automatic model calls', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'consolidation-cap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  let now=Date.parse('2026-09-29T00:10:00Z'),calls=0
  const row={id:'source',status:'active',type:'episodic',scope:'private:owner',text:'Use green folders.',source:{attribution:'owner_statement'},createdAt:'2026-09-29T00:00:00Z',details:{}}
  let rows=[row,...Array.from({length:20},()=>({status:'candidate',source:{kind:'consolidation'},details:{}}))]
  const worker=createWorker({dir,allowed:()=>true,clock:()=>now,gateway:{list:async()=>rows,consolidate:async()=>{calls++}}})
  await worker.tick();assert.equal(calls,0)
  rows=[row];row.details.consolidation={state:'failed',attempts:1,checkedAt:new Date(now-120000).toISOString(),nextRetryAt:new Date(now+60000).toISOString()}
  await worker.tick();assert.equal(calls,0)
  now+=60000;await worker.tick();assert.equal(calls,1)
  row.details.consolidation={state:'running',checkedAt:new Date(now-120000).toISOString()}
  await worker.tick();assert.equal(calls,1)
  now+=61000;await worker.tick();assert.equal(calls,2)
})
