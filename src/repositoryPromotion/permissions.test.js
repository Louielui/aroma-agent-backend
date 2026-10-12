'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
test('permission preparation is read-only for Windows ACLs and never silently approves a plan',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/repository/prepareServiceControl.ps1'),'utf8')
  assert.match(source,/sc\.exe sdshow AromaXiangXiangBackend/)
  assert.match(source,/accessMask=0x30/);assert.match(source,/approved=\$false/)
  assert.ok(!/sdset|Restart-Service|Stop-Service|Set-ExecutionPolicy|schtasks/.test(source))
})
test('permission application reconstructs only start-stop rights for the same Owner and supports exact revocation',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/repository/applyServiceControl.ps1'),'utf8')
  assert.match(source,/WindowsAdministratorRequired/);assert.match(source,/OwnerApprovedPlanHash/);assert.match(source,/OwnerApprovedPlanChanged/)
  assert.ok(!/approved -ne \$true/.test(source))
  assert.match(source,/GetCurrent\(\)\.User\.Value/);assert.match(source,/UnexpectedPermissionDifference/)
  assert.match(source,/ServiceDescriptorChanged/);assert.match(source,/ServicePermissionReadBackFailed/)
  assert.match(source,/\[switch\]\$Revoke/);assert.ok(!/SERVICE_ALL_ACCESS|0xF01FF|New-Service|schtasks|Set-ExecutionPolicy/.test(source))
})
test('cloud policy contract checks are read-only, pinned and never receive production credentials',()=>{
  const source=fs.readFileSync(path.join(root,'.github/workflows/repository-policy.yml'),'utf8')
  assert.match(source,/contents: read/);assert.match(source,/persist-credentials: false/)
  assert.match(source,/actions\/checkout@[a-f0-9]{40}/);assert.match(source,/actions\/setup-node@[a-f0-9]{40}/)
  assert.ok(!/secrets\.|contents: write|pull_request_target/.test(source))
})

test('service delegation preserves all descriptor sections and the native write is explicitly DACL-only',t=>{
 const cp=require('child_process');const prepare=fs.readFileSync(path.join(root,'scripts/repository/prepareServiceControl.ps1'),'utf8'),apply=fs.readFileSync(path.join(root,'scripts/repository/applyServiceControl.ps1'),'utf8');assert.match(prepare,/AccessControlSections\]::All/);assert.match(apply,/AccessControlSections\]::All/);assert.match(apply,/SetServiceObjectSecurity\(\$serviceControlHandle,0x4,\$serviceControlNative\)/);assert.ok(!/sc\.exe sdset/.test(apply));
 if(process.platform!=='win32'){t.diagnostic('The descriptor reconstruction is measured in the Windows suite.');return}
 const script="$ErrorActionPreference='Stop'; $d=New-Object Security.AccessControl.RawSecurityDescriptor('D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)S:(AU;SAFA;RPWP;;;WD)');$auditBefore=$d.GetSddlForm([Security.AccessControl.AccessControlSections]::Audit);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$d.DiscretionaryAcl.InsertAce($d.DiscretionaryAcl.Count,(New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,0x30,$sid,$false,$null)));$after=$d.GetSddlForm([Security.AccessControl.AccessControlSections]::All);$rebuilt=New-Object Security.AccessControl.RawSecurityDescriptor($after);if($rebuilt.GetSddlForm([Security.AccessControl.AccessControlSections]::Audit) -cne $auditBefore){throw 'audit_changed'};Write-Output 'audit_preserved'";const result=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,shell:false,timeout:15000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/audit_preserved/);
});
