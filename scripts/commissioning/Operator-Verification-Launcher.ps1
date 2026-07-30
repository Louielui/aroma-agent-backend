# Operator-Verification-Launcher.ps1 - LAUNCHER 2. The AromaOperator session.
#
# ── IT DOES NOT ELEVATE, AND MUST NOT TRY ───────────────────────────────────
# MEASURED: AromaOperator is NOT in Administrators (only AromaBrain\Administrator and
# AROMABRAIN\louis are). A UAC prompt here would demand admin credentials - and typing
# credentials plus judging the prompt is executor work the commissioning exception does not
# cover. So this runs non-elevated, and everything it needs must be reachable that way:
#   . the probe directory      - explicit ALLOW ReadAndExecute for this account under Gate B
#   . the evidence directory   - writable by this account (Part B wrote there)
# Both are re-checked at the start rather than assumed.
#
# Louie presses one icon. This does Part B, hands the result back through a file, and then -
# ONLY after the Owner side has SEALED Part B - does the operator half of Lock 5.

param([switch]$DryRun)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DRY = ($PSBoundParameters.ContainsKey('DryRun') -and [bool]$PSBoundParameters['DryRun'])
. (Join-Path $PSScriptRoot 'commissioningCore.ps1')

$UI = CX-NewUI -Title 'Aroma - Operator Check' -Subtitle $(if ($DRY) { 'DRY RUN - nothing will be measured' } else { 'Physical machine commissioning, step 2 of 2' })
$UI.Banner2('Starting...', 'info')
foreach ($s in @(
  @('who',   'Check this is the right Windows account'),
  @('ready', 'Pick up the run from the other account'),
  @('files', 'Report the staged files'),
  @('partb', 'Run the Part B checks'),
  @('hand',  'Send the result back'),
  @('lock5', 'Lock 5 - stop-control check'),
  @('done',  'Finish')
)) { $UI.AddStep($s[0], $s[1]) }

