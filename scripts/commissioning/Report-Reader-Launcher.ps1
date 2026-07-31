# Report-Reader-Launcher.ps1 - LAUNCHER 3. Bring the commissioning reports somewhere the Owner
# can actually read them.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
# The commissioning reports are written under C:\Aroma\ComputerOperator-Evidence, which needs
# elevation to read (handoff §10). The launchers show the path and SHA-256 on screen, so the
# visit works - but the report the Owner is told to "hand off" is one he cannot open, and
# neither can an unelevated agent. Round 1e80253806ce was therefore diagnosed from source only.
# Inference is not reading. This closes that.
#
# Not for one round. It copies EVERY commissioning round, every time it is pressed, so any
# future report is retrievable by pressing one icon.
#
# ── STRICTLY READ-ONLY ON THE EVIDENCE ──────────────────────────────────────
# It copies OUT. It never writes, moves, deletes or reclassifies anything under the evidence
# root - a reader that can damage the record is not a reader. The only thing it creates is the
# destination folder and its contents.
#
# Same guarantees as the other two: self-elevating, Chinese, no question ever asked, and every
# failure routed through the one fail-safe screen.

param([string]$Destination = 'C:\Aroma\Commissioning-Reports')

. (Join-Path $PSScriptRoot 'commissioningCore.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# ── SELF-ELEVATE ────────────────────────────────────────────────────────────
# Reading the evidence root requires it. Louie presses the icon and answers UAC; he is never
# asked to right-click and choose "Run as administrator".
if (-not (CX-IsElevated)) {
  $argl = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $PSCommandPath,
            '-Destination', $Destination)
  try { Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList $argl -Verb RunAs | Out-Null }
  catch {
    # Declining UAC ends the run safely, with the same three instructions every other stop uses.
    # 'OK' only: never a Yes/No that asks Louie to decide.
    Add-Type -AssemblyName System.Windows.Forms
    $r = CX-Fail -UI $null -Nonce $null -Stage 'elevation' -Reason '冇畀到系統管理員批准' `
      -Detail @('冇讀取過任何嘢，亦冇改動過任何嘢。') -Launcher 'reader'
    [Windows.Forms.MessageBox]::Show(
      (CX-FailSafeBanner -Path $r.txt -Sha $r.sha256), 'Aroma 報告', 'OK', 'Information') | Out-Null
  }
  exit 0
}

# Protected: an unprotected preamble exits with NO window at all, which leaves the person at the
# machine nothing to photograph. See Operator-Verification-Launcher.ps1 for the incident.
$UI = $null
try {
  $UI = CX-NewUI -Title 'Aroma 報告 —— 攞返驗收報告' -Subtitle '把報告抄去一個唔使提權都讀得到嘅資料夾'
} catch {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [Windows.Forms.MessageBox]::Show(
      ('已經停止 —— 而且係安全咁停低咗。' + "`r`n" +
       '呢一步連開始都未開始，冇改動過任何證據。' + "`r`n" +
       '影一張相，然後就可以停手。' + "`r`n`r`n" + $_.Exception.Message),
      'Aroma 報告', 'OK', 'Information') | Out-Null
  } catch { }
  exit 1
}
$UI.Banner2('開始緊……', 'info')

foreach ($s in @(
  @('src',  '揾出所有驗收回合'),
  @('dest', '準備一個你讀得到嘅資料夾'),
  @('copy', '抄出報告'),
  @('index','寫一張總覽'),
  @('done', '完成')
)) { $UI.AddStep($s[0], $s[1]) }

try {
  # ── 1. the source ─────────────────────────────────────────────────────────
  # ── SAFE AT ANY MOMENT, BY CONSTRUCTION ──────────────────────────────────
  # Owner requirement: this icon must be safe to press whenever, and be KNOWN to be. It only
  # ever copies OUT, so it cannot disturb a run in progress or a run that failed. The two
  # "nothing there" cases are therefore NOT failures - showing a red stop screen for an empty
  # folder would teach the red screen to mean nothing, and the red screen has to keep meaning
  # something. Both exit 0.
  $UI.SetStep('src', 'run', '')
  $rounds = @()
  $loose = @()
  if (Test-Path -LiteralPath $script:CX_CommissionRoot) {
    $rounds = @(Get-ChildItem -LiteralPath $script:CX_CommissionRoot -Directory -Force -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime)
    $loose = @(Get-ChildItem -LiteralPath $script:CX_CommissionRoot -File -Force -ErrorAction SilentlyContinue)
  }
  if ($rounds.Count -eq 0 -and $loose.Count -eq 0) {
    $UI.SetStep('src', 'skip', '一份報告都仲未有')
    [void](CX-NotApplicable -UI $UI -Nonce $null -Launcher 'reader' `
      -Why '仲未有任何驗收報告可以攞。' `
      -Detail @('驗收未跑過，或者跑咗但未寫低任何嘢。',
                '呢個圖示幾時撳都安全 —— 佢淨係抄出嚟，唔會改動任何證據。'))
    CX-Wait -UI $UI
    exit 0
  }
  $UI.SetStep('src', 'ok', ($rounds.Count.ToString() + ' 個回合，另有 ' + $loose.Count + ' 個檔案'))

  # ── 2. the destination ────────────────────────────────────────────────────
  # Explicitly granted to the Owner, not left to inheritance: the whole point is that he can
  # open it WITHOUT elevation, and an inherited grant is exactly what is missing upstream.
  $UI.SetStep('dest', 'run', '')
  if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Force -Path $Destination | Out-Null }
  $owner = $null
  try {
    # whoever is being elevated FOR - not the elevated token, which may say Administrator
    $owner = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName
    if ($owner -and $owner.Contains('\')) { $owner = $owner.Split('\')[-1] }
  } catch { }
  if (-not $owner) { $owner = $env:USERNAME }
  try {
    $acl = Get-Acl -LiteralPath $Destination
    $inh = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      ($env:COMPUTERNAME + '\' + $owner), 'Modify', $inh, 'None', 'Allow')))
    Set-Acl -LiteralPath $Destination -AclObject $acl
  } catch {
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'destination' -Reason '開唔到一個你讀得到嘅資料夾' `
      -Detail @($Destination, $_.Exception.Message) -Launcher 'reader')
    CX-Wait -UI $UI; exit 1
  }
  $UI.SetStep('dest', 'ok', $Destination)

  # ── 3. copy OUT. Never back. ──────────────────────────────────────────────
  $UI.SetStep('copy', 'run', '')
  $copied = 0
  $failedFiles = New-Object System.Collections.Generic.List[string]
  $index = New-Object System.Collections.Generic.List[string]
  $index.Add('AROMA COMMISSIONING REPORTS')
  $index.Add('copied from : ' + $script:CX_CommissionRoot)
  $index.Add('copied at   : ' + (Get-Date).ToString('o'))
  $index.Add('')

  foreach ($r in $rounds) {
    $srcDir = $r.FullName
    $dstDir = Join-Path $Destination $r.Name
    if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
    $index.Add('=== round ' + $r.Name + '   (' + $r.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + ') ===')
    foreach ($f in @(Get-ChildItem -LiteralPath $srcDir -File -Force -Recurse -ErrorAction SilentlyContinue)) {
      $rel = $f.FullName.Substring($srcDir.Length).TrimStart('\')
      $target = Join-Path $dstDir $rel
      $tdir = Split-Path $target -Parent
      if (-not (Test-Path -LiteralPath $tdir)) { New-Item -ItemType Directory -Force -Path $tdir | Out-Null }
      try {
        Copy-Item -LiteralPath $f.FullName -Destination $target -Force -ErrorAction Stop
        $copied++
        # hash the COPY: if the copy is what gets handed off, the copy is what must be pinned
        $index.Add(('  {0,-46} {1,8}  {2}' -f $rel, $f.Length, (CX-Sha256File -Path $target)))
      } catch {
        $failedFiles.Add($rel)
        $index.Add(('  {0,-46} COULD NOT COPY' -f $rel))
      }
    }
    $index.Add('')
  }
  foreach ($f in $loose) {
    try {
      Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $Destination $f.Name) -Force -ErrorAction Stop
      $copied++
    } catch { $failedFiles.Add($f.Name) }
  }

  # ── THE RESULT FILES LIVE IN THE EVIDENCE ROOT, NOT THE ROUND DIRECTORY ────
  # Added 2026-07-31. Round 8c019adcbe8a could only be diagnosed by REASONING, because the
  # numbers that would have settled it - windowCount, foundOwnSentinel, ownSignatureSamples and
  # the capture's own failure reasons - sit in stage3-results.json one level up, and this
  # launcher only ever copied the round directory. Diagnosing from inference when the file is
  # sitting on the disk is the thing this phase keeps refusing to do.
  #
  # RECORDS ONLY. The classifier in evidenceStore.js already draws this line and it is drawn
  # here the same way: JSON records, attestations, manifests and probe output come out; RAW
  # CONTENT DOES NOT. Captures (*.png) and UIA node dumps (*.uia.txt) are screen contents, and
  # this destination is readable WITHOUT elevation - copying them here would take material that
  # retention exists to bound and put it somewhere with weaker protection than where it started.
  # That would be a containment regression dressed up as convenience.
  $RECORD_PATTERNS = @(
    'stage3-manifest.json', 'stage3-results.json', 'stage3-topup-results-*.json',
    'stage3-STARTED-*.json', 'stage3-COMPLETED-*.json',
    'stage3-topup-STARTED-*.json', 'stage3-topup-COMPLETED-*.json',
    'stage3-sentinel-owner-*.json', 'stage3-clip-owner-*.json',
    'stage3-uia.json', 'tierA-probe.out', 'tierA-INCIDENT-*.json',
    'observer-task-baseline*.xml', 'observer-result.json', 'session-identity-task.json',
    'probedir-acl-pre-*.txt', 'companion-*.log', 'companion-*.log.err'
  )
  # Belt: even if a pattern above is ever widened by mistake, these never leave.
  $NEVER_COPY = @('*.png', '*.uia.txt', '*.bmp', '*.jpg')

  $UI.SetStep('copy', 'run', '證據根目錄嘅結果檔')
  $rootDir = Join-Path $Destination '_evidence-root'
  if (-not (Test-Path -LiteralPath $rootDir)) { New-Item -ItemType Directory -Force -Path $rootDir | Out-Null }
  $index.Add('=== evidence root (records only - raw content is deliberately NOT copied) ===')
  $rootCopied = 0
  foreach ($pat in $RECORD_PATTERNS) {
    foreach ($f in @(Get-ChildItem -LiteralPath $script:CX_EvidenceRoot -Filter $pat -File -Force -ErrorAction SilentlyContinue)) {
      $skip = $false
      foreach ($bad in $NEVER_COPY) { if ($f.Name -like $bad) { $skip = $true } }
      if ($skip) { continue }
      try {
        Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $rootDir $f.Name) -Force -ErrorAction Stop
        $rootCopied++; $copied++
        $index.Add(('  {0,-46} {1,8}  {2}' -f $f.Name, $f.Length, (CX-Sha256File -Path (Join-Path $rootDir $f.Name))))
      } catch { $failedFiles.Add($f.Name) }
    }
  }
  $index.Add('')
  $index.Add('NOT copied, on purpose: *.png, *.uia.txt - raw screen content. This folder needs no')
  $index.Add('elevation to read; raw material stays where retention and the ACL still bound it.')
  $index.Add('')

  if ($copied -eq 0) {
    [void](CX-Fail -UI $UI -Nonce $null -Stage 'copy' -Reason '一個檔案都抄唔到' `
      -Detail @($failedFiles) -Launcher 'reader')
    CX-Wait -UI $UI; exit 1
  }
  $UI.SetStep('copy', 'ok', ($copied.ToString() + ' 個檔案（其中 ' + $rootCopied + ' 個結果檔）' +
    $(if ($failedFiles.Count) { '，' + $failedFiles.Count + ' 個抄唔到' } else { '' })))

  # ── 4. the index ──────────────────────────────────────────────────────────
  $UI.SetStep('index', 'run', '')
  $indexPath = Join-Path $Destination 'INDEX.txt'
  [IO.File]::WriteAllText($indexPath, (($index -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  $UI.SetStep('index', 'ok', 'INDEX.txt')

  # ── 5. done ───────────────────────────────────────────────────────────────
  $UI.SetStep('done', 'ok', '')
  $UI.Banner2(("報告已經攞返嚟。" + "`r`n`r`n" + $Destination + "`r`n`r`n" +
               '共 ' + $copied + ' 個檔案，' + $rounds.Count + ' 個回合。' +
               $(if ($failedFiles.Count) { "`r`n" + $failedFiles.Count + ' 個抄唔到，已經列咗喺 INDEX.txt。' } else { '' })), 'pass')
  $UI.SetFoot('可以閂咗呢個窗。')
  CX-Wait -UI $UI
  exit 0
}
catch {
  # The outermost catch. Anything unforeseen still ends on a screen — and if the fail-safe
  # screen itself cannot run, CX-Crash writes somewhere readable without elevation.
  $err = $_
  $ok = $false
  try {
    if ($UI) {
      [void](CX-Fail -UI $UI -Nonce $null -Stage 'unexpected' -Reason $err.Exception.Message `
        -Detail @($err.ScriptStackTrace) -Launcher 'reader')
      CX-Wait -UI $UI
      $ok = $true
    }
  } catch { $ok = $false }
  if (-not $ok) { [void](CX-Crash -Launcher 'reader' -ErrorRecord $err -UI $UI) }
  exit 1
}
