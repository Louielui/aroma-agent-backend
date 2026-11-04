'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const fixture=require('./fixtures/naturalAdviceReplay.json')
async function replay(t,raw=fixture.raw){
 const before={...process.env};Object.assign(process.env,{CHAT_BACKEND:'off',TURN_ROUTER:'on',CONVERSATION_CONTRACT:'on',MULTI_AI_ROUTER:'off',READ_ACCESS:'off',CONVERSATION_RECALL:'off',DECISION_RECALL:'off',GOAL_DECOMPOSER:'off',A4_KNOWLEDGE_ROUTING:'off',XIANGXIANG_MEMORY:'off',XIANGXIANG_ARCHIVE:'off',LLM_LANGUAGE_MODE:'off',XIANGXIANG_WEBSITE_FLOW:'off'})
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before)})
 const express=require('express'),{createDemoRouter}=require('../routes/demoRouter'),{processIntake}=require('./intakeService'),calls=[]
 const adapter={complete:async(prompt,opts)=>{calls.push({prompt,system:opts.system});return{text:JSON.stringify(raw),model:'offline-retained-native-replay'}}}
 const app=express();app.locals.conversationDemo=true;app.use(express.json());app.locals.promoteToProposal=()=>assert.fail('unexpected proposal')
 app.use(createDemoRouter({getAdapterFn:()=>adapter,conversationStore:{get:()=>({messages:fixture.history}),appendTurn:()=>{}},processIntakeFn:(m,a,h,o)=>processIntake(m,a,h,o)}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/demo/intake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:fixture.message,conversationId:'advice-retained-replay',interactionMode:'chat'})})
 assert.equal(response.status,200);return{result:await response.json(),calls}
}
test('retained native recommendation is rendered once, with all supplementary uncertainty kept separately',async t=>{
 assert.notEqual(fixture.visibleReply,fixture.raw.reply,'the saved native failure includes an added prefix')
 const {result,calls}=await replay(t)
 assert.equal(result.reply,fixture.raw.reply,'ordinary advice must preserve the complete guarded answer, not prepend a second recommendation')
 assert.deepEqual(result.adviceBasis,{status:fixture.raw.executiveJudgment.status,uncertainties:fixture.raw.executiveJudgment.uncertainties,changeIf:fixture.raw.executiveJudgment.changeIf})
 assert.equal(result.decision,null);assert.deepEqual(result.tasks,[]);assert.equal(calls.length,1)
 assert.match(calls[0].prompt,/不是要你現在把兩項都自動化/)
})
test('a chat question still receives the required leading judgment; it cannot hide a stance in supplementary advice',async t=>{
 const raw={...fixture.raw,mode:'chat',intent:'question',reply:'你比較重視哪一點？'},j=raw.executiveJudgment
 const {result}=await replay(t,raw);assert.ok(result.reply.startsWith(j.statement));assert.match(result.reply,/你比較重視哪一點/);assert.equal(result.adviceBasis,undefined)
})
test('blocked advice and invalid judgments cannot be hidden in collapsed details',async t=>{
 const {result}=await replay(t,{...fixture.raw,reply:'目前不足以給出建議。',executiveJudgment:{status:'blocked',statement:'',uncertainties:['實際工作範圍未知。'],changeIf:[]}})
 assert.match(result.reply,/目前無法給出負責任的判斷/);assert.equal(result.adviceBasis,undefined)
})
test('supplementary advice uses a closed, non-executing details element and text nodes',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../demo/assets/app.js'),'utf8'),start=source.indexOf('  function appendAdviceBasis '),end=source.indexOf('  function render (',start)
 assert.ok(start>=0&&end>start,'the existing chat renderer must expose supplementary advice')
 const node=(tag,cls,text)=>({tag,children:[],textContent:text||'',open:false,appendChild(c){this.children.push(c);return c}}),context={el:node,t:k=>k};vm.createContext(context);vm.runInContext(source.slice(start,end),context)
 const host=node('div'),basis={status:'provisional',uncertainties:['<img src=x onerror=alert(1)>'],changeIf:['Only if the premise changes.']};context.appendAdviceBasis(host,basis)
 assert.equal(host.children.length,1);const details=host.children[0];assert.equal(details.tag,'details');assert.equal(details.open,false);assert.equal(details.children[0].tag,'summary')
 const text=n=>n.textContent+' '+n.children.map(text).join(' ');assert.match(text(details),/<img src=x onerror=alert\(1\)>/);assert.equal(details.children.some(n=>n.tag==='img'),false);assert.match(text(details),/Only if the premise changes/)
 const absent=node('div');context.appendAdviceBasis(absent,{...basis,status:'blocked'});assert.equal(absent.children.length,0)
})
