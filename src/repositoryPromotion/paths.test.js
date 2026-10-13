'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
test('repository policy receipts and locks use the same Owner directory outside virtualized AppData',()=>{
  const {promotionDirectory}=require('./paths')
  const owner=path.resolve('owner-profile'),expected=path.join(owner,'.imagine','repository-promotion')
  assert.equal(promotionDirectory({USERPROFILE:owner,LOCALAPPDATA:'codex-cache',TEMP:'codex-temp'}),expected)
  assert.equal(promotionDirectory({USERPROFILE:owner,LOCALAPPDATA:'native-appdata',TEMP:'native-temp'}),expected)
  for(const env of [{},{USERPROFILE:''},{USERPROFILE:'relative'}])assert.throws(()=>promotionDirectory(env),/invalid_promotion_owner_profile/)
})
test('all repository promotion entry points share the canonical path and permission plans match it',()=>{
  const root=path.resolve(__dirname,'../..')
  for(const file of ['scripts/repository/tranche.cjs','scripts/repository/acceptedTranche.cjs','scripts/subscription/startBridge.js']){
    const text=fs.readFileSync(path.join(root,file),'utf8')
    assert.match(text,/promotionDirectory\(\)/)
    assert.ok(!/path\.join\([^\n]*['"]repository-promotion['"]/.test(text),file)
  }
  for(const file of ['prepareServiceControl.ps1','applyServiceControl.ps1']){
    const text=fs.readFileSync(path.join(root,'scripts/repository',file),'utf8')
    assert.match(text,/Join-Path \$env:USERPROFILE '\.imagine\/repository-promotion\/permission-plans'/)
    assert.ok(!text.includes('LOCALAPPDATA'))
  }
})
