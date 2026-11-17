'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto')
const {validateReadiness,canonical}=require('./readiness'),hash=s=>crypto.createHash('sha256').update(s).digest('hex')
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'promotion-ready-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const id=crypto.randomUUID(),directory=path.join(root,'readiness',id),bundle=path.join(root,'backups','bundle'),restore=path.join(root,'backups','isolated'),contents='{"fixture":true}',bytes=Buffer.from(contents),file='conversations/example.json',canonicalBytes=Buffer.from('{"snapshot":"fixture only"}'),counts={records:1,audit:1,principals:0,access_audit:0},snapshotHash='d'.repeat(64)
 fs.mkdirSync(path.join(bundle,'objects'),{recursive:true});fs.mkdirSync(path.join(restore,'data','conversations'),{recursive:true});fs.mkdirSync(directory,{recursive:true})
 fs.writeFileSync(path.join(bundle,'canonical.json'),canonicalBytes);fs.writeFileSync(path.join(restore,'canonical.json'),canonicalBytes);fs.writeFileSync(path.join(bundle,'objects',hash(bytes)),bytes);fs.writeFileSync(path.join(restore,'data',file),bytes)
 const manifest={canonical:{file:'canonical.json',sha256:hash(canonicalBytes),tables:counts},files:[{path:file,sha256:hash(bytes),bytes:bytes.length}]},manifestHash=hash(canonical(manifest))
 fs.writeFileSync(path.join(bundle,'manifest.json'),JSON.stringify({sha256:manifestHash,manifest}))
 const worker={path:path.join(bundle,'canonical.json'),finishedAt:new Date().toISOString(),saved:{state:'saved',sha256:snapshotHash,counts},restored:{state:'verified',sha256:snapshotHash,database:'xiangxiang_restore_'+snapshotHash.slice(0,12)},recovery:{state:'verified',manifestHash},filesRestored:{state:'isolated_files_restored',path:restore,files:1,tables:counts}}
 const record={id:'xx-00000000-0000-4000-8000-000000000001',version:4,status:'active',scope:'private:owner',source:{attribution:'owner_statement',at:'2026-09-29'},approval:{kind:'policy'},index:{state:'saved',facts:1},text:'Fictional test code blue'}
 const baselines={baselines:[{record:{...record,textSha256:hash(record.text)}}]},workerBytes=Buffer.from(JSON.stringify(worker)),baselineBytes=Buffer.from(JSON.stringify(baselines)),request={id,commit:'a'.repeat(40),tree:'b'.repeat(40),createdAt:new Date().toISOString(),backupReceiptHash:hash(workerBytes),baselineFileHash:hash(baselineBytes)}
 fs.writeFileSync(path.join(directory,'backup-worker.json'),workerBytes);fs.writeFileSync(path.join(directory,'memory-baselines.json'),baselineBytes);fs.writeFileSync(path.join(directory,'request.json'),JSON.stringify(request))
 return{root,directory,bundle,restore,request,record,options:{artifacts:root,readinessId:id,commit:request.commit,tree:request.tree},deps:{backupRoot:path.join(root,'backups'),readRecord:async()=>record,readIndex:async()=>({id:record.id,text:record.text,facts:1})}}
}
test('readiness verifies backup and restored bytes independently and binds existing canonical memory revision',async t=>{const f=fixture(t),value=await validateReadiness(f.options,f.deps);assert.equal(value.files,1);assert.equal(value.baselineHashes[0].version,4)})
test('local index recovery verifies every restored and archived byte without accepting arbitrary paths',async t=>{
 const f=fixture(t),workerFile=path.join(f.directory,'backup-worker.json'),worker=JSON.parse(fs.readFileSync(workerFile)),sealed=JSON.parse(fs.readFileSync(path.join(f.bundle,'manifest.json')))
 for(const file of ['model-center-local.json','memory-local-index/memory.sqlite','local-brain/'+crypto.randomUUID()+'.json']){const bytes=Buffer.from(file.endsWith('sqlite')?'isolated sqlite byte fixture':'{}');fs.mkdirSync(path.dirname(path.join(f.restore,'data',file)),{recursive:true});fs.writeFileSync(path.join(f.restore,'data',file),bytes);fs.writeFileSync(path.join(f.bundle,'objects',hash(bytes)),bytes);sealed.manifest.files.push({path:file,bytes:bytes.length,sha256:hash(bytes)})}
 sealed.sha256=hash(canonical(sealed.manifest));worker.recovery.manifestHash=sealed.sha256;worker.filesRestored.files=4;fs.writeFileSync(path.join(f.bundle,'manifest.json'),JSON.stringify(sealed));const bytes=JSON.stringify(worker);fs.writeFileSync(workerFile,bytes);f.request.backupReceiptHash=hash(bytes);fs.writeFileSync(path.join(f.directory,'request.json'),JSON.stringify(f.request))
 assert.equal((await validateReadiness(f.options,f.deps)).files,4)
 fs.writeFileSync(path.join(f.restore,'data','memory-local-index','memory.sqlite'),'damaged');await assert.rejects(validateReadiness(f.options,f.deps),/backup_restore_proof_unconfirmed/)
})
test('changed candidate, altered backup objects, damaged restored files or stale memory fail before authority',async t=>{for(const kind of ['sha','object','restore','memory']){const f=fixture(t);if(kind==='sha')f.options.commit='c'.repeat(40);if(kind==='object')fs.writeFileSync(path.join(f.bundle,'objects',hash('{"fixture":true}')),'broken');if(kind==='restore')fs.writeFileSync(path.join(f.restore,'data','conversations','example.json'),'broken');if(kind==='memory')f.record.version++;await assert.rejects(validateReadiness(f.options,f.deps),/readiness_evidence_stale|backup_restore_proof_unconfirmed|memory_baseline_changed/)}})
test('local recovery additions cannot admit credentials, arbitrary index files or path traversal',async t=>{
 for(const name of ['.env','memory-local-index/private.json','local-brain/password.json','local-brain/../secret.json','model-center-local.json/secret','local-brain/'+crypto.randomUUID()+'.json:ads']){
  const f=fixture(t),manifestFile=path.join(f.bundle,'manifest.json'),workerFile=path.join(f.directory,'backup-worker.json'),sealed=JSON.parse(fs.readFileSync(manifestFile)),worker=JSON.parse(fs.readFileSync(workerFile))
  sealed.manifest.files.push({path:name,bytes:2,sha256:hash('{}')});sealed.sha256=hash(canonical(sealed.manifest));worker.recovery.manifestHash=sealed.sha256;worker.filesRestored.files=2;fs.writeFileSync(manifestFile,JSON.stringify(sealed));const bytes=JSON.stringify(worker);fs.writeFileSync(workerFile,bytes);f.request.backupReceiptHash=hash(bytes);fs.writeFileSync(path.join(f.directory,'request.json'),JSON.stringify(f.request))
  await assert.rejects(validateReadiness(f.options,f.deps),/readiness_path_unconfirmed/)
 }
})

