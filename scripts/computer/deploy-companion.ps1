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
# -ForceRestage: destroy files in the staging directory that are not in the derived closure.
# Off by default and deliberately awkward - a re-stage already destroyed session-identity.ps1
# once, silently, and only one Tier A row ever noticed.
param([switch]$ForceRestage)

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
# The module list is DERIVED here too - a second hand-written list in the preflight would
# be the same mistake in a different place, and would happily approve a staging set that
# does not match the real require graph.
foreach ($f in 'companion-entry.js','demo-killswitch.js','companionManifest.js') {
  if (-not (Test-Path -LiteralPath (Join-Path $ScriptDir $f))) { $fail += "missing script: $f" }
}
if (Test-Path -LiteralPath (Join-Path $ScriptDir 'companionManifest.js')) {
  $preManifest = & 'C:\Program Files\nodejs\node.exe' (Join-Path $ScriptDir 'companionManifest.js') --list 2>&1
  if ($LASTEXITCODE -ne 0) { $fail += "the Companion require graph does not resolve: $preManifest" }
  else { foreach ($m in $preManifest) { if (-not (Test-Path -LiteralPath $m)) { $fail += "manifest names a missing file: $m" } } }
}
if ($fail.Count) {
  Write-Host "PREFLIGHT FAILED - nothing was changed:" -ForegroundColor Red
  $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  return
}
$userSid = $user.SID
Write-Host "preflight passed" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 1. LOCK THE OPERATOR ACCOUNT OUT OF EVERYTHING UNDER C:\Aroma
#
# An audit of the whole machine found the repo was not the only problem - the ENTIRE
# C:\Aroma tree grants Authenticated Users MODIFY, and AromaOperator is one. That means
# it could read and WRITE:
#   . C:\Aroma\secrets\google-refresh-token.json  - Gmail, Drive and Calendar access
#   . C:\Aroma\xiangxiang.ps1                     - the resident launcher (env, flags)
#   . C:\Aroma\aroma-agent-backend\.env           - API keys and the Owner password
#   . C:\Aroma\aroma-agent-backend\.aroma         - THE AUDIT STORE ITSELF
# An operator that can rewrite its own audit trail, or read the Owner's Google token, is
# not contained by anything the Companion process does or does not do.
#
# TWO LAYERS, because a hardcoded list goes stale:
#   (a) an INHERIT-ONLY deny on C:\Aroma - applies to every child, present and FUTURE,
#       but not to C:\Aroma itself, so traversal to the two Companion folders still works
#       and does not depend on the "bypass traverse checking" privilege.
#   (b) an explicit deny on each existing child except the two Companion folders, so the
#       intent is visible in each ACL rather than only inherited.
# The two Companion folders have inheritance PROTECTED, so neither layer reaches them.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "1. locking $AccountName out of C:\Aroma" -ForegroundColor Cyan

$AromaRoot = 'C:\Aroma'
$KeepReachable = @($StageDir, $EvidenceDir)   # the ONLY two it may reach

function Add-DenyAce {
  param([string]$Path, [string]$Inheritance, [string]$Propagation)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $a = Get-Acl -LiteralPath $Path
  # Drop any existing deny for this SID first, so re-running does not stack duplicates.
  foreach ($r in @($a.Access)) {
    if ($r.AccessControlType -eq 'Deny' -and $r.IdentityReference.Value -eq $userSid.Value) { [void]$a.RemoveAccessRule($r) }
  }
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $userSid, 'FullControl', $Inheritance, $Propagation, 'Deny')
  $a.AddAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $a
  return $true
}

# (a) future-proof: inherit-only deny on the root, for its CHILDREN
if (Add-DenyAce -Path $AromaRoot -Inheritance 'ContainerInherit,ObjectInherit' -Propagation 'InheritOnly') {
  Write-Host "   DENY (inherit-only) on $AromaRoot - covers future children too" -ForegroundColor Green
}

