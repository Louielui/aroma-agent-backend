'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { processIntake } = require('./intakeService')

async function turn (t, { allowed = true, question = '之前有什麼會導致不停扣 credit？', focus = null, failed = false, verdict = 'allow_final', judgment = null, semanticCallModel = undefined, workEvidence = false, unavailableFact = false, extraFacts = [], previousInvestigation = null, reference = null, history = [], investigationAnswer = undefined, semanticDecision = 'supported', evidenceSections = null, fastPath = false, taskType = 'diagnose', sources = ['xiangxiang_operations'], externalUnavailable = false, externalEmpty = false, requestedCapability = null, primaryOperation = 'xiangxiang_operations', investigationEvidence = [], captureLocalParams = false } = {}) {
  const old = { ...process.env }
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]; Object.assign(process.env, old) })
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', GOAL_DECOMPOSER: 'on', READ_ACCESS: 'on', CONTEXT_XIANGXIANG_OPERATIONS: 'on', XIANGXIANG_MEMORY: 'on', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'on', MULTI_AI_ROUTER: 'off', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off' })
  if(sources.includes('github'))process.env.GITHUB_READ_REPO='fixture/project'
  const events = [], calls = [], reads = []
  const a = { providerName: 'claude', preflight: async () => {}, complete: async (p, options = {}) => {
    calls.push({ p, schema: options.responseFormat?.name, format: options.responseFormat })
    if (options.responseFormat?.name === 'investigation_semantic_review') return {billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify({reviews:[{id:'c1',decision:semanticDecision,reason:'matches_reference'}]})}
    if (options.responseFormat?.name === 'goal_plan') return { billing:'claude-subscription', model:'claude-opus-5-5', text:JSON.stringify({question_restated:question,executive_frame:fastPath?{taskType,decisionNeeded:true,successDefinition:'Explain the observed record and remaining uncertainty.',answerPosture:'evidence_first'}:undefined,requested_capability:requestedCapability,investigation_focus:focus,investigation_evidence:investigationEvidence,investigation_reference:reference,facts:[{id:'f1',need:'Investigate own previous usage and work',operation:primaryOperation,entity:null,fields:[],necessity:'required'},...(unavailableFact?[{id:'f2',need:'Runtime regression for the same failure',operation:null,entity:null,fields:[],necessity:'required'}]:[]),...extraFacts],joins:[]}) }
    return { billing: 'claude-subscription', model: 'claude-opus-5-5', text: JSON.stringify({ mode: 'chat', intent: 'question', reply: '已找到排程設定，但實際扣款原因未確認。', nextRead: null, answerPlan: null, executiveJudgment: judgment, investigationAnswer }) }
  } }
  let recall = 0
  const fixtureRead = async (source, method, params) => {
    reads.push((source === 'gmail' || captureLocalParams) ? { source, method, params } : { source, method })
    if (source !== 'xiangxiang_operations' && externalEmpty) return { results: [] }
    if (source === 'github' || source === 'drive') {
      if (source === 'github' && externalUnavailable) throw Error('external connector unavailable')
      return { results: [{source, sourceId:source + ':one', title:'Related investigation record', content:'Historical evidence only', trust:'live', retrievedAt:'2026-10-08T01:00:00Z'}] }
    }
    if (source === 'gmail') {
      if (externalUnavailable) throw Error('mail connector unavailable')
      return {results:[{source,sourceId:'mail:one',title:'Provider usage notice',retrievedAt:'2026-10-07T20:00:00Z',content:'A usage notice was sent; this does not prove a charge.',trust:'live',fields:{}}]}
    }
    if (failed) throw Error('unavailable')
    if (evidenceSections) return {results:evidenceSections.map(s=>({source,sourceId:s.sourceId,title:s.section,retrievedAt:'2026-10-08T01:10:20.000Z',content:JSON.stringify(s),trust:'live',fields:s}))}
    return {results:[{source,sourceId:'billing:abc',title:'billing',retrievedAt:'2026-10-06T12:00:00Z',content:'Billing source is unconnected: charge cause not established.',trust:'live',fields:{section:workEvidence?'work':'billing',state:workEvidence?'ok':'unconnected',evidenceState:workEvidence?'confirmed':'not_established',provesCharge:false,records:workEvidence?[{sourceId:'failed-run',state:'failed',reason:'source_dirty'}]:[],sha256:'a'.repeat(64)}}]}
  }
  const result = await processIntake(question, { complete: async () => { throw Error('API must not be used') } }, history, {
    demo: true, interactionMode: 'chat', ownerInvestigation: allowed, openaiAdapter: a, semanticCallModel, controlAdapter: { complete: async () => { throw Error('unexpected API control call') } },
    previousInvestigation, memoryClient: { recall: async () => { recall++; return [] } },
    onInvestigation: e => events.push(e),
    readContextDeps: { sources, connector: { read: fixtureRead }, finalVerifier: async () => ({ decision: verdict, question: null }), sourceIntentResolver: async () => JSON.stringify({ intent: 'internal', question: null }) }
  })
  return { result, events, calls, reads, recall }
}

test('bilingual intake saves the exact repair-chain gap without claiming an unrelated successful task is the fix',async t=>{
 for(const question of ['上一個開發任務為什麼失敗？現在修好了嗎？','What caused the previous development task to fail, and has it actually been fixed?']){
  const x=await turn(t,{question,focus:'work_failure',fastPath:true,investigationEvidence:['work_failure','source_revision','test_results','repair_verification'],evidenceSections:[
   {section:'work',sourceId:'work:chain',state:'partial',latestFailureId:'failed',retrievedAt:new Date().toISOString(),records:[{sourceId:'failed',kind:'worker/project-tasks',state:'failed',reason:'source_dirty'},
    {sourceId:'unrelated',kind:'worker/project-runs',state:'completed',tests:{total:3,passed:3,failed:0,exitCode:0,skipped:0,cancelled:0}}]},
   {section:'configuration',sourceId:'config:chain',state:'ok',retrievedAt:new Date().toISOString(),records:[{sourceId:'backend',bootCommit:'a'.repeat(40)}]}]})
  const c=x.result.investigation.workCorrelation.repairChain
  assert.equal(c.targetId,'failed');assert.equal(c.firstGap,'linked_correction');assert.equal(c.conclusion,'not_established')
  assert.equal(c.stages.find(s=>s.key==='passing_tests').state,'UNKNOWN')
  assert.match(x.result.reply,/明確編號關聯|explicitly linked/)
  assert.match(x.result.investigation.answerDetails,/修復證據鏈|Repair evidence chain/)
  assert.equal(x.result.investigation.evidenceModel.assertions.find(a=>a.facet==='repair_chain_linked_correction').state,'UNKNOWN')
  assert.deepEqual(x.result.tasks,[]);assert.deepEqual(x.reads,[{source:'xiangxiang_operations',method:'readInvestigation'}])
 }
})

