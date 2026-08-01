# ===========================================================================
#  Disable-XiangxiangArchive.ps1
#
#  Turns OFF Xiangxiang Conversation Archive by removing the ONE line
#  Enable added, and restarting the 8090 backend.
#
#  IT DOES NOT DELETE ANYTHING YOU HAVE ALREADY COLLECTED. Disabling stops new
#  writes; it is not an erase. To remove data, use:
#      node scripts/lab/xiangxiang-archive.js delete --all
#  which is a separate, deliberate act.
#
#  It touches no other line, no other flag, and nothing belonging to the
#  Computer Operator.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Launcher   = 'C:\Aroma\xiangxiang.ps1'
$LabRoot    = 'C:\Aroma\XiangxiangLab'
$ArchiveDir = 'C:\Aroma\XiangxiangLab\conversation-archive'
$Port       = 8090

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }
function Stop-Now ([string]$Why) {
  Say ''
  Say ('  STOPPED: ' + $Why) 'Red'
  Say ''
  $null = Read-Host '  Press Enter to close'
  exit 1
}

Say ''
Say '  DISABLE XIANGXIANG ARCHIVE' 'Cyan'
Say ''

if (-not (Test-Path -LiteralPath $Launcher)) { Stop-Now "launcher not found: $Launcher" }

$bytes = [IO.File]::ReadAllBytes($Launcher)
$raw   = [IO.File]::ReadAllText($Launcher)
$hashBefore = (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLower()
$hasBom = ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$crlf   = ([regex]::Matches($raw, "`r`n")).Count

if ($raw -notmatch 'XIANGXIANG_ARCHIVE') {
  Say '  XIANGXIANG_ARCHIVE is not in the launcher - already disabled.' 'Yellow'
  Say ''
  $files = @(Get-ChildItem -LiteralPath $ArchiveDir -File -Filter '*.jsonl' -ErrorAction SilentlyContinue)
  Say ('  Collected data is untouched: ' + $files.Count + ' file(s) in ' + $ArchiveDir)
  Say ''
  $null = Read-Host '  Press Enter to close'
  exit 0
}

# ── backup before touching it, exactly as Enable does ─────────────────────
$stamp  = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$backup = Join-Path $LabRoot ('xiangxiang.ps1.backup-' + $stamp)
[IO.File]::WriteAllBytes($backup, $bytes)
if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLower() -ne $hashBefore) {
  Stop-Now 'the backup does not match the original - refusing to modify the launcher'
}
Say ('  backup : ' + $backup)

# ── remove ONLY that line ─────────────────────────────────────────────────
$before = $raw -split "`n"
$after  = @()
$removed = @()
for ($i = 0; $i -lt $before.Count; $i++) {
  if ($before[$i] -match '^\s*\$env:XIANGXIANG_ARCHIVE\s*=') { $removed += ('line ' + ($i + 1) + ': ' + $before[$i]); continue }
  $after += $before[$i]
}
if ($removed.Count -ne 1) {
  [IO.File]::WriteAllBytes($Launcher, $bytes)
  Stop-Now ('expected exactly one XIANGXIANG_ARCHIVE line, found ' + $removed.Count + ' - launcher untouched')
}

$enc = New-Object System.Text.UTF8Encoding($hasBom)
[IO.File]::WriteAllText($Launcher, ($after -join "`n"), $enc)

# verify: exactly one line gone, every other line identical
$check = ([IO.File]::ReadAllText($Launcher)) -split "`n"
if ($check.Count -ne ($before.Count - 1)) {
  [IO.File]::WriteAllBytes($Launcher, $bytes)
  Stop-Now 'line count wrong after removal - launcher restored'
}
$diffs = @()
$c = 0
for ($i = 0; $i -lt $before.Count; $i++) {
  if ($before[$i] -match '^\s*\$env:XIANGXIANG_ARCHIVE\s*=') { continue }
  if ($check[$c] -ne $before[$i]) { $diffs += ('line ' + ($i + 1)) }
  $c++
}
if ($diffs.Count -gt 0) {
  [IO.File]::WriteAllBytes($Launcher, $bytes)
  Stop-Now ('other lines changed (' + ($diffs -join ', ') + ') - launcher restored')
}

$hashAfter = (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLower()
Say ''
Say '  THE EXACT DIFF:' 'Green'
foreach ($r in $removed) { Say ('      - ' + $r) 'Green' }
Say '  other lines changed : 0'
Say ('  sha256 ' + $hashBefore + ' -> ' + $hashAfter)
Say ''

# ── restart 8090 only ─────────────────────────────────────────────────────
Say '  RESTART (8090 only)' 'Cyan'
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  $op = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  if ($op -and $op.ProcessName -ne 'node') { Stop-Now ("port $Port is held by " + $op.ProcessName + ' - refusing to stop a foreign process') }
  Say ('    stopping node pid ' + $conn.OwningProcess)
  Stop-Process -Id $conn.OwningProcess -Force
  Start-Sleep -Milliseconds 1500
}
# NOT a pipeline and NOT -Wait: the launcher's hidden node child inherits the parent's stdout
# handle (so `| Out-Null` never sees end-of-stream) and -Wait waits on the whole process tree
# (so it waits on the server itself). Either one hangs after a successful restart. The health
# poll below IS the wait.
Start-Process -FilePath 'powershell.exe' `
  -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Launcher, '-Mode', 'Startup' `
  -WindowStyle Hidden

$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 750
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
}
if (-not $healthy) { Stop-Now 'the backend did not come back healthy - check C:\Aroma\xiangxiang.log' }

$newConn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
Say ('    healthy. node pid ' + $(if ($newConn) { $newConn.OwningProcess } else { '?' })) 'Green'
Say ''

# ── what remains ──────────────────────────────────────────────────────────
$files = @(Get-ChildItem -LiteralPath $ArchiveDir -File -Filter '*.jsonl' -ErrorAction SilentlyContinue)
$turns = 0
$af = Join-Path $ArchiveDir 'archive.jsonl'
if (Test-Path -LiteralPath $af) { $turns = @(Get-Content -LiteralPath $af | Where-Object { $_.Trim() }).Count }

Say '  RESULT' 'Cyan'
Say '    new conversations will NOT be recorded'
Say ('    already-collected data KEPT: ' + $turns + ' turn(s) in ' + $ArchiveDir)
Say '    to erase it, that is a separate command:'
Say '      node scripts\lab\xiangxiang-archive.js delete --all' 'DarkGray'
Say ''

$record = [ordered]@{
  event              = 'xiangxiang_archive_disabled'
  disabledAt         = (Get-Date).ToUniversalTime().ToString('o')
  launcherHashBefore = $hashBefore
  launcherHashAfter  = $hashAfter
  launcherBackup     = $backup
  removedLine        = ($removed -join '; ')
  otherLinesChanged  = 0
  healthCheck        = 'ok'
  dataKept           = $turns
  note               = 'Disabling stops new writes. It does not delete collected data. No conversation content is recorded in this file.'
}
$recPath = Join-Path $LabRoot ('deactivation-' + $stamp + '.json')
$record | ConvertTo-Json -Depth 4 | Out-File -FilePath $recPath -Encoding utf8
Say ('  Record: ' + $recPath) 'DarkGray'
Say ''
$null = Read-Host '  Press Enter to close'
exit 0
