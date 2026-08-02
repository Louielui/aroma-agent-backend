# ===========================================================================
#  Backup-XiangxiangArchive.ps1
#
#  The archive's own backup chain. Snapshot -> manifest -> VERIFIED RESTORE.
#
#  A store is NOT backed up until a restore has been proven. That is not a
#  slogan here, it is the AromaTruthData-B2Sync precedent: every run below
#  restores the snapshot it just wrote into a scratch directory and compares it
#  byte for byte. If the restore does not match, the snapshot is deleted and the
#  run FAILS - a backup that cannot be restored is worse than none, because it
#  is trusted.
#
#  IT HAS ITS OWN DIRECTORY, WITH ITS OWN ACL, ON PURPOSE.
#  D:\AromaCoreBackups - the existing chain - grants Everyone FullControl. The
#  archive is protected to louis/SYSTEM/Administrators only. Copying it into the
#  existing chain would take a locked store of conversations and drop it
#  somewhere anybody on the machine can read. This script refuses to write to a
#  destination whose permissions are not protected.
#
#  LOCAL LEG ONLY. Nothing here uploads anything anywhere. Sending conversation
#  text to Backblaze or any other outside service is a separate decision the
#  Owner has not made.
# ===========================================================================

[CmdletBinding()]
param(
  [int]$KeepSnapshots = 30,
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SourceDir = 'C:\Aroma\XiangxiangLab\conversation-archive'
$DestRoot  = 'D:\XiangxiangArchiveBackups'
$LabRoot   = 'C:\Aroma\XiangxiangLab'
$OperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$Files     = @('archive.jsonl', 'audit.jsonl')   # audit.jsonl may legitimately not exist yet

function Say ([string]$T, [string]$C = 'Gray') {
  if ($Quiet -and $C -eq 'Gray') { return }
  if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C }
}
function Fail ([string]$Why) {
  Say ''
  Say ('  FAILED: ' + $Why) 'Red'
  Say ''
  if (-not $Quiet) { $null = Read-Host '  Press Enter to close' }
  exit 1
}

Say ''
Say '  BACKUP XIANGXIANG ARCHIVE' 'Cyan'
Say ''

# ── 1. PREFLIGHT ──────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $SourceDir)) { Fail "the archive directory does not exist: $SourceDir" }
$srcFiles = @()
foreach ($f in $Files) {
  $p = Join-Path $SourceDir $f
  if (Test-Path -LiteralPath $p) { $srcFiles += (Get-Item -LiteralPath $p) }
}
if ($srcFiles.Count -eq 0) { Fail "there is nothing to back up yet - $SourceDir holds no archive files" }