test('decision advice reaches the actual bilingual cost intake without added calls or actions', async t => {
 for(const question of ['根據剛才的用量調查，你建議怎樣減少不必要的消耗？','Based on the usage investigation, what do you recommend to reduce unnecessary consumption?']){
  const call={sourceId:'invocation:advice',invocationId:'advice',requestId:'12345678-1234-4234-8234-123456789012',linkBasis:'host_request_identity',role:'chat_completion',phase:'answer',state:'succeeded',startedAt:'2026-10-08T01:00:00Z',finishedAt:'2026-10-08T01:00:01Z',actualModel:'claude-opus-5-5',modelResultObserved:true,billingRoute:'claude-subscription',usageBasis:'provider_result_model_usage',usage:{inputTokens:10,outputTokens:4},evidenceBasis:'owner_bridge_invocation_ledger'}
  const x=await turn(t,{question,focus:'cost',fastPath:true,evidenceSections:[{section:'execution',sourceId:'execution:advice',state:'partial',records:[call]},{section:'billing',sourceId:'billing:advice',state:'unconnected',records:[]}]})
  assert.match(x.result.reply,/建議怎樣處理|Recommended next steps/)
  assert.match(x.result.reply,/預期效果|Expected benefit/)
  assert.match(x.result.reply,/代價|Tradeoff/)
  assert.equal(x.result.investigation.decisionAdvice.preferred,'review_observed_usage')
  assert.ok(x.result.investigation.answerPresentation.decisionAdvice.references.some(r=>r.recordId==='invocation:advice'))
  assert.equal(x.calls.filter(c=>c.schema!=='goal_plan').length,0)
  assert.equal(x.result.reply,x.result.replyForArchive)
  assert.deepEqual(x.result.tasks,[])
  assert.deepEqual(x.reads,[{source:'xiangxiang_operations',method:'readInvestigation'}])
 }
})
test('decision advice survives the concise failed-task brief and keeps exact identity',async t=>{
 const x=await turn(t,{fastPath:true,focus:'work_failure',evidenceSections:[{section:'work',sourceId:'work:advice',state:'partial',latestFailureId:'failed',records:[{sourceId:'failed',state:'failed',reason:'source_dirty'}]}]})
 assert.match(x.result.reply,/建議怎樣處理/)
 assert.equal(x.result.investigation.decisionAdvice.preferred,'verify_same_failure')
 assert.deepEqual(x.result.investigation.decisionAdvice.options[0].targets,['failed'])
 assert.equal(x.calls.filter(c=>c.schema!=='goal_plan').length,0)
 assert.deepEqual(x.result.tasks,[])
})
test('fresh source-bound failure answer skips only the unused main answer model call', async t => {
  const x = await turn(t, { fastPath: true, focus: 'work_failure', workEvidence: true, previousInvestigation:{state:'absent'},
    question: 'Why did the previous development task fail; is it fixed now?' })
  assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 0)
  assert.match(x.result.reply, /uncommitted changes/)
  assert.match(x.result.investigation.answerDetails, /source_dirty/)
  assert.match(x.result.reply, /not.*confirm/i)
  assert.equal(x.result.replyForArchive, x.result.reply)
  assert.equal(x.result.investigation.answerPresentation.answerCallSkipped, true)
  assert.equal(x.result.investigation.answerPresentation.modelProseUsed, false)
  assert.deepEqual(x.result.tasks, [])
})

test('fresh source-bound cost answer skips unused model but retains exact receipts and billing gap', async t => {
  const sections = [
    { section:'execution', sourceId:'execution:live', state:'partial', records:[{ sourceId:'invocation:one',role:'memory_completion',state:'succeeded',modelResultObserved:true,actualModel:'claude-sonnet-5-5',startedAt:'2026-10-08T01:10:19.069Z',usage:{outputTokens:149},usageBasis:'provider_result_model_usage',evidenceBasis:'owner_bridge_invocation_ledger' }] },
    { section:'billing', sourceId:'billing:gap', state:'unconnected', records:[] }
  ]
  const x = await turn(t, { fastPath: true, focus: 'cost', evidenceSections: sections })
  assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 0)
  assert.match(x.result.reply, /149 token/)
  assert.match(x.result.reply, /扣款原因未確認/)
  assert.equal(x.result.investigation.answerPresentation.findings.references[0].recordId, 'invocation:one')
  assert.equal(x.result.investigation.answerPresentation.answerCallSkipped, true)
  assert.equal(x.result.replyForArchive, x.result.reply)
})

test('fast path refuses action intent, missing verification operation, continuity and unavailable evidence', async t => {
  for (const options of [
    { fastPath:true, taskType:'act', focus:'work_failure', workEvidence:true },
    { fastPath:true, focus:'work_failure', workEvidence:true, unavailableFact:true },
    { fastPath:true, focus:'work_failure', workEvidence:true, previousInvestigation:{state:'available'} },
    { fastPath:true, focus:'work_failure', workEvidence:true, requestedCapability:'proposal.create' },
    { fastPath:true, focus:'work_failure', failed:true }
  ]) {
    const x = await turn(t, options)
    assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 1)
    assert.notEqual(x.result.investigation?.answerPresentation?.answerCallSkipped, true)
  }
})

test('fresh unambiguous background inventory skips unused answer and review calls; follow-up does not', async t => {
  const background = await turn(t, {fastPath:true,focus:'background',requestedCapability:'xiangxiang_operations.read',question:'Which background jobs are running and what models do they use?',
    evidenceSections:[{section:'configuration',sourceId:'configuration:live',state:'partial',records:[{sourceId:'backend:mail_analysis',role:'mail_analysis',currentRunningState:'idle',model:'claude-sonnet',modelBasis:'bridge_route_configuration',evidenceBasis:'live_process_snapshot',at:'2026-10-08T01:10:19.069Z'}]}]})
  assert.equal(background.result.investigation.answerCallGate,'eligible')
  assert.equal(background.calls.filter(c=>c.schema!=='goal_plan').length,0)
  assert.equal(background.result.investigation.answerPresentation.answerCallSkipped,true)
  assert.match(background.result.reply,/Mail analysis.*idle.*claude-sonnet/)

  const previous={state:'available',runId:'previous-run',at:'2026-10-07T00:00:00Z',focus:'work_failure',failureId:'failed-run',goal:'Why did the task fail?',investigation:{sections:[{section:'work',state:'ok',sourceId:'work:old',records:[{sourceId:'failed-run',state:'failed',reason:'source_dirty'}]}]}}
  const followup=await turn(t,{fastPath:true,focus:'work_failure',reference:'previous',previousInvestigation:previous,workEvidence:true,question:'Is that same failure fixed now?'})
  assert.equal(followup.result.investigation.answerCallGate,'outside_fresh_owner_read')
  assert.equal(followup.calls.filter(c=>c.schema!=='goal_plan').length,1)
  assert.equal(followup.reads.length,1)
  assert.equal(followup.result.investigation.continuity.selectedRecordId,'failed-run')
  assert.equal(followup.result.investigation.continuity.provesRepair,false)
  assert.notEqual(followup.result.investigation.answerPresentation?.answerCallSkipped,true)
})

