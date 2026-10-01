'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createReadConnector } = require('./readConnector')
const { createToolGateway } = require('./toolGateway')
let api = {}; try { api = require('./aromaContext') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
const at = '2026-10-01T21:00:00.000Z', actor = { role: 'owner' }
function fixture (body, status = 200) {
  const calls = [], events = [], env = { READ_ACCESS:'on', CONTEXT_AROMA_SYSTEM:'on', AROMA_SYSTEM_KEY:'fixture-secret' }
  const adapter = api.createAromaContextAdapter({ env, clock:()=>at, fetchFn:async(url,init)=>{ calls.push({url,init}); return {ok:status===200,status,json:async()=>body} } })
  const connector = createReadConnector({env,clock:()=>at}); connector.register(adapter)
  const gateway = createToolGateway({connector,resources:api.aromaResources(),audit:{append:e=>events.push(e)},clock:()=>at})
  return {env,adapter,gateway,calls,events}
}
test('Aroma context exposes only fixed reads, proves source provenance and preserves unknown dates and cap ambiguity',async()=>{
  const f=fixture({data:Array.from({length:100},(_,i)=>({ingredient_id:i+1,ingredient_name:'Item '+i,suggested_order_qty:i})),count:100})
  const p=await f.gateway.list(actor,'aroma.order_planning',{})
  assert.equal(p.state,'ok');assert.equal(p.count,100);assert.equal(p.layer,'truth');assert.equal(p.sensitivity,'private')
  assert.equal(p.content[0].fields.suggested_order_qty,99);assert.equal(p.content[0].originalDate,null)
  assert.equal(p.coverage.truncated,null);assert.equal(p.coverage.complete,null)
  assert.equal(p.coverage.serverTruncated,null);assert.equal(p.coverage.dataAsOf,null)
  assert.equal(p.coverage.queryScope.declaredBy,'reader');assert.equal(p.coverage.returnedRows,100)
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'GET');assert.equal(new URL(f.calls[0].url).pathname,'/api/v1/ai/order-planning')
  assert.doesNotMatch(JSON.stringify(p),/fixture-secret/);assert.doesNotMatch(JSON.stringify(f.events),/Item|ingredient_name|fixture-secret/)
  assert.equal(f.adapter.methods.send,undefined);assert.equal(f.gateway.write,undefined)
})
test('Aroma get and search are explicit bounded-snapshot selections, not unsupported provider filters',async()=>{
  const f=fixture({data:[{id:1,name:'Rice',suggested_order_qty:3},{id:2,name:'Flour',suggested_order_qty:2}],count:2})
  const p=await f.gateway.search(actor,'aroma.order_planning',{query:'Rice'})
  assert.equal(p.count,1);assert.equal(p.content[0].title,'Rice');assert.equal(p.coverage.selection,'bounded_snapshot_search')
  const item=await f.gateway.get(actor,'aroma.order_planning',{sourceId:'2'})
  assert.equal(item.content[0].sourceId,'2');assert.equal(item.count,1)
  assert.ok(f.calls.every(c=>!new URL(c.url).search))
  for(const [op,input] of [['list',{url:'https://evil.test'}],['get',{sourceId:['1']}],['search',{query:'',status:'pending'}]]) await assert.rejects(f.gateway[op](actor,'aroma.order_planning',input),/invalid_request/)
  const meta=await f.gateway.readMetadata(actor,'aroma.invoices',{})
  assert.equal(meta.content[0].fields.endpoint,'invoices');assert.equal(f.calls.length,2)
})
test('provider failure, malformed success and revoked reads never turn into empty business truth',async()=>{
  for(const [body,status] of [[{error:'private response'},200],[{data:[null]},200],[{data:[]},401]]){
    const f=fixture(body,status),p=await f.gateway.list(actor,'aroma.invoices',{})
    assert.equal(p.state,'unavailable');assert.equal(p.count,null);assert.equal(p.content,null)
  }
  const f=fixture({data:[]});assert.equal((await f.gateway.list(actor,'aroma.invoices',{})).count,0)
  await assert.rejects(f.gateway.list({role:'member'},'aroma.invoices',{}),/permission_denied/)
  f.env.CONTEXT_AROMA_SYSTEM='off';assert.equal((await f.gateway.list(actor,'aroma.invoices',{})).state,'unavailable');assert.equal(f.calls.length,1)
})
test('a credential change while the provider is reading suppresses the private result',async()=>{
  const env={READ_ACCESS:'on',CONTEXT_AROMA_SYSTEM:'on',AROMA_SYSTEM_KEY:'old-fixture'}
  const adapter=api.createAromaContextAdapter({env,fetchFn:async()=>{env.AROMA_SYSTEM_KEY='new-fixture';return {ok:true,json:async()=>({data:[{id:1,total:20}]})}}})
  await assert.rejects(adapter.methods.listInvoicesContext({}),/source_access_changed/)
})
