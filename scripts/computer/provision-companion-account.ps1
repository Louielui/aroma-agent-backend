# provision-companion-account.ps1 — Computer Operator v0, Phase 3a.
#
# RUN THIS YOURSELF, ELEVATED. Claude does not create Windows accounts or install
# services: those are system and security changes, and they stay the Owner's to make even
# when authorized. This script is written to be READ before it is run.
#
#   Right-click PowerShell -> "Run as administrator", then:
#     & 'C:\Aroma\aroma-agent-backend\scripts\computer\provision-companion-account.ps1'
#
# WHAT IT DOES, AND NOTHING ELSE:
#   1. Creates a local account named AromaOperator.
#   2. Puts it in Users ONLY — never Administrators.
#   3. Denies it network logon, so it is a local desktop identity and nothing else.
#   4. Creates its evidence folder.
#   5. Prints what it did.
#
# WHAT IT DELIBERATELY DOES NOT DO:
#   · It does not sign that account into anything — no browser, no Google, no bank,
#     no Microsoft account. The bank red line is STRUCTURAL: that profile has no
#     credentials at all, so there is no session to ride. Do not log it into anything.
#   · It does not install a service. That is a separate step, after 3a is reviewed.
#   · It does not touch your own account, profile, files or credentials.
#   · It does not create C:\Aroma\ComputerOperator-Test (that is v0, not Phase 3).
#   · It does not enable COMPUTER_OPERATOR anywhere.
#
# YOU WILL BE ASKED FOR A PASSWORD. Type it yourself; it is never stored in this file,
# never passed on a command line, and never shown to Claude.

#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AccountName  = 'AromaOperator'
$EvidenceDir  = "C:\Aroma\ComputerOperator-Evidence"

Write-Host "=== Computer Operator Phase 3a — provisioning ===" -ForegroundColor Cyan

# ── 1. refuse to run twice ────────────────────────────────────────────────────
if (Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue) {
  Write-Host "$AccountName already exists. Nothing to do." -ForegroundColor Yellow
  Write-Host "To start over, run rollback-companion.ps1 first."
  return
}

# ── 2. the password is typed by you, here, and goes nowhere else ─────────────
Write-Host ""
Write-Host "Choose a password for $AccountName. You will not need to remember it:" -ForegroundColor Yellow
Write-Host "the account is for the Companion process, not for you to log into daily."
$pw = Read-Host -AsSecureString "Password for $AccountName"

# ── 3. create it, NON-ADMIN ───────────────────────────────────────────────────
New-LocalUser -Name $AccountName `
              -Password $pw `
              -FullName 'Aroma Computer Operator' `
              -Description 'Non-admin desktop identity for the Aroma Computer Operator Companion. No credentials, no bank or payroll sessions, brand-new browser profile.' `
              -PasswordNeverExpires `
              -UserMayNotChangePassword | Out-Null

Add-LocalGroupMember -Group 'Users' -Member $AccountName

# Belt and braces: prove it is NOT an administrator.
$admins = (Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue).Name
if ($admins -contains "$env:COMPUTERNAME\$AccountName") {
  throw "REFUSING TO CONTINUE: $AccountName ended up in Administrators."
}

# ── 4. deny network logon — local desktop identity only ───────────────────────
# The account should never be usable to reach this machine from elsewhere.
try {
  $sid = (Get-LocalUser -Name $AccountName).SID.Value
  $cfg = New-TemporaryFile
  secedit /export /cfg $cfg.FullName /quiet
  $txt = Get-Content $cfg.FullName -Raw
  if ($txt -match 'SeDenyNetworkLogonRight\s*=\s*(.*)') {
    $txt = $txt -replace 'SeDenyNetworkLogonRight\s*=\s*(.*)', "SeDenyNetworkLogonRight = `$1,*$sid"
  } else {
    $txt = $txt -replace '(\[Privilege Rights\])', "`$1`r`nSeDenyNetworkLogonRight = *$sid"
  }
  Set-Content -Path $cfg.FullName -Value $txt -Encoding Unicode
  secedit /configure /db "$env:TEMP\aroma-op.sdb" /cfg $cfg.FullName /areas USER_RIGHTS /quiet
  Remove-Item $cfg.FullName -Force -ErrorAction SilentlyContinue
  Write-Host "network logon denied for $AccountName" -ForegroundColor Green
} catch {
  Write-Host "WARNING: could not deny network logon automatically: $_" -ForegroundColor Yellow
  Write-Host "Set it by hand in secpol.msc -> Local Policies -> User Rights Assignment ->"
  Write-Host "'Deny access to this computer from the network' -> add $AccountName."
}

# ── 5. evidence folder, readable only by the Companion and administrators ─────
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$acl = Get-Acl $EvidenceDir
$acl.SetAccessRuleProtection($true, $false)   # drop inherited access
$acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  $AccountName, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
$acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  'Administrators', 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -Path $EvidenceDir -AclObject $acl

# ── 6. report ─────────────────────────────────────────────────────────────────
# Values are computed into plain variables first. Interpolating a $( ) that itself
# contains double quotes does not parse, and a broken script handed over for elevated
# execution is exactly the wrong place to discover that.
$qualified = $env:COMPUTERNAME + '\' + $AccountName
$memberOf = @()
foreach ($g in Get-LocalGroup) {
  $members = (Get-LocalGroupMember -Group $g -ErrorAction SilentlyContinue).Name
  if ($members -contains $qualified) { $memberOf += $g.Name }
}
$isAdmin = $admins -contains $qualified

Write-Host ""
Write-Host "=== created ===" -ForegroundColor Cyan
Get-LocalUser -Name $AccountName | Select-Object Name,Enabled,PasswordNeverExpires,Description | Format-List
Write-Host ("groups        : " + ($memberOf -join ', '))
Write-Host ("is admin      : " + $isAdmin)
Write-Host ("evidence dir  : " + $EvidenceDir)
Write-Host ""
Write-Host "DO NOT sign this account into anything — no browser, no Google, no bank." -ForegroundColor Yellow
Write-Host "Its lack of credentials IS the containment." -ForegroundColor Yellow
