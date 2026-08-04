# ===========================================================================
#  Backup-XiangxiangArchive-v2.ps1
#
#  v1 with two changes and nothing else:
#    1. the destination moves off D: to C:\AromaBackupStaging\XiangxiangArchive
#    2. a Backblaze B2 leg is added
#
#  EVERYTHING ELSE IS UNCHANGED, and deliberately so: the snapshot, the manifest,
#  the PROVEN RESTORE, the retention, the record, and — most importantly — the
#  three ACL assertions. This is a NEW FILE rather than an edit to v1 because the
#  scheduled task XiangxiangArchive-LocalBackup still points at v1, and editing
#  v1 in place would have started sending conversations to Backblaze at 02:30
#  tonight without a separate GO. The cutover is its own step.
#
#  ── THE THING THE OWNER APPROVED, WRITTEN DOWN WHERE IT RUNS ──────────────
#  THIS UPLOADS CONVERSATION CONTENT TO BACKBLAZE. archive.jsonl holds verbatim
#  turns, including whatever she quoted from Gmail, Drive, invoices and inventory.
#  Once a snapshot is on B2 it CANNOT BE UNSENT. Owner decision, 2026-08-04:
#  accepted, because the archive being the only store with no off-site copy was
#  the larger risk. v1's closing line "STILL NOT OFF-SITE. Both copies are in
#  this room." is no longer true and has been replaced rather than left to rot.
#
#  ── WHY THE ACL CHECK SURVIVES THE MOVE ───────────────────────────────────
#  v1 refused to write into D:\AromaCoreBackups because that chain grants Everyone
#  FullControl. The same reasoning applies to any new home: C:\AromaBackupStaging
#  inherits from C:\, which grants Authenticated Users write. So this script still
#  builds its own directory with inheritance OFF and nothing copied down, and
#  still RE-CHECKS on every run. Verified 2026-08-04 that louis can do all of
#  that WITHOUT elevation, so the check was not weakened to fit the new location.
#
#  -SkipB2 runs the local half only. Use it once to prove the new destination and
#  the restore before anything leaves the machine.
# ===========================================================================

[CmdletBinding()]
param(
  [int]$KeepSnapshots = 30,
  [switch]$Quiet,
  [switch]$SkipB2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SourceDir   = 'C:\Aroma\XiangxiangLab\conversation-archive'
$DestRoot    = 'C:\AromaBackupStaging\XiangxiangArchive'
$LabRoot     = 'C:\Aroma\XiangxiangLab'
$OperatorSid = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
$Files       = @('archive.jsonl', 'audit.jsonl')   # audit.jsonl may legitimately not exist yet

# The existing, pinned toolchain. Never %APPDATA%, never a PATH lookup.
$RCLONE  = 'C:\ProgramData\AromaBackup\bin\rclone.exe'
$RCONFIG = 'C:\ProgramData\AromaBackup\config\rclone.conf'
$B2BASE  = 'b2:aroma-core-backups/xiangxiang-archive'

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

# rclone's exit code is authoritative; its progress output goes to stderr and is NOT a failure.
function Invoke-Rclone ([string[]]$RArgs) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $RCLONE '--config' $RCONFIG @RArgs 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  [pscustomobject]@{ exit = $code; text = ($out -join "`n") }
}

Say ''
Say '  BACKUP XIANGXIANG ARCHIVE (v2 - C: local + Backblaze off-site)' 'Cyan'
Say ''

# ── 1. PREFLIGHT ──────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $SourceDir)) { Fail "the archive directory does not exist: $SourceDir" }
$srcFiles = @()
foreach ($f in $Files) {
  $p = Join-Path $SourceDir $f
  if (Test-Path -LiteralPath $p) { $srcFiles += (Get-Item -LiteralPath $p) }
}
if ($srcFiles.Count -eq 0) { Fail "there is nothing to back up yet - $SourceDir holds no archive files" }

if (-not $SkipB2) {
  if (-not (Test-Path -LiteralPath $RCLONE))  { Fail "rclone is missing: $RCLONE" }
  if (-not (Test-Path -LiteralPath $RCONFIG)) { Fail "the rclone config is missing: $RCONFIG" }
  if ((Invoke-Rclone @('lsd', 'b2:')).exit -ne 0) { Fail 'Backblaze is not reachable (rclone lsd b2: failed)' }
  Say '  b2       : reachable'
}