function reseal(f,change){
 const manifestFile=path.join(f.bundle,'manifest.json'),workerFile=path.join(f.directory,'backup-worker.json'),sealed=JSON.parse(fs.readFileSync(manifestFile)),worker=JSON.parse(fs.readFileSync(workerFile))
 change(sealed.manifest,worker);sealed.sha256=hash(canonical(sealed.manifest));worker.recovery.manifestHash=sealed.sha256
 fs.writeFileSync(manifestFile,JSON.stringify(sealed));const bytes=JSON.stringify(worker);fs.writeFileSync(workerFile,bytes);f.request.backupReceiptHash=hash(bytes);fs.writeFileSync(path.join(f.directory,'request.json'),JSON.stringify(f.request))
}

test('an Owner-authorized current-size manifest verifies all 40349 assets including the last restored byte',async t=>{
 const f=fixture(t),bytes=Buffer.from('{}'),digest=hash(bytes),count=40349;fs.writeFileSync(path.join(f.bundle,'objects',digest),bytes)
 let last
 reseal(f,(manifest,worker)=>{
  for(let i=1;i<count;i++){last='conversations/'+String(i).padStart(16,'0')+'-00000000-0000-4000-8000-000000000001.json';fs.writeFileSync(path.join(f.restore,'data',last),bytes);manifest.files.push({path:last,sha256:digest,bytes:bytes.length})}
  worker.filesRestored.files=count
 })
 assert.ok(fs.statSync(path.join(f.bundle,'manifest.json')).size>2000000)
 assert.ok(fs.statSync(path.join(f.bundle,'manifest.json')).size<=8*1024*1024)
 assert.equal((await validateReadiness(f.options,f.deps)).files,count)
 fs.writeFileSync(path.join(f.restore,'data',last),'!');await assert.rejects(validateReadiness(f.options,f.deps),/backup_restore_proof_unconfirmed/)
})

test('manifest byte and entry ceilings fail closed while other evidence keeps its two MB ceiling',async t=>{
 for(const kind of ['manifest','entries','request','worker','baselines']){
  const f=fixture(t)
  if(kind==='manifest')fs.writeFileSync(path.join(f.bundle,'manifest.json'),' '.repeat(8*1024*1024+1))
  if(kind==='entries'){
   // Keep this below the byte ceiling so it specifically exercises entry count.
   reseal(f,(m,w)=>{m.files=Array.from({length:65537},()=>({path:'x',bytes:0,sha256:'d'.repeat(64)}));w.filesRestored.files=m.files.length})
   assert.ok(fs.statSync(path.join(f.bundle,'manifest.json')).size<=8*1024*1024)
  }
  if(kind==='request')fs.writeFileSync(path.join(f.directory,'request.json'),' '.repeat(2000001))
  if(kind==='worker'||kind==='baselines'){
   const name=kind==='worker'?'backup-worker.json':'memory-baselines.json',bytes=' '.repeat(2000001);fs.writeFileSync(path.join(f.directory,name),bytes)
   f.request[kind==='worker'?'backupReceiptHash':'baselineFileHash']=hash(bytes);fs.writeFileSync(path.join(f.directory,'request.json'),JSON.stringify(f.request))
  }
  await assert.rejects(validateReadiness(f.options,f.deps),kind==='manifest'||kind==='entries'?/readiness_manifest_limit/:/readiness_evidence_unavailable/)
 }
})

test('sealed manifests cannot conceal malformed asset sizes, digests or aggregate size',async t=>{
 for(const kind of ['negative','fraction','unsafe','over_asset','aggregate','digest']){
  const f=fixture(t)
  reseal(f,(m,w)=>{
   if(kind==='digest')m.files[0].sha256='../canonical.json'
   else if(kind==='aggregate'){m.files=[{...m.files[0],bytes:512*1024*1024},{...m.files[0],path:'conversations/other.json',bytes:1}];w.filesRestored.files=2}
   else m.files[0].bytes={negative:-1,fraction:1.5,unsafe:Number.MAX_SAFE_INTEGER+1,over_asset:512*1024*1024+1}[kind]
  })
  await assert.rejects(validateReadiness(f.options,f.deps),/backup_restore_proof_unconfirmed/)
 }
})