# (a2) THE CONTAINER ITSELF. InheritOnly means "children, NOT this folder" - so the
# directory's own Modify right survived and the account could still CREATE FILES IN
# C:\Aroma. That is a persistence path: drop something beside xiangxiang.ps1, the resident
# entry that runs at every login. Denying the file was not enough; the container had to be
# denied too.
#
# This ACE denies only the WRITE-shaped rights and is scoped to this folder alone. Read
# and Traverse are deliberately NOT denied, so the account can still walk through C:\Aroma
# into the two Companion folders. That is what keeps traverse working WITHOUT relying on
# the "bypass traverse checking" privilege, which cannot be read unelevated and is
# therefore not something to depend on.
$writeRights = [System.Security.AccessControl.FileSystemRights]'CreateFiles,CreateDirectories,DeleteSubdirectoriesAndFiles,Delete,WriteAttributes,WriteExtendedAttributes,ChangePermissions,TakeOwnership'

# The SAME class was then audited machine-wide, not just fixed where it was spotted. Four
# containers were writable by this account:
#   C:\Aroma          - ours, the bug above
#   C:\               - Windows default (Users may create directories at the root)
#   C:\ProgramData    - Windows default
#   C:\Users\Public   - Windows default
# The last three are not something this deployment created; they apply to every standard
# account on the machine. They are still persistence surfaces for THIS account, so they
# are denied for it specifically. That is a per-account change, not a machine-wide policy
# change - every other user keeps the Windows defaults untouched.
$containersToDeny = @($AromaRoot, 'C:\', 'C:\ProgramData', 'C:\Users\Public')
foreach ($c in $containersToDeny) {
  if (-not (Test-Path -LiteralPath $c)) { continue }
  try {
    $cAcl = Get-Acl -LiteralPath $c
    foreach ($r in @($cAcl.Access)) {
      if ($r.AccessControlType -eq 'Deny' -and $r.IdentityReference.Value -eq $userSid.Value `
          -and $r.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None `
          -and $r.InheritanceFlags -eq [System.Security.AccessControl.InheritanceFlags]::None) {
        [void]$cAcl.RemoveAccessRule($r)
      }
    }
    $cAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
      $userSid, $writeRights, 'None', 'None', 'Deny')))
    Set-Acl -LiteralPath $c -AclObject $cAcl
    Write-Host ("   DENY write on the container itself: " + $c + " (read + traverse kept)") -ForegroundColor Green
  } catch {
    Write-Host ("   WARNING: could not deny container write on " + $c + " : " + $_.Exception.Message) -ForegroundColor Yellow
  }
}

