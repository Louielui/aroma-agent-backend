'use strict'
// Host receipt reduction only. Does not start a model, open a ledger or grade text.
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0
const median=values=>{const sorted=values.filter(finite).sort((a,b)=>a-b),n=sorted.length;return n?n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2:null}
function summarize(rows){
 if(!Array.isArray(rows)||rows.length>6)throw Error('acceptance_receipt_invalid')
 const seen=new Set(),scenarios=[];let totalCalls=0
 for(const row of rows){
  const key=row?.scenario+':'+row?.repeat
  if(!row||!['minimum_transfer','capability_offline'].includes(row.scenario)||![1,2,3].includes(row.repeat)||seen.has(key)||!Number.isInteger(row.modelCalls)||row.modelCalls<0||row.modelCalls>6||typeof row.correct!=='boolean'||![true,false,null].includes(row.loadedBefore)||!Array.isArray(row.trace)||!row.client)throw Error('acceptance_receipt_invalid')
  for(const v of Object.values(row.client))if(v!==null&&!finite(v))throw Error('acceptance_receipt_invalid')
  for(const e of row.trace)if(e.type==='model_complete'&&(!e.timing||Object.values(e.timing).some(v=>v!==null&&!finite(v))))throw Error('acceptance_receipt_invalid')
  seen.add(key);totalCalls+=row.modelCalls
 }
 for(const scenario of ['minimum_transfer','capability_offline']){
  const group=rows.filter(r=>r.scenario===scenario);if(!group.length)continue
  const metric=(subset,key)=>median(subset.map(r=>r.client[key])),modelFirst=group.flatMap(r=>r.trace.filter(e=>e.type==='model_complete').map(e=>e.timing.firstTokenMs))
  const warm=group.filter(r=>r.loadedBefore===true),cold=group.filter(r=>r.loadedBefore===false),unknown=group.filter(r=>r.loadedBefore===null)
  // Every row remains visible; a failed/incomplete group cannot be called accepted.
  scenarios.push({scenario,completed:group.length,completeThree:group.length===3,allCorrect:group.length===3&&group.every(r=>r.correct),answerPaintOpportunityMedianMs:metric(group,'answerPaintOpportunityMs'),streamCompleteMedianMs:metric(group,'streamCompleteMs'),modelFirstTokenMedianMs:median(modelFirst),warm:warm.map(r=>r.repeat),cold:cold.map(r=>r.repeat),unknownLoad:unknown.map(r=>r.repeat),warmAnswerMedianMs:metric(warm,'answerPaintOpportunityMs'),coldAnswerMedianMs:metric(cold,'answerPaintOpportunityMs')})
 }
 return{totalCalls,scenarios,semantics:'Model first token is per model invocation. Client answer timing is a visible DOM paint opportunity, never a phase label or optical measurement. No absent timing is zero.'}
}
module.exports={summarize,median}