test('required authorised Gmail evidence is read and source-bound alongside operations', async t => {
  const x = await turn(t, { fastPath:true, focus:'cost', sources:['xiangxiang_operations','gmail'],
    question:'Check my local calls and related provider email about credit charges.',
    extraFacts:[{id:'f2',need:'Related provider email',operation:'gmail',entity:null,fields:[],necessity:'required'}],
    evidenceSections:[{section:'execution',sourceId:'execution:fresh',state:'partial',records:[{sourceId:'invocation:one',role:'memory_completion',state:'succeeded',modelResultObserved:true,actualModel:'claude-sonnet-5-5',startedAt:'2026-10-08T01:10:19.069Z',usage:{outputTokens:149},usageBasis:'provider_result_model_usage',evidenceBasis:'owner_bridge_invocation_ledger'}]}],
    investigationAnswer:{claims:[{id:'c1',text:'A provider usage notice was found in email.',kind:'observation',evidenceState:'supported',temporalScope:'historical',references:[{sourceId:'read-context:gmail',recordId:'mail:one',field:'title',value:'Provider usage notice'}]}]} })
  assert.equal(x.reads[0].source,'xiangxiang_operations')
  assert.ok(x.reads.slice(1).every(r=>r.source==='gmail'),'Gmail search may hydrate its matched message')
  assert.match(x.reads.find(r=>r.source==='gmail'&&r.method==='searchMessages').params.q,/OpenAI.*billing.*newer_than:2y/)
  assert.equal(x.result.investigation.crossSourceReads[0].state,'sampled')
  assert.equal(x.result.investigation.crossSourceComparison.mailSelection,'provider_cost_search')
  assert.equal(x.result.investigation.crossSourceComparison.state,'no_shared_identifier_in_sample')
  assert.equal(x.result.investigation.sections.at(-1).sourceId,'read-context:gmail')
  assert.equal(x.result.investigation.semanticReview.accepted.length,1)
  assert.match(x.result.reply,/provider usage notice was found/i)
  assert.match(x.result.reply,/No shared request\/invocation ID was found in the sample/)
  assert.match(x.result.reply,/charges and their cause remain unconfirmed/i)
  assert.equal(x.result.investigation.answerPresentation.kind,'cross_source_semantic_review')
  assert.equal(x.result.replyForArchive,x.result.reply)
})

test('unavailable required Gmail source is recorded as a gap, not an empty inbox', async t => {
  const x=await turn(t,{focus:'cost',sources:['xiangxiang_operations','gmail'],externalUnavailable:true,
    extraFacts:[{id:'f2',need:'Related provider email',operation:'gmail',entity:null,fields:[],necessity:'required'}]})
  assert.deepEqual(x.reads.map(r=>r.source),['xiangxiang_operations','gmail'])
  assert.equal(x.result.investigation.crossSourceReads[0].state,'unavailable')
  assert.equal(x.result.investigation.sections.at(-1).state,'unconnected')
  assert.match(x.result.reply,/gmail: unavailable/)
  assert.doesNotMatch(x.result.reply,/inbox is empty/i)
})

test('cross-source enrichment keeps the main answer call and discloses the omitted source scope', async t => {
  const x = await turn(t, { fastPath: true, focus: 'cost', question: 'Check my local calls and related email about credit charges.',
    extraFacts: [{id:'f2',need:'Related provider email',operation:'gmail',entity:null,fields:[],necessity:'enriching'}],
    evidenceSections: [
      {section:'execution',sourceId:'execution:fresh',state:'partial',records:[{sourceId:'invocation:one',role:'memory_completion',state:'succeeded',modelResultObserved:true,actualModel:'claude-sonnet-5-5',startedAt:'2026-10-08T01:10:19.069Z',usage:{outputTokens:149},usageBasis:'provider_result_model_usage',evidenceBasis:'owner_bridge_invocation_ledger'}]},
      {section:'billing',sourceId:'billing:gap',state:'unconnected',records:[]}
    ] })
  assert.equal(x.result.investigation.answerCallGate, 'mixed_plan_facts')
  assert.equal(x.result.investigation.answerPresentation.answerCallSkipped, undefined)
  assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 1)
  assert.deepEqual(x.reads, [{source:'xiangxiang_operations',method:'readInvestigation'}])
  assert.match(x.result.reply, /charges and their cause remain unconfirmed/)
  assert.match(x.result.reply, /Other sources named in the question are outside this evidence/)
  assert.equal(x.result.investigation.answerPresentation.findings.otherSourcesNotVerified, true)
  assert.equal(x.result.replyForArchive, x.result.reply)
})

test('actual Owner credit answer and archive retain source-bound call evidence with no billing inference',async t=>{
 const evidenceSections=[{section:'execution',sourceId:'execution:abc',state:'partial',evidenceState:'confirmed',records:[{sourceId:'invocation:one',invocationId:'one',role:'memory_completion',state:'succeeded',modelResultObserved:true,actualModel:'claude-sonnet-5-5',startedAt:'2026-10-07T20:00:00Z',usage:{inputTokens:13,outputTokens:4},usageBasis:'provider_result_model_usage',durationMs:2500,evidenceBasis:'owner_bridge_invocation_ledger'}]}]
 const x=await turn(t,{question:'Which calls consumed tokens and credits?',focus:'cost',evidenceSections})
 assert.match(x.result.reply,/claude-sonnet-5-5/);assert.match(x.result.reply,/4 output tokens/);assert.match(x.result.reply,/charges.*unconfirmed/)
 assert.equal(x.result.replyForArchive,x.result.reply);assert.equal(x.result.investigation.answerPresentation.invocationSummary.references[0].recordId,'invocation:one')
 assert.equal(x.result.investigation.answerPresentation.costFindings.references[0].recordId,'invocation:one')
 assert.deepEqual(x.result.tasks,[])
})

test('cost findings skip an unused semantic review and still keep unsupported prose out of the answer',async t=>{
 const evidenceSections=[
  {section:'execution',sourceId:'execution:fresh',state:'partial',records:[{sourceId:'invocation:memory',role:'memory_completion',state:'succeeded',modelResultObserved:true,actualModel:'claude-sonnet-5-5',startedAt:'2026-10-08T01:10:19.069Z',usage:{outputTokens:149},usageBasis:'provider_result_model_usage',evidenceBasis:'owner_bridge_invocation_ledger'}]},
  {section:'schedules',sourceId:'schedules:fresh',state:'ok',records:[{sourceId:'codex-automation:memory',name:'Memory follow-up',state:'PAUSED'}]},
  {section:'billing',sourceId:'billing:fresh',state:'unconnected',records:[]}
 ]
 const investigationAnswer={claims:[{id:'c1',text:'The Memory follow-up schedule caused the charges.',kind:'observation',evidenceState:'confirmed',temporalScope:'current',references:[{sourceId:'schedules:fresh',recordId:'codex-automation:memory',field:'name',value:'Memory follow-up'}]}]}
 const x=await turn(t,{question:'Which background task consumed my credits?',focus:'cost',evidenceSections,investigationAnswer,semanticDecision:'unsupported'})
 assert.match(x.result.reply,/claude-sonnet-5-5.*149 output tokens/s)
 assert.match(x.result.reply,/Memory follow-up.*paused/is)
 assert.match(x.result.reply,/charges and their cause remain unconfirmed/)
 assert.doesNotMatch(x.result.reply,/caused the charges|No usable semantic review|Recent verifiable model calls/)
 assert.equal(x.result.investigation.semanticReview,undefined)
 assert.equal(x.calls.filter(c=>c.schema==='investigation_semantic_review').length,0)
 assert.equal(x.result.investigation.answerPresentation.reviewSkipped,'deterministic_verified_findings')
 assert.equal(x.result.investigation.answerPresentation.modelProseUsed,false)
 assert.equal(x.result.replyForArchive,x.result.reply)
})