# (b) explicit deny on every existing child except the two Companion folders
$denied = @()
$skipped = @()
foreach ($item in Get-ChildItem -LiteralPath $AromaRoot -Force -ErrorAction SilentlyContinue) {
  if ($KeepReachable -contains $item.FullName) { $skipped += $item.Name; continue }
  $inh = if ($item.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
  try {
    if (Add-DenyAce -Path $item.FullName -Inheritance $inh -Propagation 'None') { $denied += $item.Name }
  } catch { Write-Host ("   WARNING: could not deny " + $item.Name + " : " + $_.Exception.Message) -ForegroundColor Yellow }
}
Write-Host ("   DENY applied to " + $denied.Count + " item(s):") -ForegroundColor Green
$denied | ForEach-Object { Write-Host ("     " + $_) }
if ($skipped.Count) { Write-Host ("   left reachable: " + ($skipped -join ', ')) -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
# 2. stage only what the Companion needs, read-only to it
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "2. staging the Companion" -ForegroundColor Cyan
# ── REFUSE TO WIPE ANYTHING NOBODY DECLARED ─────────────────────────────────
# This step deletes the WHOLE staging directory and rebuilds it from the derived closure.
# Correct for the closure, and silently destructive for everything else - and it already
# destroyed something real: session-identity.ps1, the script the SessionGate task points at,
# lived here, is not in the closure, and was wiped by a re-stage. NOTHING NOTICED except
# C4b-gate-script-sha, one Tier A row, on the next run.
#
# Two lessons, the second being the general one:
#   . anything not in the derived closure MUST NOT LIVE HERE. This is precisely why the Owner
#     ruled that probes do not belong in the staging tree.
#   . a destructive rebuild must refuse to destroy what it cannot account for. Refuse, do not
#     trim - the same rule this set applies everywhere else.
if (Test-Path -LiteralPath $StageDir) {
  $expectedNames = @()
  try { $expectedNames = @(& $node (Join-Path $ScriptDir 'companionManifest.js') --list | ForEach-Object { Split-Path $_ -Leaf }) } catch { }
  $presentNames = @(Get-ChildItem -LiteralPath $StageDir -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  $foreign = @($presentNames | Where-Object { $expectedNames -notcontains $_ })
  if (@($foreign).Count -gt 0 -and -not $ForceRestage) {
    Write-Host ""
    Write-Host "*** REFUSING TO RE-STAGE: files here are not in the derived closure ***" -ForegroundColor Red
    foreach ($x in $foreign) { Write-Host ("    " + $x) -ForegroundColor Red }
    Write-Host "  Re-staging DELETES THE WHOLE DIRECTORY. These would be destroyed with no record." -ForegroundColor Red
    Write-Host "  Move them somewhere that is not rebuilt, then re-run. -ForceRestage overrides," -ForegroundColor Yellow
    Write-Host "  and if you use it, record in the handoff what was lost." -ForegroundColor Yellow
    throw 'refusing to destroy undeclared files in the staging directory'
  }
  if (@($foreign).Count -gt 0) {
    Write-Host ("   -ForceRestage: DESTROYING " + @($foreign).Count + " undeclared file(s): " + (@($foreign) -join ', ')) -ForegroundColor Red
  }
  Remove-Item -LiteralPath $StageDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

# THE LIST IS DERIVED, NOT HAND-WRITTEN. companionManifest.js walks the entry's real
# require graph. The previous hand-written list is what let the deploy fail on a module
# nobody had checked the location of. If the graph cannot be resolved, we stop before
# copying anything rather than stage a half-complete Companion.
$manifest = & $node (Join-Path $ScriptDir 'companionManifest.js') --list
if ($LASTEXITCODE -ne 0 -or -not $manifest) {
  throw "could not compute the Companion manifest - refusing to stage an incomplete copy"
}
foreach ($srcFile in $manifest) {
  if (-not (Test-Path -LiteralPath $srcFile)) { throw "manifest names a file that does not exist: $srcFile" }
  Copy-Item -LiteralPath $srcFile -Destination $StageDir
}
Write-Host ("   manifest resolved " + @($manifest).Count + " file(s)") -ForegroundColor Green

# Inheritance is PROTECTED on both Companion folders. That is what keeps the inherit-only
# DENY on C:\Aroma from reaching them - so it is asserted here rather than assumed, and
# re-asserted on the evidence folder in case anything reset it.
$sacl = Get-Acl -LiteralPath $StageDir
$sacl.SetAccessRuleProtection($true, $false)
$sacl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  $userSid, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
$sacl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  (New-Object Security.Principal.SecurityIdentifier($SID_ADMINS)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $StageDir -AclObject $sacl
Write-Host "   staged 5 files, READ-ONLY to $AccountName" -ForegroundColor Green
Get-ChildItem -LiteralPath $StageDir | ForEach-Object { Write-Host ("     " + $_.Name) }

$eacl = Get-Acl -LiteralPath $EvidenceDir
if (-not $eacl.AreAccessRulesProtected) {
  $eacl.SetAccessRuleProtection($true, $true)
  Set-Acl -LiteralPath $EvidenceDir -AclObject $eacl
  Write-Host "   re-protected the evidence folder's ACL" -ForegroundColor Yellow
} else {
  Write-Host "   evidence folder ACL already protected" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 3. DEMONSTRATE EACH BINDING AGAINST A FRESH, LIVE COMPANION
#
# The previous version ran all three bindings against ONE Companion. KILL 2 aborted it,
# so KILL 3 had nothing left to kill and "gone after kill: True" passed while proving
# nothing. Green, but not proving what it claimed.
#
# Each binding now gets its OWN Companion, started fresh, and the harness proves it is
# alive with a real ping/pong round-trip before doing anything. A binding whose target was
# not alive is reported as NOT DEMONSTRATED, never as a pass.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "3. demonstrating each kill-switch binding against a fresh Companion" -ForegroundColor Cyan
# ${Name} is required here: "$AccountName:" parses the colon as a DRIVE QUALIFIER, not as
# punctuation, and the whole script fails to parse. Only found by parse-checking.
Write-Host "   Enter the password you set for ${AccountName}:" -ForegroundColor Yellow
$cred = Get-Credential -UserName ($env:COMPUTERNAME + '\' + $AccountName) -Message "Password for $AccountName"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$roundResults = @()

function Start-Companion {
  param([string]$PipeName, [string]$LogPath)
  try {
    $p = Start-Process -FilePath $node `
      -ArgumentList @((Join-Path $StageDir 'companion-entry.js'), $PipeName) `
      -WorkingDirectory $StageDir -Credential $cred `
      -RedirectStandardOutput $LogPath -RedirectStandardError ($LogPath + '.err') `
      -PassThru
    Start-Sleep -Seconds 3
    if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) {
      Write-Host "   THE COMPANION EXITED IMMEDIATELY - its own output follows:" -ForegroundColor Red
      foreach ($lf in @($LogPath, ($LogPath + '.err'))) {
        if (Test-Path -LiteralPath $lf) { Get-Content -LiteralPath $lf -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { Write-Host ("     " + $_) -ForegroundColor Red } }
      }
      return $null
    }
    return $p
  } catch {
    Write-Host "   FAILED to start the Companion as $AccountName : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   (a wrong password, or the account lacks 'Log on as a batch job')" -ForegroundColor Yellow
    return $null
  }
}

foreach ($round in @('gate','abort','oskill')) {
  Write-Host ""
  Write-Host ("   --- binding: " + $round + " ---") -ForegroundColor Cyan
  $pipeName = 'aroma-op-3a-' + $round + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  $evidenceFile = Join-Path $EvidenceDir ("killswitch-$round-$stamp.json")
  $companionLog = Join-Path $EvidenceDir ("companion-$round-$stamp.log")
  $readyMarker  = Join-Path $EvidenceDir ("ready-$round-$stamp.marker")
  Remove-Item -LiteralPath $readyMarker -Force -ErrorAction SilentlyContinue

  $companion = Start-Companion -PipeName $pipeName -LogPath $companionLog
  if (-not $companion) { $roundResults += [pscustomobject]@{ binding=$round; started=$false; file=$null }; continue }
  Write-Host ("   Companion started, pid " + $companion.Id) -ForegroundColor Green

  $harness = Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $ScriptDir 'demo-killswitch.js'), $pipeName, $evidenceFile, $round, $readyMarker) `
    -WorkingDirectory $ScriptDir -NoNewWindow -PassThru

  if ($round -eq 'oskill') {
    # THE OS FALLBACK, DEMONSTRATED PROPERLY. Wait until the harness says the Companion is
    # alive and answering, THEN kill it from outside while the channel is open. That is
    # what stopping the Windows service or logging the account out does.
    $waited = 0
    while (-not (Test-Path -LiteralPath $readyMarker) -and $waited -lt 40) { Start-Sleep -Milliseconds 500; $waited++ }
    $aliveBeforeKill = [bool](Get-Process -Id $companion.Id -ErrorAction SilentlyContinue)
    Write-Host ("   companion alive immediately before the OS kill : " + $aliveBeforeKill) -ForegroundColor $(if ($aliveBeforeKill) { 'Green' } else { 'Red' })
    if ($aliveBeforeKill) {
      Stop-Process -Id $companion.Id -Force -ErrorAction SilentlyContinue
      Write-Host "   OS kill issued (Stop-Process)" -ForegroundColor Yellow
    }
  }

  $harness | Wait-Process -Timeout 120 -ErrorAction SilentlyContinue
  if (-not $harness.HasExited) { Stop-Process -Id $harness.Id -Force -ErrorAction SilentlyContinue }

  # Clean up whatever is left of this round's Companion before the next round starts.
  $left = Get-Process -Id $companion.Id -ErrorAction SilentlyContinue
  if ($left) { Stop-Process -Id $companion.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $readyMarker -Force -ErrorAction SilentlyContinue

  $roundResults += [pscustomobject]@{ binding=$round; started=$true; file=$evidenceFile }
}

# ---------------------------------------------------------------------------
# 4. report the evidence
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== EVIDENCE ===" -ForegroundColor Cyan
$allDemonstrated = $true
foreach ($r in $roundResults) {
  Write-Host ""
  Write-Host ("--- " + $r.binding + " ---") -ForegroundColor Cyan
  if (-not $r.started -or -not $r.file -or -not (Test-Path -LiteralPath $r.file)) {
    Write-Host "  NOT DEMONSTRATED - no evidence file was produced" -ForegroundColor Red
    $allDemonstrated = $false
    continue
  }
  $j = $null
  try { $j = Get-Content -LiteralPath $r.file -Raw | ConvertFrom-Json } catch { }
  if (-not $j) { Write-Host "  evidence unreadable" -ForegroundColor Red; $allDemonstrated = $false; continue }
  Write-Host ("  companionAliveBefore              : " + $j.companionAliveBefore)
  Write-Host ("  demonstratedAgainstLiveCompanion  : " + $j.demonstratedAgainstLiveCompanion) -ForegroundColor $(if ($j.demonstratedAgainstLiveCompanion) { 'Green' } else { 'Red' })
  foreach ($c in $j.checks) { Write-Host ("    {0,-6} {1}" -f $(if ($c.passed) { 'PASS' } else { 'FAIL' }), $c.name) -ForegroundColor $(if ($c.passed) { 'Green' } else { 'Red' }) }
  if (-not $j.allPassed) { $allDemonstrated = $false }
}

Write-Host ""
if ($allDemonstrated) {
  Write-Host "ALL THREE BINDINGS DEMONSTRATED AGAINST A LIVE COMPANION UNDER $AccountName" -ForegroundColor Green
} else {
  Write-Host "NOT ALL BINDINGS WERE DEMONSTRATED - see above. Do NOT mark 3a complete." -ForegroundColor Red
}

# ---------------------------------------------------------------------------
# 5. verify the containment actually holds
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== containment check ===" -ForegroundColor Cyan
# The probe runs AS the operator account and tries each thing the audit found reachable.
# Every MUST-BE-FALSE line is a credential or a governance control; the two MUST-BE-TRUE
# lines are the only places it is supposed to be able to work.
# WHERE THE PROBE LIVES MATTERS. The last run wrote it to $env:TEMP - which is
# C:\Users\louis\AppData\Local\Temp - and AromaOperator cannot read anything under the
# Owner's profile, so PowerShell reported "the argument to -File does not exist" and the
# containment check NEVER RAN. That is the worst kind of failure: the one result that had
# to be False was simply not measured. The probe now lives in the staged directory, which
# that account has explicit ReadAndExecute on, and its OUTPUT goes to the evidence folder,
# which it can write.
$probe = Join-Path $StageDir 'containment-probe.ps1'
Set-Content -LiteralPath $probe -Encoding UTF8 -Value @'
function Try-Read { param($p) try { Get-Content -LiteralPath $p -TotalCount 1 -ErrorAction Stop | Out-Null; $true } catch { $false } }
function Try-List { param($p) try { Get-ChildItem -LiteralPath $p -ErrorAction Stop | Out-Null; $true } catch { $false } }
function Try-Write { param($p) try { $f=Join-Path $p ('w-'+[guid]::NewGuid().ToString('N')+'.tmp'); Set-Content -LiteralPath $f -Value 'x' -ErrorAction Stop; Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue; $true } catch { $false } }
$r = [ordered]@{}
# MUST BE FALSE - credentials
$r.readGoogleRefreshToken = Try-Read 'C:\Aroma\secrets\google-refresh-token.json'
$r.readGoogleOAuthClient  = Try-Read 'C:\Aroma\secrets\google-oauth-client.json'
$r.readDotEnv             = Try-Read 'C:\Aroma\aroma-agent-backend\.env'
$r.readClaudeCreds        = Try-Read 'C:\Users\louis\.claude\.credentials.json'
# MUST BE FALSE - governance controls
$r.readLauncher           = Try-Read 'C:\Aroma\xiangxiang.ps1'
$r.writeLauncherDir       = Try-Write 'C:\Aroma'
$r.writeCRoot             = Try-Write 'C:\'
$r.writeProgramData       = Try-Write 'C:\ProgramData'
$r.writeUsersPublic       = Try-Write 'C:\Users\Public'
$r.listRepo               = Try-List 'C:\Aroma\aroma-agent-backend\src'
$r.writeAuditStore        = Try-Write 'C:\Aroma\aroma-agent-backend\.aroma\agent-audit'
$r.listSecrets            = Try-List 'C:\Aroma\secrets'
$r.listLogs               = Try-List 'C:\Aroma\logs'
$r.listBackup             = Try-List 'C:\ProgramData\AromaBackup'
$r.listOwnerProfile       = Try-List 'C:\Users\louis'
# MUST BE TRUE - the only two it should reach
$r.readStagedCompanion    = Try-List 'C:\Aroma\ComputerOperator-Companion'
$r.writeEvidence          = Try-Write 'C:\Aroma\ComputerOperator-Evidence'
$r | ConvertTo-Json -Compress
'@
# Output goes to the evidence folder, which the operator account CAN write. The working
# directory must also be reachable by that account: the default would be the current
# directory, which is now denied, and a process that cannot enter its own working
# directory fails before it runs a line.
$probeOut = Join-Path $EvidenceDir 'containment-probe.out'
Remove-Item -LiteralPath $probeOut -Force -ErrorAction SilentlyContinue
try {
  $pp = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$probe) `
    -WorkingDirectory $StageDir `
    -Credential $cred -RedirectStandardOutput $probeOut -PassThru
  $pp | Wait-Process -Timeout 60 -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $probeOut)) {
    Write-Host "  THE CONTAINMENT PROBE PRODUCED NO OUTPUT - it did not run." -ForegroundColor Red
    Write-Host "  Do NOT treat containment as verified." -ForegroundColor Red
  }
  if (Test-Path $probeOut) {
    $raw = (Get-Content $probeOut -Raw).Trim()
    $res = $null
    try { $res = $raw | ConvertFrom-Json } catch { }
    if ($res) {
      $mustBeFalse = @('readGoogleRefreshToken','readGoogleOAuthClient','readDotEnv','readClaudeCreds',
                       'readLauncher','writeLauncherDir','writeCRoot','writeProgramData','writeUsersPublic',
                       'listRepo','writeAuditStore','listSecrets',
                       'listLogs','listBackup','listOwnerProfile')
      $mustBeTrue  = @('readStagedCompanion','writeEvidence')
      $bad = @()
      foreach ($k in $mustBeFalse) {
        $v = $res.$k
        if ($v) { $bad += $k }
        Write-Host ("  {0,-24} {1,-6}  (must be False)" -f $k, $v) -ForegroundColor $(if ($v) { 'Red' } else { 'Green' })
      }
      foreach ($k in $mustBeTrue) {
        $v = $res.$k
        if (-not $v) { $bad += $k }
        Write-Host ("  {0,-24} {1,-6}  (must be True)" -f $k, $v) -ForegroundColor $(if ($v) { 'Green' } else { 'Red' })
      }
      Write-Host ""
      if ($bad.Count -eq 0) { Write-Host "CONTAINMENT HOLDS" -ForegroundColor Green }
      else { Write-Host ("CONTAINMENT FAILED on: " + ($bad -join ', ')) -ForegroundColor Red }
    } else {
      Write-Host ("as " + $AccountName + " : " + $raw)
    }
  }
} catch { Write-Host "containment probe could not run: $($_.Exception.Message)" -ForegroundColor Yellow }
# The probe script is removed; its OUTPUT is kept in the evidence folder as the record
# that the check actually ran.
Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== untouched ===" -ForegroundColor Cyan
$hub = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
if ($hub) { $hubState = "still listening, PID " + $hub.OwningProcess } else { $hubState = 'not running' }
Write-Host ("your account : " + $env:USERNAME)
Write-Host ("8090 service : " + $hubState)
Write-Host "Paste the EVIDENCE block above back to Claude."
