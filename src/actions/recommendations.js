'use strict'
// Only host-produced exact Windows receipts count. Neither model text, task names,
// declared execution IDs nor a shared model establish redundant scheduling.
const {TARGETS,HASH,hash}=require('./contract')
function assess(inspection,now=Date.now()){
 const rows=(inspection?.observations||[]).map(o=>{
  const s=o.snapshot,t=TARGETS.find(t=>t.id===o.target?.id)
  const age=now-Date.parse(s?.at)
  const known=o.state==='CONFIRMED'&&t&&s?.targetId===t.id&&s.taskPath===t.taskPath&&s.taskName===t.taskName&&age>=-5000&&age<=30000&&HASH.test(s.definitionHash||'')&&
   s.scheduleEvidence?.basis==='windows_task_xml_exact_calendar_v1'&&HASH.test(s.scheduleEvidence.actionHash||'')&&Array.isArray(s.scheduleEvidence.triggers)&&s.scheduleEvidence.triggers.length<=32&&s.scheduleEvidence.triggers.every(h=>HASH.test(h))&&typeof s.enabled==='boolean'
  return {targetId:t?.id||null,state:known?'CONFIRMED':'UNAVAILABLE',snapshot:known?s:null}
 })
 const unique=rows.length===TARGETS.length&&TARGETS.every(t=>rows.filter(r=>r.targetId===t.id).length===1)
 const recommendations=[],candidates=[]
 if(unique){for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j]
  if(a.state!=='CONFIRMED'||b.state!=='CONFIRMED')continue
  const x=a.snapshot,y=b.snapshot
  if(!x.enabled||!y.enabled||x.scheduleEvidence.actionHash!==y.scheduleEvidence.actionHash)continue
  const overlaps=x.scheduleEvidence.triggers.filter(h=>y.scheduleEvidence.triggers.includes(h))
  if(!overlaps.length){candidates.push({targets:[a.targetId,b.targetId],state:'CANDIDATE',reason:'same_action_different_triggers'});continue}
  // Stable catalogue order keeps the first fully covering task. No name/prose preference.
  const removable=y.scheduleEvidence.triggers.every(h=>x.scheduleEvidence.triggers.includes(h))?b:x.scheduleEvidence.triggers.every(h=>y.scheduleEvidence.triggers.includes(h))?a:null
  const survivor=removable===b?a:b
  const refs=[a,b].map(r=>({targetId:r.targetId,definitionHash:r.snapshot.definitionHash,enabled:r.snapshot.enabled,at:r.snapshot.at,actionHash:r.snapshot.scheduleEvidence.actionHash,triggers:r.snapshot.scheduleEvidence.triggers}))
  candidates.push({targets:[a.targetId,b.targetId],state:'CONFIRMED',reason:'identical_calendar_trigger_overlap',executionState:'UNKNOWN',references:refs})
  if(removable&&[x,y].every(s=>s.runtime==='Ready'))recommendations.push({targetId:removable.targetId,taskName:removable.snapshot.taskName,survivorId:survivor.targetId,survivorTaskName:survivor.snapshot.taskName,capability:'scheduler.pause',configurationState:'CONFIRMED',executionState:'UNKNOWN',billingState:'UNKNOWN',reason:'all_target_triggers_covered',references:refs,evidenceHash:hash(refs.map(({at,...r})=>r))})
 }}
 return {version:1,inspectionId:inspection.id,at:new Date(now).toISOString(),scope:'registered_exact_windows_tasks_only',inventoryComplete:false,executionState:'UNKNOWN',billingState:'UNKNOWN',sourceState:unique&&rows.every(r=>r.state==='CONFIRMED')?'CONFIRMED':'UNAVAILABLE',observations:rows.map(r=>({targetId:r.targetId,state:r.state,enabled:r.snapshot?.enabled??null,runtime:r.snapshot?.runtime||'Unknown'})),candidates,recommendations:recommendations.slice(0,1)}
}
module.exports={assess}
