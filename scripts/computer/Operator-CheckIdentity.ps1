# ===========================================================================
#  Operator-CheckIdentity.ps1 - fixed launcher. No parameters, no choices.
#
#  Confirms this session is the operator account, and nothing more.
#
#  It starts ONE file, whose name is written below and nowhere else. There is
#  no argument, no environment variable and no shortcut property that can
#  change which file that is.
# ===========================================================================

. (Join-Path $PSScriptRoot 'operatorLauncher.ps1')

Invoke-OperatorTool 'tool-check-identity.js' 'CHECK OPERATOR IDENTITY'
