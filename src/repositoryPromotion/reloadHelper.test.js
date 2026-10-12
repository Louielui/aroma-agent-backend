'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os')
test('the actual PowerShell bridge guard survives disappearance and PID replacement, rejects foreign identity, and kills only the bound instance',t=>{
  if(process.platform!=='win32'){t.diagnostic('Native helper cases are exercised by the full Windows suite; cloud checks do not claim native verification.');return}
  const source=path.resolve(__dirname,'../../scripts/repository/restartLocal.ps1').replace(/'/g,"''")
  const harness=String.raw`
$ErrorActionPreference='Stop'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('SOURCE_PATH',[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'helper_parse_failed'}
$defs=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('AssertImagineBridge','StopVerifiedBridgeAfterRestart')},$true))
if($defs.Count -ne 2){throw 'helper_functions_missing'}
foreach($definition in $defs){Invoke-Expression $definition.Extent.Text}
$fixtureState=[pscustomobject]@{Foreign=$false;Current=$null;Listeners=@();Bound=$null}
$ownerParts=[Security.Principal.WindowsIdentity]::GetCurrent().Name.Split([char]92)
function Get-NetTCPConnection {param($State,$LocalPort,$ErrorAction) return $fixtureState.Listeners}
function Get-CimInstance {param($ClassName,$Filter) if($Filter -eq 'ProcessId=43'){return [pscustomobject]@{CommandLine='node "C:/Aroma/aroma-agent-backend/scripts/memory/serviceSupervisor.cjs" bridge'}};return $fixtureState.Current}
function Invoke-CimMethod {param([Parameter(ValueFromPipeline=$true)]$InputObject,$MethodName) process {if($fixtureState.Foreign){return [pscustomobject]@{ReturnValue=0;Domain='foreign';User='foreign'}};return [pscustomobject]@{ReturnValue=0;Domain=$ownerParts[0];User=$ownerParts[1]}}}
$birth=[DateTime]::UtcNow
$original=[pscustomobject]@{ProcessId=42;ParentProcessId=43;CreationDate=$birth;CommandLine='node "C:/Aroma/aroma-agent-backend/scripts/subscription/startBridge.js"'}
function ResetCase {
  $fixtureState.Foreign=$false;$fixtureState.Current=[pscustomobject]@{ProcessId=$original.ProcessId;ParentProcessId=$original.ParentProcessId;CreationDate=$original.CreationDate;CommandLine=$original.CommandLine};$fixtureState.Listeners=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=42})
  $fixtureState.Bound=[pscustomobject]@{HasExited=$false;KillCount=0;RaceExit=$false}
  $fixtureState.Bound | Add-Member -MemberType ScriptMethod -Name Kill -Value {if($this.RaceExit){$this.HasExited=$true;throw 'already_gone'};$this.KillCount++}
}
ResetCase;StopVerifiedBridgeAfterRestart $original $fixtureState.Bound;if($fixtureState.Bound.KillCount -ne 1){throw 'bound_kill_missing'}
ResetCase;$fixtureState.Listeners=@();StopVerifiedBridgeAfterRestart $original $fixtureState.Bound;if($fixtureState.Bound.KillCount){throw 'gone_killed'}
ResetCase;$fixtureState.Bound.HasExited=$true;StopVerifiedBridgeAfterRestart $original $fixtureState.Bound;if($fixtureState.Bound.KillCount){throw 'exited_killed'}
ResetCase;$fixtureState.Current.ProcessId=44;$fixtureState.Listeners[0].OwningProcess=44;StopVerifiedBridgeAfterRestart $original $fixtureState.Bound;if($fixtureState.Bound.KillCount){throw 'replacement_killed'}
ResetCase;$fixtureState.Current.CreationDate=$birth.AddSeconds(1);StopVerifiedBridgeAfterRestart $original $fixtureState.Bound;if($fixtureState.Bound.KillCount){throw 'reused_pid_killed'}
ResetCase;$fixtureState.Foreign=$true;$refused=$false;try{StopVerifiedBridgeAfterRestart $original $fixtureState.Bound}catch{if($_.Exception.Message -eq 'BridgeOwnerMismatch'){$refused=$true}else{throw}};if(-not $refused -or $fixtureState.Bound.KillCount){throw 'foreign_not_refused'}
ResetCase;$fixtureState.Bound.RaceExit=$true;StopVerifiedBridgeAfterRestart $original $fixtureState.Bound;if(-not $fixtureState.Bound.HasExited -or $fixtureState.Bound.KillCount){throw 'exit_race_not_contained'}
Write-Output 'bridge_guard_cases_passed'
`
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-guard-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true})});const file=path.join(dir,'harness.ps1');fs.writeFileSync(file,'\ufeff'+harness.replace('SOURCE_PATH',source),'utf8');
  const result=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',file],{encoding:'utf8',windowsHide:true,shell:false,timeout:30000})
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/bridge_guard_cases_passed/)
})
