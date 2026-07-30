# Owner-Sentinel-Launcher.ps1 - LAUNCHER 1. Louie's session. Self-elevating.
#
# Louie presses one icon and answers the UAC prompt. Everything else happens here.
#
# PHASES
#   0  self-elevate
#   1  preflight            - HARD STOPS ONLY. Nothing is repaired that was not expected.
#   2  prepare              - the known, idempotent, baselined items and nothing else
#   3  mint the round       - nonce, manifest, round directory
#   4  owner sentinel       - open it and verify its colour reached the framebuffer
#   5  READY -> wait        - Louie switches accounts; this polls a file
#   6  PART B adjudicate + SEAL   <- sealed to disk BEFORE Lock 5 is allowed to begin
#   7  LOCK 5               - service side of the three kill bindings, then wait
#   8  final report         - Part B and Lock 5 adjudicated SEPARATELY
#
# OWNER RULING 2026-07-30 ON ORDER: Part B results are written and SEALED first. Lock 5 opens
# only after that, and a Lock 5 failure MUST NOT invalidate Part B. The two are adjudicated
# separately in the report, and this file is the thing that enforces it.
#
# UP TO 3 ROUNDS. The one-shot nonce exists so a crashed run cannot be quietly retried into a
# clean-looking result. That intent is kept: every round is recorded separately and the final
# report names the total and each round's outcome. After the third, it stops and reports.

param([switch]$DryRun, [int]$MaxRounds = 3)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DRY = ($PSBoundParameters.ContainsKey('DryRun') -and [bool]$PSBoundParameters['DryRun'])
$ROUND_CAP = $MaxRounds

# ── PHASE 0: SELF-ELEVATE ───────────────────────────────────────────────────
# Louie must not be asked to right-click and choose "Run as administrator". He presses the
# icon; if this is not elevated it relaunches itself and he answers the UAC prompt. Answering
# UAC is not executor work - it is one button on a dialog Windows raises.
. (Join-Path $PSScriptRoot 'commissioningCore.ps1')

if (-not (CX-IsElevated)) {
  $argl = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $PSCommandPath)
  if ($DRY) { $argl += '-DryRun' }
  try { Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList $argl -Verb RunAs | Out-Null }
  catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show(
      "This needs administrator approval to continue." + "`r`n`r`n" +
      "Press the launcher again and choose Yes when Windows asks." + "`r`n`r`n" +
      "Nothing has been changed.", 'Aroma Commissioning', 'OK', 'Warning') | Out-Null
  }
  exit 0
}

$UI = CX-NewUI -Title 'Aroma - Owner Sentinel' -Subtitle $(if ($DRY) { 'DRY RUN - nothing on this machine will be changed' } else { 'Physical machine commissioning, step 1 of 2' })
$UI.Banner2('Starting...', 'info')

foreach ($s in @(
  @('pre',    'Check the machine is ready'),
  @('sess',   'Check the Operator account is still signed in'),
  @('prep',   'Prepare tasks and staged files'),
  @('mint',   'Create this run''s identity'),
  @('sent',   'Open and verify the owner marker window'),
  @('handoff','Hand over to the Operator account'),
  @('partb',  'Receive and seal the Part B result'),
  @('lock5',  'Lock 5 - stop-control check'),
  @('report', 'Write the final report')
)) { $UI.AddStep($s[0], $s[1]) }

$NONCE = $null
$roundLog = New-Object System.Collections.Generic.List[object]

