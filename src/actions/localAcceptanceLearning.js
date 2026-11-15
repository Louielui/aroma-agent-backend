'use strict'
// Host-only entry to the existing isolated memory runtime. It never activates a
// budget, approves a candidate, drains the formal backlog or enables capture.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {PROFILE}=require('./localAcceptancePolicy')
async function runIsolatedLearningBatch({budget,dir,source,adapter}){
 const scope=require('./usageBudget').currentScope(),slot=PROFILE.slots[6]
 if(scope?.rootId!==PROFILE.id||scope.turnId!==slot.id||scope.childId!==null||budget.readStatus().id!==PROFILE.id)throw Error('usage_scope_required')
 if(!path.isAbsolute(dir)||!path.resolve(dir).toLowerCase().startsWith(path.resolve('C:/Aroma/local-brain-runtime').toLowerCase()+path.sep)||fs.existsSync(dir))throw Error('fresh_isolated_directory_required')
 if(!source||source.scope!=='private:owner'||source.status!=='active'||source.type!=='preference'||source.id!==PROFILE.learningSource.id||source.version!==PROFILE.learningSource.version||source.hash!==PROFILE.learningSource.hash||crypto.createHash('sha256').update(source.text||'').digest('hex')!==source.hash)throw Error('approved_source_required')
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'acceptance-provenance.json'),JSON.stringify({isolatedFixture:true,originalId:source.id,originalVersion:source.version,originalHash:source.hash,originalSource:source.source,canonicalWrites:false}),{flag:'wx',mode:0o600})
 let learning
 try{
  learning=require('../localBrain/learning').createLearning({dir,adapter,readConversation:async()=>null})
  const queued=learning.runtime.event('conversation','isolated-approved-source-'+source.id,source.text,'owner_statement')
  learning.start()
  const deadline=Date.now()+90000;let candidates=[]
  while(Date.now()<deadline){
   await new Promise(r=>setTimeout(r,100))
   const row=await learning.gateway.get(require('../memory/governed').OWNER,queued.id)
   if(row?.index.state==='unconfirmed'||row?.details?.consolidation?.state==='failed')throw Error('local_background_unconfirmed')
   candidates=await learning.gateway.list(require('../memory/governed').OWNER,{status:'candidate'})
   if(row?.index.state==='saved'&&candidates.length&&!learning.runtime.status().active&&!learning.runtime.consolidation.status().busy)break
  }
  learning.runtime.stop()
  const status=budget.readStatus(),attempts=status.attempts.filter(a=>a.turnId===slot.id)
  if(!candidates.length||attempts.length!==2||attempts.some(a=>a.state!=='succeeded')||(await learning.gateway.preferences(require('../memory/governed').OWNER)).items.length)throw Error('local_background_acceptance_failed')
  return{sourceId:queued.id,candidates:candidates.map(c=>({id:c.id,version:c.version,status:c.status,text:c.text})),engine:learning.engine.status(),approved:false,canonicalWrites:0,attempts:attempts.length}
 }catch(e){budget.stopOnFailure(e.code||e.message);throw e}
 finally{if(learning){learning.runtime.stop();const until=Date.now()+5000;while((learning.runtime.status().active||learning.runtime.consolidation.status().busy||learning.engine.status().busy)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));learning.close()}}
}
module.exports={runIsolatedLearningBatch}