test('deterministic cost answer omits the unused scalar review catalog and oversized raw receipts',async t=>{
 const large='receipt detail '.repeat(2000)
 const evidenceSections=[
  {section:'work',sourceId:'work:large',state:'partial',records:[{sourceId:'run:one',state:'failed',reason:'source_dirty',goal:'Inspect credit use',sourceFiles:[{path:large}]}]},
  {section:'billing',sourceId:'billing:gap',state:'unconnected',records:[]}
 ]
 const x=await turn(t,{focus:'cost',evidenceSections})
 const answer=x.calls.find(c=>c.schema==='distill_with_cost_investigation')
 assert.ok(answer,'The answer receives source identities')
 assert.doesNotMatch(answer.p,/FRESH SEMANTIC REFERENCE CATALOG:/)
 assert.doesNotMatch(answer.p,/receipt detail receipt detail/,'Unrelated oversized raw receipt stays out of the model prompt')
 assert.ok(answer.p.length<30000,'The cost-specific context stays bounded')
 assert.equal(x.result.investigation.sections[0].records[0].sourceFiles[0].path,large,'The full receipt remains available for server-side verification')
})

test('cost investigation does not request either unused semantic claims or an Answer Plan', async t => {
 const cost = await turn(t, {focus:'cost'})
 const costCall = cost.calls.find(c => c.schema==='distill_with_cost_investigation')
 assert.ok(costCall)
 assert.equal(costCall.schema,'distill_with_cost_investigation')
 assert.equal(costCall.format.schema.properties.answerPlan,undefined)
 assert.equal(costCall.format.schema.required.includes('answerPlan'),false)
 assert.equal(costCall.format.schema.properties.investigationAnswer,undefined)
 assert.equal(cost.calls.filter(c=>c.schema==='investigation_semantic_review').length,0)
 assert.equal(cost.result.investigation.readOnly,true)
 assert.equal(cost.result.investigation.billingConfirmed,false)
 const other = await turn(t,{focus:'background',question:'What background jobs use which models?'})
 const otherCall = other.calls.find(c => c.format?.schema?.properties?.investigationAnswer)
 assert.ok(otherCall.format.schema.properties.answerPlan,'other investigation focuses retain their established plan contract')
})

test('reviewed prose cannot omit the observed runtime inventory from the actual saved Owner reply',async t=>{
 const at='2026-10-08T01:10:19.069Z',evidenceSections=[
  {section:'configuration',sourceId:'configuration:abc',state:'partial',evidenceState:'confirmed',records:[
   {sourceId:'backend:mail_analysis',role:'mail_analysis',currentRunningState:'idle',model:'claude-sonnet',modelBasis:'bridge_route_configuration',evidenceBasis:'live_process_snapshot',at},
   {sourceId:'backend:memory_index',role:'memory_index',currentRunningState:'active',model:'claude-sonnet',modelBasis:'bridge_route_configuration',evidenceBasis:'live_process_snapshot',at}]},
  {section:'schedules',sourceId:'schedules:abc',state:'ok',evidenceState:'confirmed',records:[{sourceId:'paused-task',state:'PAUSED'}]}]
 const investigationAnswer={claims:[{id:'c1',text:'A schedule is configured as PAUSED.',kind:'observation',evidenceState:'confirmed',temporalScope:'current',references:[{sourceId:'schedules:abc',recordId:'paused-task',field:'state',value:'PAUSED'}]}]}
 for(const semanticDecision of ['supported','unsupported']){
  const x=await turn(t,{question:'What background jobs are running and which models do they use?',focus:'background',evidenceSections,investigationAnswer,semanticDecision})
  assert.match(x.result.reply,/Mail analysis.*idle.*claude-sonnet/)
  assert.match(x.result.reply,/General memory indexing.*active.*claude-sonnet/)
  assert.match(x.result.reply,/2026-10-08T01:10:19.069Z/)
  assert.equal(x.result.replyForArchive,x.result.reply)
  assert.equal(x.result.investigation.answerPresentation.runtimeSummary.references.length,2)
  assert.equal(x.result.investigation.answerPresentation.runtimeSummary.references[1].fields.currentRunningState,'active')
  assert.equal(x.result.investigation.semanticReview.accepted.length,semanticDecision==='supported'?1:0)
  assert.deepEqual(x.result.tasks,[]);assert.equal(x.reads.length,1)
 }
})

test('an Owner-only judged operational read cannot have its evidence answer replaced by the legacy business ambiguity question', async t => {
  const x = await turn(t, { focus:'work_failure', question:'上一個開發任務為什麼失敗？現在修好了嗎？', workEvidence:true, semanticCallModel:async()=>JSON.stringify({intent:'code',confidence:'MEDIUM'}) })
  assert.ok(x.result.investigation)
  assert.equal(x.result.mode, 'chat')
  assert.equal(x.result.demoOutcome, 'speech')
  assert.match(x.result.reply, /未提交的改動/)
  assert.match(x.result.investigation.answerDetails, /source_dirty/)
  assert.doesNotMatch(x.result.reply, /你想睇邊方面/)
  assert.equal(x.reads.length, 1)
  assert.equal(x.calls.filter(c=>c.schema!=='goal_plan').length, 1)
})

