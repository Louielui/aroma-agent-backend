'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createMemoryOperations } = require('./operations')
const ready = async () => ({ state:'ready', services:{bridge:{state:'ready'},database:{state:'ready'},hindsight:{state:'ready'}} })
test('component outage preserves queued receipts and unknown coverage instead of reporting empty memory', async () => {
  const ops = createMemoryOperations({ probe:async()=>({state:'unavailable',services:{bridge:{state:'unavailable',reason:'connection_failed'}}}),
    gateway:{status:async()=>{throw Error('secret-provider-detail')}}, runtime:{status:()=>({enabled:true,pending:5,error:'memory_background_unavailable'})},
    mailMemory:{status:async()=>{throw Error('secret-mail')}}, mailHistory:{status:async()=>{throw Error('secret-history')}} })
  const result = await ops.status()
  assert.equal(result.services.bridge.state,'unavailable')
  assert.equal(result.general.state,'unavailable'); assert.equal(result.general.counts,null)
  assert.equal(result.receipts.pending,5)
  assert.equal(result.mail.state,'unavailable'); assert.equal(result.history.state,'unavailable')
  assert.equal(JSON.stringify(result).includes('secret'),false)
})
test('measured coverage distinguishes semantic originals, pending review and source-only retained history', async () => {
  const coverage = {counts:{active:8,candidate:3},index:{saved:4,raw_only:3,source_only:1,pending:0,unconfirmed:0},layers:[],consolidation:{review:2}}
  const ops = createMemoryOperations({probe:ready,gateway:{status:async actor=>{assert.equal(actor.role,'owner');return coverage}},
    runtime:{status:()=>({enabled:true,pending:0}),consolidation:{status:()=>({enabled:true})}},
    mailMemory:{status:async()=>({state:'source_bound',initialWindow:'30_days',hasMore:false,analysis:{pending:2}})},
    mailHistory:{status:async()=>({state:'running',saved:17,excluded:1})}})
  const result = await ops.status()
  assert.deepEqual(result.general.index,coverage.index); assert.equal(result.general.counts.candidate,3)
  assert.equal(result.mail.initialWindow,'30_days'); assert.equal(result.history.saved,17)
  assert.equal(result.state,'ready'); assert.equal(result.receipts.pending,0)
})
test('disabled capture is reported independently of connected services', async () => {
  const ops=createMemoryOperations({probe:ready,gateway:{status:async()=>({counts:{},index:{}})},runtime:{status:()=>({enabled:false,pending:2})}})
  const result=await ops.status();assert.equal(result.receipts.enabled,false);assert.equal(result.mail.state,'not_connected')
  assert.equal(result.history.state,'not_started');assert.equal(result.backup.state,'not_measured')
})
