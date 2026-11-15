'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function client(){let now=100,visible=true;const frames=[],document={visibilityState:'visible',createElement:()=>({textContent:''})},window={innerHeight:900,innerWidth:1280,getComputedStyle:()=>({visibility:'visible',display:'block'}),performance:{now:()=>now},requestAnimationFrame:fn=>frames.push(fn)};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/demo/assets/topics.js'),'utf8'),{window,document,TextDecoder});const node={textContent:'Guarded answer',isConnected:true,getClientRects:()=>visible?[{}]:[],getBoundingClientRect:()=>({top:20,left:20,bottom:100,right:100}),setAttribute(k,v){this[k]=v}}
 return{api:window.XiangxiangTopics,node,document,clock:v=>now=v,visible:v=>visible=v,frame:()=>frames.shift()?.()}}
test('formal client separates first guarded response, end of stream, DOM insertion and a visible paint opportunity',async()=>{
 const c=client(),timing=c.api.startTiming();c.clock(130)
 const bytes=Buffer.from('data: {"type":"model_start"}\n\ndata: {"type":"final","body":{"reply":"Guarded answer"},"timing":{"totalMs":25}}\n\n'),body=new ReadableStream({start(x){x.enqueue(bytes);x.close()}})
 const result=await c.api.readStream({status:200,body},{appendChild(){}},s=>s,timing);assert.equal(result.body.reply,'Guarded answer');assert.equal(timing.firstGuardedResponseMs,30);assert.equal(timing.streamCompleteMs,30)
 c.clock(135);c.api.markRendered({root:c.node,source:result.body.reply},result.body,timing);assert.equal(timing.answerDomMs,35);assert.equal(timing.answerPaintOpportunityMs,null);c.clock(140);c.frame();c.clock(150);c.frame();assert.equal(timing.answerPaintOpportunityMs,50);assert.equal(JSON.parse(c.node['data-local-answer-timing']).answerPaintOpportunityMs,50)
})
test('hidden, detached or empty answers do not acquire a visible-answer time; no clock stays unknown',()=>{
 for(const state of ['hidden','detached','empty','offscreen']){const c=client(),t=c.api.startTiming();if(state==='hidden')c.document.visibilityState='hidden';if(state==='detached')c.node.isConnected=false;if(state==='empty')c.node.textContent='';if(state==='offscreen')c.node.getBoundingClientRect=()=>({top:1000,bottom:1100,left:20,right:100});c.api.markRendered({root:c.node,source:state==='empty'?'':'answer'},{reply:state==='empty'?'':'answer'},t);c.frame();c.frame();assert.equal(t.answerPaintOpportunityMs,null)}
 const window={},document={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/demo/assets/topics.js'),'utf8'),{window,document,TextDecoder});assert.equal(window.XiangxiangTopics.startTiming(),null)
})
test('receipt reduction preserves missing timings and separates repetitions by scenario and observed load state',()=>{
 const {summarize}=require('../../src/localBrain/acceptanceTiming'),rows=[1,2,3].map((repeat,i)=>({scenario:'minimum_transfer',repeat,correct:true,modelCalls:i+1,client:{answerPaintOpportunityMs:(i+1)*100,streamCompleteMs:(i+1)*80},trace:[{type:'model_complete',timing:{firstTokenMs:10,totalMs:50,loadMs:0,promptMs:20,generationMs:30}}],loadedBefore:true}))
 const r=summarize(rows);assert.equal(r.scenarios[0].completed,3);assert.equal(r.scenarios[0].answerPaintOpportunityMedianMs,200);assert.equal(r.scenarios[0].modelFirstTokenMedianMs,10);assert.equal(r.totalCalls,6)
 const missing=summarize([{...rows[0],loadedBefore:null,client:{},trace:[]}]);assert.equal(missing.scenarios[0].answerPaintOpportunityMedianMs,null);assert.equal(missing.scenarios[0].cold.length,0);assert.equal(missing.scenarios[0].unknownLoad.length,1);assert.equal(missing.scenarios[0].completeThree,false)
 assert.throws(()=>summarize([rows[0],rows[0]]),/acceptance_receipt_invalid/);assert.throws(()=>summarize([{...rows[0],modelCalls:7}]),/acceptance_receipt_invalid/)
})
test('measurement faults cannot replace or suppress an already guarded answer',()=>{
 const c=client(),t=c.api.startTiming();c.node.setAttribute=()=>{throw Error('DOM instrumentation unavailable')};assert.doesNotThrow(()=>c.api.markRendered({root:c.node,source:'answer'},{reply:'answer'},t));assert.doesNotThrow(()=>c.frame());assert.doesNotThrow(()=>c.frame());assert.equal(c.node.textContent,'Guarded answer')
 const window={performance:{now(){throw Error('clock failed')}}},document={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/demo/assets/topics.js'),'utf8'),{window,document,TextDecoder});assert.equal(window.XiangxiangTopics.startTiming(),null)
})
