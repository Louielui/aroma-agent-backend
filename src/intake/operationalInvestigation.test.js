'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { processIntake } = require('./intakeService')

async function turn (t, { allowed = true, question = '之前有什麼會導致不停扣 credit？', focus = null, failed = false, verdict = 'allow_final', judgment = null, semanticCallModel = undefined, workEvidence = false, unavailableFact = false, extraFacts = [], previousInvestigation = null, reference = null, history = [], investigationAnswer = undefined, semanticDecision = 'supported', evidenceSections = null, fastPath = false, taskType = 'diagnose', sources = ['xiangxiang_operations'], externalUnavailable = false, requestedCapability = null } = {}) {
  const old = { ...process.env }
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]; Object.assign(process.env, old) })
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', GOAL_DECOMPOSER: 'on', READ_ACCESS: 'on', CONTEXT_XIANGXIANG_OPERATIONS: 'on', XIANGXIANG_MEMORY: 'on', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'on', MULTI_AI_ROUTER: 'off', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off' })
  const events = [], calls = [], reads = []
  const a = { providerName: 'claude', preflight: async () => {}, complete: async (p, options = {}) => {
    calls.push({ p, schema: options.responseFormat?.name, format: options.responseFormat })
    if (options.responseFormat?.name === 'investigation_semantic_review') return {billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify({reviews:[{id:'c1',decision:semanticDecision,reason:'matches_reference'}]})}
    if (options.responseFormat?.name === 'goal_plan') return { billing:'claude-subscription', model:'claude-opus-5-5', text:JSON.stringify({question_restated:question,executive_frame:fastPath?{taskType,decisionNeeded:true,successDefinition:'Explain the observed record and remaining uncertainty.',answerPosture:'evidence_first'}:undefined,requested_capability:requestedCapability,investigation_focus:focus,investigation_reference:reference,facts:[{id:'f1',need:'Investigate own previous usage and work',operation:'xiangxiang_operations',entity:null,fields:[],necessity:'required'},...(unavailableFact?[{id:'f2',need:'Runtime regression for the same failure',operation:null,entity:null,fields:[],necessity:'required'}]:[]),...extraFacts],joins:[]}) }
    return { billing: 'claude-subscription', model: 'claude-opus-5-5', text: JSON.stringify({ mode: 'chat', intent: 'question', reply: '已找到排程設定，但實際扣款原因未確認。', nextRead: null, answerPlan: null, executiveJudgment: judgment, investigationAnswer }) }
  } }
  let recall = 0
  const fixtureRead = async (source, method) => {
    reads.push({ source, method })
    if (source === 'gmail') {
      if (externalUnavailable) throw Error('mail connector unavailable')
      return {results:[{source,sourceId:'mail:one',title:'Provider usage notice',retrievedAt:'2026-10-07T20:00:00Z',content:'A usage notice was sent; this does not prove a charge.',trust:'live',fields:{}}]}
    }
    if (failed) throw Error('unavailable')
    if (evidenceSections) return {results:evidenceSections.map(s=>({source,sourceId:s.sourceId,title:s.section,retrievedAt:'2026-10-07T20:00:00Z',content:JSON.stringify(s),trust:'live',fields:s}))}
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

test('fresh source-bound failure answer skips only the unused main answer model call', async t => {
  const x = await turn(t, { fastPath: true, focus: 'work_failure', workEvidence: true, previousInvestigation:{state:'absent'},
    question: 'Why did the previous development task fail; is it fixed now?' })
  assert.equal(x.calls.filter(c => c.schema !== 'goal_plan').length, 0)
  assert.match(x.result.reply, /source_dirty/)
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
  assert.equal(x.result.investigation.crossSourceReads[0].state,'sampled')
  assert.equal(x.result.investigation.sections.at(-1).sourceId,'read-context:gmail')
  assert.equal(x.result.investigation.semanticReview.accepted.length,1)
  assert.match(x.result.reply,/provider usage notice was found/i)
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
 const at='2026-10-07T20:00:00Z',evidenceSections=[
  {section:'configuration',sourceId:'configuration:abc',state:'partial',evidenceState:'confirmed',records:[
   {sourceId:'backend:mail_analysis',role:'mail_analysis',currentRunningState:'idle',model:'claude-sonnet',modelBasis:'bridge_route_configuration',evidenceBasis:'live_process_snapshot',at},
   {sourceId:'backend:memory_index',role:'memory_index',currentRunningState:'active',model:'claude-sonnet',modelBasis:'bridge_route_configuration',evidenceBasis:'live_process_snapshot',at}]},
  {section:'schedules',sourceId:'schedules:abc',state:'ok',evidenceState:'confirmed',records:[{sourceId:'paused-task',state:'PAUSED'}]}]
 const investigationAnswer={claims:[{id:'c1',text:'A schedule is configured as PAUSED.',kind:'observation',evidenceState:'confirmed',temporalScope:'current',references:[{sourceId:'schedules:abc',recordId:'paused-task',field:'state',value:'PAUSED'}]}]}
 for(const semanticDecision of ['supported','unsupported']){
  const x=await turn(t,{question:'What background jobs are running and which models do they use?',focus:'background',evidenceSections,investigationAnswer,semanticDecision})
  assert.match(x.result.reply,/Mail analysis.*idle.*claude-sonnet/)
  assert.match(x.result.reply,/General memory indexing.*active.*claude-sonnet/)
  assert.match(x.result.reply,/2026-10-07T20:00:00Z/)
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
  assert.match(x.result.reply, /source_dirty/)
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
  assert.match(x.result.reply,/source_dirty/)
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
  assert.match(x.result.reply,/source_dirty/)
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
