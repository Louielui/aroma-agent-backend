[CmdletBinding()]
param([ValidateSet('read','create','enable','disable')][string]$Mode='read',[ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedDefinitionHash)
$ErrorActionPreference='Stop'
$taskName='DailyProcurementReport'; $taskPath='\AromaXiangXiang\'
$repoRoot='C:\Aroma\aroma-agent-backend'; $runner=Join-Path $repoRoot 'scripts\scheduler\run-procurement.ps1'
$runnerArguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$runner+'"'
function Read-Task {
  try {$rows=@(Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop)}catch{if($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound){return @{exists=$false;taskName=$taskName;taskPath=$taskPath}};throw 'scheduler_unavailable'}
  if($rows.Count -eq 0){return @{exists=$false;taskName=$taskName;taskPath=$taskPath}}
  if($rows.Count -ne 1){throw 'scheduler_unavailable'}
  $task=$rows[0]; [xml]$xml=Export-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable); $ns.AddNamespace('t',$xml.DocumentElement.NamespaceURI)
  $enabledNode=$xml.SelectSingleNode('/t:Task/t:Settings/t:Enabled',$ns); if($enabledNode){$null=$enabledNode.ParentNode.RemoveChild($enabledNode)}
  $sha=[Security.Cryptography.SHA256]::Create();try{$definitionHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($xml.OuterXml)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
  $triggers=@($task.Triggers);$actions=@($task.Actions);$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  try {$principalSid=([Security.Principal.NTAccount]::new($task.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{$principalSid=[string]$task.Principal.UserId}
  $valid=$triggers.Count -eq 1 -and $actions.Count -eq 1 -and $triggers[0].CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger' -and -not([string]$triggers[0].Repetition.Interval) -and -not([string]$triggers[0].EndBoundary) -and $task.Settings.RestartCount -eq 0 -and $triggers[0].DaysInterval -eq 1 -and $triggers[0].StartBoundary -match '^\d{4}-\d{2}-\d{2}T08:00:00$' -and $triggers[0].Enabled -eq $true -and $actions[0].Execute -ieq (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -and $actions[0].Arguments -ceq $runnerArguments -and $actions[0].WorkingDirectory -ieq $repoRoot -and [string]$task.Principal.LogonType -eq 'Interactive' -and [string]$task.Principal.RunLevel -eq 'Limited' -and $principalSid -eq $identity -and (Get-TimeZone).Id -eq 'Central Standard Time' -and $task.Settings.StartWhenAvailable -and [string]$task.Settings.MultipleInstances -eq 'IgnoreNew' -and $task.Settings.ExecutionTimeLimit -eq 'PT5M'
  $trigger=@{kind='unknown';observedAt=$null;eventRecordId=$null}
  $info=Get-ScheduledTaskInfo -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop
  # A time-trigger event is a witness, not a caller-supplied claim. Missing history stays unknown.
  try {
    $events=Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational';Id=@(107,110);StartTime=(Get-Date).AddMinutes(-10)} -MaxEvents 40 -ErrorAction Stop
    foreach($event in $events){[xml]$e=$event.ToXml();$entry=@($e.Event.EventData.Data | Where-Object {$_.Name -eq 'TaskName'});if($entry.Count -eq 1 -and $entry[0].'#text' -ceq ($taskPath+$taskName)){if([string]$task.State -eq 'Running' -and [Math]::Abs(($info.LastRunTime-$event.TimeCreated).TotalSeconds) -le 10){$trigger=@{kind=$(if($event.Id -eq 107){'time'}else{'manual'});observedAt=$event.TimeCreated.ToUniversalTime().ToString('o');eventRecordId=$event.RecordId}};break}}
  }catch{}
  return @{exists=$true;taskName=$taskName;taskPath=$taskPath;validDefinition=[bool]$valid;definitionHash=$definitionHash;enabled=[bool]$task.Settings.Enabled;runtime=[string]$task.State;trigger=$trigger;lastRunAt=$(if($info.LastRunTime.Year -ge 2020){$info.LastRunTime.ToUniversalTime().ToString('o')}else{$null});lastTaskResult=$info.LastTaskResult;at=[DateTime]::UtcNow.ToString('o')}
}
$before=Read-Task
if($Mode -eq 'create'){
  if($before.exists -or -not(Test-Path -LiteralPath $runner) -or (Get-TimeZone).Id -ne 'Central Standard Time'){throw 'schedule_definition_changed'}
  $taskAction=New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $runnerArguments -WorkingDirectory $repoRoot
  $firstRun=(Get-Date).Date.AddHours(8);if($firstRun -le (Get-Date)){$firstRun=$firstRun.AddDays(1)}
  $trigger=New-ScheduledTaskTrigger -Daily -At '08:00';$trigger.StartBoundary=$firstRun.ToString('yyyy-MM-ddTHH:mm:ss')
  $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -RestartCount 0
  $settings.Enabled=$false
  Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Imagine: approved fixed read-only daily procurement report, 08:00 America/Winnipeg. In-app results only.' | Out-Null
}elseif($Mode -in @('enable','disable')){
  if(-not $before.exists -or -not $before.validDefinition -or -not $ExpectedDefinitionHash -or $before.definitionHash -cne $ExpectedDefinitionHash){throw 'schedule_definition_changed'}
  if($Mode -eq 'enable'){Enable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null}else{Disable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null}
}
ConvertTo-Json (Read-Task) -Depth 5 -Compress
