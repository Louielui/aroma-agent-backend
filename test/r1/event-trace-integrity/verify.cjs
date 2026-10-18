'use strict'
// Bounded diagnosis of exact source fragments. No Monitor, CIM subscription, process trace, or VM is launched.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto'),test=require('node:test')
const E=process.env.R1_EVENT_TRACE_FIXTURE,R=path.resolve(__dirname,'../../..');assert.ok(E&&path.isAbsolute(E),'explicit disposable fixture required')
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',COMSPEC:'C:\\Windows\\System32\\cmd.exe',PATH:'C:\\Windows\\System32',HOME:E,USERPROFILE:E,TEMP:E,TMP:E}
const source=fs.readFileSync(E+'/process-monitor.ps1','utf8');assert.equal(hash(source),read(R+'/test/r1/monitor-diagnostics/provenance.json').files.find(x=>x.file==='process-monitor.ps1').correctedSha256)
const helpers=source.slice(source.indexOf('$monitorFailure=$null'),source.indexOf('# Source fragments'))
const registration=source.slice(source.indexOf('try {\ntry {\n')+12,source.indexOf('  $self=Get-Process'))
const poll=source.slice(source.indexOf("    Set-MonitorOperation 'POLLING'"),source.indexOf('    if ($eventsList.Count'))
const drain=source.slice(source.indexOf("  Set-MonitorOperation 'POST_STOP_DRAIN'"),source.indexOf('} catch {\n  Save-MonitorFailure'))
const cleanup=source.slice(source.indexOf('} finally {\n  $cleanupFailures=')+11,source.lastIndexOf('\n}\n} catch {')).trim()
assert.ok(registration.includes('Register-CimIndicationEvent'));assert.ok(poll.includes('Collect-MonitorEvent') && helpers.includes('Remove-Event -EventIdentifier'));assert.ok(cleanup.includes('process-events.json'));assert.ok(cleanup.includes('Unregister-Event'))
fs.mkdirSync(E+'/cases');let sequence=0
function execute(config={}){
 const name='case-'+String(++sequence).padStart(2,'0'),dir=E+'/cases/'+name;fs.mkdirSync(dir)
 const cfg=Buffer.from(JSON.stringify(config)).toString('base64'),root=Buffer.from(dir).toString('base64')
 let harness=String.raw`$ErrorActionPreference='Stop'
$cfg=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__CFG__'))|ConvertFrom-Json
$PrivateRoot=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ROOT__'))
$eventsList=[System.Collections.Generic.List[object]]::new()
$ownedSources=[System.Collections.Generic.List[string]]::new()
$subs=@{'unrelated-source'=$true}
$queue=[System.Collections.Generic.List[object]]::new()
$calls=[System.Collections.Generic.List[object]]::new()
$queue.Add([PSCustomObject]@{EventIdentifier=9;SourceIdentifier='unrelated-source'})
$failure=$null;$inCleanup=$false;$nextId=100;$started=Get-Date
if($cfg.expired){$started=$started.AddSeconds(-181)}
if($cfg.traceBound){for($i=0;$i-lt 5000;$i++){$eventsList.Add(@{synthetic='bound'})}}
if($cfg.existingTrace){[IO.File]::WriteAllText((Join-Path $PrivateRoot 'process-events.json'),'{"sentinel":123,"terminal":false}')}
if($cfg.existingFailure){[IO.File]::WriteAllText((Join-Path $PrivateRoot 'monitor-failure.json'),'{"sentinel":456}')}
function Make-Event([int]$id,[string]$kind){[PSCustomObject]@{SourceIdentifier=$kind;EventIdentifier=$id;SourceEventArgs=[PSCustomObject]@{NewEvent=[PSCustomObject]@{ProcessID=7000;ParentProcessID=6000;ProcessName='synthetic.exe';ExitStatus=0;TIME_CREATED=[string](100000+$id)}}}}
function Register-CimIndicationEvent {[CmdletBinding()]param([string]$Namespace,[string]$Query,[string]$SourceIdentifier)
 $calls.Add(@{cmd='register';source=$SourceIdentifier;namespace=$Namespace;query=$Query})
 if($cfg.registrationFailure-eq $SourceIdentifier){throw ('injected_registration_failure:'+ $SourceIdentifier)}
 if($subs.ContainsKey($SourceIdentifier)){throw 'injected_duplicate_subscription'}
 $subs[$SourceIdentifier]=$true;$queue.Add((Make-Event $script:nextId $SourceIdentifier));$script:nextId++
}
function Get-Event {[CmdletBinding()]param()
 $calls.Add(@{cmd='get-event';cleanup=$inCleanup})
 if($cfg.cleanupQueueFailure-and $inCleanup){throw 'injected_queue_failure'}
 $snapshot=$queue.ToArray()
 foreach($item in $snapshot){$item;if($cfg.duplicate-and -not $inCleanup-and $item.EventIdentifier-eq 100){$item}}
}
function Remove-Event {[CmdletBinding()]param([int]$EventIdentifier)
 $calls.Add(@{cmd='remove-event';id=$EventIdentifier;recorded=$eventsList.Count;cleanup=$inCleanup;line=$MyInvocation.ScriptLineNumber})
 if($cfg.removeFailure-and -not $inCleanup-and $EventIdentifier-eq 100){throw 'injected_permission_failure'}
 if($cfg.cleanupRemoveFailure-and $inCleanup-and $EventIdentifier-eq 102){throw 'injected_cleanup_remove_failure'}
 $matches=@($queue.ToArray()|Where-Object EventIdentifier -eq $EventIdentifier)
 if($cfg.disappears-and -not $inCleanup-and $EventIdentifier-eq 100-and $matches.Count-eq 1){[void]$queue.Remove($matches[0]);$matches=@()}
 if($matches.Count-ne 1){throw ("Event with identifier '"+$EventIdentifier+"' does not exist.")}
 [void]$queue.Remove($matches[0])
 if($cfg.arrivalDuringPoll-and -not $inCleanup-and $EventIdentifier-eq 100){$queue.Add((Make-Event 102 'r1-start'))}
}
function Unregister-Event {[CmdletBinding()]param([string]$SourceIdentifier)
 $calls.Add(@{cmd='unregister';source=$SourceIdentifier})
 if($cfg.unregisterFailure-eq $SourceIdentifier){throw ('injected_unsubscribe_failure:'+ $SourceIdentifier)}
 if(-not $subs.ContainsKey($SourceIdentifier)){throw 'injected_subscription_absent'}
 [void]$subs.Remove($SourceIdentifier)
 if($cfg.lateArrival-and $SourceIdentifier-eq 'r1-start'){$queue.Add((Make-Event 102 'r1-start'))}
}
__HELPERS__
$receiptWriter=(Get-Item -LiteralPath Function:Write-MonitorReceipt).ScriptBlock
if($cfg.writeFailure){function Write-MonitorReceipt([string]$Name,$Value){if($Name-eq 'process-events.json'){throw 'injected_trace_persistence_failure'};& $script:receiptWriter $Name $Value}}
__OUTER_START__
try {
__REGISTRATION__
__POLL__
__DRAIN__
} catch {Save-MonitorFailure $_} finally {
 $inCleanup=$true
__CLEANUP__
}
__OUTER_END__
$trace=$null;$tracePath=Join-Path $PrivateRoot 'process-events.json'
if(Test-Path -LiteralPath $tracePath){$trace=Get-Content -LiteralPath $tracePath -Raw|ConvertFrom-Json}
[PSCustomObject]@{evidenceClass='INJECTED EXACT SOURCE FRAGMENTS; NO REAL CIM/MONITOR';failure=$failure;calls=@($calls.ToArray());memoryRecords=@($eventsList.ToArray());trace=$trace;remainingSubscriptions=@($subs.Keys|Sort-Object);remainingEvents=@($queue.ToArray())}|ConvertTo-Json -Depth 10 -Compress
if($null-ne $failure){exit 1}
exit 0`
 harness=harness.replace('__CFG__',()=>cfg).replace('__ROOT__',()=>root).replace('__REGISTRATION__',()=>registration).replace('__POLL__',()=>config.drainOnly?'':poll).replace('__DRAIN__',()=>drain).replace('__CLEANUP__',()=>cleanup).replace('__HELPERS__',()=>helpers)
 harness=harness.replace('__OUTER_START__',config.nativeUncaught?'':'try {').replace('__OUTER_END__',config.nativeUncaught?'':"}catch{$failure=$_.Exception.Message;if($null-ne $monitorFailure){[Console]::Error.WriteLine($monitorFailure.error)};if($null-eq $monitorFailure-or $failure-ne $monitorFailure.error){[Console]::Error.WriteLine($failure)}}")
 fs.writeFileSync(dir+'/harness.ps1',harness,{flag:'wx'})
 const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',argv=['-NoProfile','-NonInteractive','-Command',harness],start=new Date().toISOString(),r=cp.spawnSync(ps,argv,{env,windowsHide:true,encoding:'utf8',maxBuffer:2000000}),end=new Date().toISOString()
 for(const [file,b]of [['stdout.log',r.stdout??''],['stderr.log',r.stderr??'']])fs.writeFileSync(dir+'/'+file,b,{flag:'wx'})
 fs.writeFileSync(dir+'/receipt.json',JSON.stringify({config,evidenceClass:'INJECTED EXACT SOURCE FRAGMENTS',sourceSha256:hash(source),harnessSha256:hash(harness),executable:ps,executableSha256:hash(fs.readFileSync(ps)),argv,pid:r.pid,start,end,exit:r.status,signal:r.signal,error:r.error?.message??null,stdoutSha256:hash(r.stdout??''),stderrSha256:hash(r.stderr??'')},null,2)+'\n',{flag:'wx'})
 assert.equal(r.error,undefined);return {...r,value:r.stdout.trim()?JSON.parse(r.stdout):null,dir}
}
module.exports={execute,E,R,source,hash,read}
if(require.main===module){
function untouched(r){assert.deepEqual(r.value.remainingSubscriptions,['unrelated-source']);assert.deepEqual(r.value.remainingEvents,[{EventIdentifier:9,SourceIdentifier:'unrelated-source'}]);assert.equal(r.value.calls.some(x=>x.cmd==='remove-event'&&x.id===9),false)}
test('1 — normal processing records ordered start/stop and persists the exact complete trace',()=>{const r=execute();assert.equal(r.status,0);assert.equal(r.stderr,'');assert.equal(r.value.trace.terminal,true);assert.deepEqual(r.value.trace.events,r.value.memoryRecords);assert.deepEqual(r.value.memoryRecords.map(x=>x.kind),['r1-start','r1-stop']);assert.deepEqual(r.value.memoryRecords.map(x=>x.traceTime),['100100','100101']);untouched(r)})
test('2 — exact event identifiers are removed only after their records are retained in memory',()=>{const r=execute();assert.equal(r.status,0);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='remove-event').map(x=>[x.id,x.recorded]),[[100,1],[101,2]]);untouched(r)})
test('3 — injected duplicate snapshot reproduces missing-event failure and cannot claim success',()=>{const r=execute({duplicate:true});assert.equal(r.status,1);assert.equal(r.value.failure,"Event with identifier '100' does not exist.");assert.equal(r.value.trace,null);assert.deepEqual(r.value.memoryRecords.map(x=>x.traceTime),['100100','100100']);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='remove-event'&&!x.cleanup).map(x=>x.id),[100,100])})
test('4 — injected disappearance before first removal remains nonzero and loses the final trace',()=>{const r=execute({disappears:true});assert.equal(r.status,1);assert.equal(r.value.failure,"Event with identifier '100' does not exist.");assert.equal(r.value.trace,null);assert.equal(r.value.memoryRecords.length,1);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='remove-event'&&!x.cleanup).map(x=>x.id),[100])})
test('5 — poll-to-drain arrival is processed in the next snapshot with ordering and identity intact',()=>{const r=execute({arrivalDuringPoll:true});assert.equal(r.status,0);assert.deepEqual(r.value.trace.events.map(x=>x.traceTime),['100100','100101','100102']);untouched(r)})
test('6 — partial registration cleans only successfully owned subscriptions',()=>{const r=execute({registrationFailure:'r1-stop'});assert.equal(r.status,1);assert.match(r.value.failure,/injected_registration_failure/);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='unregister').map(x=>x.source),['r1-start']);assert.equal(r.value.trace,null);untouched(r)})
test('7 — post-stop drain preserves unrelated queued events and subscriptions',()=>{const r=execute({drainOnly:true});assert.equal(r.status,0);assert.equal(r.value.trace.events.length,2);untouched(r)})
test('8 — both owned subscriptions are explicitly unregistered',()=>{const r=execute();assert.equal(r.status,0);assert.deepEqual(r.value.calls.filter(x=>x.cmd==='unregister').map(x=>x.source),['r1-start','r1-stop']);untouched(r)})
test('9 — required invariant: an unprocessed event arriving before unsubscribe cannot be silently accepted',()=>{const r=execute({lateArrival:true});assert.equal(r.status,0,'baseline currently exits successfully');assert.ok(r.value.trace.events.some(x=>x.traceTime==='100102'),'BASELINE DEFECT: owned event 102 was removed in finally without appearing in the persisted terminal trace')})
test('10 — genuine event and owned-cleanup failures remain visible and nonzero',()=>{const a=execute({removeFailure:true});assert.equal(a.status,1);assert.match(a.stderr,/injected_permission_failure/);const b=execute({unregisterFailure:'r1-stop'});assert.equal(b.status,1);assert.match(b.stderr,/monitor_cleanup_failed.*injected_unsubscribe_failure/);assert.equal(b.value.remainingSubscriptions.includes('r1-stop'),true)})
test('11 — trace write failure cannot yield success or a fabricated complete trace',()=>{const r=execute({writeFailure:true});assert.equal(r.status,1);assert.match(r.value.failure,/injected_trace_persistence_failure/);assert.equal(r.value.trace,null);assert.equal(r.value.memoryRecords.length,2)})
test('12 — isolated native queue: exact removal succeeds with terminal exit 0',()=>{const r=read(E+'/native-queue-probe.json'),v=JSON.parse(fs.readFileSync(E+'/native-queue-probe.stdout.log','utf8'));assert.equal(r.exit,0);assert.equal(v.remaining,0);assert.deepEqual(v.snapshot.map(x=>x.id),[1,2,3,4]);assert.ok(v.observations.filter(x=>x.phase==='after').every(x=>x.present===0))})
test('13 — genuine uncaught cleanup failure produces native nonzero exit without test exit overrides',()=>{const r=execute({nativeUncaught:true,unregisterFailure:'r1-stop'});assert.equal(r.status,1);assert.match(r.stderr,/monitor_cleanup_failed/);assert.equal(r.value,null)})
test('14 — actual source, Ready identity, helper, trace queries and all driver contracts remain unchanged',()=>{const p=read(R+'/test/r1/monitor-diagnostics/provenance.json');assert.equal(hash(source),p.files.find(x=>x.file==='process-monitor.ps1').correctedSha256);assert.equal(hash(fs.readFileSync(R+'/'+p.helper.path)),p.helper.sha256);assert.equal(p.helper.sha256,'3794fcbf9fc68867b9368b99e75008ee93b18b5c71f373b80471fde2c32bf032');for(const literal of ["'SELECT * FROM Win32_ProcessStartTrace'","'SELECT * FROM Win32_ProcessStopTrace'","runId=$RunId.ToString()","launchId=$LaunchId.ToString()","subscriptions=2","handshake='process-trace-subscribed'","process_trace_bound_exceeded","process_trace_window_expired","exit 1"]){assert.ok(source.includes(literal),literal)}assert.equal(/Get-Job|Remove-Job/.test(source),false)})
test('15 — isolated native asynchronous arrivals do not establish the V6 failure mechanism',()=>{const r=read(E+'/native-arrival-probe.json'),v=JSON.parse(fs.readFileSync(E+'/native-arrival-probe.stdout.log','utf8'));assert.equal(r.exit,0);assert.ok(v.records.length>0);assert.deepEqual(v.errors,[]);assert.ok(v.records.every(x=>x.new));assert.equal(v.remaining,0)})

}