try {
  # ── PHASE 1: PREFLIGHT. HARD STOPS. ──────────────────────────────────────
  $UI.SetStep('pre', 'run', '')
  $problems = New-Object System.Collections.Generic.List[string]

  if ($env:COMPUTER_OPERATOR) { $problems.Add('COMPUTER_OPERATOR is set in this environment; it must stay unset/off') }
  foreach ($p in @($script:CX_Repo, $script:CX_Scripts, $script:CX_EvidenceRoot)) {
    if (-not (Test-Path -LiteralPath $p)) { $problems.Add('missing required path: ' + $p) }
  }
  if (-not (Get-LocalUser -Name $script:CX_Account -ErrorAction SilentlyContinue)) {
    $problems.Add($script:CX_Account + ' account does not exist')
  }
  # the evidence directory must be writable BY US, now, not assumed
  try {
    $t = Join-Path $script:CX_EvidenceRoot ('.cx-write-test-' + [guid]::NewGuid().ToString('N').Substring(0,6))
    [IO.File]::WriteAllText($t, 'x'); Remove-Item -LiteralPath $t -Force
  } catch { $problems.Add('cannot write the evidence directory: ' + $_.Exception.Message) }

  if ($problems.Count -gt 0) {
    $UI.SetStep('pre', 'fail', ($problems -join '; '))
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'preflight' -Reason 'the machine is not in a state this launcher may proceed from' -Detail $problems -Launcher 'owner')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $UI.SetStep('pre', 'ok', 'flag off, paths present, evidence writable')

  # ── THE PRECONDITION THE OWNER NAMED: is session 5 still signed in? ──────
  # If it is, switching to it needs only an unlock - no password, and the whole
  # credential risk disappears. If it is gone we stop HERE, not half way through.
  $UI.SetStep('sess', 'run', '')
  $op = CX-OperatorSession
  if (-not $op.signedIn) {
    $UI.SetStep('sess', 'fail', 'the Operator account is NOT signed in')
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'preflight/session' `
      -Reason ($script:CX_Account + ' is not signed in, so this run cannot proceed') `
      -Detail @(
        'Switching to that account would require its password, which this launcher must not ask for.',
        'The session must be signed in BEFORE commissioning starts.',
        'Nothing on this machine has been changed.') -Launcher 'owner')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $UI.SetStep('sess', 'ok', ('signed in, session ' + $op.sessionId + ' (' + $op.state + ') - switching needs only an unlock'))

  # ── PHASE 2: PREPARE. ONLY THE KNOWN ITEMS. ──────────────────────────────
  $UI.SetStep('prep', 'run', '')
  if ($DRY) {
    $UI.SetStep('prep', 'skip', 'dry run - no tasks re-registered, no files staged')
  } else {
    $prepDetail = & (Join-Path $PSScriptRoot 'commissioningPrepare.ps1') -UI $UI
    if (-not $prepDetail.ok) {
      $UI.SetStep('prep', 'fail', $prepDetail.reason)
      [void](CX-Fail -UI $UI -Nonce $null -Stage 'prepare' -Reason $prepDetail.reason -Detail $prepDetail.detail -Launcher 'owner')
      $UI.Form.ShowDialog() | Out-Null; exit 1
    }
    $UI.SetStep('prep', 'ok', $prepDetail.summary)
  }

  # ── PHASES 3-8, up to $ROUND_CAP rounds ──────────────────────────────────
  $sealed = $null
  for ($round = 1; $round -le $ROUND_CAP -and -not $sealed; $round++) {
    $NONCE = [guid]::NewGuid().ToString('N').Substring(0, 12)
    $dir = CX-RoundDir -Nonce $NONCE
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    $UI.SetStep('mint', 'run', ('round ' + $round + ' of ' + $ROUND_CAP))
    $manifest = [ordered]@{
      marker = 'COMMISSIONING-MANIFEST'; round = $round; roundNonce = $NONCE
      operatorNonce = $NONCE; ownerNonce = $NONCE
      consumed = $false
      mintedBy = ([Security.Principal.WindowsIdentity]::GetCurrent()).Name
      mintedSessionId = (Get-Process -Id $PID).SessionId
      dryRun = [bool]$DRY
      at = (Get-Date).ToString('o')
    }
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'MANIFEST.json') -Object $manifest)
    $UI.SetStep('mint', 'ok', ('round ' + $round + ' - ' + $NONCE))

    # ── PHASE 4: owner sentinel ────────────────────────────────────────────
    $UI.SetStep('sent', 'run', '')
    $sentinelOk = $false; $sentinelDetail = 'dry run'
    if ($DRY) {
      $sentinelOk = $true
      $UI.SetStep('sent', 'skip', 'dry run - no window opened')
    } else {
      $sp = Join-Path $script:CX_Scripts 'stage3-sentinel.ps1'
      $so = Join-Path $dir 'owner-sentinel.out'
      $pr = Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
        -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$sp,'-Role','owner','-Nonce',$NONCE) `
        -PassThru -WindowStyle Normal -RedirectStandardOutput $so
      $att = Join-Path $script:CX_EvidenceRoot ('stage3-sentinel-owner-' + $NONCE + '.json')
      $wait = 0
      while ($wait -lt 40000 -and -not (Test-Path -LiteralPath $att)) { Start-Sleep -Milliseconds 500; $wait += 500; $UI.Pump() }
      $a = CX-ReadJson -Path $att
      $sentinelOk = ($a -and $a.matchedSamples -gt 0)
      $sentinelDetail = if ($a) { ('matched samples ' + $a.matchedSamples) } else { 'no attestation written' }
      if ($sentinelOk) { $UI.SetStep('sent', 'ok', $sentinelDetail) } else { $UI.SetStep('sent', 'fail', $sentinelDetail) }
    }
    if (-not $sentinelOk) {
      $roundLog.Add([ordered]@{ round = $round; nonce = $NONCE; outcome = 'FAILED'; where = 'owner-sentinel'; detail = $sentinelDetail })
      if ($round -ge $ROUND_CAP) {
        [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'owner-sentinel' -Reason 'the owner marker window could not be verified' -Detail $roundLog -Launcher 'owner')
        $UI.Form.ShowDialog() | Out-Null; exit 1
      }
      continue
    }

    # ── PHASE 5: READY, then wait for the operator side ────────────────────
    $UI.SetStep('handoff', 'run', '')
    $ready = [ordered]@{
      marker = 'READY'; roundNonce = $NONCE; round = $round; dryRun = [bool]$DRY
      ownerSentinelAttested = $true
      probeDir = $script:CX_ProbeDir; evidenceRoot = $script:CX_EvidenceRoot
      partBScripts = @('tierA-probe.ps1', 'stage3-harness.ps1', 'stage3-topup.ps1')
      at = (Get-Date).ToString('o')
    }
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'READY.json') -Object $ready)

    $UI.Banner2(
      "NOW SWITCH TO THE OTHER WINDOWS ACCOUNT" + "`r`n`r`n" +
      "Press Ctrl+Alt+Del, choose Switch user, pick " + $script:CX_Account + "," + "`r`n" +
      "then press the ""Aroma - Operator Check"" icon on its desktop." + "`r`n`r`n" +
      "Leave THIS window open. Come back when that one says it is finished.", 'wait')
    $UI.SetFoot('round ' + $NONCE + '  -  waiting for the other account')

    $done = CX-WaitForMarker -UI $UI -Path (CX-Marker -Nonce $NONCE -Name 'OPERATOR-DONE.json') `
      -TimeoutSeconds 3600 -WaitBanner "Waiting for the Operator account to finish Part B."
    if (-not $done) {
      $UI.SetStep('handoff', 'fail', 'timed out waiting for the other account')
      $roundLog.Add([ordered]@{ round = $round; nonce = $NONCE; outcome = 'FAILED'; where = 'handoff'; detail = 'timeout' })
      if ($round -ge $ROUND_CAP) {
        [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'handoff' -Reason 'the Operator account did not report back in time' -Detail $roundLog -Launcher 'owner')
        $UI.Form.ShowDialog() | Out-Null; exit 1
      }
      continue
    }
    $UI.SetStep('handoff', 'ok', 'operator reported back')

    # ── PHASE 6: ADJUDICATE PART B, THEN SEAL IT ───────────────────────────
    # SEALED BEFORE LOCK 5 OPENS. Owner ruling: a Lock 5 failure must not be able to
    # invalidate a Part B result that already stands.
    $UI.SetStep('partb', 'run', '')
    $partBPass = ([string]$done.verdict -eq 'PASS')
    $sealRec = [ordered]@{
      marker = 'PARTB-SEALED'; roundNonce = $NONCE; round = $round
      verdict = [string]$done.verdict
      rowCount = $done.rowCount; drift = $done.registryDrift; controlGaps = $done.controlGaps
      resultFiles = $done.resultFiles
      sealedAt = (Get-Date).ToString('o')
    }
    $sealPath = CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'PARTB-SEALED.json') -Object $sealRec
    $sealSha = CX-Sha256File -Path $sealPath
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'PARTB-SEAL-SHA.json') -Object ([ordered]@{
      marker = 'PARTB-SEAL-SHA'; file = $sealPath; sha256 = $sealSha; at = (Get-Date).ToString('o') }))
    $UI.SetStep('partb', $(if ($partBPass) { 'ok' } else { 'fail' }), ('Part B ' + $sealRec.verdict + ' - sealed'))
    $roundLog.Add([ordered]@{ round = $round; nonce = $NONCE; outcome = $sealRec.verdict; where = 'part-b'; sealSha256 = $sealSha })

    if (-not $partBPass) {
      if ($round -ge $ROUND_CAP) { break }
      continue   # a fresh round; the sealed record of this one stays on disk
    }
    $sealed = [pscustomobject]@{ nonce = $NONCE; round = $round; sha = $sealSha; rec = $sealRec }
  }

  if (-not $sealed) {
    $UI.SetStep('report', 'run', '')
    [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'part-b' `
      -Reason ('Part B did not pass in ' + $ROUND_CAP + ' rounds; stopping as ruled') -Detail $roundLog -Launcher 'owner')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }

  # ── PHASE 7: LOCK 5 - ONLY NOW, AND IT CANNOT UNDO PART B ────────────────
  $UI.SetStep('lock5', 'run', 'Part B is sealed; Lock 5 may begin')
  $lock5 = & (Join-Path $PSScriptRoot 'commissioningLock5.ps1') -UI $UI -Nonce $sealed.nonce -DryRun:$DRY
  $UI.SetStep('lock5', $(if ($lock5.ok) { 'ok' } else { 'fail' }), $lock5.summary)

  # ── PHASE 8: FINAL REPORT - TWO SEPARATE VERDICTS ────────────────────────
  $UI.SetStep('report', 'run', '')
  $final = [ordered]@{
    marker = 'COMMISSIONING-FINAL'
    roundNonce = $sealed.nonce
    roundsRun = $roundLog.Count
    rounds = $roundLog
    partB = [ordered]@{ verdict = 'PASS'; sealedSha256 = $sealed.sha; note = 'sealed to disk before Lock 5 began; a Lock 5 result cannot alter it' }
    lock5 = [ordered]@{ verdict = $lock5.verdict; detail = $lock5.summary; note = 'adjudicated separately from Part B by Owner ruling' }
    dryRun = [bool]$DRY
    at = (Get-Date).ToString('o')
  }
  $fp = CX-WriteJson -Path (CX-Marker -Nonce $sealed.nonce -Name 'FINAL-REPORT.json') -Object $final

  $lines = @()
  $lines += 'AROMA COMMISSIONING - FINAL REPORT'
  $lines += ''
  $lines += ('round        : ' + $sealed.nonce + '   (rounds run: ' + $roundLog.Count + ' of ' + $ROUND_CAP + ')')
  $lines += ('PART B       : PASS      sealed SHA-256 ' + $sealed.sha)
  $lines += ('LOCK 5       : ' + $lock5.verdict + '   ' + $lock5.summary)
  $lines += ''
  $lines += 'Part B was written and sealed to disk BEFORE Lock 5 began.'
  $lines += 'The two are judged separately: a Lock 5 result does not change Part B.'
  $lines += ''
  foreach ($r in $roundLog) { $lines += ('  round ' + $r.round + '  ' + $r.outcome + '  (' + $r.where + ')') }
  $txtPath = (CX-Marker -Nonce $sealed.nonce -Name 'FINAL-REPORT.txt')
  [IO.File]::WriteAllText($txtPath, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  $UI.SetStep('report', 'ok', $txtPath)

  $UI.Banner2(
    "PART B: PASS" + "`r`n" +
    "LOCK 5: " + $lock5.verdict + "`r`n`r`n" +
    "Report: " + $txtPath, $(if ($lock5.ok) { 'pass' } else { 'wait' }))
  $UI.SetFoot('SHA-256 ' + (CX-Sha256File -Path $txtPath) + '   -  you may close this window.')
}
catch {
  [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'unexpected' -Reason $_.Exception.Message `
    -Detail @($_.ScriptStackTrace, $roundLog) -Launcher 'owner')
}

$UI.Form.Add_FormClosed({ [Windows.Forms.Application]::ExitThread() })
[Windows.Forms.Application]::Run($UI.Form)
