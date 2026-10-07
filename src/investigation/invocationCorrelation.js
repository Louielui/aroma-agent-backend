'use strict'
// Identity joins only. Never infer a scheduler, email, payment, or cause from
// adjacent times, similar names, a configured model or overlapping occupancy.
function correlateInvocations(sections){
 const rows=sections.filter(s=>s.section==='execution'&&['ok','partial'].includes(s.state)).flatMap(s=>(s.records||[]).filter(r=>r.evidenceBasis==='owner_bridge_invocation_ledger'))
 const unique=new Map(),ambiguous=new Set()
 for(const r of rows){if(unique.has(r.invocationId))ambiguous.add(r.invocationId);else unique.set(r.invocationId,r)}
 const groups=new Map();let unlinkedCalls=0
 for(const [id,r]of unique){if(ambiguous.has(id))continue;if(!r.requestId){unlinkedCalls++;continue}
  if(!groups.has(r.requestId))groups.set(r.requestId,{requestId:r.requestId,invocationIds:[],phases:[],basis:'exact_host_request_identity',completeRequestCoverage:false})
  const group=groups.get(r.requestId);group.invocationIds.push(id);group.phases.push({phase:r.phase,state:r.state,durationMs:r.durationMs??null})
 }
 return {requestGroups:[...groups.values()],unlinkedCalls,ambiguousCalls:ambiguous.size,billingConfirmed:false,scope:'bounded_bridge_sample_no_account_totals_or_schedule_email_attribution'}
}
module.exports={correlateInvocations}
