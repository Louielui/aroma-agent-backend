# ===========================================================================
#  Enable-XiangxiangArchive.ps1
#
#  Turns ON Xiangxiang Conversation Archive v0.1 (WRITE ONLY) by adding ONE
#  line to C:\Aroma\xiangxiang.ps1 and restarting the 8090 backend.
#
#  IT CHANGES NOTHING ELSE. Not another flag, not another line, not the
#  Computer Operator, not AromaOperator, not Notepad. The diff is printed and
#  verified line by line before the restart.
#
#  IF THE RESTART IS NOT HEALTHY, THE LAUNCHER IS RESTORED AND RESTARTED with
#  the old settings, automatically, before this script exits.
#
#  The archive is NOT backed up and is NOT durable storage. Enabling it does not
#  change that.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Launcher   = 'C:\Aroma\xiangxiang.ps1'
$Repo       = 'C:\Aroma\aroma-agent-backend'
$LabRoot    = 'C:\Aroma\XiangxiangLab'
$ArchiveDir = 'C:\Aroma\XiangxiangLab\conversation-archive'
$Port       = 8090
$OperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$FlagLine   = "`$env:XIANGXIANG_ARCHIVE = 'on'"
$Anchor     = '$env:MULTI_AI_ROUTER'

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }
function Stop-Now ([string]$Why) {
  Say ''
  Say ('  STOPPED: ' + $Why) 'Red'
  Say '  Nothing was changed.' 'Yellow'
  Say ''
  $null = Read-Host '  Press Enter to close'
  exit 1
}

Say ''
Say '  ENABLE XIANGXIANG ARCHIVE' 'Cyan'
Say ''

# ===========================================================================
#  1. PREFLIGHT - every check, before anything is touched
# ===========================================================================
Say '  PREFLIGHT' 'Cyan'

if (-not (Test-Path -LiteralPath $Launcher)) { Stop-Now "launcher not found: $Launcher" }
if (-not (Test-Path -LiteralPath $Repo)) { Stop-Now "repo not found: $Repo" }

# the running code must be the version that carries the archive
$commit = (& git -C $Repo rev-parse --short HEAD).Trim()
$branch = (& git -C $Repo rev-parse --abbrev-ref HEAD).Trim()
Say ('    repo commit          : ' + $commit + '  (' + $branch + ')')
foreach ($f in @('src\lab\conversationArchive.js', 'src\lab\labArchiveHook.js', 'src\lab\redaction.js')) {
  if (-not (Test-Path -LiteralPath (Join-Path $Repo $f))) { Stop-Now "archive implementation missing: $f" }
}
Say '    archive implementation: present'

# the CJK fix, checked by BEHAVIOUR rather than by reading the source. A comment saying it was
# fixed is not the fix; `\b密碼\b` matched nothing and every Chinese-labelled password went
# straight to disk while the English ones were caught.
$cjk = & node -e "const{redact}=require('$($Repo -replace '\\','/')/src/lab/redaction');const r=redact('密碼: abc123XYZ');process.stdout.write(String(r.hits.length>0 && !r.text.includes('abc123XYZ')))"
if ($cjk -ne 'True') { Stop-Now 'the CJK password-label redaction fix is NOT working' }
Say '    CJK redaction fix     : working (verified by behaviour)'

# targeted tests
Push-Location $Repo
$testOut = & node --test src/lab/conversationArchive.test.js src/routes/demoRouter.test.js 2>&1 | Out-String
Pop-Location
if ($testOut -notmatch '(?m)^.*fail 0\s*$') { Stop-Now 'targeted tests are not green - see output above' }
$passLine = ([regex]::Match($testOut, '(?m)^.*pass (\d+)\s*$')).Groups[1].Value
Say ('    targeted tests        : ' + $passLine + ' pass, 0 fail')

# archive path and its permissions
if (-not (Test-Path -LiteralPath $ArchiveDir)) { Stop-Now "archive directory missing: $ArchiveDir  (run provision-lab-archive.ps1)" }
$acl = Get-Acl -LiteralPath $ArchiveDir
if (-not $acl.AreAccessRulesProtected) { Stop-Now 'the archive directory inherits permissions - it must not' }
$ownerOk = $false
$operatorHas = $false
foreach ($r in @($acl.Access)) {
  $sid = '?'
  try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
  if ($sid -eq $OperatorSid) { $operatorHas = $true }
  if ($r.IdentityReference.Value -like '*louis*' -and $r.AccessControlType -eq 'Allow') { $ownerOk = $true }
}
if (-not $ownerOk) { Stop-Now 'the Owner cannot access the archive directory' }
if ($operatorHas) { Stop-Now 'AromaOperator can access the archive directory - it must not' }
Say ('    archive path          : ' + $ArchiveDir)
Say '    Owner access          : yes      AromaOperator: none (correct)'

# and it must not already be on
$raw = [IO.File]::ReadAllText($Launcher)
if ($raw -match 'XIANGXIANG_ARCHIVE') { Stop-Now 'XIANGXIANG_ARCHIVE is ALREADY in the launcher - nothing to do' }
Say '    XIANGXIANG_ARCHIVE    : not set (as expected)'
Say ''

