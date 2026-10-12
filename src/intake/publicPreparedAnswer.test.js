'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {processIntake}=require('./intakeService');
const {runReasoningLoop}=require('./reasoningLoop');
test('an already prepared final is counted as zero extra model calls and still passes the terminal gate',async()=>{
 let calls=0,gates=0;
 const out=await runReasoningLoop({capabilities:['example.read'],callModel:async()=>{calls++;return calls===1?{type:'read',capability:'example.read'}:{type:'final',result:{reply:'unused'}}},executeRead:async()=>({ok:true}),getPreparedDecision:async()=>({type:'final',result:{reply:'prepared'}}),beforeTerminal:async()=>{gates++;return {type:'allow'}}});
 assert.equal(calls,1);assert.equal(out.modelCalls,1);assert.equal(gates,1);assert.equal(out.result.reply,'prepared');
});
test('a prepared final cannot bypass a terminal refusal',async()=>{
 let calls=0;
 const out=await runReasoningLoop({capabilities:['example.read'],maxSteps:2,callModel:async()=>{calls++;return {type:'read',capability:'example.read'}},executeRead:async()=>({ok:true}),getPreparedDecision:async()=>({type:'final',result:{reply:'must be withheld'}}),beforeTerminal:async()=>({type:'stop'})});
 assert.notEqual(out.result?.reply,'must be withheld');assert.equal(calls,1);
});
const now='2026-10-12T05:00:00Z';
const row={source:'public_knowledge',sourceId:'p1',trust:'live',retrievedAt:now,content:'Recorded temperature 7°C.',fields:{provider:'claude_subscription_search',contentKind:'publisher_cited_summary',consulted:true,url:'https://weather.gc.ca/forecast',sourceTitle:'Weather',sourceEvidence:{kind:'publisher_page',language:'en',hash:'a'.repeat(64),quote:'Recorded temperature 7°C.',times:[],freshness:'unknown',answerState:'supported'}}};
async function fixture({intent='public',observed=row}={}){
 const flags={READ_ACCESS:'on',CONTEXT_PUBLIC_KNOWLEDGE:'on',CONTEXT_GMAIL:'on',CONTEXT_AROMA_SYSTEM:'off',TURN_ROUTER:'on',MULTI_AI_ROUTER:'off',A4_KNOWLEDGE_ROUTING:'on'};
 const saved=Object.fromEntries(Object.keys(flags).map(k=>[k,process.env[k]]));Object.assign(process.env,flags);
 let calls=0;
 const adapter={label:'claude',complete:async()=>{calls++;return {text:JSON.stringify(calls===1?{mode:'chat',intent:'question',reply:'I will read.',nextRead:{capability:'public_knowledge.search',args:{query:'weather'}},answerPlan:null}:{mode:'chat',intent:'question',reply:'Unused draft 99°C.',nextRead:null,answerPlan:null}),model:'scripted',usage:{inputTokens:1,outputTokens:1,totalTokens:2},latencyMs:1}}};
 try{
  const out=await processIntake('What is the weather?',adapter,[],{demo:true,interactionMode:'chat',providerHint:'claude',readContextDeps:{sources:['public_knowledge','gmail'],sourceIntentResolver:async()=>({intent}),publicQueryPlanner:async()=>({query:'weather',freshness:'current',location:null}),connector:{read:async()=>({source:'public_knowledge',asOf:now,count:1,results:[observed],evidence:{source:'public_knowledge',trust:'live',shownCount:1,matchingTotal:1,completeness:'complete',retrievedAt:now}})}}});
  return {calls,out};
 }finally{for(const k of Object.keys(flags)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]}}
}
test('real intake uses verified public-only composition without an unused answer call',async()=>{
 const result=await fixture();assert.equal(result.calls,1);assert.match(result.out.reply,/7°C/);assert.doesNotMatch(result.out.reply,/99°C/);
});
test('real intake carries only the host public receipt to the transcript persistence boundary',async()=>{
 const observed={...row,fields:{...row.fields,sourceEvidence:{...row.fields.sourceEvidence,publicQuery:{query:'weather',freshness:'current',location:null},gaps:[]}}};
 const result=await fixture({observed});assert.equal(result.calls,1);assert.equal(result.out.publicAnswerReceipt.query.query,'weather');assert.equal(result.out.publicAnswerReceipt.completionAttempted,false);
});
test('insufficient public evidence retains the reasoning path',async()=>{
 const result=await fixture({observed:{...row,fields:{...row.fields,sourceEvidence:{...row.fields.sourceEvidence,answerState:'insufficient'}}}});assert.ok(result.calls>1);assert.match(result.out.reply,/do not establish/);
});
test('mixed-world intent retains the reasoning path even after a verified public read',async()=>{
 const result=await fixture({intent:'mixed'});assert.ok(result.calls>1);
});
test('prepared reuse rejects unknown obligation, private evidence, wrong language and operational investigations',()=>{
 const {preparedPublicSummary}=require('./publicProvenance');
 const input={message:'Weather?',itemsBySource:[{source:'public_knowledge',items:[row]}]},state={requiredWorlds:{public:true,internal:false},completedWorlds:{public:true,internal:false}};
 assert.match(preparedPublicSummary(input,state),/7°C/);
 for(const change of [{requiredWorlds:null},{requiredWorlds:{public:true,internal:true}},{completedWorlds:{public:false,internal:false}},{completedWorlds:{public:true,internal:true}},{investigation:{readOnly:true}}])assert.equal(preparedPublicSummary(input,{...state,...change}),null);
 assert.equal(preparedPublicSummary({...input,message:'天氣？'},state),null);
 assert.equal(preparedPublicSummary({...input,itemsBySource:[...input.itemsBySource,{source:'gmail',items:[{trust:'live'}]}]},state),null);
});