if (-not (Test-Path -LiteralPath 'D:\')) { Fail 'drive D: is not present - the backup medium is not attached' }

# ── 2. DESTINATION, WITH ITS OWN PROTECTED ACL ────────────────────────────
if (-not (Test-Path -LiteralPath $DestRoot)) {
  $null = New-Item -ItemType Directory -Path $DestRoot -Force
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  # Inheritance OFF and nothing copied down: the destination does NOT inherit D:'s
  # Everyone-FullControl. This is the whole reason the chain is not a subfolder of
  # D:\AromaCoreBackups.
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($who in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators', ("$env:USERDOMAIN\$env:USERNAME"))) {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
      $who, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  Set-Acl -LiteralPath $DestRoot -AclObject $acl
  Say ('  created  : ' + $DestRoot + '  (protected ACL)')
}

# Re-read and CHECK, rather than trusting what was just set. Every run checks, so a
# permission loosened later is caught on the next backup rather than never.
$dacl = Get-Acl -LiteralPath $DestRoot
if (-not $dacl.AreAccessRulesProtected) { Fail "$DestRoot inherits permissions - refusing to copy conversations into it" }
foreach ($r in @($dacl.Access)) {
  $who = $r.IdentityReference.Value
  if ($r.AccessControlType -ne 'Allow') { continue }
  if ($who -match 'Everyone|Authenticated Users|BUILTIN\\Users') {
    Fail "$DestRoot grants '$who' access - refusing to copy conversations into a world-readable place"
  }
  $sid = $null
  try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { }
  if ($sid -eq $OperatorSid) { Fail "$DestRoot grants AromaOperator access - refusing" }
}
Say ('  dest     : ' + $DestRoot + '  (protected, no Everyone/Users, no AromaOperator)')

# ── 3. SNAPSHOT ───────────────────────────────────────────────────────────
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$snapDir = Join-Path $DestRoot ('snapshot-' + $stamp)
$null = New-Item -ItemType Directory -Path $snapDir -Force

$entries = @()
foreach ($sf in $srcFiles) {
  $target = Join-Path $snapDir $sf.Name
  Copy-Item -LiteralPath $sf.FullName -Destination $target -Force
  $srcHash = (Get-FileHash -LiteralPath $sf.FullName -Algorithm SHA256).Hash.ToLower()
  $dstHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
  if ($srcHash -ne $dstHash) {
    Remove-Item -LiteralPath $snapDir -Recurse -Force
    Fail ('the copy of ' + $sf.Name + ' does not match the source - snapshot discarded')
  }
  # Line count only. NEVER a line: this manifest is written beside the data and read
  # by anyone diagnosing the chain, and a sample of "what got backed up" would be a
  # second, less-protected copy of the conversation.
  $lines = @(Get-Content -LiteralPath $sf.FullName | Where-Object { $_.Trim() }).Count
  $entries += [ordered]@{ file = $sf.Name; sha256 = $srcHash; bytes = $sf.Length; records = $lines }
  Say ('  copied   : ' + $sf.Name.PadRight(14) + ' ' + $sf.Length + ' bytes, ' + $lines + ' record(s)')
}

$manifest = [ordered]@{
  schemaVersion = 1
  event         = 'xiangxiang_archive_snapshot'
  takenAt       = (Get-Date).ToUniversalTime().ToString('o')
  source        = $SourceDir
  snapshot      = $snapDir
  files         = $entries
  note          = 'Hashes and counts only. This manifest contains no conversation content.'
  durability    = 'local second medium only; NOT off-site'
}
$manifestPath = Join-Path $snapDir 'manifest.json'
$manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath $manifestPath -Encoding utf8

# ── 4. PROVE THE RESTORE ──────────────────────────────────────────────────
# The step that makes this a backup rather than a copy. Restore somewhere else and
# compare the bytes; a snapshot that fails is removed, not reported as a success.
Say ''
Say '  RESTORE TEST' 'Cyan'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('xx-restore-' + $stamp)
$null = New-Item -ItemType Directory -Path $scratch -Force
$restoreOk = $true
$restoreDetail = @()
try {
  foreach ($e in $entries) {
    $from = Join-Path $snapDir $e.file
    $to = Join-Path $scratch $e.file
    Copy-Item -LiteralPath $from -Destination $to -Force
    $h = (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash.ToLower()
    $same = ($h -eq $e.sha256)
    # Compare against the LIVE source too. Identical hashes to the manifest prove the
    # copy is intact; identical to the source proves it is the right data.
    $srcNow = (Get-FileHash -LiteralPath (Join-Path $SourceDir $e.file) -Algorithm SHA256).Hash.ToLower()
    $matchesSource = ($h -eq $srcNow)
    if (-not $same) { $restoreOk = $false }
    $restoreDetail += [ordered]@{ file = $e.file; matchesManifest = $same; matchesLiveSource = $matchesSource }
    Say ('    ' + $e.file.PadRight(14) + ' restored, matches manifest: ' + $same + ', matches live source: ' + $matchesSource) $(if ($same) { 'Green' } else { 'Red' })
  }
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $restoreOk) {
  Remove-Item -LiteralPath $snapDir -Recurse -Force
  Fail 'the restore did not match - the snapshot was DELETED rather than left looking valid'
}
Say '    restore PROVEN' 'Green'

# ── 5. RETENTION ──────────────────────────────────────────────────────────
$all = @(Get-ChildItem -LiteralPath $DestRoot -Directory -Filter 'snapshot-*' | Sort-Object Name -Descending)
$pruned = 0
if ($all.Count -gt $KeepSnapshots) {
  foreach ($old in $all[$KeepSnapshots..($all.Count - 1)]) {
    Remove-Item -LiteralPath $old.FullName -Recurse -Force
    $pruned++
  }
}
Say ''
Say ('  snapshots: ' + ($all.Count - $pruned) + ' kept, ' + $pruned + ' pruned (keep=' + $KeepSnapshots + ')')

# ── 6. RECORD ─────────────────────────────────────────────────────────────
$record = [ordered]@{
  event         = 'xiangxiang_archive_backup'
  at            = (Get-Date).ToUniversalTime().ToString('o')
  snapshot      = $snapDir
  files         = $entries
  restoreProven = $true
  restoreDetail = $restoreDetail
  snapshotsKept = ($all.Count - $pruned)
  snapshotsPruned = $pruned
  destinationProtected = $true
  offsite       = $false
  durability    = 'SECOND LOCAL MEDIUM ONLY - not off-site, so a fire or a theft of both disks loses it'
  note          = 'No conversation content is recorded in this file.'
}
$recPath = Join-Path $LabRoot ('backup-' + $stamp + '.json')
$record | ConvertTo-Json -Depth 6 | Out-File -FilePath $recPath -Encoding utf8

Say ''
Say '  BACKED UP, AND THE RESTORE WAS PROVEN.' 'Green'
Say ('  ' + $snapDir)
Say ''
Say '  STILL NOT OFF-SITE. Both copies are in this room.' 'Yellow'
Say ''
if (-not $Quiet) { $null = Read-Host '  Press Enter to close' }
exit 0