# ── 2. DESTINATION, WITH ITS OWN PROTECTED ACL ────────────────────────────
if (-not (Test-Path -LiteralPath $DestRoot)) {
  $null = New-Item -ItemType Directory -Path $DestRoot -Force
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  # Inheritance OFF and nothing copied down. C:\AromaBackupStaging inherits from C:\,
  # which grants Authenticated Users write - exactly the condition v1 refused on D:.
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($who in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators', ("$env:USERDOMAIN\$env:USERNAME"))) {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
      $who, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  Set-Acl -LiteralPath $DestRoot -AclObject $acl
  Say ('  created  : ' + $DestRoot + '  (protected ACL)')
}

# Re-read and CHECK rather than trusting what was just set - every run, so a permission
# loosened later is caught on the next backup rather than never. UNCHANGED from v1.
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
  # Line count only. NEVER a line: this manifest is written beside the data and is read by
  # anyone diagnosing the chain, and a sample would be a second, less-protected copy.
  $lines = @(Get-Content -LiteralPath $sf.FullName | Where-Object { $_.Trim() }).Count
  $entries += [ordered]@{ file = $sf.Name; sha256 = $srcHash; bytes = $sf.Length; records = $lines }
  Say ('  copied   : ' + $sf.Name.PadRight(14) + ' ' + $sf.Length + ' bytes, ' + $lines + ' record(s)')
}

$manifest = [ordered]@{
  schemaVersion = 2
  event         = 'xiangxiang_archive_snapshot'
  takenAt       = (Get-Date).ToUniversalTime().ToString('o')
  source        = $SourceDir
  snapshot      = $snapDir
  files         = $entries
  note          = 'Hashes and counts only. This manifest contains no conversation content.'
  durability    = 'local C: copy + Backblaze B2 off-site'
}
$manifestPath = Join-Path $snapDir 'manifest.json'
$manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath $manifestPath -Encoding utf8

# ── 4. PROVE THE RESTORE ──────────────────────────────────────────────────
# The step that makes this a backup rather than a copy, and it runs BEFORE the upload:
# nothing is sent off-site until it has been proven restorable here. UNCHANGED from v1.
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

# ── 5. OFF-SITE LEG ───────────────────────────────────────────────────────
# Copy-only (never sync/delete/mirror), then rclone check re-compares hashes remotely.
# A copy that cannot be verified is reported as a FAILURE, not as an upload.
$b2Dest = "$B2BASE/snapshot-$stamp"
$offsite = $false
$b2Detail = 'skipped by -SkipB2'
if (-not $SkipB2) {
  Say ''
  Say '  OFF-SITE (Backblaze B2)' 'Cyan'
  Say '    uploading conversation content - this cannot be unsent' 'Yellow'
  $cp = Invoke-Rclone @('copy', $snapDir, $b2Dest)
  if ($cp.exit -ne 0) { Fail "the B2 upload failed (rclone exit $($cp.exit)) - the local snapshot is kept" }
  $ck = Invoke-Rclone @('check', $snapDir, $b2Dest, '--one-way')
  if ($ck.exit -ne 0) { Fail "B2 verification failed (rclone check exit $($ck.exit)) - do NOT treat this snapshot as off-site" }
  $offsite = $true
  $b2Detail = $b2Dest
  Say ('    uploaded + verified : ' + $b2Dest) 'Green'
}

# ── 6. RETENTION ──────────────────────────────────────────────────────────
# Local only. B2 retention is deliberately NOT automated here: this script never deletes
# anything off-site, so a bug on this machine cannot destroy the off-site copy.
$all = @(Get-ChildItem -LiteralPath $DestRoot -Directory -Filter 'snapshot-*' | Sort-Object Name -Descending)
$pruned = 0
if ($all.Count -gt $KeepSnapshots) {
  foreach ($old in $all[$KeepSnapshots..($all.Count - 1)]) {
    Remove-Item -LiteralPath $old.FullName -Recurse -Force
    $pruned++
  }
}
Say ''
Say ('  snapshots: ' + ($all.Count - $pruned) + ' kept locally, ' + $pruned + ' pruned (keep=' + $KeepSnapshots + '); B2 copies are never pruned by this script')

# ── 7. RECORD ─────────────────────────────────────────────────────────────
$record = [ordered]@{
  event           = 'xiangxiang_archive_backup'
  at              = (Get-Date).ToUniversalTime().ToString('o')
  snapshot        = $snapDir
  files           = $entries
  restoreProven   = $true
  restoreDetail   = $restoreDetail
  snapshotsKept   = ($all.Count - $pruned)
  snapshotsPruned = $pruned
  destinationProtected = $true
  offsite         = $offsite
  offsiteTarget   = $b2Detail
  durability      = $(if ($offsite) { 'local C: copy + Backblaze B2 off-site' } else { 'LOCAL ONLY - not off-site' })
  note            = 'No conversation content is recorded in this file.'
}
$recPath = Join-Path $LabRoot ('backup-' + $stamp + '.json')
$record | ConvertTo-Json -Depth 6 | Out-File -FilePath $recPath -Encoding utf8

Say ''
Say '  BACKED UP, AND THE RESTORE WAS PROVEN.' 'Green'
Say ('  ' + $snapDir)
Say ''
if ($offsite) {
  Say '  OFF-SITE COPY MADE. Conversation content is now on Backblaze and cannot be unsent.' 'Yellow'
} else {
  Say '  LOCAL ONLY - nothing left this machine on this run.' 'Yellow'
}
Say ''
if (-not $Quiet) { $null = Read-Host '  Press Enter to close' }
exit 0
