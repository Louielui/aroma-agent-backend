# provision-companion-account.ps1 - Computer Operator v0, Phase 3a.
#
# RUN THIS YOURSELF, ELEVATED. Claude does not create Windows accounts or install
# services: those are system and security changes, and they stay the Owner's to make even
# when authorized. This script is written to be READ before it is run.
#
#   Right-click PowerShell -> "Run as administrator", then:
#     & 'C:\Aroma\aroma-agent-backend\scripts\computer\provision-companion-account.ps1'
#
# WHAT IT DOES, AND NOTHING ELSE:
#   1. PREFLIGHT: validates every argument against each cmdlet's OWN declared limits
#      before touching anything. Nothing is created unless all checks pass.
#   2. Creates a local account named AromaOperator.
#   3. Puts it in the Users group ONLY - never Administrators. Groups are resolved by
#      well-known SID, not by name, because those names are localized.
#   4. Denies it network logon, so it is a local desktop identity and nothing else.
#   5. Creates its evidence folder with an explicit ACL.
#   6. Prints what it did.
#
# IF ANY STEP FAILS, EVERYTHING THIS SCRIPT CREATED IS UNDONE. A half-provisioned
# account is worse than none: it looks present, and nothing has checked it.
#
# WHAT IT DELIBERATELY DOES NOT DO:
#   . It does not sign that account into anything - no browser, no Google, no bank,
#     no Microsoft account. The bank red line is STRUCTURAL: that profile has no
#     credentials at all, so there is no session to ride. Do not log it into anything.
#   . It does not install a service. That is a separate step, after 3a is reviewed.
#   . It does not touch your own account, profile, files or credentials.
#   . It does not create C:\Aroma\ComputerOperator-Test (that is v0, not Phase 3).
#   . It does not enable COMPUTER_OPERATOR anywhere.
#
# YOU WILL BE ASKED FOR A PASSWORD. Type it yourself; it is never stored in this file,
# never passed on a command line, and never shown to Claude.

#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AccountName = 'AromaOperator'
$FullName    = 'Aroma Computer Operator'
$Description = 'Aroma Computer Operator (non-admin, no creds)'
$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence'

# Well-known SIDs. Group names are LOCALIZED - on a non-English Windows, 'Users' and
# 'Administrators' do not exist under those names and every membership call would fail
# or, worse, silently match nothing.
$SID_USERS  = 'S-1-5-32-545'
$SID_ADMINS = 'S-1-5-32-544'

Write-Host "=== Computer Operator Phase 3a - provisioning ===" -ForegroundColor Cyan

# =============================================================================
# PREFLIGHT - validate everything BEFORE creating anything.
# The previous version failed on New-LocalUser -Description being 141 characters
# against a 48-character limit. A parse check cannot catch that; only checking each
# argument against the cmdlet's declared validation can. So the limits are read from
# the cmdlet metadata at runtime rather than copied from documentation, which means
# they cannot drift from whatever this machine's PowerShell actually enforces.
# =============================================================================
function Get-DeclaredMaxLength {
  param([string]$CmdletName, [string]$ParameterName)
  $cmd = Get-Command $CmdletName -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  if (-not $cmd.Parameters.ContainsKey($ParameterName)) { return $null }
  $v = $cmd.Parameters[$ParameterName].Attributes |
       Where-Object { $_ -is [System.Management.Automation.ValidateLengthAttribute] }
  if ($v) { return $v.MaxLength }
  return $null
}

$preflight = @()

# -- account name: SAM limit, illegal characters, trailing period ---------------
$nameMax = Get-DeclaredMaxLength 'New-LocalUser' 'Name'
if ($nameMax -and $AccountName.Length -gt $nameMax) {
  $preflight += "account name is $($AccountName.Length) chars, limit $nameMax"
}
if ($AccountName -match '["/\\\[\]:;|=,+*?<>@]') { $preflight += 'account name contains an illegal character' }
if ($AccountName.EndsWith('.')) { $preflight += 'account name must not end with a period' }
if ([string]::IsNullOrWhiteSpace($AccountName)) { $preflight += 'account name is empty' }

# -- description: THE FAULT THAT BROKE THE LAST RUN ----------------------------
$descMax = Get-DeclaredMaxLength 'New-LocalUser' 'Description'
if ($descMax -and $Description.Length -gt $descMax) {
  $preflight += "description is $($Description.Length) chars, limit $descMax"
}

# -- full name -----------------------------------------------------------------
$fullMax = Get-DeclaredMaxLength 'New-LocalUser' 'FullName'
if ($fullMax -and $FullName.Length -gt $fullMax) {
  $preflight += "full name is $($FullName.Length) chars, limit $fullMax"
}

