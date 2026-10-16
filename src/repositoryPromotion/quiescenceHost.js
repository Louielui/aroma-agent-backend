'use strict'
// Fixed host adapter shared by the external launcher and offline tests. It never
// imports product modules for frozen recovery, nor accepts a caller's PASS flag.
const fs=Object.freeze({...require('node:fs')}),path=require('node:path'),crypto=require('node:crypto')
const processIO=Object.freeze({...require('node:child_process')})
const {createGate}=require('./quiescence'),{createRuntime,install}=require('./quiescenceRuntime'),{installFence}=require('./quiescenceFence')
const digest=b=>crypto.createHash('sha256').update(b).digest('hex')
const interval=globalThis.setInterval,clearIntervalRaw=globalThis.clearInterval
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'))
function checkFile(file,sha256){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||digest(fs.readFileSync(file))!==sha256)throw Error('recovery_identity_changed')}
function verifyRecovery({gate,planFile,planSha256}){
 checkFile(planFile,planSha256)
 const plan=read(planFile),state=gate.status()
 if(state.phase!=='frozen'||plan.run!==state.run||plan.generation!==state.generation||plan.schema!=='quiescence-recovery-v1')throw Error('recovery_gate_changed')
 if(!path.isAbsolute(plan.root||'')||!/^[a-f0-9]{40}$/.test(plan.commit||'')||!/^[a-f0-9]{40}$/.test(plan.tree||''))throw Error('recovery_source_missing')
 const git=args=>processIO.execFileSync('git',['-C',plan.root,...args],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}})
 const identity=git(['rev-parse','HEAD','HEAD^{tree}']).trim().split(/\r?\n/)
 if(identity[0]!==plan.commit||identity[1]!==plan.tree)throw Error('recovery_source_changed')
 for(const key of ['protectedFiles','sourceFiles','launcherFiles','testReceipts'])if(!Array.isArray(plan[key])||!plan[key].length)throw Error('recovery_evidence_missing')
 for(const file of [...plan.protectedFiles,...plan.sourceFiles,...plan.launcherFiles,...plan.testReceipts]){
  if(!path.isAbsolute(file.path||'')||!/^[a-f0-9]{64}$/.test(file.sha256||''))throw Error('recovery_evidence_invalid')
  checkFile(file.path,file.sha256)
 }
 const tracked=git(['ls-files','-z']).split('\0').filter(Boolean).map(file=>path.resolve(plan.root,file)).sort()
 if(JSON.stringify(plan.sourceFiles.map(p=>path.resolve(p.path)).sort())!==JSON.stringify(tracked))throw Error('recovery_source_scope_incomplete')
 const dirty=git(['diff','--no-ext-diff','--no-textconv','--name-only','HEAD','-z']).split('\0').filter(Boolean).sort(),overlays=plan.allowedOverlays||[]
 if(JSON.stringify(dirty)!==JSON.stringify(overlays.map(o=>o.file).sort()))throw Error('recovery_overlay_changed')
 for(const overlay of overlays)checkFile(path.join(plan.root,overlay.file),overlay.sha256)
 if(!Array.isArray(plan.roles)||JSON.stringify([...plan.roles].sort())!==JSON.stringify(['backend','bridge','native']))throw Error('recovery_roles_incomplete')
 if(!Array.isArray(plan.directories)||!plan.directories.length)throw Error('recovery_membership_missing')
 for(const scope of plan.directories){
  const names=[]
  function walk(dir){if(fs.lstatSync(dir).isSymbolicLink())throw Error('recovery_link_forbidden');for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('recovery_link_forbidden');const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(e.isFile())names.push(path.resolve(file))}}
  walk(scope.path)
  if(JSON.stringify(names.sort())!==JSON.stringify(scope.files.map(f=>path.resolve(f)).sort()))throw Error('recovery_membership_changed')
 }
 for(const pin of plan.testReceipts){
  const receipt=read(pin.path)
  if(receipt.producer!=='node-test-isolated'||receipt.exitCode!==0||receipt.failed!==0||receipt.cancelled!==0||receipt.timedOut!==false||!Number.isSafeInteger(receipt.passed)||receipt.passed<1||!Number.isSafeInteger(receipt.skipped)||receipt.skipped<0||receipt.commit!==plan.commit||receipt.tree!==plan.tree)throw Error('recovery_tests_unverified')
  checkFile(receipt.logPath,receipt.logHash)
  const actual=require('./checks').parseTests(fs.readFileSync(receipt.logPath,'utf8'),receipt.exitCode)
  for(const key of ['passed','failed','skipped','cancelled','total','logHash'])if(actual[key]!==receipt[key])throw Error('recovery_tests_unverified')
  if(actual.skipped!==actual.skipNames.length||actual.skipNames.some(name=>!require('./checks').AUTHORIZED_SKIP_NAMES.includes(name)))throw Error('recovery_skips_unauthorized')
 }
 if(git(['rev-parse','HEAD','HEAD^{tree}']).trim().split(/\r?\n/).join(':')!==identity.join(':'))throw Error('recovery_source_changed')
 return{verified:true,receiptHash:digest(Buffer.from(JSON.stringify({planSha256,run:state.run,generation:state.generation,files:[...plan.protectedFiles,...plan.sourceFiles,...plan.launcherFiles,...plan.testReceipts]}))),scope:'static source, exact persistence, launcher and offline regression evidence; application not imported'}
}
function releaseVerified({gate,request,planFile,planSha256}){const observed=gate.status();return gate.release(request,()=>verifyRecovery({gate:{status:()=>observed},planFile,planSha256}))}
function launch({directory,participants,participant,ownerPassword,entry,entryArguments=[],serviceToken,park,internalOrigins,requiredInspectors={backend:['browser-read','browser-operator','durable-runs'],bridge:['bridge-work'],native:['native-operator']}[participant]}){
 const gate=createGate({directory,participants,ownerPassword})
 let state
 try{state=gate.status()}catch(e){return park({state:'unavailable',reason:e.message})}
 if(state.phase!=='open')return park({state:state.phase})
 const runtime=createRuntime({gate,participant,requiredInspectors}),uninstall=install(runtime),restore=installFence(runtime,{serviceToken,controlDirectory:directory,internalOrigins})
 // The lease acquisition is a second atomic check after the initial observation.
 // If prepare won the race, entry is never evaluated.
 const started=runtime.run(()=>{if(typeof entry==='function')return entry();process.argv=[process.execPath,entry,...entryArguments];return require('node:module')._load(entry,null,true)},{kind:'startup'})
 const observer=interval(()=>{try{const s=gate.status();if(s.phase==='draining'&&!s.acknowledged.includes(participant))runtime.acknowledge()}catch(_){}},250);observer.unref()
 return{gate,runtime,started,close(){clearIntervalRaw(observer);restore();uninstall();runtime.close()}}
}
module.exports={launch,verifyRecovery,releaseVerified,checkFile,digest}
