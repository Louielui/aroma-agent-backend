'use strict'
// The caller owns transport, projection, authority checks and budgets. Page data
// never supplies a URL, method, credential, budget or callback.
async function collectReadPages({readPage,key,verify,maxPages,maxRows,pageSize,seen=new Set(),onRow=()=>{}}){
 if(![readPage,key,verify,onRow].every(f=>typeof f==='function')||![maxPages,pageSize].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(maxRows)||maxRows<0||!(seen instanceof Set))throw Error('invalid_read_collection')
 const rows=[],cursors=new Set();let cursor=null,pages=0
 while(pages<maxPages&&rows.length<maxRows){
  verify();const limit=Math.min(pageSize,maxRows-rows.length),page=await readPage({cursor,limit});verify();pages++
  if(!page||!Array.isArray(page.rows)||page.rows.length>limit)throw Error('invalid_source_response')
  for(const row of page.rows){const id=key(row);if(!(typeof id==='string'&&id.length>0&&id.length<=200||Number.isSafeInteger(id)&&id>0)||seen.has(id))throw Error('invalid_source_response');seen.add(id);rows.push(row);onRow(row)}
  if(page.next===null)return {rows,pages,complete:true,reason:null}
  if(typeof page.next!=='string'||!page.next||page.next.length>2048||cursors.has(page.next))throw Error('invalid_source_response')
  cursors.add(page.next);cursor=page.next
 }
 return {rows,pages,complete:false,reason:rows.length>=maxRows?'row_limit':'page_limit'}
}
module.exports={collectReadPages}
