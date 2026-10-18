'use strict'
// Explicit source/fragment-injected checks. Never executes the Monitor script or real event/job cmdlets.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto')
const root=process.env.R1_MONITOR_CLEANUP_FIXTURE
assert.ok(root&&path.isAbsolute(root),'explicit disposable fragment fixture required')
const monitor=fs.readFileSync(root+'/process-monitor.ps1','utf8'),before=fs.readFileSync(root+'/process-monitor.before.ps1','utf8'),hash=b=>crypto.createHash('sha256').update(b).digest('hex')
assert.ok(monitor.includes("$ownedSources=[System.Collections.Generic.List[string]]::new()"),'owned-source cleanup contract required')
const ps='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',registration=s=>s.slice(s.indexOf('try {\n')+6,s.indexOf('  $self=Get-Process')),cleanup=s=>s.slice(s.lastIndexOf('} finally {')+11,s.lastIndexOf('}')).trim()
assert.ok(registration(monitor).includes('Register-CimIndicationEvent'));assert.ok(cleanup(monitor).includes('monitor_cleanup_failed'))
const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',COMSPEC:'C:\\Windows\\System32\\cmd.exe',PATH:'C:\\Windows\\System32',HOME:root,USERPROFILE:root,TEMP:root,TMP:root};let sequence=0
function execute(config={},legacy=false){
 const source=legacy?before:monitor,reg=registration(source),final=cleanup(source),fixture=Buffer.from(JSON.stringify(config)).toString('base64')
 let harness=String.raw`$ErrorActionPreference='Stop'
$cfg=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__FIXTURE__'))|ConvertFrom-Json
$subs=@{};foreach($n in @($cfg.existingSubscriptions)){if($null-ne $n){$subs[$n]=$true}}
$queue=[System.Collections.Generic.List[object]]::new();foreach($e in @($cfg.initialEvents)){if($null-ne $e){$queue.Add($e)}}
$jobs=@('unrelated-background','unrelated-event-action','unrelated-workflow')
$calls=[System.Collections.Generic.List[object]]::new();$nextId=100;$failure=$null
function Register-CimIndicationEvent {[CmdletBinding()]param([string]$Namespace,[string]$Query,[string]$SourceIdentifier)
 $calls.Add(@{cmd='register';source=$SourceIdentifier;query=$Query;namespace=$Namespace})
 if($subs.ContainsKey($SourceIdentifier)-or $cfg.registrationFailure-eq $SourceIdentifier){throw ('synthetic_registration_failure:'+ $SourceIdentifier)}
 $subs[$SourceIdentifier]=$true;$queue.Add([PSCustomObject]@{SourceIdentifier=$SourceIdentifier;EventIdentifier=$script:nextId});$script:nextId++
 if($cfg.returnSubscription){[PSCustomObject]@{syntheticType='EventSubscription';SourceIdentifier=$SourceIdentifier}}
}
function Unregister-Event {[CmdletBinding()]param([string]$SourceIdentifier)
 $calls.Add(@{cmd='unregister';source=$SourceIdentifier})
 if($cfg.unregisterFailure-eq $SourceIdentifier){throw ('synthetic_unregister_failure:'+ $SourceIdentifier)}
 if(-not $subs.ContainsKey($SourceIdentifier)){throw 'synthetic_subscription_absent'}
 [void]$subs.Remove($SourceIdentifier)
}
function Get-Event {[CmdletBinding()]param()
 $calls.Add(@{cmd='get-event'})
 if($cfg.queueReadFailure-and @($calls|Where-Object {$_.cmd-eq 'unregister'}).Count-gt 0){throw 'synthetic_queue_read_failure'}
 if($cfg.queueBeforeRegistrationFailure-and @($calls|Where-Object {$_.cmd-eq 'register'}).Count-eq 0){throw 'synthetic_initial_queue_failure'}
 foreach($e in $queue.ToArray()){$e}
}
function Remove-Event {[CmdletBinding()]param([int]$EventIdentifier)
 $calls.Add(@{cmd='remove-event';id=$EventIdentifier})
 if($cfg.removeFailure-and $EventIdentifier-eq 100){throw 'synthetic_event_remove_failure'}
 $e=@($queue.ToArray()|Where-Object {$_.EventIdentifier-eq $EventIdentifier});if($e.Count-ne 1){throw 'synthetic_event_id_ambiguous'}
 [void]$queue.Remove($e[0])
}
function Get-Job {[CmdletBinding()]param();$calls.Add(@{cmd='get-job'});throw 'SYNTHETIC WorkflowJobSourceAdapter: The Persistence Path does not exist.'}
function Remove-Job {[CmdletBinding()]param([Parameter(ValueFromPipeline=$true)]$InputObject);process{$calls.Add(@{cmd='remove-job'});throw 'unrelated_job_removal_forbidden'}}
$ownedSources=[System.Collections.Generic.List[string]]::new()
try {try {
__REGISTRATION__
 if($cfg.bodyFailure){throw 'synthetic_monitor_body_failure'}
} finally {
__CLEANUP__
}}catch{$failure=$_.Exception.Message;[Console]::Error.WriteLine($failure)}
[PSCustomObject]@{evidenceClass='SYNTHETIC FRAGMENTS; NO REAL MONITOR/CIM/JOB';calls=@($calls.ToArray());owned=@($ownedSources.ToArray());remainingSubscriptions=@($subs.Keys|Sort-Object);remainingEvents=@($queue.ToArray());jobs=$jobs;failure=$failure}|ConvertTo-Json -Depth 6 -Compress
if($null-ne $failure){exit 1}
exit 0`.replace('__FIXTURE__',()=>fixture).replace('__REGISTRATION__',()=>reg).replace('__CLEANUP__',()=>final)
 if(config.nativeTerminal){const begin=harness.indexOf('try {try {\n'),end=harness.indexOf('}}catch{$failure=');assert.ok(begin>=0&&end>begin);harness=harness.slice(0,begin)+'& {'+harness.slice(begin+5,end)+'}}';assert.equal(harness.includes('exit 0'),false);assert.equal(harness.includes('exit 1'),false)}
 // All resource-changing commands in the extracted fragments are locally mocked above.
 const argv=['-NoProfile','-NonInteractive','-Command',harness],start=new Date().toISOString(),r=cp.spawnSync(ps,argv,{env,windowsHide:true,encoding:'utf8',maxBuffer:1000000}),end=new Date().toISOString(),name='injected-'+String(++sequence).padStart(2,'0');fs.writeFileSync(root+'/'+name+'.stdout.log',r.stdout??'',{flag:'wx'});fs.writeFileSync(root+'/'+name+'.stderr.log',r.stderr??'',{flag:'wx'});fs.writeFileSync(root+'/'+name+'.json',JSON.stringify({sourceSha256:hash(source),legacy,executable:ps,executableSha256:hash(fs.readFileSync(ps)),argv,pid:r.pid,start,end,exit:r.status,signal:r.signal,error:r.error?.message??null,stdoutSha256:hash(r.stdout??''),stderrSha256:hash(r.stderr??''),config},null,2)+'\n',{flag:'wx'});assert.equal(r.error,undefined);assert.ok(r.status===0||r.status===1,r.stderr);const value=config.nativeTerminal?null:JSON.parse(r.stdout.replace(/^\uFEFF/,''));return {...r,value}
}
const unrelated={existingSubscriptions:['unrelated-subscription'],initialEvents:[{SourceIdentifier:'unrelated-subscription',EventIdentifier:9}]}
function untouched(r){assert.deepEqual(r.value.jobs,['unrelated-background','unrelated-event-action','unrelated-workflow']);assert.equal(r.value.calls.some(x=>x.cmd==='remove-job'),false);assert.equal(r.value.calls.some(x=>x.cmd==='unregister'&&x.source==='unrelated-subscription'),false);assert.equal(r.value.calls.some(x=>x.cmd==='remove-event'&&x.id===9),false)}
test('A/B/C/H — normal owned subscription and queue cleanup is terminal exit 0',()=>{const r=execute(unrelated);assert.equal(r.status,0);assert.equal(r.value.failure,null);assert.equal(r.stderr,'');assert.deepEqual(r.value.owned,['r1-start','r1-stop']);assert.deepEqual(r.value.remainingSubscriptions,['unrelated-subscription']);assert.deepEqual(r.value.remainingEvents,unrelated.initialEvents);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='unregister').map(x=>x.source),['r1-start','r1-stop']);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='remove-event').map(x=>x.id),[100,101]);untouched(r)})
test('D/E/F — unrelated subscriptions/jobs remain; unavailable Workflow adapter is never queried',()=>{const r=execute({...unrelated,returnSubscription:true});assert.equal(r.status,0);assert.equal(r.value.calls.some(x=>x.cmd==='get-job'),false);untouched(r)})
test('historical boundary — injected original V5 finally reproduces broad Get-Job failure',()=>{const r=execute(unrelated,true);assert.equal(r.status,1);assert.match(r.stderr,/SYNTHETIC WorkflowJobSourceAdapter: The Persistence Path does not exist/);assert.equal(r.value.calls.filter(x=>x.cmd==='get-job').length,1);untouched(r)})
test('G/I — either owned unsubscribe failure remains visible and cleanup attempts the other resource',()=>{for(const source of ['r1-start','r1-stop']){const r=execute({...unrelated,unregisterFailure:source});assert.equal(r.status,1);assert.match(r.stderr,/monitor_cleanup_failed/);assert.match(r.value.failure,new RegExp('synthetic_unregister_failure:'+source));assert.equal(r.value.calls.filter(x=>x.cmd==='unregister').length,2);assert.ok(r.value.remainingSubscriptions.includes(source));untouched(r)}})
test('G/I — event removal failure cannot become success; other owned events still attempted',()=>{const r=execute({...unrelated,removeFailure:true});assert.equal(r.status,1);assert.match(r.value.failure,/synthetic_event_remove_failure/);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='remove-event').map(x=>x.id),[100,101]);assert.ok(r.value.remainingEvents.some(x=>x.EventIdentifier===100));untouched(r)})
test('G/I — queue inspection failure remains visible after subscription cleanup',()=>{const r=execute({...unrelated,queueReadFailure:true});assert.equal(r.status,1);assert.match(r.value.failure,/synthetic_queue_read_failure/);assert.deepEqual(r.value.remainingSubscriptions,['unrelated-subscription']);untouched(r)})
test('ownership — second registration failure cleans only the first successfully owned source',()=>{const r=execute({...unrelated,registrationFailure:'r1-stop'});assert.equal(r.status,1);assert.match(r.value.failure,/synthetic_registration_failure:r1-stop/);assert.deepEqual(r.value.owned,['r1-start']);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='unregister').map(x=>x.source),['r1-start']);untouched(r)})
test('ownership — first registration failure cannot remove any subscription',()=>{const r=execute({...unrelated,registrationFailure:'r1-start'});assert.equal(r.status,1);assert.deepEqual(r.value.owned,[]);assert.equal(r.value.calls.some(x=>x.cmd==='unregister'),false);untouched(r)})
test('ownership — pre-existing colliding subscription is never acquired or removed',()=>{const r=execute({...unrelated,existingSubscriptions:['unrelated-subscription','r1-start']});assert.equal(r.status,1);assert.deepEqual(r.value.owned,[]);assert.ok(r.value.remainingSubscriptions.includes('r1-start'));assert.equal(r.value.calls.some(x=>x.cmd==='unregister'),false);untouched(r)})
test('ownership — stale same-name queued events fail before registration and remain untouched',()=>{const r=execute({...unrelated,initialEvents:[...unrelated.initialEvents,{SourceIdentifier:'r1-start',EventIdentifier:8}]});assert.equal(r.status,1);assert.match(r.value.failure,/monitor_source_event_preexisting/);assert.equal(r.value.calls.some(x=>x.cmd==='register'||x.cmd==='remove-event'),false);assert.equal(r.value.remainingEvents.length,2);untouched(r)})
test('ownership — unavailable initial queue check stops without acquiring resources',()=>{const r=execute({...unrelated,queueBeforeRegistrationFailure:true});assert.equal(r.status,1);assert.match(r.value.failure,/synthetic_initial_queue_failure/);assert.deepEqual(r.value.owned,[]);assert.equal(r.value.calls.some(x=>x.cmd==='register'),false);untouched(r)})
test('failure contract — an earlier Monitor-body failure cannot be cleared by successful cleanup',()=>{const r=execute({...unrelated,bodyFailure:true});assert.equal(r.status,1);assert.match(r.value.failure,/synthetic_monitor_body_failure/);assert.deepEqual(r.value.remainingSubscriptions,['unrelated-subscription']);untouched(r)})
test('H/I native exit — fragment completion exits 0 and uncaught owned cleanup error exits 1 without test exit overrides',()=>{const good=execute({...unrelated,nativeTerminal:true});assert.equal(good.status,0);assert.equal(good.stderr,'');const bad=execute({...unrelated,nativeTerminal:true,unregisterFailure:'r1-stop'});assert.equal(bad.status,1);assert.match(bad.stderr,/monitor_cleanup_failed/);assert.match(bad.stderr,/synthetic_unregister_failure:r1-stop/)})
test('J/source scope — restore only ownership bookkeeping and finally to recover exact old script',()=>{let restored=monitor.replace("$ownedSources=[System.Collections.Generic.List[string]]::new()\n",'').replace("  if(@(Get-Event -ErrorAction Stop | Where-Object SourceIdentifier -in @('r1-start','r1-stop')).Count){throw 'monitor_source_event_preexisting'}\n",'').replace("  $ownedSources.Add('r1-start')\n",'').replace("  $ownedSources.Add('r1-stop')\n",'');restored=restored.slice(0,restored.lastIndexOf('} finally {'))+before.slice(before.lastIndexOf('} finally {'));assert.equal(restored,before);assert.equal(/Get-Job|Remove-Job|Start-Job|Start-ThreadJob|\bworkflow\b|-Action\b/.test(monitor),false);assert.ok(monitor.includes("'process-trace-subscribed'"));assert.ok(monitor.includes("'process_trace_bound_exceeded'"));assert.ok(monitor.includes("'process_trace_window_expired'"));assert.ok(monitor.includes('exit 1'));assert.equal(/SilentlyContinue/.test(cleanup(monitor)),false)})
test('provenance — materialized Monitor and patch pins match server-owned committed contracts',()=>{const repo=path.resolve(__dirname,'../../..'),p=JSON.parse(fs.readFileSync(repo+'/test/r1/monitor-diagnostics/provenance.json')),m=p.files.find(x=>x.file==='process-monitor.ps1');assert.equal(hash(monitor),m.correctedSha256);assert.equal(hash(fs.readFileSync(repo+'/test/r1/monitor-diagnostics/'+m.patch)),m.patchSha256);assert.equal(hash(fs.readFileSync(m.original)),m.originalSha256);assert.equal(hash(fs.readFileSync(repo+'/'+p.helper.path)),p.helper.sha256)})
