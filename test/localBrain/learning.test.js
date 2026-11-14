'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
test('isolated learning reuses gateway approval, durable indexing, opt-out and background workers',async t=>{
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-test-')
 const text='我偏好測試回報先講結論，最多三個重點。',seen=[]
 const adapter={providerName:'local',complete:async(prompt,opts)=>{seen.push(opts.invocationPhase);return{text:JSON.stringify(opts.invocationPhase==='memory_extract'?{quotes:[text]}:{candidates:[{kind:'preference',subject:'測試回報',text,reason:'Owner statement',quote:text,supersedes:null,taskState:null}]})}}}
 const {createLearning}=require('../../src/localBrain/learning')
 let x=createLearning({dir,adapter});t.after(()=>{x.close();assert.ok(path.resolve(dir).startsWith(path.resolve('C:/Aroma/local-brain-runtime')+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
 assert.throws(()=>createLearning({dir,adapter}),/local_memory_owner_busy/)
 const queued=x.runtime.event('conversation','fixture-owner',text,'owner_statement')
 assert.equal(x.runtime.event('conversation','optout','不要保存記憶，這只是測試。','owner_statement').state,'excluded')
 await x.runtime.drain();await x.runtime.consolidation.tick()
 const {OWNER}=require('../../src/memory/governed')
 const source=await x.gateway.get(OWNER,queued.id)
 assert.equal(source.index.state,'saved')
 const candidates=await x.gateway.list(OWNER,{status:'candidate'})
 assert.equal(candidates.length,1);assert.equal(candidates[0].text,text)
 assert.equal((await x.gateway.preferences(OWNER)).items.length,0)
 assert.ok((await x.gateway.audit(OWNER,source.id)).every(e=>e.hash&&e.snapshot))
 await assert.rejects(x.gateway.transition({id:'agent',role:'agent'},candidates[0].id,candidates[0].version,'approve'),/permission/)
 x.close();x=createLearning({dir,adapter})
 await x.runtime.drain();await x.runtime.consolidation.tick()
 assert.equal(seen.filter(x=>x==='memory_extract').length,1)
 assert.equal((await x.gateway.list(OWNER,{status:'candidate'})).length,1)
 // Disposable fixture approval proves the original revision mechanism, not an
 // authorization to approve real Owner preferences automatically.
 await x.gateway.transition(OWNER,candidates[0].id,candidates[0].version,'approve')
 assert.equal((await x.gateway.preferences(OWNER)).items[0].text,text)
})
test('failed inference remains unconfirmed across restart and never silently resends',async t=>{
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-failure-');let x,sent=0
 t.after(()=>{x?.close();fs.rmSync(dir,{recursive:true,force:true})})
 const {createLearning}=require('../../src/localBrain/learning'),{randomUUID}=require('node:crypto')
 const adapter={providerName:'local',complete:async()=>{sent++;throw Error('local_transport_unavailable')}}
 x=createLearning({dir,adapter});const id='xx-'+randomUUID(),scope='private:owner',engine=x.engine.forScope(scope)
 await assert.rejects(engine.retain(id,'I prefer a short report.'),/local_transport_unavailable/)
 x.close();x=createLearning({dir,adapter})
 await assert.rejects(x.engine.forScope(scope).retain(id,'I prefer a short report.'),/local_memory_inference_unconfirmed/)
 assert.equal(sent,1)
 assert.equal(x.engine.status().inference.counts.failed,1);assert.equal(x.engine.status().inference.lastFailure.code,'local_transport_unavailable')
})
test('model outputs cannot invent extraction quotes or evidence and the engine rejects cloud adapters',async t=>{
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-invalid-'),{createLocalStore}=require('../../src/localBrain/memoryStore'),{createLocalEngine}=require('../../src/localBrain/memoryEngine')
 const database=createLocalStore(dir);t.after(()=>{database.close();fs.rmSync(dir,{recursive:true,force:true})})
 assert.throws(()=>createLocalEngine({database,adapter:{providerName:'claude'}}),/local_memory_provider_required/)
 const engine=createLocalEngine({database,adapter:{providerName:'local',complete:async()=>({text:JSON.stringify({quotes:['invented']})})}}).forScope('private:owner')
 await assert.rejects(engine.retain('xx-'+require('node:crypto').randomUUID(),'I prefer short replies.'),/memory_invalid_result/)
 assert.equal(database.documents('private:owner').length,0)
 assert.throws(()=>createLocalStore('C:/Aroma/aroma-agent-backend/data'),/local_memory_path_refused/)
})
test('dead-process ownership recovers without changing durable reservations',t=>{
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-recover-'),{createLocalStore}=require('../../src/localBrain/memoryStore'),{createLearning}=require('../../src/localBrain/learning')
 const d=createLocalStore(dir);d.reserve('unconfirmed-fixture');d.close()
 fs.writeFileSync(path.join(dir,'learning-owner.lock'),JSON.stringify({pid:2147483647}))
 const x=createLearning({dir,adapter:{providerName:'local'}});t.after(()=>{x.close();fs.rmSync(dir,{recursive:true,force:true})})
 assert.equal(x.engine.status().inference.counts.running,1)
 assert.throws(()=>x.database.reserve('unconfirmed-fixture'),/local_memory_inference_unconfirmed/)
})
test('local canonical commit is atomic under stale revision and audit chains remain verifiable',async t=>{
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-cas-'),{createLocalStore}=require('../../src/localBrain/memoryStore'),d=createLocalStore(dir)
 t.after(()=>{d.close();fs.rmSync(dir,{recursive:true,force:true})})
 const row={id:'fixture',version:1,status:'candidate',type:'semantic'}
 await d.store.commit([{row,expected:0}],{op:'fixture'})
 await assert.rejects(d.store.commit([{row:{...row,version:2},expected:0},{row:{...row,id:'other'},expected:0}],{op:'conflict'}),/revision_conflict/)
 assert.equal(await d.store.get('other'),null);assert.equal((await d.store.get('fixture')).version,1)
 const [a]=await d.store.audit('fixture'),{hash,previousHash,...event}=a
 const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v
 assert.equal(hash,require('node:crypto').createHash('sha256').update(JSON.stringify(ordered(event))).digest('hex'));assert.equal(previousHash,null)
})
test('actual background interval performs consolidation after receipt drain instead of starving it',async t=>{
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-timer-'),text='I prefer test reports to start with the conclusion.'
 const adapter={providerName:'local',complete:async(p,o)=>({text:JSON.stringify(o.invocationPhase==='memory_extract'?{quotes:[text]}:{candidates:[{kind:'preference',subject:'Test report',text,quote:text,reason:'Explicit fixture statement',supersedes:null,taskState:null}]})})}
 const x=require('../../src/localBrain/learning').createLearning({dir,adapter});t.after(()=>{x.close();fs.rmSync(dir,{recursive:true,force:true})})
 x.runtime.event('conversation','timer',text,'owner_statement');x.start()
 await new Promise(r=>setTimeout(r,5500));x.runtime.stop()
 assert.equal((await x.gateway.list(require('../../src/memory/governed').OWNER,{status:'candidate'})).length,1)
})
test('isolated memory routes do not expose grants, business workers, credentials or maintenance',()=>{
 const {learningRequestAllowed:allowed}=require('../../src/localBrain/server')
 const req=op=>({method:'POST',path:'/api/v1/memory/catalog',body:{op}})
 for(const op of ['grant','backup','rebuild_index','working','finish','procedure','shell','deploy'])assert.equal(allowed(req(op),true),false)
 for(const op of ['recall','index','consolidate','reflect','transition']){assert.equal(allowed(req(op),true),true);assert.equal(allowed(req(op),false),false)}
 assert.equal(allowed({method:'POST',path:'/api/v1/agent-memory',body:{op:'recall'}},true),false)
})
test('parallel memory requests cannot create two in-flight model sends',async t=>{
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-parallel-'),{createLearning}=require('../../src/localBrain/learning');let sent=0,release
 const done=new Promise(r=>release=r),x=createLearning({dir,adapter:{providerName:'local',complete:async()=>{sent++;await done;return {text:JSON.stringify({quotes:['I prefer concise reports.']})}}}})
 t.after(()=>{x.close();fs.rmSync(dir,{recursive:true,force:true})})
 const e=x.engine.forScope('private:owner'),id='xx-'+require('node:crypto').randomUUID(),first=e.retain(id,'I prefer concise reports.')
 await assert.rejects(e.retain(id,'I prefer concise reports.'),/local_memory_busy/);release();await first
 assert.equal(sent,1)
})
test('reflection limits are enforced by the host even when a provider ignores the schema',async t=>{
 const dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/learning-reflection-'),{createLocalStore}=require('../../src/localBrain/memoryStore'),database=createLocalStore(dir)
 t.after(()=>{database.close();fs.rmSync(dir,{recursive:true,force:true})})
 const id='xx-'+require('node:crypto').randomUUID(),quote='I prefer concise reports.',valid={text:quote,evidenceIds:[id],quotes:[{id,quote}]};let value
 const engine=require('../../src/localBrain/memoryEngine').createLocalEngine({database,adapter:{providerName:'local',complete:async()=>({text:JSON.stringify(value)})}}).forScope('private:owner')
 const invalid=[{...valid,evidenceIds:Array(31).fill(id)},{...valid,quotes:Array(9).fill({id,quote})},{...valid,text:'x'.repeat(6001)}]
 for(let i=0;i<invalid.length;i++){value=invalid[i];await assert.rejects(engine.reflect('Summarize fixture '+i,[{id,text:quote}]),/memory_invalid_result/)}
 assert.equal(database.inferenceStatus().counts.failed,3)
})
