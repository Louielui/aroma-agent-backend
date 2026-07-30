# commissioningPrepare.ps1 - PHASE 2 of launcher 1. Elevated, in Louie's session.
#
# OWNER RULING 2026-07-30: preparation folds into the launcher so Louie never judges machine
# state - AND it is limited to the KNOWN, IDEMPOTENT, BASELINED items listed here. Anything
# unexpected STOPS and reports. This is not a general repair tool and must never become one.
#
# The four known items, each already carrying its own baseline/backup/verify discipline:
#   1. the SessionGate script lives in C:\Aroma\ComputerOperator-Gate (it was destroyed once
#      by a re-stage of the Companion tree) and the gate task points there
#   2. the Observer task's SHA pin matches the staged observer.ps1
#   3. the probe directory holds the current staged scripts
#   4. Gate B is applied
#
# Returns @{ ok; reason; detail; summary }. It NEVER throws for an expected condition - the
# caller decides how to stop, so a failure can still be written to a report.

param($UI)

# Dot-source the core: this script is invoked with & from the launcher, so $script:
# variables set in the LAUNCHER's scope are NOT visible here. The self-check caught this.
. (Join-Path $PSScriptRoot 'commissioningCore.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$detail = New-Object System.Collections.Generic.List[string]
$did = New-Object System.Collections.Generic.List[string]
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

function Note { param([string]$m) $detail.Add($m); if ($UI) { $UI.SetStep('prep', 'run', $m) } }

# ── 1. the gate script and its task ─────────────────────────────────────────
$gateScript = Join-Path $script:CX_GateDir 'session-identity.ps1'
$gateSrc = Join-Path $script:CX_Scripts 'session-identity.ps1'
if (-not (Test-Path -LiteralPath $gateSrc)) {
  return @{ ok = $false; reason = 'the gate script is missing from the repo'; detail = @($gateSrc); summary = '' }
}
$needGate = $true
if (Test-Path -LiteralPath $gateScript) {
  $needGate = ((CX-Sha256File -Path $gateScript) -ne (CX-Sha256File -Path $gateSrc))
}
if ($needGate) {
  Note 'registering the session gate task'
  $out = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:CX_Scripts 'register-session-gate-task.ps1') 2>&1 | Out-String
  if ((CX-Sha256File -Path $gateScript) -ne (CX-Sha256File -Path $gateSrc)) {
    return @{ ok = $false; reason = 'the session gate script could not be placed'; detail = @($out); summary = '' }
  }
  $did.Add('gate task')
} else { $did.Add('gate task already current') }

# ── 2. the Observer task pin ────────────────────────────────────────────────
# The pin lives in the task DESCRIPTION and nothing verifies it at run time, so a stale pin is
# invisible until C8 fails. Re-registering is the only thing that refreshes it.
$obsSrc = Join-Path $script:CX_Scripts 'observer.ps1'
$obsSrcSha = CX-Sha256File -Path $obsSrc
$needObs = $true
try {
  $t = Get-ScheduledTask -TaskName 'AromaComputerOperator-Observer' -ErrorAction Stop
  if ([string]$t.Description -match '([A-Fa-f0-9]{64})') { $needObs = ($Matches[1].ToLower() -ne $obsSrcSha) }
} catch { $needObs = $true }
if ($needObs) {
  Note 'refreshing the observer task'
  $bl = Join-Path $script:CX_EvidenceRoot 'observer-task-baseline.xml'
  if (Test-Path -LiteralPath $bl) {
    Copy-Item -LiteralPath $bl -Destination (Join-Path $script:CX_EvidenceRoot ('observer-task-baseline-pre-commissioning-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.xml')) -Force
  }
  $out = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:CX_Scripts 'register-observer-task.ps1') 2>&1 | Out-String
  $ok = $false
  try {
    $t2 = Get-ScheduledTask -TaskName 'AromaComputerOperator-Observer' -ErrorAction Stop
    if ([string]$t2.Description -match '([A-Fa-f0-9]{64})') { $ok = ($Matches[1].ToLower() -eq $obsSrcSha) }
  } catch { }
  if (-not $ok) { return @{ ok = $false; reason = 'the observer task pin could not be refreshed'; detail = @($out); summary = '' } }
  $did.Add('observer task')
} else { $did.Add('observer pin already current') }

# ── 3. stage the current probe scripts ──────────────────────────────────────
# Copy-Item INTO the probe directory still works under Gate B (creating a file needs write,
# not read). Hashing the STAGED copy does not - so the verification is deferred to the probes
# themselves, which print a staged-file table from the session that CAN read it.
$stageSet = @('observer.ps1','assertionRegistry.ps1','assertion-registry.json','probeIdentityGate.ps1',
              'tierA-probe.ps1','stage3-harness.ps1','stage3-topup.ps1','stage3-lock5.ps1',
              'stage3-sentinel.ps1','stage3-baseline.ps1')
if (-not (Test-Path -LiteralPath $script:CX_ProbeDir)) {
  return @{ ok = $false; reason = 'the probe directory does not exist'; detail = @($script:CX_ProbeDir); summary = '' }
}
Note 'staging the probe scripts'
foreach ($n in $stageSet) {
  $s = Join-Path $script:CX_Scripts $n
  if (-not (Test-Path -LiteralPath $s)) { return @{ ok = $false; reason = ('missing from the repo: ' + $n); detail = @($s); summary = '' } }
  try { Copy-Item -LiteralPath $s -Destination (Join-Path $script:CX_ProbeDir $n) -Force -ErrorAction Stop }
  catch { return @{ ok = $false; reason = ('could not stage ' + $n); detail = @($_.Exception.Message); summary = '' } }
}
$did.Add(('staged ' + $stageSet.Count + ' scripts'))

# ── 4. Gate B ───────────────────────────────────────────────────────────────
Note 'checking the probe-directory boundary'
$known = Join-Path $script:CX_ProbeDir 'observer.ps1'
$readable = $true
try { $null = Get-FileHash -LiteralPath $known -Algorithm SHA256 -ErrorAction Stop } catch { $readable = $false }
if ($readable) {
  $out = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:CX_Scripts 'restrict-probe-dir.ps1') -Apply 2>&1 | Out-String
  $still = $true
  try { $null = Get-FileHash -LiteralPath $known -Algorithm SHA256 -ErrorAction Stop } catch { $still = $false }
  if ($still) { return @{ ok = $false; reason = 'Gate B could not be applied'; detail = @($out); summary = '' } }
  $did.Add('Gate B applied')
} else { $did.Add('Gate B already applied') }

@{ ok = $true; reason = ''; detail = @($detail); summary = (($did) -join ', ') }