test('general English semantics reaches the actual final intake reply with visible source binding and one review',async t=>{
 const investigationAnswer={claims:[{id:'c1',text:'The billing source is not connected, so the actual charge cause is not established.',kind:'limitation',evidenceState:'not_established',temporalScope:'unknown',references:[{sourceId:'billing:abc',recordId:null,field:'state',value:'unconnected'}]}]}
 const x=await turn(t,{question:'Could the credits be coming from an unattended workflow? Find the evidence.',focus:'general',investigationAnswer})
 assert.match(x.result.reply,/billing source is not connected/);assert.equal(x.result.investigation.answerPresentation.kind,'source_bound_semantic_review')
 assert.equal(x.result.replyForArchive,x.result.reply,'Archive must preserve the reviewed answer rather than the unreviewed draft')
 assert.equal(x.result.investigation.semanticReview.accepted[0].references[0].sourceId,'billing:abc')
 assert.equal(x.result.investigation.semanticReview.calls,1);assert.equal(x.reads.length,1);assert.deepEqual(x.result.tasks,[])
 assert.ok(x.events.some(e=>e.state==='semantic_review'));assert.equal(x.calls.filter(c=>c.schema==='investigation_semantic_review').length,1)
 assert.ok(x.calls.some(c=>c.p.includes('FRESH SEMANTIC REFERENCE CATALOG:')&&c.p.includes('billing:abc')),'Main model receives exact fresh reference identities rather than guessing labels')
 const withheld=await turn(t,{question:'Investigate credit usage',focus:'general',investigationAnswer,semanticDecision:'unsupported'})
 assert.doesNotMatch(withheld.result.reply,/billing source is not connected/);assert.equal(withheld.result.investigation.semanticReview.accepted.length,0)
 assert.match(withheld.result.reply,/No usable semantic review/)
 assert.equal(withheld.result.replyForArchive,withheld.result.reply,'Withheld prose must not survive through the archive')
 const denied=await turn(t,{allowed:false,investigationAnswer});assert.equal(denied.calls.filter(c=>c.schema==='investigation_semantic_review').length,0)
})
test('legacy ambiguity remains terminal when the Owner operational read has no observed evidence', async t => {
  const x = await turn(t, { focus:'work_failure', failed:true, semanticCallModel:async()=>JSON.stringify({intent:'code',confidence:'MEDIUM'}) })
  assert.equal(x.result.demoOutcome,'clarification')
  assert.match(x.result.reply,/你想睇邊方面/)
})
test('an unavailable verification fact stays a report gap and cannot erase an observed operations answer', async t => {
  const x = await turn(t, { focus:'work_failure', unavailableFact:true, workEvidence:true, semanticCallModel:async()=>JSON.stringify({intent:'code',confidence:'MEDIUM'}) })
  assert.equal(x.result.mode,'chat')
  assert.equal(x.result.demoOutcome,'speech')
  assert.ok(x.result.investigation.gaps.some(g=>g.section==='same_failure_current_version_verification'))
  assert.match(x.result.reply,/未提交的改動/)
  assert.match(x.result.investigation.answerDetails,/source_dirty/)
  assert.equal(x.reads.length,1)
})

test('a historical enquiry with empty memory reads own operational sources before answering, on the selected subscription', async t => {
  const x = await turn(t)
  assert.ok(x.recall > 0)
  assert.equal(x.calls.filter(c => c.schema === 'goal_plan').length, 1)
  assert.deepEqual(x.reads, [{ source: 'xiangxiang_operations', method: 'readInvestigation' }])
  assert.ok(x.calls.find(c => c.schema !== 'goal_plan').p.includes('billing:abc'))
  assert.ok(x.calls.find(c => c.schema !== 'goal_plan').p.includes('unconnected'))
  assert.equal(x.result.investigation.sections[0].evidenceState, 'not_established')
  assert.ok(x.events.some(e => e.state === 'reading'))
  assert.ok(x.events.some(e => e.state === 'evaluating'))
  assert.notEqual(x.result.demoOutcome, 'clarification')
})
test('the same operational source choice handles English without a Chinese intent keyword', async t => {
  const x = await turn(t, { question: 'Find what previously kept consuming my credits and whether it is still running.' })
  assert.equal(x.reads.length, 1)
  assert.ok(x.result.investigation)
})
test('an English Owner investigation reaches the final reply with its source-bound failure and unverified repair status',async t=>{
  const x=await turn(t,{question:'Why did the previous task fail? Is it fixed?',focus:'work_failure',workEvidence:true})
  assert.match(x.result.reply,/uncommitted changes/)
  assert.match(x.result.investigation.answerDetails,/source_dirty/)
  assert.match(x.result.reply,/not.*confirm/i)
  assert.doesNotMatch(x.result.reply,/扣款原因/)
  assert.equal(x.result.investigation.answerPresentation.kind,'source_bound_work_findings')
  assert.equal(x.result.investigation.answerPresentation.findings.references[0].recordId,'failed-run')
  assert.equal(x.calls.filter(c=>c.schema==='investigation_semantic_review').length,0)
  assert.equal(x.calls.find(c=>c.schema==='distill_with_answer_plan').format.schema.properties.investigationAnswer,undefined)
  assert.equal(x.calls.filter(c=>c.schema!=='goal_plan').length,1)
})

test('judged Chinese and English work and background focuses survive the actual intake without granting actions', async t => {
  for (const [focus,question] of [['work_failure','上一個開發任務為什麼失敗？現在修好了嗎？'],['work_failure','Why did the previous development task fail; is it fixed now?'],['background','現在有哪些背景工作？各自使用什麼模型？'],['background','What background jobs are configured and which models do they use?']]) {
    const x=await turn(t,{focus,question})
    assert.equal(x.result.investigation.focus,focus)
    assert.equal(x.result.investigation.readOnly,true)
    assert.equal(x.reads.length,1)
    assert.ok(x.result.investigation.recommendations.every(r=>r.kind!=='obtain_billing_evidence'))
    assert.ok(x.calls.some(r=>r.p.includes('QUESTION-SPECIFIC INVESTIGATION: report focus='+focus)))
  }
})

test('an operational answer does not prepend an unchecked auxiliary judgment over its evidence answer', async t => {
  const x = await turn(t, { judgment: { status: 'provisional', statement: 'Unsupported-billing-judgment', uncertainties: ['This task has no execution records.'], changeIf: [] } })
  assert.doesNotMatch(x.result.reply, /Unsupported-billing-judgment|no execution records/)
  assert.equal(x.result.investigation.unverifiedJudgmentOmitted, true)
  assert.match(x.result.reply, /扣款原因未確認/)
})
test('a plan cannot grant local operational access to a non-Owner caller', async t => {
  const x = await turn(t, { allowed: false })
  assert.deepEqual(x.reads, [])
  assert.equal(x.result.investigation, undefined)
})

test('a mixed-language follow-up uses a saved context reference but must perform a fresh authorized read', async t => {
 const previousInvestigation={state:'available',runId:'prior-receipt',at:'2026-10-07T00:00:00Z',focus:'work_failure',failureId:'failed-run',goal:'Investigate previous failed task',investigation:{sections:[{section:'work',state:'ok',sourceId:'old-work',records:[{sourceId:'failed-run',state:'failed',reason:'source_dirty'}]}]}}
 const x=await turn(t,{question:'剛才那個 task，now怎樣？',focus:'work_failure',reference:'previous',previousInvestigation,workEvidence:true,history:[{role:'assistant',text:'not evidence '+ 'x'.repeat(900)+' previous failed task'}]})
 assert.equal(x.reads.length,1);assert.equal(x.result.investigation.continuity.referenceRunId,'prior-receipt')
 assert.equal(x.result.investigation.continuity.selectedRecordId,'failed-run');assert.match(x.result.reply,/重新讀取/)
 assert.ok(x.calls.find(c=>c.schema==='goal_plan').p.includes('PREVIOUS INVESTIGATION — CONTEXT, NOT CURRENT EVIDENCE'))
 assert.equal(x.calls.filter(c=>c.schema==='goal_plan').length,1);assert.equal(x.calls.filter(c=>c.schema!=='goal_plan').length,1)
 const denied=await turn(t,{allowed:false,question:'And now?',focus:'work_failure',reference:'previous',previousInvestigation})
 assert.equal(denied.reads.length,0);assert.equal(denied.result.investigation,undefined)
 assert.ok(!denied.calls.find(c=>c.schema==='goal_plan').p.includes('prior-receipt'))
})

