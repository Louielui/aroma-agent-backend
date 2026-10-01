'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createTestStore } = require('../memory/structuredStore')
const { createMailMemory } = require('./mailMemory')
function setup() {
  const store = createTestStore(); let revision = 0; let reads = 0
  const mailbox = { status:()=>({mailbox:'adm@example.test'}), lease:()=> { const start=revision;return()=>{ if(start!==revision)throw Error('mail_access_denied') } }, read:async()=>{} }
  const all = store.all
  store.mailRows = async (account,kinds=['admin_mail_message','admin_mail_thread']) => { reads++; assert.equal(account,'adm@example.test'); return (await all()).filter(r=>kinds.includes(r.source.kind)) }
  store.all = async()=>{ throw Error('unbounded_all_read') }
  const analyzer={analyze:async()=>({category:'notification',summary:'Invoice request',messageId:'abc',quote:'Please confirm invoice.',task:null,change:{kind:'none',messageId:'abc',quote:'Please confirm invoice.'}})}
  const memory = createMailMemory({store,mailbox,analyzer,clock:()=> '2026-10-01T00:00:00.000Z'})
  return {store,memory,mailbox,reads:()=>reads,revoke:()=>{revision++}}
}
async function capture(f) {
  return f.memory.capture({owner:true},{id:'abc',threadId:'abc',mailbox:'adm@example.test',subject:'Invoice',from:'Vendor',body:'Please confirm invoice.',date:'2026-09-29T12:00:00Z',internalDate:'1790683200000',bodyState:'available',bodyTruncated:false})
}
test('mail view loads one bounded snapshot for list, analysis and verified original index counts', async()=>{
  const f=setup(); await capture(f)
  const result=await f.memory.view({owner:true},'Invoice','all')
  assert.equal(f.reads(),1);assert.equal(result.items.length,1)
  assert.equal(result.sync.analysis.pending,1);assert.equal(result.sync.hindsight.total,1)
  assert.equal(result.sync.hindsight.pending,1)
})
test('mail view does not release its snapshot after source revocation', async()=>{
  const f=setup();await capture(f)
  const original=f.store.mailRows
  f.store.mailRows=async(...args)=>{const rows=await original(...args);f.revoke();return rows}
  await assert.rejects(f.memory.view({owner:true},'Invoice'),/mail_access_denied/)
})
test('invalid view requests do not read private sources', async()=>{
  const f=setup()
  for(const [query,filter] of [['x'.repeat(401),'all'],['Invoice','invalid']]) {
    await assert.rejects(f.memory.view({owner:true},query,filter),/invalid_query/)
  }
  assert.equal(f.reads(),0)
})
test('bounded thread selection and index worker never fall back to a full canonical scan', async()=>{
  const f=setup();await capture(f)
  const result=await f.memory.analyzeNext({owner:true},{background:true})
  assert.equal(result.state,'ready');assert.equal(f.reads(),1)
  assert.equal((await f.memory.indexNext({owner:true})).state,'not_connected');assert.equal(f.reads(),2)
})
