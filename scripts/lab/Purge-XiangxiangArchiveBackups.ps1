# ===========================================================================
#  Purge-XiangxiangArchiveBackups.ps1
#
#  RUN THIS AFTER YOU DELETE ANYTHING FROM THE ARCHIVE.
#
#  A backup chain and a delete button are in direct conflict, and the conflict is
#  silent, which is the dangerous kind. `xiangxiang-archive.js delete` removes a
#  turn from the live archive and writes an audit line - but every snapshot taken
#  before that moment still holds the deleted text on D:. The Owner would be told
#  the turn was deleted, and it would still exist.
#
#  Snapshots are whole-file copies, so there is no way to reach inside one and
#  remove a line without rewriting it - and a rewritten snapshot no longer matches
#  the manifest that proves it is intact. The honest resolution is the blunt one:
#  after a deletion, the whole chain goes, and the next backup starts fresh.
#
#  The cost is real and is stated rather than hidden: you lose the history of
#  snapshots. That is the price of a delete button that means what it says.
# ===========================================================================

[CmdletBinding()]
param([switch]$Yes)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DestRoot = 'D:\XiangxiangArchiveBackups'
$LabRoot  = 'C:\Aroma\XiangxiangLab'

function Say ([string]$T, [string]$C = 'Gray') { if ($C -eq 'Gray') { Write-Host $T } else { Write-Host $T -ForegroundColor $C } }

Say ''
Say '  PURGE XIANGXIANG ARCHIVE BACKUPS' 'Cyan'
Say ''

if (-not (Test-Path -LiteralPath $DestRoot)) {
  Say '  There is no backup chain to purge.' 'Yellow'
  Say ''
  $null = Read-Host '  Press Enter to close'
  exit 0
}

$snaps = @(Get-ChildItem -LiteralPath $DestRoot -Directory -Filter 'snapshot-*' | Sort-Object Name)
if ($snaps.Count -eq 0) {
  Say '  The chain is already empty.' 'Yellow'
  Say ''
  $null = Read-Host '  Press Enter to close'
  exit 0
}

Say ('  This will permanently remove ' + $snaps.Count + ' snapshot(s) from:') 'Yellow'
Say ('    ' + $DestRoot)
Say ('    oldest: ' + $snaps[0].Name)
Say ('    newest: ' + $snaps[$snaps.Count - 1].Name)
Say ''
Say '  Do this ONLY after deleting something from the archive. Afterwards you have' 'Yellow'
Say '  no backup at all until the next one runs.' 'Yellow'
Say ''

if (-not $Yes) {
  $answer = Read-Host '  Type PURGE to confirm'
  if ($answer -ne 'PURGE') {
    Say ''
    Say '  Cancelled. Nothing was removed.' 'Green'
    Say ''
    $null = Read-Host '  Press Enter to close'
    exit 0
  }
}

$names = $snaps | ForEach-Object { $_.Name }
foreach ($s in $snaps) { Remove-Item -LiteralPath $s.FullName -Recurse -Force }

$remaining = @(Get-ChildItem -LiteralPath $DestRoot -Directory -Filter 'snapshot-*').Count
if ($remaining -ne 0) { Say ('  WARNING: ' + $remaining + ' snapshot(s) could not be removed') 'Red' }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$record = [ordered]@{
  event      = 'xiangxiang_archive_backups_purged'
  at         = (Get-Date).ToUniversalTime().ToString('o')
  destRoot   = $DestRoot
  purged     = $names.Count
  purgedNames = $names          # snapshot FOLDER names - timestamps, no content
  remaining  = $remaining
  reason     = 'run after an archive deletion so that deleted turns do not survive in snapshots'
  note       = 'No conversation content is recorded in this file.'
}
$recPath = Join-Path $LabRoot ('backup-purge-' + $stamp + '.json')
$record | ConvertTo-Json -Depth 4 | Out-File -FilePath $recPath -Encoding utf8

Say ''
Say ('  Purged ' + $names.Count + ' snapshot(s). THERE IS NO BACKUP UNTIL THE NEXT RUN.') 'Green'
Say ('  Record: ' + $recPath) 'DarkGray'
Say ''
$null = Read-Host '  Press Enter to close'
exit 0
