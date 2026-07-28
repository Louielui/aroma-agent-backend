# relocate-probe.ps1 - move the containment probe out of a shared writable location.
#
# RUN THIS YOURSELF, ELEVATED.
#
# WHY IT MOVES AT ALL
# The probe was staged in C:\Users\Public. That was wrong. The AromaOperator DENY on that
# directory carries no (OI), so it does not apply to files inside it, while
# NT AUTHORITY\INTERACTIVE:(OI)(CI)(IO)(M,DC) does inherit down as Modify. AromaOperator
# logged on interactively in session 5 carries S-1-5-4, so it could rewrite the very script
# it was about to execute, leaving a TOCTOU window between hash check and run.
#
# WHY NOT THE COMPANION STAGING TREE
# Staging is derived from the require graph and its whole point is that its contents equal
# the closure exactly. Dropping a non-closure file in would break that invariant, and the
# fix would be an exception in the integrity check - which defeats the check. Worse,
# measured directly: C:\Aroma carries (OI)(CI)(IO)(N), a deny-all that inherits to EVERY
# child, and deploy-companion.ps1 sweeps every child of C:\Aroma applying DENY unless the
# path is in $KeepReachable. A probe directory under C:\Aroma would therefore need a second
# exception and would silently lose read access on the next deploy.
#
# WHERE IT GOES INSTEAD
# C:\AromaOperator-Probe - a sibling of C:\Aroma at the drive root:
#   . not a child of C:\Aroma, so neither deploy-companion.ps1 nor rollback-companion.ps1
#     enumerates it (both use Get-ChildItem -LiteralPath 'C:\Aroma')
#   . not reached by the C:\Aroma inherit-only deny-all
#   . the C:\ DENY for this account carries NO (OI)/(CI) - it is container-only - so nothing
#     hostile is inherited downward either
#   . not in the require closure, so no staging derivation or integrity check sees it
#   . no code anywhere does prefix matching on "C:\Aroma", so the shared prefix is inert
#
# FAIL-CLOSED: the SOURCE is hash-checked BEFORE it is copied. A tampered source is not
# relocated, and the Public copy is not deleted, so nothing is destroyed on a bad run.

#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AccountName  = 'AromaOperator'
$Qualified    = $env:COMPUTERNAME + '\' + $AccountName
$Source       = 'C:\Users\Public\containment-probe-rerun.ps1'
$ProbeDir     = 'C:\AromaOperator-Probe'
$Dest         = Join-Path $ProbeDir 'containment-probe-rerun.ps1'

# pinned out-of-band, in chat, not read from a file next to the script
$ExpectedHash  = 'E72E1004190A7EFFEEE6F87C6FA29B195232AFBE44168050800D632D8638149D'
$ExpectedBytes = 4488

Write-Host "=== relocate containment probe ===" -ForegroundColor Cyan
Write-Host ("running as : " + (whoami) + "   SessionId=" + (Get-Process -Id $PID).SessionId)

# ---------------------------------------------------------------------------
# PREFLIGHT
# ---------------------------------------------------------------------------
$fail = @()
if (-not (Test-Path -LiteralPath $Source)) { $fail += "source missing: $Source" }
if (-not (Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue)) { $fail += "$AccountName does not exist" }
# refuse to sit anywhere under C:\Aroma, for the reasons in the header
if ($ProbeDir -like 'C:\Aroma\*') { $fail += "probe directory must not be under C:\Aroma" }
if ($fail.Count) {
  Write-Host "PREFLIGHT FAILED - nothing moved, nothing deleted:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  return
}

# ---------------------------------------------------------------------------
# 1. verify the SOURCE before trusting it
# ---------------------------------------------------------------------------
$srcHash  = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
$srcBytes = (Get-Item -LiteralPath $Source).Length
Write-Host ""
Write-Host "=== source verification ===" -ForegroundColor Cyan
Write-Host ("  expected : " + $ExpectedHash + "  (" + $ExpectedBytes + " bytes)")
Write-Host ("  actual   : " + $srcHash + "  (" + $srcBytes + " bytes)")
if ($srcHash -ne $ExpectedHash -or $srcBytes -ne $ExpectedBytes) {
  Write-Host ""
  Write-Host "SOURCE HASH MISMATCH - the file in C:\Users\Public is NOT the one that was" -ForegroundColor Red
  Write-Host "verified. It may have been modified. Nothing copied, nothing deleted." -ForegroundColor Red
  Write-Host "Report this - a mismatch here is exactly the tamper case this move prevents." -ForegroundColor Red
  return
}
Write-Host "  MATCH" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. create the probe directory and pin its ACL
# ---------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $ProbeDir)) {
  New-Item -ItemType Directory -Path $ProbeDir | Out-Null
  Write-Host ""
  Write-Host ("created : " + $ProbeDir) -ForegroundColor Green
}

