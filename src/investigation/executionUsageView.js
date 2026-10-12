'use strict'
const {t}=require('../i18n/t')
const inline=v=>'`'+String(v).replace(/[^a-zA-Z0-9_.:\/-]/g,'').slice(0,160)+'`'
function renderExecutionUsage(report,{message=''}={}){
 if(report?.readOnly!==true||report.focus!=='cost'||!report.executionUsage)return null
 const e=report.executionUsage,locale=/[\u3400-\u9fff]/.test(message)?'zh':'en',lines=[],references=[],chosen=[]
 const subscription=require('./subscriptionEvidenceView').renderSubscriptionEvidence(e.subscriptionEvidence,locale)
 if(subscription){lines.push(subscription.text);references.push(...subscription.references)}
 const unknown=t('investigation.briefNotRecorded',{},locale)
 const counterWords={input:()=>t('investigation.usageCounter.input',{},locale),output:()=>t('investigation.usageCounter.output',{},locale),total:()=>t('investigation.usageCounter.total',{},locale),cacheRead:()=>t('investigation.usageCounter.cacheRead',{},locale),cacheCreate:()=>t('investigation.usageCounter.cacheCreate',{},locale),reasoning:()=>t('investigation.usageCounter.reasoning',{},locale)}
 const sourceWords={bridge_invocations:()=>t('investigation.usageSource.bridgeInvocations',{},locale),codex_sessions:()=>t('investigation.usageSource.codexSessions',{},locale),worker_records:()=>t('investigation.usageSource.workerRecords',{},locale),scheduler_definitions:()=>t('investigation.usageSource.schedulerDefinitions',{},locale)}
 for(const kind of ['worker_work','background_work','host_request','bridge_lane','codex_session','worker_record']){const c=e.chains.find(x=>x.kind===kind);if(c&&chosen.length<4)chosen.push(c)}
 for(const c of e.chains)if(!chosen.includes(c)&&chosen.length<4)chosen.push(c)
 const counterNames={inputTokens:'input',input_tokens:'input',outputTokens:'output',output_tokens:'output',totalTokens:'total',total_tokens:'total',cacheReadInputTokens:'cacheRead',cachedInputTokens:'cacheRead',cached_input_tokens:'cacheRead',cacheCreationInputTokens:'cacheCreate',cache_write_input_tokens:'cacheCreate',reasoningOutputTokens:'reasoning',reasoning_output_tokens:'reasoning'}
 const counters=(v,m)=>v?Object.entries(v).map(([k,n])=>(counterWords[counterNames[k]]?.()||unknown)+': '+(n===null?unknown:n)+(m&&m.counterCoverage[k]<m.receiptCount?' ('+m.counterCoverage[k]+'/'+m.receiptCount+')':'')).join(', '):unknown
 for(const c of chosen){
  references.push(...c.references)
  const identity=c.jobId?inline(c.jobId):t('investigation.executionUsageUnlinked',{},locale)
  if(c.kind==='codex_session')lines.push('- '+t('investigation.executionUsageSession',{id:identity,started:c.observedStartedTurns??unknown,completed:c.observedCompletedTurns??unknown,usage:counters(c.cumulativeUsage),at:c.usageAt?inline(c.usageAt):unknown},locale))
  else if(c.kind==='worker_record')lines.push('- '+t('investigation.executionUsageWorker',{id:identity,state:c.executionState==='CONTRADICTED'?t('investigation.executionUsageRecordConflict',{},locale):c.recordedState?inline(c.recordedState):unknown},locale))
  else {
   if(c.kind==='worker_work')lines.push(t('investigation.executionUsageWorkerRun',{id:c.recordId?inline(c.recordId):unknown,runs:c.observedRuns,retries:c.observedRetryRuns,state:c.canonicalEvidenceState==='CONTRADICTED'?t('investigation.executionUsageRecordConflict',{},locale):c.canonicalRecordState?inline(c.canonicalRecordState):unknown,phases:c.phases.map(p=>inline(p.phase)+': '+inline(p.state)).join('; ')},locale))
   if(c.kind==='background_work'){
    const names={mail_analysis:()=>t('investigation.workMailAnalysis',{},locale),mail_index:()=>t('investigation.workMailIndex',{},locale),memory_index:()=>t('investigation.workMemoryIndex',{},locale),memory_consolidation:()=>t('investigation.workMemoryConsolidation',{},locale)}
    const outcomes=c.runs.map(r=>inline(r.runId)+': '+(r.outcomeState==='CONTRADICTED'?t('investigation.executionUsageRecordConflict',{},locale):r.hostOutcome?inline(r.hostOutcome.state):unknown)).join('; ')
    lines.push(t('investigation.executionUsageWork',{kind:names[c.workKind]?.()||unknown,runs:c.observedRuns,retries:c.observedRetryRuns,record:c.recordId?inline(c.recordId):unknown,outcomes},locale))
   }
   lines.push('- '+t('investigation.executionUsageCalls',{id:identity,attempts:c.observedAttempts,dispatched:c.observedDispatches,results:c.successfulResults,unknown:c.unknownUsageCalls,start:c.startedAt?inline(c.startedAt):unknown,end:c.finishedAt?inline(c.finishedAt):unknown},locale))
   if(c.usageState==='CONTRADICTED')lines.push('  '+t('investigation.executionUsageConflict',{},locale))
   else for(const m of c.usageModels)lines.push('  '+t('investigation.executionUsageModel',{provider:inline(m.provider),model:inline(m.model),count:m.receiptCount,usage:counters(m.subtotal,m),scope:m.subtotal?t('investigation.executionUsageSubtotal',{},locale):t('investigation.executionUsageLastTurn',{},locale)},locale))
  }
 }
 if(!chosen.length&&!subscription)return null
 for(const x of e.inventory)references.push(...x.references)
 const inventory=e.inventory.map(x=>(sourceWords[x.source]?.()||unknown)+': '+(x.state==='UNAVAILABLE'?t('investigation.executionUsageUnavailable',{},locale):x.observedRecords===null?unknown:x.observedRecords)).join(locale==='zh'?'；':'; ')
 return {version:1,text:[t('investigation.executionUsageTitle',{},locale),inventory,lines.join('\n'),t('investigation.executionUsageBoundary',{shown:chosen.length,total:e.chains.length,duplicates:e.duplicateReceipts,conflicts:e.conflictingReceipts},locale)].join('\n\n'),references,scope:e.scope,modelProseUsed:false}
}
module.exports={renderExecutionUsage}
