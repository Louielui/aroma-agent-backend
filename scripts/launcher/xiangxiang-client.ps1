<#
  xiangxiang-client.ps1 — THE INTERACTIVE SIDE, AFTER THE SERVICE OWNS THE SERVER.

  ==============================================================================
  THIS SCRIPT CANNOT START THE SERVER. THAT IS ITS ENTIRE POINT.

  Today the Startup shortcut runs the full launcher, which probes 8090 and, finding nothing,
  STARTS node in the interactive session. That is why a logoff ends 香香: the server is a child
  of a session that goes away. Recorded three times now, most recently a 5h48m silent outage.

  Once the Windows service owns 8090, a second owner is not a fallback — it is a race and a
  split brain. So this replacement can probe, it can open the UI, and it can tell the Owner the
  service is unwell. It contains no node invocation, no Start-Process of any interpreter, and
  no call to the launcher body. `clientProbeOnly.test.js` scans this file with comments stripped
  and fails if any of that ever appears.

  NOT WIRED UP. The Startup shortcut still points at the old launcher and is untouched by this
  tranche. Repointing it is part of the cutover GO, after the service is proven.
  ==============================================================================
#>
# ⛔ CmdletBinding MAKES AN UNKNOWN PARAMETER AN ERROR, NOT A SHRUG.
#
# Measured: without it, `-Url node.exe` was silently ignored and the script ran normally.
# Ignoring is not the same as refusing — a caller who thinks they supplied a launch target
# should be told they did not, and the whole point here is that no such target exists.
[CmdletBinding()]
param(
  [int]$Port = 8090,
  [ValidateSet('Probe', 'Open')][string]$Mode = 'Probe',
  # Suppresses the MODAL only. It does not change the probe, the decision, or the exit
  # code, and there is no switch anywhere here that lets this script start a server.
  # Automated verification needs it because MessageBox::Show blocks until a human clicks,
  # which in a headless run is a hang rather than a notification.
  [switch]$NoNotify
)

$ErrorActionPreference = 'Stop'

# ⛔ THE UI TARGET IS CONSTRUCTED, NEVER SUPPLIED.
#
# This used to be a -Url parameter with a loopback default, which meant the caller chose what
# Start-Process received. `-Url node.exe` would have launched an interpreter from a script
# whose entire purpose is that it cannot start a server. The target is now derived from the
# port this script itself probed, so there is no caller-controlled value to inject.
$UiUrl = 'http://127.0.0.1:' + $Port + '/demo'

function Show-Msg([string]$text) {
  if ($NoNotify) { Write-Output ('NOTIFY_SUPPRESSED=' + $text.Substring(0, [Math]::Min(24, $text.Length))); return }
  # Blocking on purpose: the return is the evidence a human saw it. A toast whose Show()
  # succeeds whether or not it was delivered is "ran and did nothing" wearing a success.
  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($text, '香香') | Out-Null } catch { }
}

<#
  Identity comes from /health, never from the page markup. Returns:

    ours    — 200 and service == 'aroma-hub'
    foreign — anything else answering, or a listener we cannot identify
    down    — nothing listening at all

  'foreign' and 'down' are DIFFERENT FACTS and are reported differently, but neither of them
  is ever a reason to start something here. That decision no longer lives on this side.
#>
function Probe-Service {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      $svc = $null
      try { $svc = ($r.Content | ConvertFrom-Json).service } catch { $svc = $null }
      if ($svc -eq 'aroma-hub') { return 'ours' }
    }
    return 'foreign'
  } catch {
    $listen = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listen) { return 'foreign' }
    return 'down'
  }
}

$state = Probe-Service

switch ($state) {
  'ours' {
    Write-Output 'CLIENT_STATE=ours service healthy on 8090; nothing to do'
    if ($Mode -eq 'Open') { Start-Process $UiUrl }   # the constructed loopback URL, handed to the shell. Never a caller value.
    exit 0
  }
  'foreign' {
    Write-Output 'CLIENT_STATE=foreign 8090 answered but is not aroma-hub; fail-closed'
    Show-Msg '8090 被其他程式佔用，或者答唔到 aroma-hub。香香冇啟動 —— 呢個客戶端唔會殺對方、唔會轉 port、亦唔會自己開一個 server。'
    exit 3
  }
  'down' {
    Write-Output 'CLIENT_STATE=down service is not listening; report only'
    Show-Msg '香香 服務而家冇喺度。請檢查 AromaXiangXiangBackend 服務同 C:\ProgramData\AromaXiangXiang\logs。呢個客戶端唔會代替服務開 server。'
    exit 4
  }
}
