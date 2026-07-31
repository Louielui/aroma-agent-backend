# collect-identity.ps1  -  G4. The Companion measures ITSELF.
#
# ===========================================================================
#  It runs INSIDE the AromaOperator session, as that account, immediately
#  before anything is allowed to act. It emits one JSON snapshot and does
#  nothing else: no desktop action, no file write, no privilege of its own.
#
#  ── WHY MEASURE, RATHER THAN ASSUME ─────────────────────────────────────
#  The canary was sealed, approved and unlocked, and would still have run as
#  louis, because nothing ever asked who was running. A preflight can check a
#  folder, a hash, a flag and an audit sink and still be checking the wrong
#  process's world. So this is the first question, asked by the process that
#  will act, about itself.
#
#  ── EVERY FIELD OR NONE ─────────────────────────────────────────────────
#  A field that cannot be read is emitted as null and the judge REFUSES. It is
#  never omitted and never guessed. An attestation that quietly drops what it
#  could not measure is worse than no attestation, because it looks like
#  evidence.
#
#  ── THE ADMINISTRATORS DISTINCTION ──────────────────────────────────────
#  A filtered (non-elevated) admin token still CARRIES the Administrators SID,
#  as DENY_ONLY - present and unusable. Reporting only presence would refuse
#  every ordinary user; reporting only elevation would miss a token where it
#  is genuinely enabled. So both are reported, separately, and the judge
#  decides.
# ===========================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$COLLECTOR_VERSION = 1

function Emit {
  param([hashtable] $Snapshot)
  $Snapshot | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

# Null on failure, never absent, never invented.
function Try-Get { param([scriptblock] $B) try { & $B } catch { $null } }

$id      = Try-Get { [Security.Principal.WindowsIdentity]::GetCurrent() }
$account = Try-Get { $id.Name }
$sid     = Try-Get { $id.User.Value }
$procId  = Try-Get { ([System.Diagnostics.Process]::GetCurrentProcess()).Id }
$session = Try-Get { ([System.Diagnostics.Process]::GetCurrentProcess()).SessionId }

# Elevation and integrity, from the token rather than from group membership.
$elevated = Try-Get { (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

# MEASURED, not assumed: WindowsIdentity.Groups does NOT carry the integrity
# SID on this machine - the first version of this collector returned null here
# and the judge correctly refused the whole snapshot. whoami /groups does
# expose it, so that is the source, with Groups kept as a fallback rather than
# the other way round.
# ONE list of SID strings, built once. Filtering $id.Groups directly with
# $_.Value throws PropertyNotFoundStrict under StrictMode on some elements -
# measured, not guessed: it is what made integrityLevel come back null and the
# judge refuse the whole snapshot. ToString() on a SecurityIdentifier is the
# SID, and a list of strings has nothing StrictMode can object to.
$sidList = Try-Get { @($id.Groups | ForEach-Object { $_.ToString() }) }

$integrity = Try-Get {
  # NOT [0]. Under StrictMode -Version Latest, indexing an EMPTY array throws
  # IndexOutOfRangeException rather than yielding $null - measured, and it is
  # exactly what made this whole fallback dead code: the throw happened on this
  # line, Try-Get swallowed it, integrityLevel came back null, and the judge
  # refused every snapshot. The whoami branch below was never once reached.
  # Select-Object -First 1 yields nothing on an empty pipeline and cannot throw.
  $lvl = $sidList | Where-Object { $_ -like 'S-1-16-*' } | Select-Object -First 1
  if (-not $lvl) {
    $lvl = (whoami /groups /fo csv | ConvertFrom-Csv | Where-Object { $_.SID -like 'S-1-16-*' } | Select-Object -First 1).SID
  }
  switch ($lvl) {
    'S-1-16-4096'  { 'Low' }
    'S-1-16-8192'  { 'Medium' }
    'S-1-16-8448'  { 'MediumPlus' }
    'S-1-16-12288' { 'High' }
    'S-1-16-16384' { 'System' }
    default        { if ($lvl) { $lvl } else { $null } }
  }
}

$groups = $sidList

# Presence and ENABLED state are different questions. Claims carries the
# attribute; a deny-only Administrators SID is present in Groups but is not an
# enabled claim, which is exactly the distinction that matters.
$adminSid = 'S-1-5-32-544'
$adminsPresent = Try-Get { [bool](@($sidList | Where-Object { $_ -eq $adminSid }).Count -gt 0) }
$adminsEnabled = Try-Get {
  [bool](@($id.Claims | Where-Object {
    $_.Type -eq 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groupsid' -and $_.Value -eq $adminSid
  }).Count -gt 0)
}

# The window station and desktop this thread is attached to. Session 0 and the
# service window station have no interactive desktop, so UIA finds nothing -
# which is why "it did not work" must never be reported as "nothing was there".
$desktop = Try-Get {
  Add-Type -Namespace Aroma -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetProcessWindowStation();
[DllImport("user32.dll")] public static extern System.IntPtr GetThreadDesktop(uint id);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(System.IntPtr h, int i, System.Text.StringBuilder p, int n, out uint need);
'@ -ErrorAction Stop
  $sb = New-Object System.Text.StringBuilder 256
  $need = 0
  [void][Aroma.W]::GetUserObjectInformation([Aroma.W]::GetProcessWindowStation(), 2, $sb, 256, [ref]$need)
  $ws = $sb.ToString()
  $sb2 = New-Object System.Text.StringBuilder 256
  [void][Aroma.W]::GetUserObjectInformation([Aroma.W]::GetThreadDesktop([Aroma.W]::GetCurrentThreadId()), 2, $sb2, 256, [ref]$need)
  if ($ws -and $sb2.ToString()) { $ws + '\' + $sb2.ToString() } else { $null }
}

$interactive = Try-Get { [bool]([Environment]::UserInteractive -and $session -gt 0) }

$self = Try-Get { (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLower() }

Emit @{
  account               = $account
  sid                   = $sid
  processId             = $procId
  sessionId             = $session
  isInteractive         = $interactive
  desktop               = $desktop
  isElevated            = $elevated
  integrityLevel        = $integrity
  groupSids             = $groups
  administratorsPresent = $adminsPresent
  administratorsEnabled = $adminsEnabled
  collectorVersion      = $COLLECTOR_VERSION
  collectorSha256       = $self
  attestedAt            = (Get-Date).ToUniversalTime().ToString('o')
}