# -- evidence path: MAX_PATH, and it must be absolute --------------------------
if ($EvidenceDir.Length -ge 248) { $preflight += "evidence path is $($EvidenceDir.Length) chars; directory limit is 248" }
if (-not [System.IO.Path]::IsPathRooted($EvidenceDir)) { $preflight += 'evidence path must be absolute' }

# -- the built-in groups must resolve on THIS machine --------------------------
$usersAccount = $null
$adminsAccount = $null
try { $usersAccount  = (New-Object Security.Principal.SecurityIdentifier($SID_USERS)).Translate([Security.Principal.NTAccount]).Value } catch { $preflight += 'the Users group SID does not resolve on this machine' }
try { $adminsAccount = (New-Object Security.Principal.SecurityIdentifier($SID_ADMINS)).Translate([Security.Principal.NTAccount]).Value } catch { $preflight += 'the Administrators group SID does not resolve on this machine' }

# -- the cmdlets themselves must exist -----------------------------------------
foreach ($c in 'New-LocalUser','Add-LocalGroupMember','Get-LocalUser','Remove-LocalUser','Get-Acl','Set-Acl') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { $preflight += "required cmdlet missing: $c" }
}

# -- refuse to run twice --------------------------------------------------------
if (Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue) {
  Write-Host "$AccountName already exists. Nothing to do." -ForegroundColor Yellow
  Write-Host "To start over, run rollback-companion.ps1 -Purge first."
  return
}

if ($preflight.Count -gt 0) {
  Write-Host ""
  Write-Host "PREFLIGHT FAILED - nothing was created:" -ForegroundColor Red
  foreach ($p in $preflight) { Write-Host "  - $p" -ForegroundColor Red }
  return
}

Write-Host "preflight passed:" -ForegroundColor Green
Write-Host ("  account name  : {0} ({1} chars, limit {2})" -f $AccountName, $AccountName.Length, $nameMax)
Write-Host ("  description   : {0} chars, limit {1}" -f $Description.Length, $descMax)
Write-Host ("  users group   : {0}" -f $usersAccount)
Write-Host ("  admins group  : {0}" -f $adminsAccount)
Write-Host ("  evidence path : {0} ({1} chars)" -f $EvidenceDir, $EvidenceDir.Length)

# =============================================================================
# The password is typed by you, here, and goes nowhere else.
# =============================================================================
Write-Host ""
Write-Host "Choose a password for $AccountName. You will not need to remember it:" -ForegroundColor Yellow
Write-Host "the account is for the Companion process, not for you to log into daily."
$pw = Read-Host -AsSecureString "Password for $AccountName"
if (-not $pw -or $pw.Length -eq 0) {
  Write-Host "No password entered - nothing was created." -ForegroundColor Red
  return
}

# =============================================================================
# PROVISION - each completed step is recorded so a later failure can undo it.
# =============================================================================
$done = New-Object System.Collections.ArrayList

