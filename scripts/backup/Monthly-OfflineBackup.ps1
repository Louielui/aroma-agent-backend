<#
================================================================================================
 Monthly-OfflineBackup.ps1 — the Seagate leg, by hand, once a month.

 WHY THIS IS NOT A SCHEDULED TASK, AND MUST NEVER BECOME ONE
 Owner's reasoning, 2026-08-04, and it is correct: a task that fails 29 nights out of 30
 trains you to ignore failures. That is exactly how the real outage went unnoticed for two
 nights — four backup tasks were failing and the noise had already become normal. This runs
 when YOU run it, reports in plain language, and is silent the rest of the month.

 WHAT IT IS FOR
 The cloud legs (B2 for data, GitHub for code) are the automated chain. This adds the third
 physical medium: a copy in your hand, on a disk that is not in this machine. It is also the
 ONLY thing that puts the git repository on a physical disk you own — B2 holds the data
 bundles, GitHub holds the code, and neither is a disk in a drawer.

 D: IS CHECKED PROPERLY, NOT WITH Test-Path
 The whole reason the old chain broke silently: on 2026-08-04 the Seagate was attached,
 Online and Healthy, its partition intact and lettered D — and completely unusable, because
 the volume was BitLocker-locked. Get-Volume reported FileSystem blank, Size 0,
 OperationalStatus Unknown. `Test-Path 'D:\'` returns False for that, but so does a truly
 absent disk, and the two need different words. This checks the volume, not the path.

 NO ELEVATION. Unlocking BitLocker To Go is a password prompt in Explorer, not an admin
 action, so nothing here needs to run elevated.

 NOTHING IS EVER DELETED from D: by this script.
================================================================================================
#>

[CmdletBinding()]
param(
  [string]$DriveLetter = 'D',
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoPath = 'C:\Aroma\aroma-agent-backend'
$Sources  = @(
  [pscustomobject]@{ Name = '倉存/發票資料 (truth-data)';  Path = 'C:\AromaBackupStaging\TruthData' }
  [pscustomobject]@{ Name = '發佈紀錄 (release-records)';  Path = 'C:\AromaBackupStaging\ReleaseRecords' }
  [pscustomobject]@{ Name = '香香對話封存 (archive)';       Path = 'C:\AromaBackupStaging\XiangxiangArchive' }
  # ⛔ ADDED 2026-08-07. Core was omitted from BOTH migrations: Stage1-RetireDStaging.ps1
  # deferred it to a "Stage 2" that was never written, and this list was built without it.
  # Two independent omissions of the same leg — which is how it ran 12 nights unnoticed.
  [pscustomobject]@{ Name = '香香核心資料 (core-data)';    Path = 'C:\AromaBackupStaging\Core' }
  # ⛔ ADDED 2026-08-07 as its own defect, not folded into the protection design:
  # the one file that starts everything was the one file with no copy. The BODY is what
  # holds the flags; the shim at C:Aroma is 21 lines and is pinned by hash instead.
  [pscustomobject]@{ Name = '啟動器 (launcher body)';      Path = 'C:\Aroma\aroma-agent-backend\scripts\launcher' }
)

function Say ([string]$T, [string]$C = 'Gray') {
  if ($Quiet -and $C -eq 'Gray') { return }
  if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C }
}
function Stop-Closed ([string]$Why) {
  Say ''
  Say '  ❌ 冇備份到。' 'Red'
  Say ("     " + $Why) 'Red'
  Say ''
  if (-not $Quiet) { $null = Read-Host '  撳 Enter 關閉' }
  exit 1
}

Say ''
Say '  每月離線備份（Seagate）' 'Cyan'
Say ''

