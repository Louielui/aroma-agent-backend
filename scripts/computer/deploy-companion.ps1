# deploy-companion.ps1 - Computer Operator v0, Phase 3a step 2.
#
# RUN THIS YOURSELF, ELEVATED. Same boundary as the account creation: Claude does not
# change ACLs, launch processes as another user, or deploy software. Read it first.
#
#   & 'C:\Aroma\aroma-agent-backend\scripts\computer\deploy-companion.ps1'
#
# == WHY THIS SCRIPT LOCKS YOU OUT OF SOMETHING FIRST ==
# AromaOperator is a member of Users and therefore an Authenticated User. Your repo grants
# Authenticated Users MODIFY. That means, right now, that account can:
#   . read C:\Aroma\aroma-agent-backend\.env  - your API keys and your Owner password
#   . EDIT the governance code - the approval gate, the audit, the flag matrix
# An operator account that can read your credentials off disk is not contained, no matter
# what the Companion process can or cannot do. So step 1 denies it the repo entirely, and
# the Companion runs from a STAGED COPY containing only the four files it needs.
#
# WHAT IT DOES:
#   1. Denies AromaOperator all access to the repo (explicit DENY beats any inherited Allow).
#   2. Stages 4 files into C:\Aroma\ComputerOperator-Companion, read-only to that account.
#   3. Launches the Companion AS AromaOperator (you will be asked for its password).
#   4. Runs the kill-switch demonstration and writes an evidence file.
#   5. Prints the evidence and cleans up the process.
#
# WHAT IT DOES NOT DO: install a service, enable any flag, touch your session, grant any
# capability, or create C:\Aroma\ComputerOperator-Test.
#
# ROLLBACK: rollback-companion.ps1 removes the staged copy and the account. The repo DENY
# is removed by that script too.

#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AccountName = 'AromaOperator'
$RepoDir     = 'C:\Aroma\aroma-agent-backend'
$StageDir    = 'C:\Aroma\ComputerOperator-Companion'
$EvidenceDir = 'C:\Aroma\ComputerOperator-Evidence'
$SrcDir      = Join-Path $RepoDir 'src\computer'
$ScriptDir   = Join-Path $RepoDir 'scripts\computer'
$SID_ADMINS  = 'S-1-5-32-544'