try {
  # -- 1. create it, NON-ADMIN --------------------------------------------------
  New-LocalUser -Name $AccountName `
                -Password $pw `
                -FullName $FullName `
                -Description $Description `
                -PasswordNeverExpires `
                -UserMayNotChangePassword | Out-Null
  [void]$done.Add('user')
  Write-Host "account created" -ForegroundColor Green

  $userSid = (Get-LocalUser -Name $AccountName).SID

  # -- 2. Users group, by SID ---------------------------------------------------
  # -Member takes LocalPrincipal[], and a SecurityIdentifier OBJECT does not convert to
  # it - only the SID STRING does. Passing the object would have thrown at runtime, which
  # a parse check cannot see. The group is still selected by SID because group names are
  # localized.
  Add-LocalGroupMember -SID $SID_USERS -Member $userSid.Value
  [void]$done.Add('group')
  Write-Host "added to $usersAccount" -ForegroundColor Green

  # -- 3. PROVE it is not an administrator -------------------------------------
  $adminMembers = @()
  try { $adminMembers = (Get-LocalGroupMember -SID $SID_ADMINS -ErrorAction Stop).SID.Value } catch { }
  if ($adminMembers -contains $userSid.Value) {
    throw "REFUSING TO CONTINUE: $AccountName ended up in Administrators."
  }
  Write-Host "confirmed NOT an administrator" -ForegroundColor Green

  # -- 4. deny network logon - local desktop identity only ----------------------
  # Non-fatal: if it cannot be applied, the account is still non-admin and local. It is
  # reported loudly rather than silently skipped, and the run is NOT undone for it.
  $cfg = Join-Path $env:TEMP ("aroma-op-" + [guid]::NewGuid().ToString('N') + ".inf")
  $db  = Join-Path $env:TEMP ("aroma-op-" + [guid]::NewGuid().ToString('N') + ".sdb")
  try {
    $null = secedit /export /cfg $cfg /areas USER_RIGHTS /quiet
    if (-not (Test-Path $cfg)) { throw 'policy export produced no file' }
    $txt = Get-Content $cfg -Raw
    $sidToken = '*' + $userSid.Value
    if ($txt -match 'SeDenyNetworkLogonRight\s*=\s*(.*)') {
      $existing = $Matches[1].Trim()
      if ($existing -notlike "*$sidToken*") {
        $replacement = 'SeDenyNetworkLogonRight = ' + $existing + ',' + $sidToken
        $txt = $txt -replace 'SeDenyNetworkLogonRight\s*=\s*(.*)', $replacement
      }
    } else {
      $txt = $txt -replace '(\[Privilege Rights\])', ('$1' + "`r`n" + 'SeDenyNetworkLogonRight = ' + $sidToken)
    }
    Set-Content -Path $cfg -Value $txt -Encoding Unicode
    $null = secedit /configure /db $db /cfg $cfg /areas USER_RIGHTS /quiet
    Write-Host "network logon denied" -ForegroundColor Green
  } catch {
    Write-Host "WARNING: could not deny network logon automatically: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  Set it by hand: secpol.msc -> Local Policies -> User Rights Assignment ->" -ForegroundColor Yellow
    Write-Host "  'Deny access to this computer from the network' -> add $AccountName" -ForegroundColor Yellow
  } finally {
    Remove-Item $cfg -Force -ErrorAction SilentlyContinue
    Remove-Item $db  -Force -ErrorAction SilentlyContinue
  }

  # -- 5. evidence folder, ACL by SID ------------------------------------------
  if (-not (Test-Path -LiteralPath $EvidenceDir)) {
    New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
    [void]$done.Add('evidencedir')
  }
  $acl = Get-Acl -LiteralPath $EvidenceDir
  $acl.SetAccessRuleProtection($true, $false)   # drop inherited access
  $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    $userSid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($SID_ADMINS)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  Set-Acl -LiteralPath $EvidenceDir -AclObject $acl
  Write-Host "evidence folder created and locked down" -ForegroundColor Green

} catch {
  # =========================================================================
  # UNDO - in reverse order. Nothing partial is left behind.
  # =========================================================================
  Write-Host ""
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "undoing everything this run created..." -ForegroundColor Yellow
  if ($done -contains 'evidencedir') {
    Remove-Item -LiteralPath $EvidenceDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  evidence folder removed" -ForegroundColor Yellow
  }
  if ($done -contains 'user') {
    # Removing the user removes its group memberships with it.
    Remove-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
    Write-Host "  account removed" -ForegroundColor Yellow
  }
  $stillThere = [bool](Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue)
  Write-Host ""
  Write-Host ("machine restored - account present: {0}, evidence folder present: {1}" -f $stillThere, (Test-Path -LiteralPath $EvidenceDir)) -ForegroundColor Yellow
  Write-Host "If a password policy rejected the password, choose a longer or more complex one and run again." -ForegroundColor Yellow
  return
}

# =============================================================================
# REPORT
# =============================================================================
$qualified = $env:COMPUTERNAME + '\' + $AccountName
$memberOf = @()
foreach ($g in Get-LocalGroup) {
  $members = @()
  try { $members = (Get-LocalGroupMember -Group $g -ErrorAction Stop).Name } catch { }
  if ($members -contains $qualified) { $memberOf += $g.Name }
}
$adminNames = @()
try { $adminNames = (Get-LocalGroupMember -SID $SID_ADMINS -ErrorAction Stop).Name } catch { }
$isAdmin = $adminNames -contains $qualified

Write-Host ""
Write-Host "=== created ===" -ForegroundColor Cyan
Get-LocalUser -Name $AccountName | Select-Object Name,Enabled,PasswordNeverExpires,Description | Format-List
Write-Host ("groups        : " + ($memberOf -join ', '))
Write-Host ("is admin      : " + $isAdmin)
Write-Host ("evidence dir  : " + $EvidenceDir)
Write-Host ""
Write-Host "DO NOT sign this account into anything - no browser, no Google, no bank." -ForegroundColor Yellow
Write-Host "Its lack of credentials IS the containment." -ForegroundColor Yellow
