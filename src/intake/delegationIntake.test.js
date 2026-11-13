'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const saved=require('../investigation/fixtures/delegationAudit.json'),projection=require('../investigation/delegationEvidence')
test('offline full intake reads delegation once and renders the bounded roster without another helper or action',async t=>{
 const original={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original)})
 Object.assign(process.env,{CHAT_BACKEND:'codex-subscription',GOAL_DECOMPOSER:'on',READ_ACCESS:'on',CONTEXT_DECISIONS_OPENAI:'on',CONTEXT_XIANGXIANG_OPERATIONS:'on',TURN_ROUTER:'on',A4_KNOWLEDGE_ROUTING:'on',MULTI_AI_ROUTER:'off',DECISION_RECALL:'off',CONVERSATION_RECALL:'off'})
 const goal=structuredClone(saved.goal);goal.facts.find(f=>f.id==='f2').operation='xiangxiang_operations';goal.investigation_evidence=['delegation']
 const at=new Date().toISOString(),backend=projection.backendSnapshot({bootCommit:saved.runtime,at,readAccess:true,legacy:saved.legacy,agents:[{id:'codex-code-diagnosis',role:'Read-only code diagnosis',status:'active',delegation:{model:'gpt-6.1-sol',effort:'high',selection:'fixed',permissions:'supplied_committed_code_only'}}]})
 const bridge=projection.bridgeSnapshot({bootCommit:saved.runtime,at,enabled:true,providers:[{id:'review',role:'Result review',model:'sonnet',effort:null,selection:'workflow_default',permissions:'supplied_packet_only'}],models:saved.models})
 const view=projection.mergeDelegation({backend,bridge,expectedCommit:saved.runtime,at}),calls=[],reads=[]
 const adapter={providerName:'claude',preflight:async()=>{},complete:async(prompt,o={})=>{calls.push(o.responseFormat?.name);return{billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify(o.responseFormat?.name==='goal_plan'?goal:saved.raw)}}}
 const result=await require('./intakeService').processIntake(saved.message,{complete:async()=>assert.fail('API forbidden')},[],{demo:true,interactionMode:'chat',ownerInvestigation:true,openaiAdapter:adapter,controlAdapter:{complete:async()=>assert.fail('API control forbidden')},semanticCallModel:async()=>JSON.stringify({intent:'NONE',confidence:'HIGH'}),readContextDeps:{sources:['xiangxiang_operations'],connector:{read:async(source,method,params)=>{reads.push({source,method,params});return{results:params.sections.map(section=>({source:'xiangxiang_operations',sourceId:section+':offline',title:section,trust:'live',retrievedAt:at,fields:section==='delegation'?{section,...view}:{section,state:'ok',records:[],workflows:[]}}))}}},sourceIntentResolver:async()=>assert.fail('extra classifier forbidden'),finalVerifier:async()=>({decision:'allow_final'})}})
 assert.equal(reads.length,1);assert.deepEqual(reads[0].params.sections,['configuration','work','delegation'])
 assert.equal(calls.length,2,'existing goal and final-answer calls; metadata adds no model call')
 assert.match(result.reply,/gpt-6\.1-sol/);assert.match(result.reply,/claude-sonnet-5-5/)
 assert.deepEqual(result.tasks,[]);assert.equal(result.investigation.answerPresentation.dispatchVerified,false)
 assert.equal(result.investigation.answerPresentation.validation.boundDelegationFacts,2)
 assert.equal(result.investigation.answerPresentation.modelProseUsed,false)
 assert.equal(result.capabilityCoverage,undefined,'new explicit mapped goal has no invented old missing-operation gap')
 assert.ok(result.investigation.answerDetails)
})
