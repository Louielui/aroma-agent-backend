# relocate-probe.ps1 - move the containment probe out of a shared writable location.
#
# RUN THIS YOURSELF, ELEVATED.
#
# WHY
# The probe was staged in C:\Users\Public. That was wrong. The AromaOperator DENY on that
# directory carries no (OI), so it does not apply to files inside it, while
# NT AUTHORITY\INTERACTIVE:(OI)(CI)(IO)(M,DC) does inherit down as Modify. AromaOperator
# logged on interactively in session 5 carries S-1-5-4, so it could rewrite the very script
# it was about to execute, leaving a TOCTOU window between hash check and run.
#
# This moves it under the Companion staging tree, where that account has read and execute
# and no write, and pins an explicit DENY on the file so the outcome does not depend on
# reasoning about inheritance order.
#
# FAIL-CLOSED: the SOURCE is hash-checked BEFORE it is copied. A tampered source is not
# relocated, and the Public copy is not deleted, so nothing is destroyed on a bad run.

#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AccountName  = 'AromaOperator'
$Qualified    = $env:COMPUTERNAME + '\' + $AccountName
$Source       = 'C:\Users\Public\containment-probe-rerun.ps1'
$StageDir     = 'C:\Aroma\ComputerOperator-Companion'
$Dest         = Join-Path $StageDir 'containment-probe-rerun.ps1'

# pinned out-of-band, in chat, not read from a file next to the script
$ExpectedHash  = 'E72E1004190A7EFFEEE6F87C6FA29B195232AFBE44168050800D632D8638149D'
$ExpectedBytes = 4488

Write-Host "=== relocate containment probe ===" -ForegroundColor Cyan
Write-Host ("running as : " + (whoami) + "   SessionId=" + (Get-Process -Id $PID).SessionId)

# ---------------------------------------------------------------------------
# PREFLIGHT
# ---------------------------------------------------------------------------
$fail = @()
if (-not (Test-Path -LiteralPath $Source))   { $fail += "source missing: $Source" }
if (-not (Test-Path -LiteralPath $StageDir)) { $fail += "staging directory missing: $StageDir" }
if (-not (Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue)) { $fail += "$AccountName does not exist" }
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
# 2. copy into the staging tree
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

# ---------------------------------------------------------------------------
# 3. pin the ACL explicitly rather than relying on inherited ordering
# ---------------------------------------------------------------------------
# An explicit DENY is evaluated before any inherited ALLOW, so the result does not depend
# on how the C:\Aroma inherit-only DENY and the staging-directory ALLOW happen to order.
$acl = Get-Acl -LiteralPath $Dest
$denyRights = [Security.AccessControl.FileSystemRights]::Write `
  -bor [Security.AccessControl.FileSystemRights]::Delete `
  -bor [Security.AccessControl.FileSystemRights]::ChangePermissions `
  -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
$deny  = New-Object Security.AccessControl.FileSystemAccessRule($Qualified, $denyRights, 'Deny')
$allow = New-Object Security.AccessControl.FileSystemAccessRule($Qualified, 'ReadAndExecute', 'Allow')
$acl.AddAccessRule($deny)
$acl.AddAccessRule($allow)
Set-Acl -LiteralPath $Dest -AclObject $acl

# ---------------------------------------------------------------------------
# 4. report the resulting ACL for that account
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== ACL on the destination for $AccountName ===" -ForegroundColor Cyan
$rules = (Get-Acl -LiteralPath $Dest).Access | Where-Object { $_.IdentityReference -like ('*' + $AccountName) }
if (-not $rules) { Write-Host "  NO EXPLICIT ACE - unexpected" -ForegroundColor Red }
$rules | ForEach-Object {
  Write-Host ("  {0,-5} {1}   inherited={2}" -f $_.AccessControlType, $_.FileSystemRights, $_.IsInherited) `
    -ForegroundColor $(if ($_.AccessControlType -eq 'Deny') { 'Yellow' } else { 'Green' })
}
Write-Host ""
Write-Host "  icacls:" -ForegroundColor Cyan
icacls $Dest

Write-Host ""
Write-Host "NOTE: the above is the ACL as configured. It is NOT a measurement of what that" -ForegroundColor Yellow
Write-Host "account can actually do. The session-5 command below performs that measurement" -ForegroundColor Yellow
Write-Host "from the account itself, which is the only identity that can prove it." -ForegroundColor Yellow

# ---------------------------------------------------------------------------
# 5. remove the shared-writable copy
# ---------------------------------------------------------------------------
Remove-Item -LiteralPath $Source -Force
Write-Host ""
Write-Host ("removed shared-writable copy : " + $Source + "   (still present: " + (Test-Path -LiteralPath $Source) + ")") -ForegroundColor Green

Write-Host ""
Write-Host "=== paste this in session 5, as AromaOperator ===" -ForegroundColor Cyan
Write-Host ""
Write-Host ('$f=''' + $Dest + '''; $e=''' + $ExpectedHash + '''; ...') -ForegroundColor Gray
Write-Host "(the exact one-liner was given in chat alongside this script)" -ForegroundColor Gray
