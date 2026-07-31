# prepare-canary-precondition.ps1
#
# ===========================================================================
#  RUN THIS AS ADMINISTRATOR, YOURSELF. It is the two things the canary needs
#  that no agent may do: create the one allowed directory with an explicit
#  ALLOW for the Companion, and re-stage the Companion now that its closure
#  has grown from five files to seven.
#
#  IT DOES NOT: open Notepad, set COMPUTER_OPERATOR, start the Companion, ask
#  for a password, touch main, touch production, or execute any work order.
#  It creates one empty folder and copies seven files.
#
#  It is idempotent. Running it twice changes nothing the second time.
# ===========================================================================
#
#  TWO TRAPS THIS SCRIPT EXISTS TO AVOID
#
#  1. THE DEPLOY REPO IS ON main, AND main DOES NOT HAVE THE NEW FILES.
#     deploy-companion.ps1 stages from C:\Aroma\aroma-agent-backend, which is
#     checked out at main. sealedOrderGate.js does not exist there. Running the
#     normal deploy would therefore stage the OLD five-file Companion without
#     any error at all - the exact silent-staleness failure that cost this
#     project a run once already. So this script stages from the worktree that
#     actually holds the branch, and REFUSES if the closure is not the expected
#     seven files.
#
#  2. C:\Aroma HAS AN INHERIT-ONLY DENY FOR THE COMPANION ACCOUNT.
#     deploy-companion.ps1 puts a Deny FullControl on C:\Aroma with
#     ContainerInherit,ObjectInherit + InheritOnly, so EVERY NEW CHILD inherits
#     it. A folder created normally would be denied to the Companion the moment
#     it exists, and the Save As would fail with a permission error that looks
#     like a containment problem and is actually this. So the new folder has
#     inheritance PROTECTED and its own explicit ALLOW - the same shape the
#     staging folder already uses.
#
# ===========================================================================

#Requires -RunAsAdministrator

