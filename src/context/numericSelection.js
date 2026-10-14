'use strict'
// Pure selection over host-projected values. Missing or incompatible units stay
// unresolved, including a record with known nonmatches and one missing value.
function selectNumericRows(rows,query,values,sourceComplete){
 if(!Array.isArray(rows)||typeof values!=='function'||!query||Object.keys(query).sort().join(',')!=='operator,value'||!['gt','gte','lt','lte','eq'].includes(query.operator)||!Number.isFinite(query.value))throw Error('invalid_read_query')
 const matches=[],excluded=[],unresolved=[]
 const compare=value=>({gt:()=>value>query.value,gte:()=>value>=query.value,lt:()=>value<query.value,lte:()=>value<=query.value,eq:()=>value===query.value})[query.operator]()
 for(const row of rows){const list=values(row);if(!Array.isArray(list))throw Error('invalid_read_values');const known=list.filter(v=>typeof v==='number'&&Number.isFinite(v));if(known.some(compare))matches.push(row);else if(!list.length||known.length!==list.length)unresolved.push(row);else excluded.push(row)}
 return {matches,excluded,unresolved,scannedCount:rows.length,complete:sourceComplete===true&&unresolved.length===0}
}
module.exports={selectNumericRows}
