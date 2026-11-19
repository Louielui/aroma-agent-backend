'use strict'
// Test-only observer. No command/config/environment/timeout changes or retries.
// Raw argv, paths, stdout and stderr never enter the diagnostic event.
const {performance}=require('node:perf_hooks')
function failure(r){
 const text=String(r?.stderr||'')
 if(r?.timedOut||r?.error?.code==='ETIMEDOUT')return 'timeout'
 if(r?.status===0)return null
 if(/could not resolve|name or service not known|temporary failure in name resolution/i.test(text))return 'dns'
 if(/authentication|terminal prompts disabled|could not read username|403|permission denied/i.test(text))return 'authentication_or_denial'
 if(/HTTP\/2|HTTP2|stream .*closed/i.test(text))return 'http_stream'
 if(/connection reset|connection timed out|failed to connect|could not connect/i.test(text))return 'connection'
 return 'unclassified_failure'
}
function wrap(run,{emit=event=>console.error('WSL_TEST_COMMAND '+JSON.stringify(event))}={}){
 return (argv,opts)=>{
  const started=performance.now();let result,error
  try {result=run(argv,opts);return result}catch(e){error=e;throw e}
  finally {
   const git=argv?.[0]==='git',command=git?(argv.includes('clone')?'git_clone':'git_other'):argv?.[0]==='sh'?'fixture_script':'native_other'
   // Clone success and all native failures are observable; no output payloads.
   if(command==='git_clone'||error||result?.status!==0)try{emit({command,elapsedMs:Math.round(performance.now()-started),deadlineMs:Number.isFinite(opts?.timeoutMs)?opts.timeoutMs:null,status:Number.isInteger(result?.status)?result.status:null,threw:!!error,failure:error?'native_exception':failure(result),stdoutBytes:Buffer.byteLength(String(result?.stdout||'')),stderrBytes:Buffer.byteLength(String(result?.stderr||''))})}catch{/* Instrumentation cannot replace the native verdict. */}
  }
 }
}
module.exports={wrap}
