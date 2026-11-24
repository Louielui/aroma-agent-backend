'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {SHA}=require('./policy')
const MANIFEST_BYTES=16*1024*1024,MANIFEST_FILES=131072,RECOVERY_BYTES=512*1024*1024
const BACKUP_VALIDITY_MS=86400000,BACKUP_DEADLINE_MS=240000
const TABLES=['records','audit','principals','access_audit']
const TRACE_PATH=/^local-brain\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/
const hash=value=>crypto.createHash('sha256').update(value).digest('hex')
const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value)
function inside(root,file){const relative=path.relative(path.resolve(root),path.resolve(file));if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.realpathSync(file).toLowerCase()!==path.resolve(file).toLowerCase())throw Error('readiness_path_unconfirmed')}
function json(file,max=2000000,limitReason='readiness_evidence_unavailable'){
 const stat=fs.lstatSync(file)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('readiness_evidence_unavailable')
 if(stat.size>max)throw Error(limitReason)
 const fd=fs.openSync(file,'r')
 try{
  const opened=fs.fstatSync(fd)
  if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size||opened.nlink!==1)throw Error('readiness_evidence_changed')
  // One extra byte detects growth without an unbounded read/allocation.
  const bytes=Buffer.alloc(stat.size+1);let length=0,count
  while(length<bytes.length&&(count=fs.readSync(fd,bytes,length,bytes.length-length,length))>0)length+=count
  const after=fs.fstatSync(fd)
  if(length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||after.nlink!==1)throw Error('readiness_evidence_changed')
  return JSON.parse(bytes.subarray(0,length).toString('utf8'))
 }finally{fs.closeSync(fd)}
}
async function fileHash(file,zeroFilled=false){
 const digest=crypto.createHash('sha256')
 for await(const part of fs.createReadStream(file)){
  if(zeroFilled&&part.some(byte=>byte!==0))throw Error('backup_restore_proof_unconfirmed')
  digest.update(part)
 }
 return digest.digest('hex')
}
function confirmBackupWindow(worker,format){
 const finished=Date.parse(worker.finishedAt),now=Date.now()
 const originalExpiry=finished+BACKUP_VALIDITY_MS
 const expires=worker.expiresAt===undefined?originalExpiry:Date.parse(worker.expiresAt)
 if(!Number.isFinite(finished)||finished>now||!Number.isFinite(expires)||expires>originalExpiry||expires<=now)throw Error('backup_restore_proof_unconfirmed')
 if(format===2){
  const elapsed=worker.elapsedMs??worker.backupOrigin?.elapsedMs
  if(worker.expiresAt===undefined||!Number.isSafeInteger(elapsed)||elapsed<1||elapsed>BACKUP_DEADLINE_MS||
     (worker.deadlineMs!==undefined&&worker.deadlineMs!==BACKUP_DEADLINE_MS))throw Error('backup_restore_proof_unconfirmed')
 }
}
function confirmTables(worker,manifest){
 if(manifest.format===2&&(worker.restored.tables!==TABLES.length||worker.recovery.files!==manifest.files.length))
  throw Error('backup_restore_proof_unconfirmed')
 for(const table of TABLES){
  const count=worker.saved.counts?.[table]
  if(!Number.isSafeInteger(count)||count<0||count!==manifest.canonical.tables?.[table]||
     count!==worker.filesRestored.tables?.[table]||
     (manifest.format===2&&count!==worker.recovery.tables?.[table]))throw Error('backup_restore_proof_unconfirmed')
 }
}
function manifestFileEntries(manifest){
 if(!manifest||typeof manifest!=='object'||!Array.isArray(manifest.files))throw Error('backup_restore_proof_unconfirmed')
 if(manifest.files.length>MANIFEST_FILES)throw Error('readiness_manifest_limit')
 if(manifest.format===undefined||manifest.format===1)return manifest.files
 if(manifest.format!==2)throw Error('backup_restore_proof_unconfirmed')
 return manifest.files.map(row=>{
  if(!Array.isArray(row)||(row.length!==3&&row.length!==4)||(row.length===4&&row[3]!=='zero_filled_trace'))throw Error('backup_restore_proof_unconfirmed')
  const [path,sha256,bytes,contentState]=row
  return contentState===undefined?{path,sha256,bytes}:{path,sha256,bytes,contentState}
 })
}
async function validateReadiness({artifacts,readinessId,commit,tree},dependencies={}){
 if(!SHA.test(commit||'')||!SHA.test(tree||'')||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(readinessId||''))throw Error('invalid_readiness_identity')
 const directory=path.join(artifacts,'readiness',readinessId),requestFile=path.join(directory,'request.json');inside(path.join(artifacts,'readiness'),requestFile)
 const request=json(requestFile)
 if(request.commit!==commit||request.tree!==tree||request.id!==readinessId||!Number.isFinite(Date.parse(request.createdAt))||Date.now()-Date.parse(request.createdAt)>86400000||Date.parse(request.createdAt)>Date.now()+30000)throw Error('readiness_evidence_stale')
 const workerFile=path.join(directory,'backup-worker.json'),baselineFile=path.join(directory,'memory-baselines.json');inside(directory,workerFile);inside(directory,baselineFile)
 if(await fileHash(workerFile)!==request.backupReceiptHash||await fileHash(baselineFile)!==request.baselineFileHash)throw Error('readiness_evidence_changed')
 const worker=json(workerFile),baselines=json(baselineFile),backupRoot=dependencies.backupRoot||'C:/Aroma/hindsight-runtime/backups'
 const bundle=path.dirname(worker.path),manifestFile=path.join(bundle,'manifest.json');inside(backupRoot,manifestFile);inside(backupRoot,worker.path)
 const sealed=json(manifestFile,MANIFEST_BYTES,'readiness_manifest_limit'),manifest=sealed?.manifest
 const entries=manifestFileEntries(manifest)
 let recoveryBytes=0
 for(const entry of entries){
  if(!entry||typeof entry!=='object'||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>RECOVERY_BYTES||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw Error('backup_restore_proof_unconfirmed')
  recoveryBytes+=entry.bytes;if(recoveryBytes>RECOVERY_BYTES)throw Error('backup_restore_proof_unconfirmed')
 }
 if(hash(canonical(manifest))!==sealed.sha256||sealed.sha256!==worker.recovery?.manifestHash||worker.saved?.state!=='saved'||worker.restored?.state!=='verified'||worker.recovery?.state!=='verified'||worker.filesRestored?.state!=='isolated_files_restored'||worker.saved.sha256!==worker.restored.sha256||worker.restored.database!=='xiangxiang_restore_'+worker.saved.sha256.slice(0,12)||manifest.canonical?.file!=='canonical.json'||!Array.isArray(manifest.files)||worker.filesRestored.files!==manifest.files.length)throw Error('backup_restore_proof_unconfirmed')
 confirmBackupWindow(worker,manifest.format)
 confirmTables(worker,manifest)
 if(await fileHash(worker.path)!==manifest.canonical.sha256)throw Error('backup_restore_proof_unconfirmed')
 const restore=worker.filesRestored.path;inside(backupRoot,path.join(restore,'canonical.json'))
 if(await fileHash(path.join(restore,'canonical.json'))!==manifest.canonical.sha256)throw Error('backup_restore_proof_unconfirmed')
 const seen=new Set()
 let markedTraces=0
 for(const entry of entries){
  if(typeof entry.path!=='string'||entry.path.includes('\\')||entry.path.split('/').includes('..')||path.isAbsolute(entry.path)||seen.has(entry.path)||!(/^(?:memory-outbox|memory-capture|memory-consolidation|conversations)\/.+\.json$/.test(entry.path)||['company-access.json','model-center-local.json','memory-local-index/memory.sqlite'].includes(entry.path)||TRACE_PATH.test(entry.path)))throw Error('readiness_path_unconfirmed')
  const marked=Object.hasOwn(entry,'contentState')
  if(marked){
   if(entry.contentState!=='zero_filled_trace'||entry.bytes===0||!TRACE_PATH.test(entry.path))throw Error('backup_restore_proof_unconfirmed')
   markedTraces++
  }
  seen.add(entry.path);const restoredFile=path.join(restore,'data',entry.path);inside(restore,restoredFile)
  const objectFile=path.join(bundle,'objects',entry.sha256);inside(bundle,objectFile)
  if(fs.statSync(restoredFile).size!==entry.bytes||await fileHash(restoredFile,marked)!==entry.sha256||fs.statSync(objectFile).size!==entry.bytes||await fileHash(objectFile,marked)!==entry.sha256)throw Error('backup_restore_proof_unconfirmed')
 }
 if((markedTraces||manifest.format===2)&&((worker.recovery.zeroFilledTraceFiles??0)!==markedTraces||(worker.filesRestored.zeroFilledTraceFiles??0)!==markedTraces))throw Error('backup_restore_proof_unconfirmed')
 if(!Array.isArray(baselines.baselines)||baselines.baselines.length<1||baselines.baselines.length>3)throw Error('memory_baseline_unconfirmed')
 let readRecord=dependencies.readRecord,readIndex=dependencies.readIndex
 if(!readRecord||!readIndex){const runtime='C:/Aroma/aroma-agent-backend',env=require('dotenv').parse(fs.readFileSync(path.join(runtime,'.env'))),store=require('../memory/structuredStore').createStructuredStore({env}),engine=require('../memory/hindsight').createHindsight({env});readRecord= id=>store.get(id);readIndex=(scope,id)=>engine.forScope(scope).get(id)}
 for(const baseline of baselines.baselines){const expected=baseline.record;if(expected?.scope!=='private:owner'||!/^xx-[a-f0-9-]{36}$/.test(expected.id||''))throw Error('memory_baseline_unconfirmed');const r=await readRecord(expected.id),indexed=await readIndex(expected.scope,expected.id)
  if(r?.status!=='active'||r.scope!=='private:owner'||r.source?.attribution!=='owner_statement'||r.version!==expected.version||r.supersededBy||r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()||hash(r.text)!==expected.textSha256||JSON.stringify(r.source)!==JSON.stringify(expected.source)||JSON.stringify(r.approval)!==JSON.stringify(expected.approval)||r.index.state!=='saved'||indexed?.id!==r.id||hash(indexed.text)!==expected.textSha256||indexed.facts!==expected.index.facts)throw Error('memory_baseline_changed')
 }
 confirmBackupWindow(worker,manifest.format)
 return{readinessId,hash:hash(canonical(request)),backupSnapshot:worker.saved.sha256,backupManifest:sealed.sha256,files:manifest.files.length,baselineHashes:baselines.baselines.map(b=>({id:b.record.id,version:b.record.version,hash:b.record.textSha256}))}
}
module.exports={validateReadiness,canonical,fileHash,manifestFileEntries}
