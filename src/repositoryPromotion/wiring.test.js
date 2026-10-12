'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
test('the actual Owner composition wires tranche preflight and accepted-work promotion, not a dormant helper',()=>{
  const composition=fs.readFileSync(path.join(root,'scripts/subscription/startBridge.js'),'utf8')
  assert.match(composition,/repositoryPreflight:\s*\(\)\s*=>\s*repositoryPromotion\.begin\(\)/)
  assert.match(composition,/onAccepted:\s*run\s*=>\s*repositoryPromotion\.enqueue\(run\)/)
  const service=fs.readFileSync(path.join(root,'src/core/projectWork/service.js'),'utf8')
  assert.ok(service.indexOf('await repositoryPreflight()')<service.indexOf('await source.read(input.bootCommit'))
  assert.match(service,/r\.state === 'completed' && onAccepted/)
  assert.match(service,/result\?\.detached === true/)
})
test('the accepted-work driver is detached from the bridge it may restart and cannot accept arbitrary commands',()=>{
  const source=fs.readFileSync(path.join(root,'src/repositoryPromotion/acceptedWork.js'),'utf8')
  assert.match(source,/detached:true/);assert.match(source,/windowsHide:true/);assert.match(source,/shell:false/)
  assert.match(source,/\[script,'--run-id',run\.id\]/)
  assert.ok(source.includes('validateAccepted'))
  const {argumentsOf}=require('../../scripts/repository/tranche.cjs')
  assert.throws(()=>argumentsOf(['finish','--command','rm -rf']),/invalid_repository_argument/)
  assert.throws(()=>argumentsOf(['force-push']),/invalid_repository_action/)
  assert.equal(argumentsOf(['begin']).action,'begin')
})
test('all installed hooks enter the fixed policy driver and only non-main branches can be pushed',()=>{
  for(const name of ['pre-commit','post-commit','pre-push']){
    const source=fs.readFileSync(path.join(root,'scripts/repository/hooks',name),'utf8')
    assert.match(source,/tranche\.cjs/);assert.ok(!source.includes('powershell'))
  }
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
  for(const name of ['repo:begin','repo:finish','repo:resume','repo:status','repo:install-hooks'])assert.ok(pkg.scripts[name])
})
test('Windows reload has one fixed service and owned bridge, with no permission or credential expansion',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/repository/restartLocal.ps1'),'utf8')
  assert.match(source,/Restart-Service -Name AromaXiangXiangBackend/)
  assert.match(source,/BridgeOwnerMismatch/)
  assert.match(source,/ExpectedCommitMismatch/)
  assert.ok(!/New-Service|schtasks|sdset|Set-ExecutionPolicy|Copy-Item/.test(source))
})