# ===========================================================================
#  2. BACKUP - and verify it, before any edit
# ===========================================================================
Say '  BACKUP' 'Cyan'
$bytes    = [IO.File]::ReadAllBytes($Launcher)
$hashBefore = (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLower()
$hasBom   = ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$crlf     = ([regex]::Matches($raw, "`r`n")).Count
$lf       = ([regex]::Matches($raw, "(?<!`r)`n")).Count

$stamp  = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$backup = Join-Path $LabRoot ('xiangxiang.ps1.backup-' + $stamp)
[IO.File]::WriteAllBytes($backup, $bytes)
$hashBackup = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLower()
if ($hashBackup -ne $hashBefore) { Stop-Now 'the backup does not match the original - refusing to modify the launcher' }

Say ('    original sha256 : ' + $hashBefore)
Say ('    backup          : ' + $backup)
Say ('    backup sha256   : ' + $hashBackup + '  (identical)')
Say ('    encoding        : UTF-8' + $(if ($hasBom) { ' WITH BOM' } else { ' no BOM' }))
Say ('    line endings    : CRLF=' + $crlf + '  LF=' + $lf)
Say ''

# ===========================================================================
#  3. THE MINIMAL EDIT - one line, inserted after the last feature flag
# ===========================================================================
Say '  EDIT' 'Cyan'
$before = $raw -split "`n"
$anchorIdx = -1
for ($i = 0; $i -lt $before.Count; $i++) { if ($before[$i] -like ($Anchor + '*')) { $anchorIdx = $i } }
if ($anchorIdx -lt 0) { Stop-Now "could not find the anchor line ($Anchor) - refusing to guess where to insert" }

$after = @()
for ($i = 0; $i -lt $before.Count; $i++) {
  $after += $before[$i]
  if ($i -eq $anchorIdx) { $after += $FlagLine }
}

# Rebuild with the SAME line ending and the SAME encoding. Only "\n" is introduced, and the file
# is LF, so nothing about the file's shape changes but the one added line.
$newText = ($after -join "`n")
$enc = New-Object System.Text.UTF8Encoding($hasBom)
[IO.File]::WriteAllText($Launcher, $newText, $enc)

# ── VERIFY: exactly one line added, every other line byte-identical ────────
$check = ([IO.File]::ReadAllText($Launcher)) -split "`n"
if ($check.Count -ne ($before.Count + 1)) {
  [IO.File]::WriteAllBytes($Launcher, $bytes)
  Stop-Now ('expected ' + ($before.Count + 1) + ' lines, got ' + $check.Count + ' - launcher restored')
}
$diffs = @()
$b = 0
for ($i = 0; $i -lt $check.Count; $i++) {
  if ($i -eq ($anchorIdx + 1)) { continue }   # the inserted line
  if ($check[$i] -ne $before[$b]) { $diffs += ('line ' + ($i + 1) + ': "' + $before[$b] + '" -> "' + $check[$i] + '"') }
  $b++
}
if ($diffs.Count -gt 0) {
  [IO.File]::WriteAllBytes($Launcher, $bytes)
  Say '    OTHER LINES CHANGED - launcher restored:' 'Red'
  foreach ($d in $diffs) { Say ('      ' + $d) 'Red' }
  Stop-Now 'the edit was not minimal'
}
$newBytes = [IO.File]::ReadAllBytes($Launcher)
$newHasBom = ($newBytes[0] -eq 0xEF -and $newBytes[1] -eq 0xBB -and $newBytes[2] -eq 0xBF)
$newCrlf = ([regex]::Matches(([IO.File]::ReadAllText($Launcher)), "`r`n")).Count
if ($newHasBom -ne $hasBom -or $newCrlf -ne $crlf) {
  [IO.File]::WriteAllBytes($Launcher, $bytes)
  Stop-Now 'encoding or line endings changed - launcher restored'
}

$hashAfter = (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLower()
Say '    THE EXACT DIFF:' 'Green'
Say ('      + line ' + ($anchorIdx + 2) + ':  ' + $FlagLine) 'Green'
Say ('    other lines changed : 0')
Say ('    encoding/line endings preserved : yes')
Say ('    new sha256 : ' + $hashAfter)
Say ''

# ===========================================================================
#  4. RESTART - 8090 only
# ===========================================================================
Say '  RESTART (8090 only)' 'Cyan'
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
$oldPid = $null
if ($conn) {
  $oldPid = $conn.OwningProcess
  $op = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
  if ($op -and $op.ProcessName -ne 'node') { Stop-Now ("port $Port is held by " + $op.ProcessName + ' - refusing to stop a foreign process') }
  Say ('    stopping node pid ' + $oldPid + ' (started ' + $op.StartTime.ToString('u') + ')')
  Stop-Process -Id $oldPid -Force
  Start-Sleep -Milliseconds 1500
}

Say '    starting via xiangxiang.ps1 ...'
# NOT `& ... | Out-Null` and NOT -Wait. The launcher spawns a HIDDEN node child that outlives it:
#   * a pipeline never sees end-of-stream, because the child inherits the stdout handle;
#   * -Wait waits for the whole process TREE, so it waits on the server we just started.
# Both hang forever after a perfectly successful restart. The health poll below IS the wait.
Start-Process -FilePath 'powershell.exe' `
  -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Launcher, '-Mode', 'Startup' `
  -WindowStyle Hidden

# health, polled
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 750
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4 -UseBasicParsing
    if ($r.StatusCode -eq 200 -and ($r.Content | ConvertFrom-Json).service -eq 'aroma-hub') { $healthy = $true; break }
  } catch { }
}