# ── 1. IS THE MEDIUM REALLY THERE, AND REALLY USABLE? ─────────────────────────────────────
$vol = Get-Volume -DriveLetter $DriveLetter -ErrorAction SilentlyContinue
if (-not $vol) {
  Stop-Closed "搵唔到 $DriveLetter`: 磁碟機。個 Seagate 未插上,或者未被系統認到。插好佢再試。"
}
if ([string]::IsNullOrWhiteSpace($vol.FileSystem) -or $vol.Size -le 0) {
  # THE 2026-08-04 SIGNATURE: attached, healthy, lettered — and locked.
  Stop-Closed ("$DriveLetter`: 認到個碟,但讀唔到入面嘅檔案系統 —— 幾乎肯定係 BitLocker 仲鎖住。`n" +
               "     喺檔案總管撳一下 $DriveLetter`: 、輸入密碼解鎖,然後再行呢個捷徑。`n" +
               "     （唔需要管理員權限。）")
}
if (-not (Test-Path -LiteralPath "$DriveLetter`:\")) {
  Stop-Closed "$DriveLetter`: 掛載咗但入唔到。拔出再插一次,或者喺檔案總管解鎖。"
}
$freeGB = [math]::Round($vol.SizeRemaining / 1GB, 1)
Say ("  ✔ $DriveLetter`: 已解鎖,可以寫入（剩 $freeGB GB）") 'Green'

# ── 2. DESTINATION ────────────────────────────────────────────────────────────────────────
$stamp   = (Get-Date).ToString('yyyyMMdd-HHmmss')
$destRoot = Join-Path "$DriveLetter`:\" 'AromaMonthlyOffline'
$dest     = Join-Path $destRoot $stamp
$null = New-Item -ItemType Directory -Path $dest -Force
Say ("  ✔ 目的地：$dest") 'Green'
Say ''

$results = New-Object System.Collections.ArrayList
$copied  = 0
$failed  = 0

function Add-Result ([string]$What, [bool]$Ok, [string]$Detail) {
  [void]$results.Add([pscustomobject]@{ What = $What; Ok = $Ok; Detail = $Detail })
  if ($Ok) { $script:copied++ } else { $script:failed++ }
  Say ('  ' + $(if ($Ok) { '✔' } else { '✘' }) + ' ' + $What.PadRight(30) + ' ' + $Detail) $(if ($Ok) { 'Green' } else { 'Red' })
}

# ── 3. THE B2-VERIFIED BUNDLES ────────────────────────────────────────────────────────────
foreach ($s in $Sources) {
  if (-not (Test-Path -LiteralPath $s.Path)) {
    Add-Result $s.Name $true '未有內容,略過'
    continue
  }
  $files = @(Get-ChildItem -LiteralPath $s.Path -Recurse -File -ErrorAction SilentlyContinue)
  if ($files.Count -eq 0) { Add-Result $s.Name $true '空,略過'; continue }

  $leaf   = Split-Path $s.Path -Leaf
  $target = Join-Path $dest $leaf
  $null = New-Item -ItemType Directory -Path $target -Force

  $bad = 0
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($s.Path.Length).TrimStart('\')
    $to  = Join-Path $target $rel
    $toDir = Split-Path -Parent $to
    if (-not (Test-Path -LiteralPath $toDir)) { $null = New-Item -ItemType Directory -Path $toDir -Force }
    Copy-Item -LiteralPath $f.FullName -Destination $to -Force
    # VERIFY EVERY FILE. A copy is not a backup until the bytes have been compared.
    $a = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    $b = (Get-FileHash -LiteralPath $to        -Algorithm SHA256).Hash
    if ($a -ne $b) { $bad++ }
  }
  Add-Result $s.Name ($bad -eq 0) ("$($files.Count) 個檔" + $(if ($bad -eq 0) { '，全部 sha256 對得上' } else { "，$bad 個對唔上" }))
}

# ── 4. THE REPOSITORY, AS A GIT BUNDLE ────────────────────────────────────────────────────
# The one thing no other leg carries on a disk you can hold. --all takes every branch and
# tag; `git bundle verify` then proves the bundle is complete and readable on its own.
try {
  $git = (Get-Command git -ErrorAction Stop).Source
  $bundle = Join-Path $dest ('aroma-agent-backend-' + $stamp + '.bundle')
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $null = & $git -C $RepoPath bundle create $bundle --all 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0 -or -not (Test-Path -LiteralPath $bundle)) {
    Add-Result '程式碼 (git bundle)' $false "git bundle 失敗 (exit $code)"
  } else {
    $ErrorActionPreference = 'Continue'
    $vout = & $git bundle verify $bundle 2>&1
    $vcode = $LASTEXITCODE
    $ErrorActionPreference = $prev
    $sizeMB = [math]::Round((Get-Item $bundle).Length / 1MB, 1)
    if ($vcode -ne 0) { Add-Result '程式碼 (git bundle)' $false 'bundle 驗證唔過' }
    else {
      $sha = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash
      ($sha + '  ' + (Split-Path $bundle -Leaf)) | Out-File -FilePath (Join-Path $dest 'SHA256SUMS.txt') -Encoding utf8 -Append
      Add-Result '程式碼 (git bundle)' $true ("$sizeMB MB，已驗證")
    }
  }
} catch {
  Add-Result '程式碼 (git bundle)' $false '搵唔到 git'
}

# ── 5. PLAIN-LANGUAGE SUMMARY ─────────────────────────────────────────────────────────────
$record = [ordered]@{
  event = 'monthly_offline_backup'
  at    = (Get-Date).ToUniversalTime().ToString('o')
  dest  = $dest
  items = $results
  ok    = ($failed -eq 0)
}
$record | ConvertTo-Json -Depth 5 | Out-File -FilePath (Join-Path $dest 'backup-record.json') -Encoding utf8

Say ''
if ($failed -eq 0) {
  Say '  ✅ 全部成功。' 'Green'
  Say ("     $copied 項已複製到 $DriveLetter`: 並逐個檔核對過 sha256。") 'Green'
  Say ''
  Say '     而家有三份:呢部機、Backblaze / GitHub、同你手上呢個碟。' 'Green'
  Say '     可以安全咁拔出個碟。' 'Green'
} else {
  Say ("  ⚠️  $copied 項成功,$failed 項失敗。") 'Yellow'
  Say '     未成功嗰啲唔可以當有備份。睇返上面紅色嗰幾行。' 'Yellow'
}
$last = @(Get-ChildItem -LiteralPath $destRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
if ($last.Count -gt 1) { Say ('     上一次:' + $last[1].Name) }
Say ''
if (-not $Quiet) { $null = Read-Host '  撳 Enter 關閉' }
exit $(if ($failed -eq 0) { 0 } else { 1 })
