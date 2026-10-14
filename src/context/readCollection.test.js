'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
test('shared read collection follows opaque cursors and records every page before proving exhaustion',async()=>{
 const {collectReadPages}=require('./readCollection'),seen=[]
 const r=await collectReadPages({maxPages:3,maxRows:10,pageSize:2,verify:()=>{},key:r=>r.id,readPage:async({cursor,limit})=>{seen.push({cursor,limit});return cursor?{rows:[{id:3}],next:null}:{rows:[{id:1},{id:2}],next:'opaque'}}})
 assert.deepEqual(r.rows.map(r=>r.id),[1,2,3]);assert.equal(r.complete,true);assert.equal(r.pages,2);assert.equal(r.reason,null);assert.deepEqual(seen,[{cursor:null,limit:2},{cursor:'opaque',limit:2}])
})
test('shared read collection reports budget coverage and refuses loops duplicates and revoked reads',async()=>{
 const {collectReadPages}=require('./readCollection'),base={maxPages:2,maxRows:5,pageSize:2,verify:()=>{},key:r=>r.id}
 let n=0;const capped=await collectReadPages({...base,maxPages:1,readPage:async()=>({rows:[{id:++n}],next:'more'})});assert.equal(capped.complete,false);assert.equal(capped.reason,'page_limit');assert.equal(capped.rows.length,1)
 const rowCap=await collectReadPages({...base,maxRows:1,readPage:async()=>({rows:[{id:1}],next:'more'})});assert.equal(rowCap.reason,'row_limit');assert.equal(rowCap.complete,false)
 await assert.rejects(collectReadPages({...base,readPage:async()=>({rows:[{id:++n}],next:'loop'})}),/invalid_source_response/)
 await assert.rejects(collectReadPages({...base,readPage:async()=>({rows:[{id:1}],next:'next'})}),/invalid_source_response/)
 let reads=0;await assert.rejects(collectReadPages({...base,verify:()=>{throw Error('source_access_changed')},readPage:async()=>{reads++}}),/source_access_changed/);assert.equal(reads,0)
})
test('shared numeric selection preserves unknown values and reports source coverage independently of matches',()=>{
 const {selectNumericRows}=require('./numericSelection'),rows=[{id:1,v:[1750]},{id:2,v:[2000,2500]},{id:3,v:[]},{id:4,v:[null]},{id:5,v:[0]}]
 const r=selectNumericRows(rows,{operator:'gt',value:2000},r=>r.v,false)
 assert.deepEqual(r.matches.map(r=>r.id),[2]);assert.deepEqual(r.unresolved.map(r=>r.id),[3,4]);assert.deepEqual(r.excluded.map(r=>r.id),[1,5]);assert.equal(r.complete,false);assert.equal(r.scannedCount,5)
 const other=selectNumericRows([{temperature:[17,23]},{temperature:[12]}],{operator:'gte',value:23},r=>r.temperature,true);assert.equal(other.matches.length,1);assert.equal(other.complete,true)
})
test('shared numeric selection retains unresolved mixed rows and never converts null into zero',()=>{
 const {selectNumericRows}=require('./numericSelection'),rows=[{v:[1900,null]},{v:[2100,null]},{v:[null]},{v:[0]}]
 const r=selectNumericRows(rows,{operator:'gt',value:2000},r=>r.v,true);assert.equal(r.matches.length,1);assert.equal(r.unresolved.length,2);assert.equal(r.excluded.length,1);assert.equal(r.complete,false)
 assert.equal(selectNumericRows(rows,{operator:'eq',value:0},r=>r.v,true).matches.length,1)
 assert.throws(()=>selectNumericRows(rows,{operator:'execute',value:0},r=>r.v,true),/invalid_read_query/)
})