Write-Host "=== Computer Operator Phase 3a - deploy Companion (zero capability) ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# PREFLIGHT
# ---------------------------------------------------------------------------
$fail = @()
$user = Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
if (-not $user) { $fail += "$AccountName does not exist - run provision-companion-account.ps1 first" }
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $fail += "node.exe not found at $node" }
foreach ($f in 'companion.js','ipcChannel.js','sessionBoundary.js','killSwitch.js') {
  if (-not (Test-Path -LiteralPath (Join-Path $SrcDir $f))) { $fail += "missing module: $f" }
}
foreach ($f in 'companion-entry.js','demo-killswitch.js') {
  if (-not (Test-Path -LiteralPath (Join-Path $ScriptDir $f))) { $fail += "missing script: $f" }
}
if ($fail.Count) {
  Write-Host "PREFLIGHT FAILED - nothing was changed:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  return
}
$userSid = $user.SID
Write-Host "preflight passed" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 1. DENY the operator account the repo. This is the important step.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "1. denying $AccountName access to the repo (.env, governance code)" -ForegroundColor Cyan
$acl = Get-Acl -LiteralPath $RepoDir
$denyRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $userSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Deny')
$acl.AddAccessRule($denyRule)
Set-Acl -LiteralPath $RepoDir -AclObject $acl
Write-Host "   DENY applied to $RepoDir" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. stage only what the Companion needs, read-only to it
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "2. staging the Companion" -ForegroundColor Cyan
if (Test-Path -LiteralPath $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
foreach ($f in 'companion.js','ipcChannel.js','sessionBoundary.js','killSwitch.js') {
  Copy-Item -LiteralPath (Join-Path $SrcDir $f) -Destination $StageDir
}
Copy-Item -LiteralPath (Join-Path $ScriptDir 'companion-entry.js') -Destination $StageDir

$sacl = Get-Acl -LiteralPath $StageDir
$sacl.SetAccessRuleProtection($true, $false)
$sacl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  $userSid, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
$sacl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  (New-Object Security.Principal.SecurityIdentifier($SID_ADMINS)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $StageDir -AclObject $sacl
Write-Host "   staged 5 files, READ-ONLY to $AccountName" -ForegroundColor Green
Get-ChildItem -LiteralPath $StageDir | ForEach-Object { Write-Host ("     " + $_.Name) }

# ---------------------------------------------------------------------------
# 3. launch the Companion AS the operator account
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "3. launching the Companion as $AccountName" -ForegroundColor Cyan
# ${Name} is required here: "$AccountName:" parses the colon as a DRIVE QUALIFIER, not as
# punctuation, and the whole script fails to parse. Only found by parse-checking.
Write-Host "   Enter the password you set for ${AccountName}:" -ForegroundColor Yellow
$cred = Get-Credential -UserName ($env:COMPUTERNAME + '\' + $AccountName) -Message "Password for $AccountName"

$pipeName = 'aroma-op-3a-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$evidenceFile = Join-Path $EvidenceDir ('killswitch-evidence-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$companionLog = Join-Path $EvidenceDir 'companion-stdout.log'

# The Service side starts FIRST so the pipe exists before the Companion connects.
$harness = Start-Process -FilePath $node `
  -ArgumentList @((Join-Path $ScriptDir 'demo-killswitch.js'), $pipeName, $evidenceFile) `
  -WorkingDirectory $ScriptDir -NoNewWindow -PassThru
Start-Sleep -Seconds 2

$companion = $null
try {
  $companion = Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $StageDir 'companion-entry.js'), $pipeName) `
    -WorkingDirectory $StageDir -Credential $cred `
    -RedirectStandardOutput $companionLog -RedirectStandardError ($companionLog + '.err') `
    -PassThru
  Write-Host ("   Companion started, pid " + $companion.Id) -ForegroundColor Green
} catch {
  Write-Host "   FAILED to start the Companion as $AccountName : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "   (a wrong password, or the account lacks 'Log on as a batch job')" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 4. wait for the demonstration, then report
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "4. running the kill-switch demonstration" -ForegroundColor Cyan
$harness | Wait-Process -Timeout 90 -ErrorAction SilentlyContinue
if (-not $harness.HasExited) { Stop-Process -Id $harness.Id -Force -ErrorAction SilentlyContinue }

# KILL 3: the OS fallback. Whatever is left of the Companion is stopped outright.
$stillRunning = $false
if ($companion) {
  $p = Get-Process -Id $companion.Id -ErrorAction SilentlyContinue
  $stillRunning = [bool]$p
  if ($p) { Stop-Process -Id $companion.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500 }
}
$goneAfterOsKill = -not [bool](Get-Process -Id $companion.Id -ErrorAction SilentlyContinue)

Write-Host ""
Write-Host "=== EVIDENCE ===" -ForegroundColor Cyan
if (Test-Path -LiteralPath $evidenceFile) {
  Get-Content -LiteralPath $evidenceFile -Raw | Write-Host
} else {
  Write-Host "no evidence file was produced - the demonstration did not complete" -ForegroundColor Red
}
Write-Host ("KILL 3 (OS fallback) - companion still running before kill : " + $stillRunning)
Write-Host ("KILL 3 (OS fallback) - companion gone after kill           : " + $goneAfterOsKill)
Write-Host ""
Write-Host "=== companion stdout ===" -ForegroundColor Cyan
if (Test-Path -LiteralPath $companionLog) { Get-Content -LiteralPath $companionLog | Select-Object -First 20 }

# ---------------------------------------------------------------------------
# 5. verify the containment actually holds
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== containment check ===" -ForegroundColor Cyan
$probe = Join-Path $env:TEMP 'aroma-op-probe.ps1'
Set-Content -LiteralPath $probe -Encoding UTF8 -Value @'
$r = @{}
$r.canReadEnv  = try { Get-Content 'C:\Aroma\aroma-agent-backend\.env' -TotalCount 1 -ErrorAction Stop; $true } catch { $false }
$r.canListRepo = try { Get-ChildItem 'C:\Aroma\aroma-agent-backend\src' -ErrorAction Stop | Out-Null; $true } catch { $false }
$r.canReadStage = try { Get-ChildItem 'C:\Aroma\ComputerOperator-Companion' -ErrorAction Stop | Out-Null; $true } catch { $false }
$r | ConvertTo-Json -Compress
'@
$probeOut = Join-Path $env:TEMP 'aroma-op-probe.out'
try {
  $pp = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$probe) `
    -Credential $cred -RedirectStandardOutput $probeOut -NoNewWindow -PassThru
  $pp | Wait-Process -Timeout 30 -ErrorAction SilentlyContinue
  if (Test-Path $probeOut) {
    Write-Host ("as " + $AccountName + " : " + (Get-Content $probeOut -Raw).Trim())
    Write-Host "canReadEnv MUST be False, canListRepo MUST be False, canReadStage MUST be True" -ForegroundColor Yellow
  }
} catch { Write-Host "containment probe could not run: $($_.Exception.Message)" -ForegroundColor Yellow }
Remove-Item $probe, $probeOut -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== untouched ===" -ForegroundColor Cyan
$hub = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
if ($hub) { $hubState = "still listening, PID " + $hub.OwningProcess } else { $hubState = 'not running' }
Write-Host ("your account : " + $env:USERNAME)
Write-Host ("8090 service : " + $hubState)
Write-Host "Paste the EVIDENCE block above back to Claude."
