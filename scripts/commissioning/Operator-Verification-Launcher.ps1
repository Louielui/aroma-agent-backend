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

$UI = CX-NewUI -Title 'Aroma 第二步 —— 操作員檢查' -Subtitle $(if ($DRY) { '試跑 —— 唔會量度任何嘢' } else { '實體機驗收,第 2 步,共 2 步' })
$UI.Banner2('開始緊……', 'info')
foreach ($s in @(
  @('who',   '檢查係唔係正確嘅 Windows 帳戶'),
  @('ready', '接手另一個帳戶交過嚟嘅執行'),
  @('files', '報告已上架檔案'),
  @('partb', '執行 Part B 檢查'),
  @('hand',  '把結果送返去'),
  @('lock5', 'Lock 5 —— 停止控制檢查'),
  @('done',  '完成')
)) { $UI.AddStep($s[0], $s[1]) }

$NONCE = $null
try {
  # ── identity. Not a formality: the whole point of Gate A. ────────────────
  $UI.SetStep('who', 'run', '')
  $me = ([Security.Principal.WindowsIdentity]::GetCurrent()).Name
  $sam = ($me -split '\\')[-1]
  if ($sam -ne $script:CX_Account) {
    $UI.SetStep('who', 'fail', ('而家係以 ' + $me + ' 身分執行'))
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'identity' `
      -Reason ('呢個啟動器必須以 ' + $script:CX_Account + ' 身分執行,而唔係 ' + $me) `
      -Detail @('請切換 Windows 帳戶,再撳嗰個桌面上嘅圖示。','冇量度過任何嘢。') -Launcher 'operator')
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
    $UI.SetStep('ready', 'fail', '冇任何執行喺度等緊')
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'handoff' `
      -Reason '冇任何驗收執行喺度等緊呢個帳戶' `
      -Detail @('請先喺另一個 Windows 帳戶撳擁有者啟動器,等佢叫你切換先。','冇量度過任何嘢。') -Launcher 'operator')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  $NONCE = $round
  $DRY = $DRY -or [bool]$ready.dryRun
  $UI.SetStep('ready', 'ok', ('回合 ' + $round))

  # ── staged files: the probe directory is unreadable to the Owner by design,
  #    so THIS session is the only place the staged hashes can be reported. ──
  $UI.SetStep('files', 'run', '')
  $staged = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $script:CX_ProbeDir -File -ErrorAction SilentlyContinue | Sort-Object Name)) {
    $staged += [ordered]@{ name = $f.Name; bytes = $f.Length; sha256 = (CX-Sha256File -Path $f.FullName) }
  }
  if (@($staged).Count -eq 0) {
    $UI.SetStep('files', 'fail', '探針資料夾係空嘅或者讀唔到')
    [void](CX-Fail -UI $UI -Nonce $NONCE -Stage 'staged-files' -Reason '呢個帳戶讀唔到探針資料夾' -Detail @($script:CX_ProbeDir) -Launcher 'operator')
    $UI.Form.ShowDialog() | Out-Null; exit 1
  }
  [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'STAGED-FILES.json') -Object @{ marker='STAGED-FILES'; files=$staged; at=(Get-Date).ToString('o') })
  $UI.SetStep('files', 'ok', ('記錄咗 ' + @($staged).Count.ToString() + ' 個檔案'))

  # ── PART B ───────────────────────────────────────────────────────────────
  $UI.SetStep('partb', 'run', '')
  $ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $results = @()
  $failed = $null
  if ($DRY) {
    $UI.SetStep('partb', 'skip', '試跑 —— 冇執行任何探針')
  } else {
    foreach ($script in @($ready.partBScripts)) {
      $UI.SetStep('partb', 'run', $script)
      $log = CX-Marker -Nonce $NONCE -Name ($script -replace '\.ps1$', '')
      $log = $log + '.log'
      $p = Start-Process -FilePath $ps -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $script:CX_ProbeDir $script)) `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $log
      $p | Wait-Process -Timeout 900 -ErrorAction SilentlyContinue
      if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force } catch { }; $failed = ($script + ' 逾時'); break }
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
    $UI.SetStep('partb', 'ok', ('完成咗 ' + @($results).Count.ToString() + ' 個探針'))
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
  $UI.SetStep('lock5', 'run', '等緊 Part B 封存')
  $UI.Banner2("Part B 完成。" + "`r`n`r`n" + "請留喺呢度 —— 跟住會做停止控制檢查。" , 'wait')
  $go = CX-WaitForMarker -UI $UI -Path (CX-Marker -Nonce $NONCE -Name 'LOCK5-GO.json') -TimeoutSeconds 900 `
    -WaitBanner 'Part B 完成。等緊另一個帳戶封存佢。'
  if (-not $go) {
    $UI.SetStep('lock5', 'skip', '另一個帳戶冇開啟 Lock 5 —— Part B 結果仍然成立')
  } elseif ($DRY) {
    $UI.SetStep('lock5', 'skip', '試跑')
    [void](CX-WriteJson -Path (CX-Marker -Nonce $NONCE -Name 'LOCK5-DONE.json') -Object @{ marker='LOCK5-DONE'; verdict='SKIPPED'; dryRun=$true; at=(Get-Date).ToString('o') })
  } else {
    $l5 = & (Join-Path $PSScriptRoot 'commissioningLock5Operator.ps1') -UI $UI -Nonce $NONCE
    $UI.SetStep('lock5', $(if ($l5.ok) { 'ok' } else { 'fail' }), $l5.summary)
  }

  $UI.SetStep('done', 'ok', '')
  $UI.Banner2(
    "呢邊完成。" + "`r`n`r`n" +
    "請切返去另一個 Windows 帳戶。" + "`r`n" +
    "嗰個窗會顯示最終結果。", 'pass')
  $UI.SetFoot('回合 ' + $NONCE + '  —  可以閂咗呢個窗。')
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