# An explicit DENY is evaluated before any inherited ALLOW, so the result does not depend
# on inheritance ordering. On a DIRECTORY, FileSystemRights::Write covers CreateFiles and
# CreateDirectories - that is what stops the account adding a new file beside the probe.
$denyRights = [Security.AccessControl.FileSystemRights]::Write `
  -bor [Security.AccessControl.FileSystemRights]::Delete `
  -bor [Security.AccessControl.FileSystemRights]::ChangePermissions `
  -bor [Security.AccessControl.FileSystemRights]::TakeOwnership

$dacl = Get-Acl -LiteralPath $ProbeDir
$dacl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
  $Qualified, $denyRights, 'ContainerInherit,ObjectInherit', 'None', 'Deny')))
$dacl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
  $Qualified, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $ProbeDir -AclObject $dacl

# ---------------------------------------------------------------------------
# 3. copy in, then pin the file's own ACL too
# ---------------------------------------------------------------------------
Copy-Item -LiteralPath $Source -Destination $Dest -Force
$dstHash  = (Get-FileHash -LiteralPath $Dest -Algorithm SHA256).Hash
$dstBytes = (Get-Item -LiteralPath $Dest).Length
Write-Host ""
Write-Host "=== destination ===" -ForegroundColor Cyan
Write-Host ("  path     : " + $Dest)
Write-Host ("  SHA-256  : " + $dstHash)
Write-Host ("  bytes    : " + $dstBytes)
if ($dstHash -ne $ExpectedHash) {
  Write-Host "  COPY CORRUPTED - aborting, Public copy left in place" -ForegroundColor Red
  return
}
Write-Host "  copy is byte-identical" -ForegroundColor Green

# explicit on the file as well, so it does not rely on inherited ACEs being ordered right
$facl = Get-Acl -LiteralPath $Dest
$facl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($Qualified, $denyRights, 'Deny')))
$facl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($Qualified, 'ReadAndExecute', 'Allow')))
Set-Acl -LiteralPath $Dest -AclObject $facl

# ---------------------------------------------------------------------------
# 4. report the resulting ACLs
# ---------------------------------------------------------------------------
foreach ($p in @($ProbeDir, $Dest)) {
  Write-Host ""
  Write-Host ("=== ACL for " + $AccountName + " on " + $p + " ===") -ForegroundColor Cyan
  $rules = @((Get-Acl -LiteralPath $p).Access | Where-Object { $_.IdentityReference -like ('*' + $AccountName) })
  if ($rules.Count -eq 0) { Write-Host "  NO ACE FOR THAT ACCOUNT - unexpected" -ForegroundColor Red }
  $rules | ForEach-Object {
    Write-Host ("  {0,-5} {1}   inherited={2}" -f $_.AccessControlType, $_.FileSystemRights, $_.IsInherited) `
      -ForegroundColor $(if ($_.AccessControlType -eq 'Deny') { 'Yellow' } else { 'Green' })
  }
  Write-Host "  icacls:" -ForegroundColor Cyan
  icacls $p
}

Write-Host ""
Write-Host "NOTE: the above is the ACL as CONFIGURED. It is NOT a measurement of what that" -ForegroundColor Yellow
Write-Host "account can actually do. The session-5 command performs that measurement from" -ForegroundColor Yellow
Write-Host "the account itself, which is the only identity that can prove it." -ForegroundColor Yellow

# ---------------------------------------------------------------------------
# 5. remove the shared-writable copy
# ---------------------------------------------------------------------------
Remove-Item -LiteralPath $Source -Force
Write-Host ""
Write-Host ("removed shared-writable copy : " + $Source) -ForegroundColor Green
Write-Host ("  still present : " + (Test-Path -LiteralPath $Source))
Write-Host ""
Write-Host "Next: run the session-5 verify+execute one-liner given in chat." -ForegroundColor Cyan
