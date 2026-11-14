'use strict'
// Bounded actual local-model acceptance. No HTTP listener, production store,
// subscription call or business operation. All approvals below are test fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
async function main(){
 const evidence='C:/Users/louis/Documents/Codex/local-candidates/local-brain-20261114'
 Object.assign(process.env,{LOCAL_BRAIN_ONLY:'1',LLM_PROVIDER:'local',LOCAL_MODEL:'qwen3.5:9b',LOCAL_MODEL_CONTEXT:'65536'})
 for(const key of Object.keys(process.env))if(/API_KEY|TOKEN|PASSWORD|DATABASE_URL/.test(key))delete process.env[key]
 const egress=[];require('../../src/localBrain/isolation').install({audit:e=>egress.push(e)})
 const {LocalAdapter}=require('../../src/adapters/LocalAdapter'),{createLearning}=require('../../src/localBrain/learning'),{OWNER}=require('../../src/memory/governed')
 const trials=[];let current,currentTrace=[]
 try{
  for(let i=0;i<3;i++){
   const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-accept-'),trace=[],begin=performance.now()
   currentTrace=trace
   const adapter=new LocalAdapter({onEvent:e=>trace.push({...e,atMs:performance.now()-begin})})
   current=createLearning({dir,adapter})
   const text='我偏好測試回報先講結論，最多三個重點。'
   const queued=current.runtime.event('conversation','fixture-'+i,text,'owner_statement')
   assert.equal(current.runtime.event('conversation','no-save-'+i,'不要保存記憶，測試內容。','owner_statement').state,'excluded')
   current.start();let source,candidates=[]
   const deadline=Date.now()+60000
   while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,300))
    source=await current.gateway.get(OWNER,queued.id)
    candidates=await current.gateway.list(OWNER,{status:'candidate'})
    if(source?.index.state==='saved'&&candidates.length&&!current.runtime.status().active&&!current.runtime.consolidation.status().busy)break
    if(source?.index.state==='unconfirmed'||source?.details.consolidation?.state==='failed')throw Error('background_learning_unconfirmed')
   }
   current.runtime.stop()
   assert.equal(source?.index.state,'saved');assert.ok(candidates.some(c=>c.type==='preference'))
   assert.equal((await current.gateway.preferences(OWNER)).items.length,0)
   const candidate=candidates.find(c=>c.type==='preference')
   await assert.rejects(current.gateway.transition({id:'untrusted',role:'agent'},candidate.id,candidate.version,'approve'),/permission_denied/)
   // Disposable fixture only. This is NOT approval of any real Owner preference.
   await current.gateway.transition(OWNER,candidate.id,candidate.version,'approve')
   // A newly approved canonical revision legitimately needs its own index.
   assert.equal((await current.gateway.index(OWNER,candidate.id)).index.state,'saved')
   const before=trace.filter(e=>e.type==='model_complete').length
   current.close();current=createLearning({dir,adapter})
   await current.runtime.drain();await current.runtime.consolidation.tick()
   const recalled=await current.gateway.preferences(OWNER)
   assert.ok(recalled.items.some(r=>r.id===candidate.id));assert.equal(trace.filter(e=>e.type==='model_complete').length,before)
   const reflected=await current.gateway.reflect(OWNER,{query:'用一句話摘要這筆隔離測試偏好。',subject:'Isolated fixture summary',scope:'private:owner',evidenceIds:[candidate.id]})
   assert.equal(reflected.status,'candidate');assert.equal(reflected.details.engine,'local')
   assert.equal((await current.gateway.get(OWNER,candidate.id)).status,'active')
   const item={dir,elapsedMs:performance.now()-begin,index:source.index,sourceId:source.id,candidateId:candidate.id,candidateText:candidate.text,reflectionId:reflected.id,reflectionText:reflected.text,background:true,restartDedupe:true,approval:'SIMULATED_FIXTURE_ONLY',trace,engine:current.engine.status()}
   trials.push(item);current.close();current=null
   fs.writeFileSync(path.join(evidence,'learning-acceptance-progress.json'),JSON.stringify({trials},null,2))
  }
  const totals=trials.map(t=>t.elapsedMs).sort((a,b)=>a-b)
  const receipt={at:new Date().toISOString(),status:'SCOPED_LOCAL_LEARNING_PASS',sourceHash:require('../../src/localBrain/buildIdentity').buildIdentity(path.resolve(__dirname,'../..')),trials,medianMs:totals[1],egress,cloudCalls:0,productionTouched:false}
  fs.writeFileSync(path.join(evidence,'LEARNING-ACCEPTANCE.json'),JSON.stringify(receipt,null,2))
  console.log(JSON.stringify({status:receipt.status,medianMs:receipt.medianMs,calls:trials.flatMap(t=>t.trace).filter(e=>e.type==='model_complete').length,file:path.join(evidence,'LEARNING-ACCEPTANCE.json')}))
 }catch(e){
  fs.writeFileSync(path.join(evidence,'LEARNING-ACCEPTANCE-FAILURE-'+Date.now()+'.json'),JSON.stringify({error:e.message,trials,currentTrace,egress,engine:current?.engine.status()},null,2));throw e
 }finally{if(current){current.runtime.stop();while(current.engine.status().busy||current.runtime.status().active||current.runtime.consolidation.status().busy)await new Promise(r=>setTimeout(r,100));current.close()}}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
