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
  assert.match(source,/WindowsAdministratorRequired/);assert.match(source,/approved -ne \$true/)
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
