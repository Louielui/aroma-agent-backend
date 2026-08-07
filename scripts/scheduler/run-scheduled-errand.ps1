<#
  run-scheduled-errand.ps1 — WHAT THE WINDOWS TASK ACTUALLY EXECUTES.

  It does no work. It knocks on 8090 and lets 香香 do the work and write the row.

      Windows Task  ──HTTP──▶  127.0.0.1:8090  ──▶  she runs the check, she writes the record

  ⛔ WHY IT IS A KNOCK AND NOT A SCRIPT THAT DOES THE ERRAND.
  DESIGN-SCHEDULED-SURFACE.md §3. A `setInterval` inside 8090 dies with the process and cannot
  record that it died. A Windows task that does the WORK would put the work outside her, so her
  own screen would be reporting on something she does not own and cannot describe beyond an exit
  code. This shape keeps the trigger where it survives reboots and the work where the truth lives.

  ⛔ NO SECRET IN THE TASK DEFINITION.
  HUB_TOKEN is hydrated at RUNTIME from the USER-scope environment — the same rule xiangxiang.ps1
  already follows. The registered task contains a path and nothing else, so `Export-ScheduledTask`
  leaks nothing and the token is never on disk in a definition file.

  ⛔ THE EXIT CODE IS WITNESS #1 AND MUST BE HONEST.
  Anything other than a clean run exits non-zero so Task Scheduler records a failure. Swallowing
  the error would make a broken schedule look like a healthy one that had nothing to report —
  and that is the exact silence the two-witness design exists to break.
#>

[CmdletBinding()]
param(
  [int]$Port = 8090,
  [int]$TimeoutSec = 240
)

$ErrorActionPreference = 'Stop'
$Log = 'C:\Aroma\logs\errand-scheduled.log'

function Write-Log([string]$m) {
  $line = ((Get-Date).ToString('o')) + '  ' + $m
  try {
    $dir = Split-Path -Parent $Log
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -LiteralPath $Log -Value $line -Encoding UTF8
  } catch { }
  Write-Host $line
}

# ── 1. The token, from the USER environment, at runtime. Never from a file, never a parameter
#       (a parameter would be stored in the task definition, which is the thing we are avoiding).
$token = [Environment]::GetEnvironmentVariable('HUB_TOKEN', 'User')
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = [Environment]::GetEnvironmentVariable('HUB_TOKEN', 'Machine')
}
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Log 'FAIL: HUB_TOKEN is not set in the environment. Not guessing, not falling back.'
  exit 3
}

# ── 2. Is she even up? 8090 only exists while the Owner is logged on — the task is registered
#       to match, but a logon without the launcher is still possible. Say so as a distinct code.
try {
  $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 10 -UseBasicParsing
  $svc = ($h.Content | ConvertFrom-Json).service
  if ($svc -ne 'aroma-hub') { Write-Log "FAIL: something else is on $Port (service='$svc')."; exit 4 }
} catch {
  Write-Log ('FAIL: 8090 is not answering — she is not running. ' + $_.Exception.Message)
  exit 4
}

# ── 3. The knock. The server decides WHAT runs; this script may not name an action.
Write-Log 'POST /api/v1/home/errand/scheduled-run'
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/home/errand/scheduled-run" `
    -Method POST `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType 'application/json' `
    -Body '{}' `
    -TimeoutSec $TimeoutSec -UseBasicParsing
} catch {
  Write-Log ('FAIL: the run endpoint refused or errored. ' + $_.Exception.Message)
  exit 5
}

$body = $null
try { $body = $r.Content | ConvertFrom-Json } catch { }
if ($null -eq $body) { Write-Log 'FAIL: the endpoint returned something unparseable.'; exit 6 }

Write-Log ('ran=' + $body.ran + ' recorded=' + $body.recorded + ' nextRunAt=' + $body.nextRunAt)
if ($body.rows) { foreach ($row in $body.rows) { Write-Log ('  ' + $row.id + '  ' + $row.outcome) } }

# ⛔ 「It ran」 is not 「it was recorded」. An errand that answered and could not be written down
#    is a failure from the schedule's point of view: the briefing will show nothing.
if (-not $body.recorded) { Write-Log 'FAIL: it ran but nothing was recorded.'; exit 7 }

Write-Log 'OK'
exit 0
