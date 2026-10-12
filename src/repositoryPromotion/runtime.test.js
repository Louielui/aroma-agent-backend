'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process')
const {overlayPlan,applyCheckout,health}=require('./runtime'),{createRepository}=require('./repository')
test('a runtime overlay is reapplied only when unchanged upstream or already absorbed exactly',()=>{
  const values={'a:file.js':'old','b:file.js':'saved','c:file.js':'saved','d:file.js':'different'}
  const repo={runtimeGit:args=>{const [sha,name]=args[1].split(':');return values[sha[0]+':'+name]}}
  const snapshot={head:'a'.repeat(40),checkpoint:'b'.repeat(40),verified:true,files:[{path:'file.js',sha256:'x'}]}
  assert.equal(overlayPlan(repo,snapshot,'c'.repeat(40))[0].absorbed,true)
  assert.throws(()=>overlayPlan(repo,snapshot,'d'.repeat(40)),/material_runtime_overlay_conflict/)
})
test('real fast-forward deployment preserves dirty bytes and all stash history without reset',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'promotion-runtime-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
  const root=path.join(dir,'repo'),remote=path.join(dir,'remote.git');fs.mkdirSync(root)
  const g=(cwd,...args)=>cp.execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','-C',cwd,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
  g(dir,'init','--bare',remote);g(root,'init','-b','main');g(root,'config','user.name','Fixture');g(root,'config','user.email','fixture@example.test')
  fs.writeFileSync(path.join(root,'overlay.js'),'base\n');fs.writeFileSync(path.join(root,'app.js'),'old\n');g(root,'add','.');g(root,'commit','-m','base');g(root,'remote','add','origin',remote);g(root,'push','-u','origin','main');const base=g(root,'rev-parse','HEAD')
  g(root,'checkout','-b','feature/candidate');fs.writeFileSync(path.join(root,'app.js'),'new\n');g(root,'add','.');g(root,'commit','-m','candidate');const target=g(root,'rev-parse','HEAD');g(root,'push','origin','feature/candidate');g(root,'checkout','main')
  fs.writeFileSync(path.join(root,'overlay.js'),'local overlay\n')
  const repository=createRepository({root,artifacts:path.join(dir,'artifacts'),remote,runtimeReader:async()=>({bootCommit:base})})
  const snapshot=repository.preserve(await repository.inspect())
  const result=applyCheckout(repository,snapshot,target)
  assert.equal(g(root,'rev-parse','HEAD'),target);assert.equal(fs.readFileSync(path.join(root,'overlay.js'),'utf8'),'local overlay\n');assert.equal(fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\r\n/g,'\n'),'new\n')
  assert.ok(g(root,'rev-parse','refs/preservation/stash/'+result.stash));assert.equal(g(root,'ls-remote','origin','refs/heads/main').split(/\s+/)[0],base)
})
test('health verification rejects a foreign listener, missing boot SHA and failed HTTP response',async()=>{
  const fake=value=>async()=>({ok:true,json:async()=>value})
  await assert.rejects(health('fixture',fake({status:'ok',service:'foreign',bootCommit:'a'.repeat(40)})))
  await assert.rejects(health('fixture',fake({status:'ok',service:'aroma-hub',bootCommit:null})))
  assert.equal((await health('fixture',fake({status:'ok',service:'aroma-hub',bootCommit:'a'.repeat(40)}))).bootCommit,'a'.repeat(40))
})
