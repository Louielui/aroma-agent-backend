'use strict'
const { createAromaSystemReadAdapter, KEY_ENV, DEFAULT_BASE_URL, PATHS, SERVER_LIMITS, QUERY_SCOPE } = require('./adapters/aromaSystemRead')
const { readAccessEnabled } = require('./flags')
const { makeContextResult } = require('./contextResult')
const RESOURCES = Object.freeze({
  'aroma.order_planning': { endpoint:'orderPlanning', suffix:'OrderPlanning', title:'Order planning' },
  'aroma.invoices': { endpoint:'invoices', suffix:'Invoices', title:'Invoice records' }
})
function validateAromaRequest (resource, operation, input) {
  if (!Object.hasOwn(RESOURCES,resource) || !['list','search','get','readMetadata'].includes(operation) || !input || typeof input!=='object' || Array.isArray(input)) throw Error('invalid_request')
  const keys=operation==='search'?['query']:operation==='get'?['sourceId']:[]
  if(Object.keys(input).some(k=>!keys.includes(k)))throw Error('invalid_request')
  if(operation==='search'){
    if(typeof input.query!=='string'||!input.query.trim()||input.query.length>80||/[\x00-\x1f\x7f]/.test(input.query))throw Error('invalid_request')
    return {query:input.query.trim()}
  }
  if(operation==='get'&&(typeof input.sourceId!=='string'||!input.sourceId||input.sourceId.length>200||/[\x00-\x1f\x7f]/.test(input.sourceId)))throw Error('invalid_request')
  return {...input}
}
function aromaResources () {
  return Object.entries(RESOURCES).map(([id,s])=>({id,source:'aroma_system',scope:PATHS[s.endpoint],sensitivity:'private',layer:'truth',
    operations:Object.fromEntries(['list','search','get','readMetadata'].map(op=>[op,{method:(op==='readMetadata'?'read':op)+s.suffix+'Context'+(op==='readMetadata'?'Metadata':''),params:input=>validateAromaRequest(id,op,input)}]))}))
}
function createAromaContextAccess (env) {
  const credential=env[KEY_ENV], configuredUrl=env.AROMA_SYSTEM_URL
  return ()=>{
    if(!readAccessEnabled(env,'aroma_system')||typeof credential!=='string'||!credential.trim())throw Error('source_access_disabled')
    if(env[KEY_ENV]!==credential||env.AROMA_SYSTEM_URL!==configuredUrl)throw Error('source_access_changed')
    if(configuredUrl&&configuredUrl.replace(/\/+$/,'')!==DEFAULT_BASE_URL)throw Error('source_configuration_invalid')
  }
}
// Only declared scalar business fields enter context; credentials remain in the existing adapter.
const FIELDS=Object.freeze(['id','ingredient_id','ingredientId','ingredient_name','ingredientName','name','invoiceNumber','invoice_number','rawVendorName','supplierName','supplier_name',
  'live_qty','par_level','suggested_order_qty','unit','status','total','currency','invoiceDate','invoice_date','createdAt','created_at','updatedAt','updated_at'])
function createAromaContextAdapter ({env=process.env,fetchFn,clock=()=>new Date().toISOString(),verify=createAromaContextAccess(env)}={}) {
  const reader=createAromaSystemReadAdapter({env,baseUrl:DEFAULT_BASE_URL,fetchFn,clock,strictResponse:true,snapshotRowLimit:100})
  const methods={}
  for(const [id,s] of Object.entries(RESOURCES)){
    for(const op of ['list','search','get','readMetadata']){
      const method=(op==='readMetadata'?'read':op)+s.suffix+'Context'+(op==='readMetadata'?'Metadata':'')
      methods[method]=async input=>{
        const normalized=validateAromaRequest(id,op,input);verify()
        if(op==='readMetadata')return {results:[makeContextResult({source:'aroma_system',sourceId:PATHS[s.endpoint],title:s.title,originalDate:null,retrievedAt:clock(),content:'',link:null,
          fields:{endpoint:s.endpoint,path:PATHS[s.endpoint],serverLimit:SERVER_LIMITS[s.endpoint],scopeDeclaredBy:QUERY_SCOPE[s.endpoint].declaredBy,credentialScope:'adapter_enforced_get_only'}})],
          evidence:{completeWithinScope:null,truncated:null,queryScope:QUERY_SCOPE[s.endpoint],selection:'metadata'}}
        const result=await reader.readWithState(s.endpoint,{});verify()
        if(!result.evidence)return {results:result.results}
        let rows=result.results.map(row=>{
          const fields=Object.fromEntries(FIELDS.filter(k=>Object.hasOwn(row.fields||{},k)).map(k=>[k,row.fields[k]]))
          return {...row,fields,content:Object.entries(fields).map(([k,v])=>k+'='+v).join(' · ')}
        })
        if(op==='search'){const query=normalized.query.toLocaleLowerCase();rows=rows.filter(r=>((r.title||'')+' '+r.content).toLocaleLowerCase().includes(query))}
        if(op==='get')rows=rows.filter(r=>r.sourceId===normalized.sourceId)
        return {results:rows,evidence:{...result.evidence,selection:op==='list'?'bounded_snapshot':op==='search'?'bounded_snapshot_search':'bounded_snapshot_get',selectedRows:rows.length}}
      }
    }
  }
  return Object.freeze({source:'aroma_system',methods:Object.freeze(methods),rowLimits:Object.freeze(Object.fromEntries(Object.keys(methods).map(k=>[k,100])))})
}
module.exports={createAromaContextAdapter,createAromaContextAccess,aromaResources,validateAromaRequest}