if (-not $healthy) {
  # ── AUTOMATIC ROLLBACK ────────────────────────────────────────────────
  Say ''
  Say '    NOT HEALTHY - restoring the original launcher and restarting' 'Red'
  [IO.File]::WriteAllBytes($Launcher, $bytes)
  $restored = (Get-FileHash -LiteralPath $Launcher -Algorithm SHA256).Hash.ToLower()
  Say ('    launcher restored, sha256 ' + $restored + '  (matches original: ' + ($restored -eq $hashBefore) + ')')
  $c2 = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($c2) { Stop-Process -Id $c2.OwningProcess -Force; Start-Sleep -Milliseconds 1500 }
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Launcher, '-Mode', 'Startup' `
    -WindowStyle Hidden
  # The rollback restart is polled too, so "the old settings are back" is a measurement.
  $backOk = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 750
    try { if ((Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4 -UseBasicParsing).StatusCode -eq 200) { $backOk = $true; break } } catch { }
  }
  Say ('    old settings healthy again : ' + $backOk) $(if ($backOk) { 'Green' } else { 'Red' })
  Stop-Now 'the backend did not become healthy with the archive enabled; the old settings are back'
}

$newConn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
$newPid = if ($newConn) { $newConn.OwningProcess } else { 0 }
Say ('    healthy. node pid ' + $newPid + $(if ($oldPid) { ' (was ' + $oldPid + ')' } else { '' })) 'Green'
Say ''

# ===========================================================================
#  5. VERIFY
# ===========================================================================
Say '  VERIFY' 'Cyan'
Say ('    launcher sets the flag : yes  (line ' + ($anchorIdx + 2) + ')')
Say ('    backend restarted from that launcher : pid ' + $newPid + ' is new')
$archiveFile = Join-Path $ArchiveDir 'archive.jsonl'
Say ('    archive.jsonl exists   : ' + (Test-Path -LiteralPath $archiveFile) + '   (expected False until the first real turn)')
Say ''
Say '    NOT YET PROVEN HERE, ON PURPOSE:' 'Yellow'
Say '      The flag inside the running process cannot be read from outside it, and'
Say '      /health does not report flags. Proving it by sending a chat turn would mean'
Say '      manufacturing a fake conversation into your archive, which you asked me not'
Say '      to do. Your NEXT REAL MESSAGE proves it: the reply carries a `labArchive`'
Say '      field, and archive.jsonl appears. If it does not, the flag did not take.'
Say ''
Say '    NOT BACKED UP. NOT DURABLE STORAGE.' 'Yellow'
Say ''

# ===========================================================================
#  6. ACTIVATION RECORD - no conversation content
# ===========================================================================
$record = [ordered]@{
  event               = 'xiangxiang_archive_enabled'
  enabledAt           = (Get-Date).ToUniversalTime().ToString('o')
  codeCommit          = $commit
  codeBranch          = $branch
  launcherPath        = $Launcher
  launcherHashBefore  = $hashBefore
  launcherHashAfter   = $hashAfter
  launcherBackup      = $backup
  launcherEncoding    = $(if ($hasBom) { 'utf-8-bom' } else { 'utf-8' })
  launcherLineEndings = $(if ($crlf -gt 0) { 'crlf' } else { 'lf' })
  addedLine           = $FlagLine
  otherLinesChanged   = 0
  archivePath         = $ArchiveDir
  aclProtected        = $true
  ownerHasAccess      = $true
  aromaOperatorAccess = $false
  healthCheck         = 'ok'
  backendPidBefore    = $oldPid
  backendPidAfter     = $newPid
  rollback            = 'run Disable-XiangxiangArchive.ps1, or restore ' + $backup + ' over ' + $Launcher + ' and restart'
  durability          = 'NOT YET BACKED UP / NOT DURABLE'
  note                = 'No conversation content is recorded in this file.'
}
$recPath = Join-Path $LabRoot ('activation-' + $stamp + '.json')
$record | ConvertTo-Json -Depth 4 | Out-File -FilePath $recPath -Encoding utf8
Say ('  Activation record: ' + $recPath) 'DarkGray'
Say ''
Say '  ARCHIVE ENABLED.' 'Green'
Say '  Talk to 香香 as normal. Nothing else changed.' 'White'
Say ''
$null = Read-Host '  Press Enter to close'
exit 0
