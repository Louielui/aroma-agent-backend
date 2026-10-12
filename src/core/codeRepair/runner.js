'use strict'
const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process'),{randomUUID}=require('node:crypto')
const {cleanEnvironment}=require('../../subscription/codexClient')
// Exact reviewed committed inputs and host-authored recipe output only.
// Models select enums; arbitrary model JavaScript never reaches this runner.
// No network-isolation claim: the Windows loopback negative probe failed.
async function runAcceptance ({dir}) {
 const probe=path.join(path.dirname(dir),'repair-boundary-'+randomUUID()+'.txt');fs.writeFileSync(probe,'nonsecret boundary canary',{flag:'wx'})
 const command=['--permission','--allow-fs-read='+dir,'--allow-fs-write='+path.join(dir,'scratch')]
 const execute=args=>new Promise((resolve,reject)=>execFile(process.execPath,[...command,...args],{cwd:dir,env:cleanEnvironment(process.env),windowsHide:true,timeout:30000,maxBuffer:50000,encoding:'utf8'},(error,stdout,stderr)=>error && !Number.isInteger(error.code)?reject(Error('test_evidence_unavailable')):resolve({exitCode:error?error.code:0,stdout,stderr})))
 try {
  const code="let n=0;for(const f of [()=>require('fs').readFileSync("+JSON.stringify(probe)+"),()=>require('fs').writeFileSync("+JSON.stringify(probe)+",'changed'),()=>require('child_process').spawn('cmd'),()=>new (require('worker_threads').Worker)('0',{eval:true})]){try{f()}catch(e){if(e.code==='ERR_ACCESS_DENIED')n++}}process.exit(n===4?0:1)"
  if((await execute(['-e',code])).exitCode!==0||fs.readFileSync(probe,'utf8')!=='nonsecret boundary canary')throw Error('sandbox_failed')
  const scratch=path.join(dir,'scratch');if(fs.realpathSync(scratch)!==path.join(fs.realpathSync(dir),'scratch'))throw Error('scope_changed')
  for(const name of fs.readdirSync(scratch)){const target=path.join(scratch,name);if(!path.resolve(target).startsWith(path.resolve(scratch)+path.sep))throw Error('scope_changed');fs.rmSync(target,{recursive:true,force:true})}
  const result=await execute(['--test','--test-isolation=none','--test-reporter=tap','acceptance.test.js']),count=name=>Number(result.stdout.match(new RegExp('^# '+name+' (\\d+)$','m'))?.[1])
  if(!Number.isFinite(count('tests')))throw Error('test_evidence_unavailable')
  return {...result,tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped'),cancelled:count('cancelled'),boundary:{outsideReadDenied:true,outsideWriteDenied:true,childProcessDenied:true,workerThreadsDenied:true,networkIsolation:'not_provided',executableOrigin:'reviewed_committed_hashes_and_host_fixed_recipes_only',arbitraryWorkerCode:false},at:new Date().toISOString()}
 }finally{fs.unlinkSync(probe)}
}
module.exports={runAcceptance}
