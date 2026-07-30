# commissioningLock5Operator.ps1 - the OPERATOR half of Lock 5. Non-elevated, session 5.
#
# ── WHY THE COMPANION IS STARTED HERE AND NOT BY THE OWNER SIDE ─────────────
# deploy-companion.ps1 launches the Companion with `Start-Process -Credential`, and line 271
# obtains that credential with Get-Credential - AN INTERACTIVE PASSWORD PROMPT for
# AromaOperator. Under one-visit commissioning that would strand Louie: he must not type
# credentials, and the password may not be remembered.
#
# The fix is the direction the IPC was already designed for. ipcChannel.js: THE COMPANION
# CREATES THE PIPE, THE SERVICE CONNECTS. This session already IS AromaOperator, so it can
# start the Companion with no credential at all, and the Owner side connects to it as the
# service. No password enters the commissioning path.
#
# Returns @{ ok; verdict; summary }. Never throws for an expected condition.

param($UI, [string]$Nonce)

# Dot-source the core: this script is invoked with & from the launcher, so $script:
# variables set in the LAUNCHER's scope are NOT visible here. The self-check caught this.
. (Join-Path $PSScriptRoot 'commissioningCore.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$BINDINGS = @('gate', 'abort', 'oskill')
$OBS_SECONDS = 3600
$node = 'node'
foreach ($c in @('C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) {
  if (Test-Path -LiteralPath $c) { $node = $c; break }
}

# ── the observation, PROVEN IN FLIGHT ───────────────────────────────────────
# It writes its own pid and a heartbeat. "We launched it" is not evidence: the 3a demo passed
# three times against targets that were already dead. It also records its NATURAL END, so a
# stand-in that simply ran out is reported VOID rather than as a boundary finding.
$pidFile  = Join-Path $env:TEMP ('cx-obs-' + $Nonce + '.pid')
$beatFile = Join-Path $env:TEMP ('cx-obs-' + $Nonce + '.beat')
$sleeper  = Join-Path $env:TEMP ('cx-obs-' + $Nonce + '.ps1')
$body = @'
$PID | Set-Content -LiteralPath $args[0] -Encoding UTF8
$end = (Get-Date).AddSeconds([int]$args[2])
while ((Get-Date) -lt $end) {
  ((Get-Date).ToString('o')) | Set-Content -LiteralPath $args[1] -Encoding UTF8
  Start-Sleep -Seconds 5
}
'@
[IO.File]::WriteAllText($sleeper, $body, (New-Object Text.UTF8Encoding($true)))

$startedAt = Get-Date
$naturalEnd = $startedAt.AddSeconds($OBS_SECONDS)
$null = Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$sleeper,$pidFile,$beatFile,[string]$OBS_SECONDS) `
  -PassThru -WindowStyle Hidden

$obsPid = $null; $w = 0
while ($w -lt 15000 -and -not $obsPid) {
  Start-Sleep -Milliseconds 300; $w += 300
  if (Test-Path -LiteralPath $pidFile) { try { $obsPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim() } catch { } }
  if ($UI) { $UI.Pump() }
}
$aliveBefore = $false
if ($obsPid) { $aliveBefore = [bool](Get-Process -Id $obsPid -ErrorAction SilentlyContinue) }
if (-not $aliveBefore) {
  [void](CX-WriteJson -Path (CX-Marker -Nonce $Nonce -Name 'LOCK5-DONE.json') -Object @{
    marker='LOCK5-DONE'; verdict='INVALID'; reason='the observation stand-in was never proven alive'; at=(Get-Date).ToString('o') })
  return @{ ok = $false; verdict = 'INVALID'; summary = 'the observation was never proven alive, so no kill result means anything' }
}
[void](CX-WriteJson -Path (CX-Marker -Nonce $Nonce -Name 'OBSERVATION-INFLIGHT.json') -Object ([ordered]@{
  marker='OBSERVATION-INFLIGHT'; pid=$obsPid; startedAt=$startedAt.ToString('o'); naturalEnd=$naturalEnd.ToString('o'); at=(Get-Date).ToString('o') }))

# ── one FRESH Companion per binding ─────────────────────────────────────────
# 3a failed this way: all three bindings ran against ONE Companion, KILL 2 killed it, and
# KILL 3 "passed" with nothing left to kill. Green, proving nothing.
$bindingResults = @()
foreach ($b in $BINDINGS) {
  if ($UI) { $UI.SetStep('lock5', 'run', ('binding ' + $b)) }
  $pipe = 'aroma-cx-' + $Nonce + '-' + $b
  $entry = Join-Path $script:CX_StageDir 'companion-entry.js'
  if (-not (Test-Path -LiteralPath $entry)) {
    $bindingResults += [ordered]@{ binding=$b; ok=$false; reason='staged companion-entry.js not found' }
    break
  }
  $cp = Start-Process -FilePath $node -ArgumentList @($entry, $pipe) -PassThru -WindowStyle Hidden `
        -WorkingDirectory $script:CX_StageDir
  Start-Sleep -Seconds 2
  $alive = [bool](Get-Process -Id $cp.Id -ErrorAction SilentlyContinue)
  [void](CX-WriteJson -Path (CX-Marker -Nonce $Nonce -Name ('COMPANION-READY-' + $b + '.json')) -Object ([ordered]@{
    marker='COMPANION-READY'; binding=$b; pipeName=$pipe; companionPid=$cp.Id; startedAlive=$alive; at=(Get-Date).ToString('o') }))

  # the Owner side connects as the SERVICE and demonstrates this one binding
  $kd = CX-WaitForMarker -UI $UI -Path (CX-Marker -Nonce $Nonce -Name ('KILL-DONE-' + $b + '.json')) -TimeoutSeconds 600 `
        -WaitBanner ('Stop-control check: binding ' + $b)
  $bindingResults += [ordered]@{ binding=$b; ok=[bool]($kd -and $kd.ok); detail=$(if ($kd) { $kd.detail } else { 'timed out' }) }
  try { if (Get-Process -Id $cp.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $cp.Id -Force -ErrorAction SilentlyContinue } } catch { }
  if (-not ($kd -and $kd.ok)) { break }
}

# ── did the observation survive? ────────────────────────────────────────────
$checkedAt = Get-Date
$aliveAfter = [bool](Get-Process -Id $obsPid -ErrorAction SilentlyContinue)
$lastBeat = $null; try { $lastBeat = (Get-Content -LiteralPath $beatFile -Raw -ErrorAction Stop).Trim() } catch { }
$expired = ($checkedAt -ge $naturalEnd)

$verdict = if ($aliveAfter) { 'CONFIRMED' } elseif ($expired) { 'INVALID' } else { 'UNEXPECTED' }
$summary = switch ($verdict) {
  'CONFIRMED'  { 'the observation SURVIVED all three bindings - this CONFIRMS the declared gap killingCompanionStopsObserver:false. Not a pass and not a failure: the measurement the declaration was waiting for.' }
  'INVALID'    { 'VOID - the stand-in reached its own natural end before the check ran. Nothing may be concluded about the bindings.' }
  default      { 'the observation DIED before its natural end. The declaration says it should not have; that needs explaining before it is treated as good news.' }
}
try { Stop-Process -Id $obsPid -Force -ErrorAction SilentlyContinue } catch { }
Remove-Item -LiteralPath $sleeper, $pidFile, $beatFile -Force -ErrorAction SilentlyContinue

$allBound = (@($bindingResults | Where-Object { $_.ok }).Count -eq $BINDINGS.Count)
[void](CX-WriteJson -Path (CX-Marker -Nonce $Nonce -Name 'LOCK5-DONE.json') -Object ([ordered]@{
  marker='LOCK5-DONE'; verdict=$verdict; bindingsDemonstrated=$allBound; bindings=$bindingResults
  observationPid=$obsPid; aliveBefore=$true; aliveAfter=$aliveAfter; lastHeartbeat=$lastBeat
  naturalEnd=$naturalEnd.ToString('o'); checkedAt=$checkedAt.ToString('o'); windowExpired=$expired
  at=(Get-Date).ToString('o') }))

@{ ok = ($verdict -eq 'CONFIRMED' -and $allBound); verdict = $verdict; summary = $summary }
