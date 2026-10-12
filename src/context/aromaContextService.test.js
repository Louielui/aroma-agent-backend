'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
let api={};try{api=require('./aromaContextService')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
test('Aroma chat matches complete read requests and excludes negations, quotes and write requests',()=>{
  assert.deepEqual(api.aromaIntent('目前有哪些補貨建議？'),{resource:'aroma.order_planning',operation:'list',input:{}})
  assert.deepEqual(api.aromaIntent('香香，查看發票紀錄'),{resource:'aroma.invoices',operation:'list',input:{}})
  for(const text of ['不要查看發票紀錄','「目前有哪些補貨建議？」','目前有哪些補貨建議？並寄給 Ivy','查看發票紀錄並修改','看看 Aroma System 現在開發到哪'])assert.equal(api.aromaIntent(text),null)
})
test('source access changes after the Gateway audit cannot return private content',async()=>{
  let ok=true,calls=0
  const service=api.createAromaContextService({verify:()=>{if(!ok)throw Error('source_access_changed')},gateway:{list:async()=>{calls++;ok=false;return {state:'ok',content:['private']}}}})
  await assert.rejects(service.read({role:'member'},'aroma.invoices','list',{}),/permission_denied/);assert.equal(calls,0)
  await assert.rejects(service.read({role:'owner'},'aroma.invoices','list',{}),/source_access_changed/);assert.equal(calls,1)
})
