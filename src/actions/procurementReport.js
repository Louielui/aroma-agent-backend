'use strict'
const scalar=x=>typeof x==='string'&&x.trim()&&x.length<=300&&!/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(x)?x.trim():null
const id=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0?String(x):typeof x==='string'&&/^[1-9][0-9]{0,14}$/.test(x)?x:null
const decimal=x=>typeof x==='number'&&Number.isFinite(x)&&x>0?x:typeof x==='string'&&/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(x)&&Number(x)>0?x:null
function build(planning,suppliers,now){
 const issues=[],unresolved=[],groups=new Map(),sourceEvidence=[]
 function check(p){const c=p?.coverage||{},timestamp=Date.parse(c.dataAsOf);sourceEvidence.push({resource:p?.resource||null,state:p?.state||'unavailable',coverage:c});if(p?.state!=='ok'||!Array.isArray(p.content)){issues.push('source_unavailable');return false}if((Number.isInteger(c.sourceTotal)&&c.sourceTotal!==p.content.length)||(Number.isInteger(c.returnedRows)&&c.returnedRows!==p.content.length)||c.complete!==true||c.truncated!==false||c.serverTruncated===true||(p.resource==='aroma.order_planning'&&c.serverTruncated!==false)||c.paginationUnsupported===true)issues.push('source_coverage_unverified');if(!Number.isFinite(timestamp)||Date.parse(now)-timestamp>86400000||timestamp>Date.parse(now)+300000)issues.push('source_time_missing_or_stale');return true}
 const good=check(planning),suppliersGood=check(suppliers),lookup=new Map(),ambiguous=new Set();if(suppliersGood)for(const row of suppliers.content){const f=row.fields||{},key=id(f.id),name=scalar(f.name||row.title);if(!key||!name||lookup.has(key)||ambiguous.has(key)){issues.push('supplier_identity_invalid');if(key){lookup.delete(key);ambiguous.add(key)}continue}lookup.set(key,name)}
 const seen=new Set();if(good)for(const row of planning.content){const f=row.fields||{},ingredientId=id(f.ingredient_id||f.ingredientId||f.id),supplierId=id(f.supplier_id||f.supplierId),name=scalar(f.ingredient_name||f.ingredientName||row.title),unit=scalar(f.unit),quantity=decimal(f.suggested_order_qty)
  const item={sourceId:scalar(row.sourceId),ingredientId,name,quantity,unit,supplierId}
  if(!ingredientId||!name||!unit||quantity===null||!supplierId||!lookup.has(supplierId)||seen.has(ingredientId)){unresolved.push({...item,reason:seen.has(ingredientId)?'duplicate_ingredient':'missing_or_invalid_fields'});continue}seen.add(ingredientId)
  if(!groups.has(supplierId))groups.set(supplierId,{supplierId,supplier:lookup.get(supplierId),items:[]});groups.get(supplierId).items.push(item)
 }
 if(unresolved.length)issues.push('unresolved_items')
 return{version:1,scope:'registered_replenishment_query',completeness:!good?'FAILED':issues.length?'PARTIAL':'COMPLETE',groups:[...groups.values()].sort((a,b)=>a.supplierId.localeCompare(b.supplierId)),unresolved,issues:[...new Set(issues)],sourceEvidence,retrievedAt:now,totalRetrieved:good?planning.content.length:null,resolvedItems:[...groups.values()].reduce((n,g)=>n+g.items.length,0),supplierCount:lookup.size,delivery:'in_app_only'}
}
module.exports={build}
