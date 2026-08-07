<#
  aroma-errand-task.ps1 — the auditable registration of 香香's ONE scheduled task.

      .\aroma-errand-task.ps1                 # Status  (default — READ-ONLY)
      .\aroma-errand-task.ps1 -Action Show    # print exactly what Install would register
      .\aroma-errand-task.ps1 -Action Install # register it  (asks for confirmation)
      .\aroma-errand-task.ps1 -Action Remove  # unregister it (asks for confirmation)

  ══════════════════════════════════════════════════════════════════════════════
  > **Owner: 「an auditable script in the repo, not a schtasks line nobody can find again.」**

  This project already flagged the shape it is avoiding: `a6-service-installed-outside-
  governance` — a service that appeared on the machine with no reviewed artifact behind it.
  Everything this task is, is in this file, in the repo, in git history.
  ══════════════════════════════════════════════════════════════════════════════

  ── FOUR DECISIONS, EACH WITH ITS REASON ────────────────────────────────────

  1. ⛔ DEFAULT ACTION IS STATUS, NOT INSTALL.
     Running this file by accident must change nothing. Install and Remove both require the
     verb AND a confirmation.

  2. ⛔ THE TASK RUNS ONLY WHEN THE OWNER IS LOGGED ON — and that is honest, not a limitation
     I failed to remove. The work is an HTTP call into 8090, and 8090 is started by the
     launcher at logon. A "run whether logged on or not" task would fire into a dead port and
     record failures every morning. It ALSO sidesteps the measured trap that killed the backup
     tasks (0x1: a scheduler logon cannot see user-profile files).
     `-StartWhenAvailable` catches the run up after a late logon, so a missed 07:00 is not a
     lost day.

  3. ⛔ NO SECRET IS STORED IN THE TASK. The action is a path and a parameter-free script.
     `run-scheduled-errand.ps1` hydrates HUB_TOKEN from the USER environment at runtime, so
     `Export-ScheduledTask` on this task leaks nothing.

  4. ⛔ IT REGISTERS EXACTLY ONE TASK, FOR ONE READ-ONLY ERRAND.
     The Owner's standing ruling: **on a timer, READS ONLY.** No writes, no dispatch, no paid
     model calls, nothing acting as him. The recall check qualifies; the SERVER — not this
     script — decides what runs, and it will only run kinds declared read-only. Adding anything
     else to the timer needs its own GO.
#>

[CmdletBinding()]
param(
  [ValidateSet('Status', 'Show', 'Install', 'Remove')]
  [string]$Action = 'Status',
  [string]$At = '07:00',
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

# ⛔ ONE constant, shared with src/home/schedulerWitness.js. A test greps that file for this
#    exact string: if they drift, the witness reports NOT_INSTALLED for a task that exists, and
#    the briefing says 「手動」 about something running on a timer.
$TaskName = 'AromaXiangXiang-ErrandRecall'
$Runner   = Join-Path $PSScriptRoot 'run-scheduled-errand.ps1'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

function Show-Definition {
  Write-Host ''
  Write-Host '  ── what this registers ──────────────────────────────────────────'
  Write-Host ("  name        : " + $TaskName)
  Write-Host ("  runs        : powershell -NoProfile -ExecutionPolicy Bypass -File " + $Runner)
  Write-Host ("  working dir : " + $RepoRoot)
  Write-Host ("  trigger     : daily at " + $At + ", ONLY when " + $env:USERNAME + " is logged on")
  Write-Host  '  catch-up    : StartWhenAvailable (a missed 07:00 runs after logon)'
  Write-Host  '  runs as     : the logged-on user, NOT SYSTEM, NOT elevated'
  Write-Host  '  network     : loopback only — it calls 127.0.0.1:8090'
  Write-Host  '  secrets     : NONE in the definition (HUB_TOKEN is read from the environment at run time)'
  Write-Host  '  what it does: POST /api/v1/home/errand/scheduled-run — the SERVER chooses the errand,'
  Write-Host  '                and will only run kinds declared read-only.'
  Write-Host '  ─────────────────────────────────────────────────────────────────'
  Write-Host ''
}

function Get-Task { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

function Show-Status {
  $t = Get-Task
  if (-not $t) {
    Write-Host ("  " + $TaskName + " : NOT INSTALLED")
    Write-Host '  香香 will report the recall check as 「手動」, which is the truth today.'
    return
  }
  $i = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  Write-Host ("  " + $TaskName + " : " + $t.State)
  if ($i) {
    Write-Host ("  last run    : " + $i.LastRunTime + "   result: " + $i.LastTaskResult)
    Write-Host ("  next run    : " + $i.NextRunTime)
    if ($i.LastTaskResult -ne 0) {
      Write-Host '  ⚠ non-zero result. 0x1 is usually a scheduler logon that cannot see user-profile files.'
    }
  }
}

function Confirm-Or-Stop([string]$what) {
  if ($Yes) { return }
  Write-Host ''
  $a = Read-Host ("  " + $what + "  Type YES to proceed")
  if ($a -ne 'YES') { Write-Host '  Aborted. Nothing changed.'; exit 1 }
}

switch ($Action) {

  'Status' { Show-Status; break }

  'Show' { Show-Definition; Write-Host '  (nothing was registered — this was Show)'; break }

  'Install' {
    if (-not (Test-Path -LiteralPath $Runner)) { throw "runner not found: $Runner" }
    if (Get-Task) { Write-Host "  Already installed. Use -Action Remove first if you want to replace it."; exit 1 }

    Show-Definition
    Confirm-Or-Stop 'Register this task?'

    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
      -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $Runner + '"') `
      -WorkingDirectory $RepoRoot

    $trigger = New-ScheduledTaskTrigger -Daily -At $At

    # ⛔ Interactive: it runs as the logged-on user, with that user's token, and ONLY when
    #    they are logged on. See decision 2 in the header.
    $principal = New-ScheduledTaskPrincipal -UserId ("$env:USERDOMAIN\$env:USERNAME") `
      -LogonType Interactive -RunLevel Limited

    $settings = New-ScheduledTaskSettingsSet `
      -StartWhenAvailable `
      -DontStopOnIdleEnd `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
      -MultipleInstances IgnoreNew `
      -RestartCount 0

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Principal $principal -Settings $settings `
      -Description '香香 — daily recall check. READ ONLY. Knocks on 127.0.0.1:8090; the server runs the errand and writes the record. Registered by scripts/scheduler/aroma-errand-task.ps1 in the aroma-agent-backend repo.' | Out-Null

    Write-Host ''
    Write-Host '  Registered.'
    Show-Status
    Write-Host ''
    Write-Host '  香香 measures this — she does not take it on trust. Her briefing will change'
    Write-Host '  from 「手動行」 to 「應該行咗」 by itself, because the sentence is built from'
    Write-Host '  Get-ScheduledTask, not from a boolean anyone edited.'
    break
  }

  'Remove' {
    if (-not (Get-Task)) { Write-Host '  Not installed. Nothing to remove.'; exit 0 }
    Show-Status
    Confirm-Or-Stop 'Unregister this task?'
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host '  Removed. 香香 will go back to reporting the recall check as 「手動」 on her own.'
    break
  }
}
