'use strict'
const {createAromaSystemReadAdapter,PATHS}=require('./adapters/aromaSystemRead'),{createAromaContextAccess}=require('./aromaContext')
const specs=Object.freeze({'aroma.order_planning':{endpoint:'orderPlanning',method:'listProcurementPlanningContext'},'aroma.suppliers':{endpoint:'suppliers',method:'listProcurementSuppliersContext'}})
const fields=Object.freeze(['id','ingredient_id','ingredientId','ingredient_name','ingredientName','name','supplier_id','supplierId','supplier_name','supplierName','suggested_order_qty','unit'])
function resources(){return Object.entries(specs).map(([id,s])=>({id,source:'aroma_system',scope:PATHS[s.endpoint],sensitivity:'private',layer:'truth',operations:{list:{method:s.method,params(input){if(!input||Object.keys(input).length)throw Error('invalid_request');return{}}}}}))}
function createAdapter({env,fetchFn,clock,verify=createAromaContextAccess(env)}){
 const planning=createAromaSystemReadAdapter({env,fetchFn,clock,strictResponse:true,snapshotRowLimit:100}),suppliers=createAromaSystemReadAdapter({env,fetchFn,clock,strictResponse:true}),methods={}
 for(const [resource,s]of Object.entries(specs))methods[s.method]=async input=>{
  if(!input||Array.isArray(input)||Object.keys(input).length)throw Error('invalid_request')
  verify();const value=await (resource==='aroma.suppliers'?suppliers:planning).readWithState(s.endpoint,{});verify()
  if(!value.evidence)return{results:value.results}
  const e=value.evidence,serverVerified=resource==='aroma.order_planning'&&e.serverTruncated===false&&e.returnedRows===value.results.length&&!e.paginationUnsupported
  // The generic interactive reader conservatively treats exactly 100 rows as unknown.
  // This fixed snapshot can use an explicit server false only when every returned row survived.
  return{results:value.results.map(r=>({...r,fields:Object.fromEntries(fields.filter(k=>Object.hasOwn(r.fields||{},k)).map(k=>[k,r.fields[k]])),content:''})),evidence:{...e,...(serverVerified?{truncated:false,completeWithinScope:true,truncationAuthority:'server'}:{}),selection:'registered_procurement_snapshot'}}
 }
 return{source:'aroma_system',methods,rowLimits:Object.fromEntries(Object.values(specs).map(s=>[s.method,null]))}
}
function createRuntime({env,store,controller,clock,fetchFn}){
 const connector=require('./readConnector').createReadConnector({env,clock});connector.register(createAdapter({env,clock,fetchFn}));const audit={append(e){const row={id:require('node:crypto').randomUUID(),workflow:'procurement_read_audit',timeline:[e]};store.save(row)}}
 return require('./toolGateway').createToolGateway({connector,resources:resources(),audit,clock,authorizeScheduled:(actor,resource,op)=>op==='list'&&controller().verifyActor(actor,resource)})
}
module.exports={createAdapter,resources,createRuntime}