test('a completed operational read satisfies an internal obligation without repeat reasoning or duplicate reads', async t => {
  const x = await turn(t, { verdict: 'require_internal' })
  assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 1)
  assert.equal(x.reads.length, 1)
  assert.ok(x.result.investigation.sections.length)
})

test('empty memory does not erase evidence gathered from other authorized sources', async t => {
  const x = await turn(t, { verdict: 'require_memory' })
  assert.ok(x.recall > 0)
  assert.ok(x.result.investigation.sections.length)
  assert.doesNotMatch(x.result.reply, /沒有找到|找不到|no matching memories/i)
})

test('a failed operational read is not counted as a fulfilled internal obligation', async t => {
  const x = await turn(t, { failed: true, verdict: 'require_internal' })
  assert.equal(x.result.investigation.state, 'unavailable')
  assert.deepEqual(x.result.investigation.sections, [])
  assert.equal(x.result.investigation.plan.completion, 'sources_exhausted_with_gaps')
})
test('an exhausted operational scope reports the gap without repeated subscription answers or reads', async t => {
  const x = await turn(t, { failed: true, verdict: 'require_internal' })
  assert.equal(x.result.investigation.state, 'unavailable')
  assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 1)
  assert.equal(x.reads.length, 1)
  assert.equal(x.result.investigation.plan.automaticModelRetries, 0)
})


test('cost evidence gaps trigger one authorised enriching Gmail read without charge inference', async t => {
  const x = await turn(t, { focus:'cost', sources:['xiangxiang_operations','gmail'],
    extraFacts:[{id:'f2',need:'Provider billing notice',operation:'gmail',entity:null,fields:[],necessity:'enriching'}] })
  const report = x.result.investigation
  assert.deepEqual(report.followupReads.sources, ['gmail'])
  assert.equal(report.followupReads.decisions[0].state, 'sampled')
  assert.equal(report.crossSourceReads[0].phase, 'followup')
  assert.equal(report.billingConfirmed, false)
  assert.ok(report.gaps.some(g=>g.section==='billing'))
  assert.equal(x.reads.filter(r=>r.method==='searchMessages').length, 1)
  assert.ok(x.events.some(e=>e.phase==='followup'&&e.section==='gmail'&&e.state==='reading'))
  assert.match(x.result.reply, /補查紀錄/)
  assert.deepEqual(x.result.tasks, [])
  assert.equal(x.result.replyForArchive, x.result.reply)
})

test('development failure supplements GitHub without claiming the current failure is repaired', async t => {
  const x = await turn(t, { focus:'work_failure', workEvidence:true, sources:['xiangxiang_operations','github'],
    question:'Why did development fail? Check related changes if needed.',
    extraFacts:[{id:'f2',need:'Related changes',operation:'github',entity:null,fields:[],necessity:'enriching'}] })
  assert.deepEqual(x.result.investigation.followupReads.sources, ['github'])
  assert.equal(x.result.investigation.crossSourceReads[0].source, 'github')
  assert.ok(x.result.investigation.gaps.some(g=>g.section==='same_failure_current_version_verification'))
  assert.deepEqual(x.result.tasks, [])
})

test('local email follow-up investigation retains required source failure and continues to a planned alternative', async t => {
  const x = await turn(t, { focus:'general', sources:['xiangxiang_operations','gmail','drive'], externalUnavailable:true,
    question:'Check the local email follow-up work and related mail; consult documents if needed.',
    extraFacts:[{id:'f2',need:'Mail thread',operation:'gmail',entity:null,fields:[],necessity:'required'},
      {id:'f3',need:'Related document',operation:'drive',entity:null,fields:[],necessity:'enriching'}] })
  assert.deepEqual(x.result.investigation.crossSourceReads.map(r=>[r.source,r.phase,r.state]),
    [['gmail','required','unavailable'],['drive','followup','sampled']])
  assert.deepEqual(x.result.investigation.followupReads.sources,['drive'])
  assert.deepEqual(x.result.tasks, [])
})

test('empty follow-up search stops without recency fallback and differs from failed or unauthorized reads', async t => {
  const facts=[{id:'f2',need:'Related mail',operation:'gmail',entity:null,fields:[],necessity:'enriching'}]
  const x=await turn(t,{focus:'general',sources:['xiangxiang_operations','gmail'],externalEmpty:true,extraFacts:facts,evidenceSections:[{section:'history',sourceId:'history:sample',state:'partial',records:[]}]})
  assert.equal(x.reads.filter(r=>r.source==='gmail').length,1)
  assert.equal(x.result.investigation.crossSourceReads[0].state,'empty')
  assert.ok(x.events.some(e=>e.sourceState==='empty'))
  assert.match(x.result.reply,/搜尋無命中/)
  const denied=await turn(t,{focus:'cost',extraFacts:facts})
  assert.equal(denied.result.investigation.followupReads.decisions[0].reason,'not_authorized')
  assert.equal(denied.reads.some(r=>r.source==='gmail'),false)
})


test('development Chinese and English share evidence route, same-failure checks and no dispatch',async t=>{
 const questions=['上一個開發任務為什麼失敗？現在修好了嗎？','What caused the previous development task to fail, and has it actually been fixed?']
 const routes=[]
 for(const question of questions){
  const x=await turn(t,{question,focus:'work_failure',workEvidence:true,fastPath:true,captureLocalParams:true,investigationEvidence:['work_failure','source_revision','test_results','repair_verification']})
  routes.push(x.result.investigation.routing.localSections)
  assert.deepEqual(x.reads[0].params.sections,['work','configuration'])
  assert.equal(x.result.investigation.evidenceModel.assertions.find(a=>a.facet==='repaired').state,'UNKNOWN')
  assert.deepEqual(x.result.tasks,[]);assert.equal(x.result.replyForArchive,x.result.reply)
 }
 assert.deepEqual(routes[0],routes[1])
})