param(
  [string] $RepoDir = 'C:\Aroma\aroma-3b'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AccountName = 'AromaOperator'
$TestDir     = 'C:\Aroma\ComputerOperator-Test'
$StageDir    = 'C:\Aroma\ComputerOperator-Companion'
$SID_ADMINS  = 'S-1-5-32-544'
$Node        = 'C:\Program Files\nodejs\node.exe'

# The closure this branch expects. Stated here so a mismatch STOPS rather than
# quietly staging whatever it happened to find.
$ExpectedClosure = @(
  'companion-entry.js', 'companion.js', 'computerOperatorFlag.js', 'ipcChannel.js',
  'observation.js', 'sealedOrderGate.js', 'sessionBoundary.js'
)

Write-Host "=== canary precondition: allowed directory + Companion re-stage ===" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# PREFLIGHT - everything checked before anything is changed
# ---------------------------------------------------------------------------
$fail = @()
if (-not (Test-Path -LiteralPath $Node)) { $fail += "node.exe not found at $Node" }
if (-not (Test-Path -LiteralPath $RepoDir)) { $fail += "repo not found: $RepoDir" }
if (-not (Test-Path -LiteralPath (Join-Path $RepoDir 'src\computer\sealedOrderGate.js'))) {
  $fail += "$RepoDir does not contain sealedOrderGate.js - wrong branch or wrong repo"
}

$user = Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
if (-not $user) { $fail += "$AccountName does not exist - run provision-companion-account.ps1 first" }

if ($fail.Count) {
  Write-Host "PREFLIGHT FAILED - nothing was changed:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host ("  " + $_) -ForegroundColor Red }
  exit 1
}
$userSid = $user.SID
Write-Host ("  account : " + $AccountName + "  (" + $userSid.Value + ")") -ForegroundColor Gray
Write-Host ("  repo    : " + $RepoDir) -ForegroundColor Gray

# ---------------------------------------------------------------------------
# 1. THE ONE ALLOWED DIRECTORY
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "1. creating $TestDir with an explicit ALLOW" -ForegroundColor Cyan

if (Test-Path -LiteralPath $TestDir) {
  Write-Host "   already exists - leaving its contents alone, re-asserting the ACL" -ForegroundColor Yellow
} else {
  New-Item -ItemType Directory -Path $TestDir | Out-Null
  Write-Host "   created" -ForegroundColor Green
}

# PROTECTED, and NOT preserving inherited rules: this is what stops the
# inherit-only Deny on C:\Aroma from reaching in. Second argument $false means
# "do not copy the inherited ACEs down" - keeping them would keep the Deny.
$acl = Get-Acl -LiteralPath $TestDir
$acl.SetAccessRuleProtection($true, $false)

# Modify, not FullControl: the Companion must create ONE file here through
# Notepad's Save As. It has no reason to change permissions or take ownership.
$acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  $userSid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
$acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  (New-Object Security.Principal.SecurityIdentifier($SID_ADMINS)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $TestDir -AclObject $acl

# Read it back. An ACL that was set is not the same as an ACL that is in force.
$check = Get-Acl -LiteralPath $TestDir
$allowForOperator = @($check.Access | Where-Object {
  $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -eq $userSid.Value })
$denyForOperator = @($check.Access | Where-Object {
  $_.AccessControlType -eq 'Deny' -and $_.IdentityReference.Value -eq $userSid.Value })

if ($allowForOperator.Count -eq 0) {
  Write-Host "   FAILED: no ALLOW for $AccountName is in force" -ForegroundColor Red
  exit 1
}
if ($denyForOperator.Count -gt 0) {
  Write-Host "   FAILED: a DENY for $AccountName is still in force - it would beat the ALLOW" -ForegroundColor Red
  exit 1
}
Write-Host ("   inheritance protected : " + $check.AreAccessRulesProtected) -ForegroundColor Green
Write-Host ("   ALLOW in force        : " + ($allowForOperator | ForEach-Object { $_.FileSystemRights }) ) -ForegroundColor Green
Write-Host ("   DENY present          : none") -ForegroundColor Green

$existing = @(Get-ChildItem -LiteralPath $TestDir -Force -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
  Write-Host ("   NOTE: the directory is NOT empty (" + $existing.Count + " item(s)). The canary refuses") -ForegroundColor Yellow
  Write-Host ("         to overwrite, so a leftover canary-1.txt would fail the run.") -ForegroundColor Yellow
  $existing | ForEach-Object { Write-Host ("     " + $_.Name) -ForegroundColor Yellow }
} else {
  Write-Host "   empty, as it should be" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 2. RE-STAGE THE COMPANION
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "2. re-staging the Companion from $RepoDir" -ForegroundColor Cyan

$manifest = & $Node (Join-Path $RepoDir 'scripts\computer\companionManifest.js') --list
if ($LASTEXITCODE -ne 0 -or -not $manifest) {
  Write-Host "   FAILED: could not compute the manifest - refusing to stage an incomplete copy" -ForegroundColor Red
  exit 1
}
$manifest = @($manifest)
$names = @($manifest | ForEach-Object { Split-Path $_ -Leaf } | Sort-Object)

# The closure must be EXACTLY what this branch expects. Staging "whatever came
# back" is how a stale five-file Companion gets deployed without complaint.
$diff = Compare-Object -ReferenceObject ($ExpectedClosure | Sort-Object) -DifferenceObject $names
if ($diff) {
  Write-Host "   FAILED: the closure is not what this branch expects - nothing was staged" -ForegroundColor Red
  $diff | ForEach-Object {
    $side = if ($_.SideIndicator -eq '<=') { 'MISSING ' } else { 'UNEXPECTED' }
    Write-Host ("     " + $side + " " + $_.InputObject) -ForegroundColor Red
  }
  exit 1
}
Write-Host ("   closure verified: " + $names.Count + " files") -ForegroundColor Green

# Refuse to destroy anything nobody declared. Same rule as deploy-companion.ps1,
# and for the same reason: a re-stage once silently wiped session-identity.ps1.
if (Test-Path -LiteralPath $StageDir) {
  $present = @(Get-ChildItem -LiteralPath $StageDir -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  $foreign = @($present | Where-Object { $ExpectedClosure -notcontains $_ })
  if ($foreign.Count -gt 0) {
    Write-Host "   *** REFUSING TO RE-STAGE: undeclared files are in the staging directory ***" -ForegroundColor Red
    $foreign | ForEach-Object { Write-Host ("     " + $_) -ForegroundColor Red }
    Write-Host "   Move them somewhere that is not rebuilt, then re-run." -ForegroundColor Yellow
    exit 1
  }
  Remove-Item -LiteralPath $StageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $StageDir | Out-Null

foreach ($srcFile in $manifest) {
  if (-not (Test-Path -LiteralPath $srcFile)) {
    Write-Host ("   FAILED: manifest names a file that does not exist: " + $srcFile) -ForegroundColor Red
    exit 1
  }
  Copy-Item -LiteralPath $srcFile -Destination $StageDir
}

# READ-ONLY to the Companion. It runs this code; it does not get to change it.
$sacl = Get-Acl -LiteralPath $StageDir
$sacl.SetAccessRuleProtection($true, $false)
$sacl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  $userSid, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
$sacl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  (New-Object Security.Principal.SecurityIdentifier($SID_ADMINS)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $StageDir -AclObject $sacl

$staged = @(Get-ChildItem -LiteralPath $StageDir -File | ForEach-Object { $_.Name } | Sort-Object)
if (@(Compare-Object -ReferenceObject ($ExpectedClosure | Sort-Object) -DifferenceObject $staged).Count -gt 0) {
  Write-Host "   FAILED: the staged directory does not match the closure after copying" -ForegroundColor Red
  exit 1
}
Write-Host ("   staged " + $staged.Count + " files, READ-ONLY to " + $AccountName) -ForegroundColor Green
$staged | ForEach-Object { Write-Host ("     " + $_) }

# ---------------------------------------------------------------------------
# DONE
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== BOTH PRECONDITIONS MET ===" -ForegroundColor Green
Write-Host ""
Write-Host ("  " + $TestDir + "   ALLOW Modify for " + $AccountName + ", inheritance protected") -ForegroundColor Green
Write-Host ("  " + $StageDir + "   " + $staged.Count + " files, was 5") -ForegroundColor Green
Write-Host ""
Write-Host "COMPUTER_OPERATOR was NOT set. Nothing was executed. No Notepad was opened." -ForegroundColor Gray
Write-Host ""
Write-Host "ONE STANDING TRAP, worth knowing before the next deploy:" -ForegroundColor Yellow
Write-Host "  deploy-companion.ps1 applies an explicit DENY to every child of C:\Aroma except" -ForegroundColor Yellow
Write-Host "  the two folders in its `$KeepReachable list. This new folder is NOT in that list," -ForegroundColor Yellow
Write-Host "  so the next run of that script WILL deny it again and the canary will fail with a" -ForegroundColor Yellow
Write-Host "  permission error. Either re-run this script afterwards, or have the folder added" -ForegroundColor Yellow
Write-Host "  to `$KeepReachable - that is a code change and needs its own approval." -ForegroundColor Yellow