$NONCE = $null
try {
  # ── identity. Not a formality: the whole point of Gate A. ────────────────
  $UI.SetStep('who', 'run', '')
  $me = ([Security.Principal.WindowsIdentity]::GetCurrent()).Name
  $sam = ($me -split '\\')[-1]
  if ($sam -ne $script:CX_Account) {
    $UI.SetStep('who', 'fail', ('running as ' + $me))
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'identity' `
      -Reason ('this launcher must run as ' + $script:CX_Account + ', not ' + $me) `
      -Detail @('Switch Windows accounts and press the icon on that desktop instead.','Nothing was measured.') -Launcher 'operator')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $UI.SetStep('who', 'ok', ($me + '  session ' + (Get-Process -Id $PID).SessionId))

  # ── pick up the round. The handoff is a FILE. No nonce is shown or typed. ─
  $UI.SetStep('ready', 'run', '')
  $round = $null; $ready = $null
  if (Test-Path -LiteralPath $script:CX_CommissionRoot) {
    foreach ($d in @(Get-ChildItem -LiteralPath $script:CX_CommissionRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
      $r = CX-ReadJson -Path (Join-Path $d.FullName 'READY.json')
      if ($r -and -not (Test-Path -LiteralPath (Join-Path $d.FullName 'OPERATOR-DONE.json'))) { $round = $d.Name; $ready = $r; break }
    }
  }
  if (-not $ready) {
    $UI.SetStep('ready', 'fail', 'no run is waiting')
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'handoff' `
      -Reason 'no commissioning run is waiting for this account' `
      -Detail @('Press the Owner launcher first, in the other Windows account, and wait until it says to switch.','Nothing was measured.') -Launcher 'operator')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $NONCE = $round
  $DRY = $DRY -or [bool]$ready.dryRun
  $UI.SetStep('ready', 'ok', ('round ' + $round))

  # ── staged files: the probe directory is unreadable to the Owner by design,
  #    so THIS session is the only place the staged hashes can be reported. ──
  $UI.SetStep('files', 'run', '')
  $staged = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $script:CX_ProbeDir -File -ErrorAction SilentlyContinue | Sort-Object Name)) {
    $staged += [ordered]@{ name = $f.Name; bytes = $f.Length; sha256 = (CX-Sha256File -Path $f.FullName) }
  }
  if (@($staged).Count -eq 0) {
    $UI.SetStep('files', 'fail', 'the probe directory is empty or unreadable')
    [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'staged-files' -Reason 'this account cannot read the probe directory' -Detail @($script:CX_ProbeDir) -Launcher 'operator')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'STAGED-FILES.json') -Object @{ marker='STAGED-FILES'; files=$staged; at=(Get-Date).ToString('o') })
  $UI.SetStep('files', 'ok', (@($staged).Count.ToString() + ' files recorded'))

  # ── PART B ───────────────────────────────────────────────────────────────
  $UI.SetStep('partb', 'run', '')
  $ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $results = @()
  $failed = $null
  if ($DRY) {
    $UI.SetStep('partb', 'skip', 'dry run - no probes executed')
  } else {
    foreach ($script in @($ready.partBScripts)) {
      $UI.SetStep('partb', 'run', $script)
      $log = CX-Marker -Nonce $NONCE -Name ($script -replace '\.ps1$', '')
      $log = $log + '.log'
      $p = Start-Process -FilePath $ps -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $script:CX_ProbeDir $script)) `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $log
      $p | Wait-Process -Timeout 900 -ErrorAction SilentlyContinue
      if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force } catch { }; $failed = ($script + ' timed out'); break }
      $results += [ordered]@{ script = $script; exitCode = $p.ExitCode; log = $log }
      if ($p.ExitCode -ne 0) { $failed = ($script + ' exited ' + $p.ExitCode); break }
      $UI.Pump()
    }
    if ($failed) {
      $UI.SetStep('partb', 'fail', $failed)
      [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'part-b' -Reason $failed -Detail $results -Launcher 'operator')
      # still tell the other side, so it stops waiting instead of timing out
      [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'OPERATOR-DONE.json') -Object @{
        marker='OPERATOR-DONE'; verdict='FAIL'; reason=$failed; results=$results; at=(Get-Date).ToString('o') })
      $UI.Form.ShowDialog() | Out-Null; exit 1
    }
    $UI.SetStep('partb', 'ok', (@($results).Count.ToString() + ' probes completed'))
  }

  # ── hand the result back ─────────────────────────────────────────────────
  $UI.SetStep('hand', 'run', '')
  $topup = @(Get-ChildItem -LiteralPath $script:CX_EvidenceRoot -Filter 'stage3-topup-results-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
  $doc = if (@($topup).Count) { CX-ReadJson -Path $topup[0].FullName } else { $null }
  $drift = if ($doc) { @($doc.registryDrift).Count } else { 0 }
  $gaps  = if ($doc) { @($doc.positiveControlProblems).Count } else { 0 }
  $rows  = if ($doc) { @($doc.rows).Count } else { 0 }
  $verdict = if ($DRY) { 'PASS' } elseif ($drift -eq 0 -and $gaps -eq 0 -and $rows -gt 0) { 'PASS' } else { 'FAIL' }

  [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'OPERATOR-DONE.json') -Object ([ordered]@{
    marker='OPERATOR-DONE'; verdict=$verdict; rowCount=$rows; registryDrift=$drift; controlGaps=$gaps
    resultFiles = @($results | ForEach-Object { $_.log }); dryRun=[bool]$DRY; at=(Get-Date).ToString('o') }))
  $UI.SetStep('hand', 'ok', ('Part B ' + $verdict))

  # ── LOCK 5 - only after the Owner side has SEALED Part B ─────────────────
  $UI.SetStep('lock5', 'run', 'waiting for Part B to be sealed')
  $UI.Banner2("Part B finished." + "`r`n`r`n" + "Stay here - the stop-control check runs next." , 'wait')
  $go = CX-WaitForMarker -UI $UI -Path (CX-Marker -Nonce $NONCE -Name 'LOCK5-GO.json') -TimeoutSeconds 900 `
    -WaitBanner 'Part B finished. Waiting for the other account to seal it.'
  if (-not $go) {
    $UI.SetStep('lock5', 'skip', 'the other account did not open Lock 5 - Part B stands')
  } elseif ($DRY) {
    $UI.SetStep('lock5', 'skip', 'dry run')
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'LOCK5-DONE.json') -Object @{ marker='LOCK5-DONE'; verdict='SKIPPED'; dryRun=$true; at=(Get-Date).ToString('o') })
  } else {
    $l5 = & (Join-Path $PSScriptRoot 'commissioningLock5Operator.ps1') -UI $UI -Nonce $NONCE
    $UI.SetStep('lock5', $(if ($l5.ok) { 'ok' } else { 'fail' }), $l5.summary)
  }

  $UI.SetStep('done', 'ok', '')
  $UI.Banner2(
    "FINISHED HERE." + "`r`n`r`n" +
    "Switch back to the other Windows account." + "`r`n" +
    "That window will show the final result.", 'pass')
  $UI.SetFoot('round ' + $NONCE + '  -  you may close this window.')
}
catch {
  [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'unexpected' -Reason $_.Exception.Message -Detail @($_.ScriptStackTrace) -Launcher 'operator')
  if ($NONCE) {
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'OPERATOR-DONE.json') -Object @{
      marker='OPERATOR-DONE'; verdict='FAIL'; reason=$_.Exception.Message; at=(Get-Date).ToString('o') })
  }
}

$UI.Form.Add_FormClosed({ [Windows.Forms.Application]::ExitThread() })
[Windows.Forms.Application]::Run($UI.Form)