test('bilingual intake routes work plus execution and archives exact usage linkage without charging claims or extra model calls',async t=>{
 for(const question of ['哪些工作用了多少 token？實際扣 credit 已確認嗎？','Which jobs used how many tokens, and are actual credit charges confirmed?']){
  const sections=[{section:'execution',sourceId:'execution:live',state:'partial',records:[{sourceId:'invocation:one',invocationId:'one',requestId:'12345678-1234-4234-8234-123456789012',linkBasis:'host_request_identity',role:'chat_completion',phase:'answer',state:'succeeded',startedAt:'2026-10-08T01:10:18.000Z',finishedAt:'2026-10-08T01:10:19.000Z',modelResultObserved:true,actualModel:'claude-sonnet-5-5',billingRoute:'claude-subscription',usage:{inputTokens:10,outputTokens:4},usageBasis:'provider_result_model_usage',evidenceBasis:'owner_bridge_invocation_ledger'}]},
   {section:'work',sourceId:'work:live',state:'partial',records:[{sourceId:'worker-one',kind:'worker/project-runs',state:'completed'}]},
   {section:'billing',sourceId:'billing:gap',state:'unconnected',records:[]}]
  const x=await turn(t,{question,focus:'cost',fastPath:true,evidenceSections:sections,captureLocalParams:true})
  const r=x.result.investigation,c=r.executionUsage.chains[0]
  assert.ok(r.routing.localSections.includes('work'));assert.ok(x.reads[0].params.sections.includes('work'))
  assert.equal(c.successfulResults,1);assert.equal(c.usageState,'CONFIRMED');assert.equal(c.billingState,'UNAVAILABLE')
  assert.deepEqual(c.usageModels[0].subtotal,{inputTokens:10,outputTokens:4})
  assert.match(x.result.reply,/執行與用量|Execution and usage/);assert.match(x.result.reply,/未確認|not confirmed/)
  assert.equal(x.calls.filter(c=>c.schema!=='goal_plan').length,0);assert.deepEqual(x.result.tasks,[])
  assert.equal(x.result.replyForArchive,x.result.reply)
  assert.ok(r.answerPresentation.findings.references.some(ref=>ref.recordId==='invocation:one'))
 }
})

test('unmapped development evidence triggers the same bounded exact revision read in Chinese and English',async t=>{
 for(const question of ['之前的任務修好了嗎？','Has the previous task actually been fixed?']) {
  const revision='a'.repeat(40)
  const x=await turn(t,{question,focus:'work_failure',captureLocalParams:true,sources:['xiangxiang_operations','github'],
   extraFacts:[{id:'f2',need:'Related development evidence',operation:'development_record',entity:null,fields:[],necessity:'enriching'}],
   evidenceSections:[{section:'work',sourceId:'work:one',state:'partial',latestFailureId:'failed-run',records:[{sourceId:'failed-run',state:'failed',reason:'source_dirty',sourceRevision:revision}]}]})
  assert.deepEqual(x.result.investigation.followupReads.sources,['github'])
  const read=x.reads.find(r=>r.source==='github')
  assert.equal(read.method,'listCommits');assert.equal(read.params.sha,revision);assert.equal(read.params.per_page,1)
  assert.equal(x.reads.filter(r=>r.source==='github').length,1)
  assert.equal(x.result.investigation.workCorrelation.targetId,'failed-run')
  assert.equal(x.result.investigation.workCorrelation.repaired,'UNKNOWN')
  assert.equal(x.result.investigation.crossSourceReads[0].requestedRevision,revision)
  assert.deepEqual(x.result.tasks,[]);assert.equal(x.result.replyForArchive,x.result.reply)
 }
})
test('background route reads history and current witnesses while omitting unrelated mail and billing',async t=>{
 const x=await turn(t,{question:'現在有哪些背景工作？各自使用什麼模型？',focus:'background',captureLocalParams:true})
 assert.deepEqual(x.reads[0].params.sections,['configuration','schedules','execution','work'])
 assert.deepEqual(x.result.tasks,[])
})
test('authorised external-only investigation does not force local operations or memory first',async t=>{
 const x=await turn(t,{question:'Why did the repository check fail?',focus:'general',primaryOperation:'github',sources:['github'],investigationEvidence:['code_history']})
 assert.ok(x.reads.length>0);assert.ok(x.reads.every(r=>r.source==='github'))
 assert.deepEqual(x.result.investigation.routing.requiredSources,['github'])
 assert.ok(x.result.investigation.evidenceModel.assertions.some(a=>a.facet==='source_statement'))
 assert.deepEqual(x.result.tasks,[])
})


test('same-time conflicting claims are disclosed instead of presenting either as a conclusion',async t=>{
 const x=await turn(t,{focus:'background',question:'Which model does this job use?',evidenceSections:[{section:'configuration',state:'ok',sourceId:'config:one',records:[{sourceId:'job',model:'a'},{sourceId:'job',model:'b'}]}]})
 assert.match(x.result.reply,/Conflicting evidence/)
 assert.doesNotMatch(x.result.reply,/A schedule is configured|已找到排程/)
 assert.equal(x.result.replyForArchive,x.result.reply)
  assert.deepEqual(x.result.tasks,[])
})

test('background Chinese and English use the same source policy and keep saved activity unknown', async t => {
 const routes=[]
 for (const question of ['現在有哪些背景工作？各自使用什麼模型？','What background jobs exist now, and which model does each use?']) {
  const x=await turn(t,{question,focus:'background',captureLocalParams:true,evidenceSections:[
   {section:'schedules',sourceId:'schedules:one',state:'partial',records:[{sourceId:'codex-automation:job',name:'Follow-up',model:'gpt',state:'ACTIVE',currentRunningState:'active'}]},
   {section:'execution',sourceId:'execution:one',state:'partial',records:[{sourceId:'invocation:old',model:'claude',at:'2026-10-07T12:00:00Z',state:'succeeded'}]}
  ]})
  routes.push(x.result.investigation.routing.localSections)
  const assertions=x.result.investigation.evidenceModel.assertions
  assert.equal(assertions.find(a=>a.facet==='configured_model').value,'gpt')
  assert.equal(assertions.find(a=>a.facet==='enabled').value,true)
  assert.equal(assertions.find(a=>a.facet==='running').state,'UNKNOWN')
  assert.equal(assertions.find(a=>a.facet==='executed_model').temporalScope,'historical_execution')
  assert.ok(x.reads.every(r=>r.source==='xiangxiang_operations'))
  assert.deepEqual(x.result.tasks,[])
 }
 assert.deepEqual(routes[0],routes[1])
})

test('brief failure presentation cannot hide an unread required source behind a local record', async t => {
 const x=await turn(t,{question:'Why did the task fail?',focus:'work_failure',workEvidence:true,fastPath:true,
  extraFacts:[{id:'f2',need:'Required repository evidence',operation:'github',necessity:'required',entity:null,fields:[]}]})
 assert.match(x.result.reply,/github — not authorized/)
 assert.equal(x.result.investigation.answerPresentation?.ownerBrief,undefined)
 assert.ok(x.reads.every(r=>r.source==='xiangxiang_operations'))
 assert.deepEqual(x.result.tasks,[])
})

test('required denied source still produces an honest investigation without performing a read', async t => {
 for (const question of ['為什麼上次開發失敗？', 'Why did the previous development task fail?']) {
  const x = await turn(t, { question, focus:'general', primaryOperation:'github', sources:[], investigationEvidence:['code_history'] })
  assert.ok(x.result.investigation, 'a denied required source must not silently remove the investigation')
  const report = x.result.investigation
  assert.deepEqual(x.reads, [])
  assert.ok(report.evidenceModel.coverage.some(c => c.source==='github' && c.state==='UNAVAILABLE' && c.reason==='not_authorized' && c.attempted===false && c.sourceId===null))
  assert.ok(report.gaps.some(g => g.reason==='not_authorized'))
  assert.match(x.result.reply, /未獲授權|not authorized/)
  assert.doesNotMatch(x.result.reply, /已找到排程/)
  assert.equal(x.result.replyForArchive, x.result.reply)
  assert.deepEqual(x.result.tasks, [])
 }
})

