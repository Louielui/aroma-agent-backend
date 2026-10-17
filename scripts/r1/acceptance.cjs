'use strict'
// Explicit offline acceptance only. Business transports are synthetic; inference
// uses the existing locked ChatGPT-subscription client, with no API-credit fallback.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),{createHash}=require('node:crypto')
const sha=x=>createHash('sha256').update(x).digest('hex')
async function main(){
 const [directory,executable]=process.argv.slice(2),root=path.resolve(__dirname,'../..')
 if(!path.isAbsolute(directory||'')||!path.isAbsolute(executable||'')||fs.existsSync(directory))throw Error('fresh_evidence_and_subscription_executable_required')
 const git=a=>cp.execFileSync('git',a,{cwd:root,encoding:'utf8',windowsHide:true}).trim()
 if(git(['status','--porcelain']))throw Error('clean_candidate_required')
 const source={commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}'])};fs.mkdirSync(directory)
 const client=require('../../src/subscription/codexClient'),model='gpt-6-astra',effort='high',results=[],persistence=[]
 const disposable=fs.mkdtempSync(path.join(os.tmpdir(),'r1-source-fixtures-'));process.env.AROMA_DATA_DIR=path.join(disposable,'data');process.env.AROMA_ARTIFACT_DIR=path.join(disposable,'artifacts')
 for(const c of [{id:'English-goal-Chinese-reply',goal:'Find a tea quotation in Drive and investigate related Aroma invoices.',reply:'第二份，紅茶那份。'},{id:'Chinese-goal-English-reply',goal:'請找 Drive 的茶葉報價，再用選中文件的線索調查相關 Aroma 發票，整理兩邊紀錄及未確認的關係。',reply:'The second one, the black tea quotation, please.'}]){
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'r1-accept-'))
  const options={executable,cwd,allowCredits:false,timeoutMs:180000},invocations=[]
  const f=await require('./fixture.cjs').fixture({transport:async(route,input,signal)=>{
   const out=route==='/status'?await client.checkSubscription({...options,signal,model:input.model,effort:input.effort}):await client.complete({...options,signal},{prompt:input.prompt,system:input.system,model:input.model,effort:input.effort})
   if(out.model!==model||out.billing!=='chatgpt-subscription')throw Error('subscription_identity_changed')
   invocations.push({route,...input,response:out,toolsEnabled:false});return {...out,actualModel:out.model}
  }})
  f.start.message=c.goal
  const dialogue=[],snapshots=[];let first,answer,body,error=null,replayNoReads=false
  try{
   first=await f.post(f.start);if(first.status!==200)throw Error(first.body.error||'start_failed')
   const v=first.body.unifiedTask;dialogue.push({owner:c.goal,xiangxiang:first.body.reply});snapshots.push(f.tasks.getTask(v.taskId))
   if(v.executionState!=='WAITING_CLARIFICATION'||f.calls.length!==1)throw Error('waiting_clarification_not_reached')
   body=f.reply(v,c.reply);answer=await f.post(body);dialogue.push({owner:c.reply,xiangxiang:answer.body.reply});snapshots.push(f.tasks.getTask(v.taskId))
   const before=f.calls.length;await f.post(body);replayNoReads=before===f.calls.length
  }catch(e){error=e.message}finally{await f.close()}
  const v=answer?.body?.unifiedTask||first?.body?.unifiedTask,readRecords=f.reads.all().filter(r=>r.unifiedTask?.taskId===v?.taskId),record=v?.executionRef&&f.reads.get(v.executionRef.id),e=record?.result?.taskEvidence
  const checks={realAppOwnerLogin:true,sameTaskGoal:!!v&&snapshots.every(t=>t.id===v.taskId&&t.ownerGoal.goalId===v.goalId&&t.ownerGoal.originalObjective===c.goal),
   authoritativeSelectionGoal:e?.selection?.goal?.goalId===v?.goalId,fiveReads:f.calls.length===5&&v?.clarification?.reads===5,
   selectedA:f.calls[2]?.input.fileId===f.ids[1],derivedBQuery:f.calls[3]?.input.query==='INV-BLACK-29'&&e?.execution?.handoff?.value==='INV-BLACK-29',selectedB:f.calls[4]?.input.sourceId===f.invoiceId,
   replayNoReads,trackedReads:readRecords.flatMap(r=>r.timeline.filter(t=>t.stage==='u2_read_started')).length===f.calls.length,
   subscriptionIdentity:invocations.every(i=>i.model===model&&i.effort===effort&&i.response.model===model&&i.response.billing==='chatgpt-subscription'),
   longDocument:f.detailRows['drive.company_files'][1].text.length>5000,explicitOmissions:e?.synthesis?.report?.sections[0]?.projection?.omittedCharacters>0,
   groundedBothSources:e?.synthesis?.state==='reviewed'&&new Set(e.synthesis.claims.flatMap(c=>c.references.map(r=>r.sourceId))).size===2,
   honestGoal:v?.investigation?.groundedAnswer===true&&v.investigation.goalVerifiedComplete===false&&v.goalStatus!=='GOAL_COMPLETED',
   noTransactionClaim:e?.execution?.handoff?.transactionRelationship==='not_established',clarificationCompleted:v?.executionState==='CLARIFICATION_COMPLETED'}
  const result={...source,case:c.id,model,effort,billing:'chatgpt-subscription',data:'synthetic_disposable_only',realAppComposition:'src/app.js#createApp; /owner/login; /api/v1/demo/task-intake',goal:c.goal,dialogue,checks,error,structuralPass:!error&&Object.values(checks).every(Boolean),invocations,actualAdapterCalls:f.calls,gatewayAudit:f.audit,taskSnapshots:snapshots,readRecords,finalEvidence:e||null,finalProjection:v||null}
  const file='case-'+c.id+'.json';fs.writeFileSync(path.join(directory,file),JSON.stringify(result,null,2),{flag:'wx'})
  results.push({case:c.id,file,sha256:sha(fs.readFileSync(path.join(directory,file))),structuralPass:result.structuralPass,checks,dialogue})
  for(const file of ['aroma-truth.json',...fs.readdirSync(path.join(process.env.AROMA_DATA_DIR,'browser-context-reads')).map(n=>'browser-context-reads/'+n)]){
   const bytes=fs.readFileSync(path.join(process.env.AROMA_DATA_DIR,file)),out=c.id+'-'+file.replaceAll('/','-');fs.writeFileSync(path.join(directory,out),bytes,{flag:'wx'});persistence.push({file:out,sha256:sha(bytes)})
  }
  console.log(JSON.stringify({case:c.id,checks,dialogue,error}));if(!result.structuralPass)break
 }
 const receipt={...source,model,effort,billing:'chatgpt-subscription',counts:{planned:2,run:results.length,passed:results.filter(r=>r.structuralPass).length,failed:results.filter(r=>!r.structuralPass).length,notRun:2-results.length},sourceUnchanged:git(['rev-parse','HEAD'])===source.commit&&!git(['status','--porcelain']),results,persistence,at:new Date().toISOString()}
 fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({counts:receipt.counts,receiptSha256:sha(fs.readFileSync(path.join(directory,'receipt.json')))}))
 if(receipt.counts.passed!==2||!receipt.sourceUnchanged)process.exitCode=1
}
main().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1})
