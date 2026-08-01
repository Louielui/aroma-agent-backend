# aromaJsonTransport.ps1  -  the PowerShell half of the one transport.
#
# ===========================================================================
#  Dot-sourced by every script the shared runner may start. It reads the
#  payload and writes the answer, and does nothing else.
#
#  ── WHY NOT A COMMAND-LINE PARAMETER ────────────────────────────────────
#  Because a JSON payload in argv was measurably destroyed by Windows quoting:
#  the same probe op returned bad_payload one way and worked another, and the
#  difference was entirely in how the arguments were passed. Base64 over stdin
#  is ASCII, so no code page, no quoting rule and no locale can alter a byte.
#
#  ── WHY AN ENVELOPE ─────────────────────────────────────────────────────
#  Because PowerShell's own banner once landed in stdout and the caller tried
#  to parse it as the result. Noise that PARSES is far more dangerous than
#  noise that does not, so the answer is marked and everything else is
#  ignored by construction.
#
#  ── FAIL CLOSED AT EVERY STEP ───────────────────────────────────────────
#  Empty stdin, invalid base64, invalid UTF-8 and invalid JSON are each a
#  distinct refusal, emitted in the same envelope so the caller always gets a
#  structured answer rather than silence.
# ===========================================================================

function Write-AromaEnvelope {
  param([hashtable] $Result)
  $json = $Result | ConvertTo-Json -Depth 8 -Compress
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
  Write-Output ('AROMA_JSON_B64:' + $b64)
}

function Write-AromaRefusal {
  param([string] $Reason, [string] $Detail = $null)
  Write-AromaEnvelope @{ ok = $false; reason = $Reason; detail = $Detail }
  exit 0
}

# Read the whole of stdin as one string. ReadToEnd blocks until the writer
# closes the pipe, which is what makes "the payload arrived complete" a fact
# rather than a hope.
function Read-AromaPayload {
  $raw = $null
  try { $raw = [Console]::In.ReadToEnd() } catch { Write-AromaRefusal 'stdin_unreadable' $_.Exception.Message }
  if ($null -eq $raw) { Write-AromaRefusal 'stdin_empty' }

  $b64 = $raw.Trim()
  if ($b64.Length -eq 0) { Write-AromaRefusal 'stdin_empty' }
  if ($b64 -notmatch '^[A-Za-z0-9+/]*={0,2}$') { Write-AromaRefusal 'bad_base64' }

  $bytes = $null
  try { $bytes = [Convert]::FromBase64String($b64) } catch { Write-AromaRefusal 'bad_base64' $_.Exception.Message }
  if ($bytes.Length -eq 0) { Write-AromaRefusal 'empty_payload' }

  # THROW on invalid UTF-8 rather than substituting U+FFFD. A replacement
  # character is a silent corruption that then parses as valid JSON with the
  # wrong contents - exactly the class of failure this transport exists to end.
  $text = $null
  try {
    $enc = New-Object System.Text.UTF8Encoding($false, $true)
    $text = $enc.GetString($bytes)
  } catch { Write-AromaRefusal 'bad_utf8' $_.Exception.Message }

  $obj = $null
  try { $obj = $text | ConvertFrom-Json } catch { Write-AromaRefusal 'bad_json' }
  if ($null -eq $obj) { Write-AromaRefusal 'bad_json' }
  return $obj
}
