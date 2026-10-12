param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9-]{36}$')][string]$PlanId)
$ErrorActionPreference = 'Stop'
$serviceControlBefore = ((& sc.exe sdshow AromaXiangXiangBackend) | Where-Object { $_ -match '^D:' }) -join ''
if ($LASTEXITCODE -ne 0 -or -not $serviceControlBefore) { throw 'ServiceDescriptorUnavailable' }
$serviceControlOwner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$serviceControlDescriptor = New-Object Security.AccessControl.RawSecurityDescriptor($serviceControlBefore)
$serviceControlAce = New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,0x30,$serviceControlOwner,$false,$null)
$serviceControlDescriptor.DiscretionaryAcl.InsertAce($serviceControlDescriptor.DiscretionaryAcl.Count,$serviceControlAce)
$serviceControlAfter = $serviceControlDescriptor.GetSddlForm([Security.AccessControl.AccessControlSections]::All)
function DescriptorHash([string]$value) { $sha=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() } }
$serviceControlDirectory = Join-Path $env:LOCALAPPDATA 'AromaXiangXiang/repository-promotion/permission-plans'
New-Item -ItemType Directory -Path $serviceControlDirectory -Force | Out-Null
$serviceControlPlan = @{ id=$PlanId;service='AromaXiangXiangBackend';ownerSid=$serviceControlOwner.Value;accessMask=0x30;scope='start_stop_existing_local_service';before=$serviceControlBefore;after=$serviceControlAfter;beforeHash=(DescriptorHash $serviceControlBefore);afterHash=(DescriptorHash $serviceControlAfter);approved=$false;createdAt=[DateTime]::UtcNow.ToString('o') }
$serviceControlPlanPath = Join-Path $serviceControlDirectory ($PlanId+'.json')
if (Test-Path -LiteralPath $serviceControlPlanPath) { throw 'PlanAlreadyExists' }
$serviceControlPlan | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $serviceControlPlanPath -Encoding UTF8
@{ id=$PlanId;state='prepared_not_applied';service=$serviceControlPlan.service;accessMask=$serviceControlPlan.accessMask;scope=$serviceControlPlan.scope;beforeHash=$serviceControlPlan.beforeHash;afterHash=$serviceControlPlan.afterHash } | ConvertTo-Json -Compress