test('unmapped or unknown required operations keep explicit gaps without inventing reads', async t => {
 for (const operation of ['development_record', null]) {
  const x = await turn(t, { question:'Investigate that task.', focus:'general', primaryOperation:operation, sources:[] })
  assert.ok(x.result.investigation)
  assert.deepEqual(x.reads, [])
  assert.equal(x.result.investigation.routing.unmappedFacts[0].status, operation?'UNAVAILABLE':'UNKNOWN')
  assert.ok(x.result.investigation.gaps.some(g => g.coverage==='unmapped_required_need'))
  assert.match(x.result.reply,/Unresolved evidence need/)
  assert.deepEqual(x.result.tasks, [])
 }
})

test('empty external search stays unknown and failed source stays unavailable in both languages', async t => {
 for (const question of ['找上次開發失敗的資料', 'Find evidence of the previous development failure']) {
  for (const mode of ['externalEmpty', 'externalUnavailable']) {
   const x = await turn(t, { question, focus:'general', primaryOperation:'github', sources:['github'], [mode]:true })
   const coverage=x.result.investigation.evidenceModel.coverage.find(c => c.section==='external_github')
   assert.equal(coverage.state, mode==='externalEmpty'?'UNKNOWN':'UNAVAILABLE')
   assert.match(x.result.reply,mode==='externalEmpty'?/搜尋無命中|No matches/:/未能讀取|Unavailable sources/)
   assert.doesNotMatch(x.result.reply,/已找到排程/)
   assert.deepEqual(x.result.tasks, [])
  }
 }
})

test('a denied required source does not block one authorised evidence-equivalent fallback', async t => {
 const x = await turn(t, { question:'Investigate the repository failure.', focus:'general', primaryOperation:'drive', sources:['github'], investigationEvidence:['code_history'] })
 assert.ok(x.reads.length > 0)
 assert.ok(x.reads.every(r => r.source==='github'))
 assert.deepEqual(x.result.investigation.followupReads.sources,['github'])
 assert.ok(x.result.investigation.evidenceModel.coverage.some(c => c.source==='drive' && c.reason==='not_authorized'))
 assert.ok(x.result.investigation.evidenceModel.coverage.some(c => c.section==='external_github' && c.state==='SUPPORTED'))
 assert.deepEqual(x.result.tasks, [])
})

test('development paraphrases stop after one exact revision probe, retain unknown repair, and skip unused prose calls', async t => {
  for (const question of ['上次改程式為何中斷？現在正常了嗎？', '之前開發失敗的原因找到了嗎，能確認已解決嗎？',
    'Why did our last code change stop, and is the issue resolved in the running version?',
    'Investigate the earlier development failure and tell me whether the fix has been verified.']) {
   for (const operation of ['development_record', 'github']) {
    const x = await turn(t, { question, focus: 'work_failure', fastPath: true, sources: ['xiangxiang_operations', 'github'], captureLocalParams: true,
      extraFacts: [{ id:'f2', need:'Additional development history', operation, necessity:'enriching', entity:null, fields:[] }],
      evidenceSections: [{ section:'work', sourceId:'work:one', state:'partial', latestFailureId:'failed-run', records:[{ sourceId:'failed-run', state:'failed', reason:'source_dirty', sourceRevision:'a'.repeat(40) }] }] })
    assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 0)
    assert.equal(x.reads.filter(r => r.source === 'github').length, 1)
    assert.equal(x.reads.find(r => r.source === 'github').params.sha, 'a'.repeat(40))
    assert.equal(x.result.investigation.answerPresentation.answerCallSkipped, true)
    assert.equal(x.result.investigation.workCorrelation.repaired, 'UNKNOWN')
    assert.match(x.result.reply, /未確認|not confirmed/)
    assert.doesNotMatch(x.result.reply, /source_dirty|Same-task investigation|同一任務追查結果|billing|帳單/)
    assert.match(x.result.investigation.answerDetails, /failed-run/)
    assert.deepEqual(x.result.investigation.stop.attemptedSources, ['github'])
    const perf = x.result.investigation.performance
    assert.ok(perf.totalMs >= 0)
    assert.ok(perf.phases.some(p => p.phase === 'live_read_context'))
    assert.ok(perf.phases.some(p => p.role === 'goal_decomposer'))
    assert.equal(perf.semanticReviewCalls, 0)
    assert.doesNotMatch(JSON.stringify(perf), /Additional development history|source_dirty|Related investigation record/)
    assert.equal(x.result.replyForArchive, x.result.reply)
    assert.deepEqual(x.result.tasks, [])
   }
  }
})

test('empty and unavailable revision follow-up finish without retry or manufactured repair proof', async t => {
  for (const mode of ['externalEmpty', 'externalUnavailable']) {
    const x = await turn(t, { [mode]:true, question:'Was the last development failure actually fixed?', focus:'work_failure', fastPath:true,
      sources:['xiangxiang_operations','github'],
      evidenceSections:[{section:'work',sourceId:'work:one',state:'partial',latestFailureId:'failed-run',records:[{sourceId:'failed-run',state:'failed',reason:'timeout',sourceRevision:'b'.repeat(40)}]}] })
    assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 0)
    assert.equal(x.reads.filter(r => r.source === 'github').length, 1)
    assert.equal(x.result.investigation.crossSourceReads[0].state, mode === 'externalEmpty' ? 'empty' : 'unavailable')
    assert.match(x.result.reply, /did not return usable evidence/)
    assert.equal(x.result.investigation.workCorrelation.repaired, 'UNKNOWN')
    assert.deepEqual(x.result.tasks, [])
  }
})

test('required external evidence, mixed goals, conflicts and unresolved required facts retain the normal model path', async t => {
  const record = {sourceId:'failed-run',state:'failed',reason:'source_dirty',sourceRevision:'c'.repeat(40)}
  for (const variant of [
    { extraFacts:[{id:'f2',need:'Required repository evidence',operation:'github',necessity:'required',entity:null,fields:[]}] },
    { extraFacts:[{id:'f2',need:'A relevant email',operation:'gmail',necessity:'enriching',entity:null,fields:[]}] },
    { unavailableFact:true },
    { evidenceSections:[{section:'work',sourceId:'work:one',state:'partial',latestFailureId:'failed-run',records:[record, {...record,reason:'timeout'}]}] }
  ]) {
    const x=await turn(t,{question:'Why did our code task fail?',focus:'work_failure',fastPath:true,sources:['xiangxiang_operations','github','gmail'],
      evidenceSections:[{section:'work',sourceId:'work:one',state:'partial',latestFailureId:'failed-run',records:[record]}],...variant})
    assert.ok(x.calls.some(c => c.schema !== 'goal_plan'))
    assert.notEqual(x.result.investigation.answerPresentation?.answerCallSkipped, true)
    assert.deepEqual(x.result.tasks, [])
  }
})
