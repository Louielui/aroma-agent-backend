param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9-]{36}$')][string]$PlanId,[Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$OwnerApprovedPlanHash,[switch]$Revoke)
$ErrorActionPreference = 'Stop'
$serviceControlPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $serviceControlPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'WindowsAdministratorRequired' }
$serviceControlDirectory = Join-Path $env:LOCALAPPDATA 'AromaXiangXiang/repository-promotion/permission-plans'
$serviceControlFile = Join-Path $serviceControlDirectory ($PlanId+'.json')
if ((Get-Item -LiteralPath $serviceControlFile).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'UnsafePlan' }
if ((Get-FileHash -LiteralPath $serviceControlFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $OwnerApprovedPlanHash) { throw 'OwnerApprovedPlanChanged' }
$serviceControlPlan = Get-Content -LiteralPath $serviceControlFile -Raw -Encoding UTF8 | ConvertFrom-Json
function DescriptorHash([string]$value) { $sha=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() } }
if ($serviceControlPlan.id -ne $PlanId -or $serviceControlPlan.service -cne 'AromaXiangXiangBackend' -or $serviceControlPlan.accessMask -ne 0x30 -or $serviceControlPlan.scope -cne 'start_stop_existing_local_service' -or $serviceControlPlan.ownerSid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -or (DescriptorHash $serviceControlPlan.before) -cne $serviceControlPlan.beforeHash -or (DescriptorHash $serviceControlPlan.after) -cne $serviceControlPlan.afterHash) { throw 'UnapprovedOrChangedPlan' }
# Reconstruct the only allowed difference rather than trusting an arbitrary SDDL.
$serviceControlExpected = New-Object Security.AccessControl.RawSecurityDescriptor($serviceControlPlan.before)
$serviceControlSid = New-Object Security.Principal.SecurityIdentifier($serviceControlPlan.ownerSid)
$serviceControlExpected.DiscretionaryAcl.InsertAce($serviceControlExpected.DiscretionaryAcl.Count,(New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,0x30,$serviceControlSid,$false,$null)))
if ($serviceControlExpected.GetSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $serviceControlPlan.after) { throw 'UnexpectedPermissionDifference' }
$serviceControlObserved = ((& sc.exe sdshow AromaXiangXiangBackend) | Where-Object { $_ -match '^D:' }) -join ''
$serviceControlExpectedCurrent = if ($Revoke) { $serviceControlPlan.after } else { $serviceControlPlan.before }
if ($serviceControlObserved -cne $serviceControlExpectedCurrent) { throw 'ServiceDescriptorChanged' }
$serviceControlTarget = if ($Revoke) { $serviceControlPlan.before } else { $serviceControlPlan.after }
& sc.exe sdset AromaXiangXiangBackend $serviceControlTarget | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ServicePermissionWriteFailed' }
$serviceControlReadBack = ((& sc.exe sdshow AromaXiangXiangBackend) | Where-Object { $_ -match '^D:' }) -join ''
if ($serviceControlReadBack -cne $serviceControlTarget) { throw 'ServicePermissionReadBackFailed' }
@{ id=$PlanId;state=$(if($Revoke){'revoked'}else{'granted'});scope=$serviceControlPlan.scope;accessMask=0x30;checkedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $serviceControlDirectory ($PlanId+'.result.json')) -Encoding UTF8
