'use strict'
const { execFile } = require('node:child_process')
const { target, HASH } = require('./contract')
function script (id, change) {
  const t = target(id)
  if (change && (!['scheduler.pause','scheduler.resume'].includes(change.action) || !HASH.test(change.definitionHash) || typeof change.enabled !== 'boolean')) throw Error('invalid_request')
  // All executable text is fixed code or closed catalogue constants. No caller command/path.
  return [
    '$ErrorActionPreference="Stop"',
    `$name='${t.taskName}'; $path='${t.taskPath}'`,
    'function Read-Exact {',
    '$rows=@(Get-ScheduledTask -TaskPath $path -ErrorAction Stop | Where-Object { $_.TaskName -ceq $name -and $_.TaskPath -ceq $path })',
    'if($rows.Count -ne 1){ throw "scheduler_unavailable" }; $task=$rows[0]',
    '[xml]$xml=Export-ScheduledTask -TaskName $name -TaskPath $path -ErrorAction Stop',
    '$ns=New-Object System.Xml.XmlNamespaceManager($xml.NameTable); $ns.AddNamespace("t",$xml.DocumentElement.NamespaceURI)',
    '$node=$xml.SelectSingleNode("/t:Task/t:Settings/t:Enabled",$ns); if($node){$null=$node.ParentNode.RemoveChild($node)}',
    'function Hash-Text([string]$text){$sha=[System.Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace("-","").ToLowerInvariant()}finally{$sha.Dispose()}}',
    '$hash=Hash-Text $xml.OuterXml; $parts=@("Actions","Principals","Settings") | ForEach-Object {$n=$xml.SelectSingleNode("/t:Task/t:"+$_,$ns);if($n){$n.OuterXml}}; $actionHash=Hash-Text ($parts -join "|")',
    '$triggers=@(); $supported=$true; $all=@($xml.SelectNodes("/t:Task/t:Triggers/*",$ns)); if($all.Count -gt 32 -or ($parts -join "|") -match "[%$]"){$supported=$false}',
    'foreach($trigger in $all){$on=$trigger.SelectSingleNode("t:Enabled",$ns);if($on -and $on.InnerText -eq "false"){continue};$start=$trigger.SelectSingleNode("t:StartBoundary",$ns);$delay=$trigger.SelectSingleNode("t:RandomDelay",$ns);if($trigger.LocalName -ne "CalendarTrigger" -or !$start -or ($delay -and $delay.InnerText -ne "PT0S")){$supported=$false;continue};$triggers+=Hash-Text $trigger.OuterXml}',
    '$evidence=if($supported){@{basis="windows_task_xml_exact_calendar_v1";actionHash=$actionHash;triggers=@($triggers)}}else{$null}',
    '@{targetId="' + id + '"; taskPath=$path; taskName=$name; definitionHash=$hash; enabled=[bool]$task.Settings.Enabled; runtime=[string]$task.State; scheduleEvidence=$evidence; at=[DateTime]::UtcNow.ToString("o")}',
    '}',
    '$before=Read-Exact',
    ...(change ? [
      `if($before.definitionHash -cne '${change.definitionHash}' -or $before.enabled -ne $${change.enabled ? 'true' : 'false'}){throw "target_changed"}`,
      'if($before.runtime -notin @("Ready","Disabled")){throw "task_not_idle"}',
      `${change.action === 'scheduler.pause' ? 'Disable' : 'Enable'}-ScheduledTask -TaskName $name -TaskPath $path -ErrorAction Stop | Out-Null`,
      '$after=Read-Exact; ConvertTo-Json $after -Compress'
    ] : ['ConvertTo-Json $before -Compress'])
  ].join('\n')
}
function createScheduler ({ execute, platform = process.platform } = {}) {
  const run = execute || (code => new Promise((resolve,reject) => {
    if (platform !== 'win32' || require('../testProcess').isTestProcess()) return reject(Error('scheduler_unavailable'))
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,timeout:12000,maxBuffer:16384},(e,out) => e ? reject(Error(/target_changed/.test(e.message) ? 'target_changed' : /task_not_idle/.test(e.message) ? 'task_not_idle' : 'scheduler_unavailable')) : resolve(out))
  }))
  async function invoke (id, change) {
    const t = target(id), r = JSON.parse(await run(script(id,change)))
    if (!r || r.targetId !== id || r.taskName !== t.taskName || r.taskPath !== t.taskPath || !HASH.test(r.definitionHash) || typeof r.enabled !== 'boolean' || !['Ready','Disabled','Running','Queued','Unknown'].includes(r.runtime) || !Number.isFinite(Date.parse(r.at))) throw Error('invalid_scheduler_receipt')
    return r
  }
  return { read: id => invoke(id), apply: (id,change) => invoke(id,change) }
}
module.exports = { createScheduler, script }
