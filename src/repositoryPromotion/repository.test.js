'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process')
const {safeGitArgs,parseStatus,createRepository,scanObjects}=require('./repository')
const g=(cwd,...args)=>cp.execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','-C',cwd,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'repository-policy-'));t.after(()=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true})})
  const remote=path.join(dir,'remote.git'),root=path.join(dir,'repo'),artifacts=path.join(dir,'artifacts');fs.mkdirSync(root)
  g(dir,'init','--bare',remote);g(root,'init','-b','main');g(root,'config','user.name','Fixture');g(root,'config','user.email','fixture@example.test');fs.writeFileSync(path.join(root,'file.js'),'module.exports=1\n');g(root,'add','.');g(root,'commit','-m','base');g(root,'remote','add','origin',remote);g(root,'push','-u','origin','main')
  const base=g(root,'rev-parse','HEAD');const repo=createRepository({root,artifacts,remote,runtimeReader:async()=>({bootCommit:g(root,'rev-parse','HEAD')})});return{dir,root,remote,artifacts,base,repo}
}
test('destructive history and direct main pushes cannot enter the command boundary',()=>{
  for(const args of [['push','--force','origin','main'],['push','origin','abc:refs/heads/main'],['reset','--hard'],['clean','-fd'],['branch','-D','last'],['update-ref','-d','refs/heads/last'],['push','origin',':refs/heads/last']])assert.throws(()=>safeGitArgs(args))
  assert.doesNotThrow(()=>safeGitArgs(['push','origin','a'.repeat(40)+':refs/heads/feature/safe']))
})
test('status parsing accounts for spaces, Unicode, rename origins and deleted files',()=>{
  const r=parseStatus(' M src/a b.js\0R  src/新.js\0src/old.js\0 D src/gone.js\0')
  assert.equal(r.length,3);assert.equal(r[0].path,'src/a b.js');assert.equal(r[1].originalPath,'src/old.js');assert.equal(r[2].status,' D')
  assert.throws(()=>parseStatus('?? ../secret\0'))
})
test('real Git preflight and preservation retain unique history and dirty bytes without moving main',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'file.js'),'module.exports=2\n');g(f.root,'add','.');g(f.root,'commit','-m','local unique');const head=g(f.root,'rev-parse','HEAD')
  fs.writeFileSync(path.join(f.root,'file.js'),'module.exports=3\n');const before=g(f.root,'status','--porcelain=v1')
  const inspection=await f.repo.inspect();assert.equal(inspection.unpublished.length,1);assert.equal(inspection.dirty.length,1)
  const kept=f.repo.preserve(inspection);assert.equal(kept.verified,true);assert.equal(g(f.root,'rev-parse','HEAD'),head);assert.equal(g(f.root,'status','--porcelain=v1'),before)
  assert.equal(fs.readFileSync(path.join(f.root,'file.js'),'utf8'),'module.exports=3\n')
  assert.ok(g(f.root,'ls-remote','--heads','origin').includes(head+'\t'+kept.remoteBackups[0].ref));assert.ok(g(f.root,'ls-remote','--heads','origin').includes(f.base+'\trefs/heads/main'))
  const restored=path.join(f.dir,'restored.git');g(f.dir,'clone','--bare',path.join(kept.directory,'repository.bundle'),restored)
  assert.equal(g(restored,'show',kept.checkpoint+':file.js'),'module.exports=3')
})
test('divergence preserves first and creates an isolated reconciliation with visible material conflicts',async t=>{
  const f=fixture(t),other=path.join(f.dir,'other');g(f.dir,'clone',f.remote,other);g(other,'checkout','main');fs.writeFileSync(path.join(other,'file.js'),'remote\n');g(other,'add','.');g(other,'commit','-m','remote');g(other,'push','origin','main')
  fs.writeFileSync(path.join(f.root,'file.js'),'local\n');g(f.root,'add','.');g(f.root,'commit','-m','local');const local=g(f.root,'rev-parse','HEAD')
  const before=await f.repo.inspect();assert.equal(before.next,'preserve_then_reconcile');const saved=f.repo.preserve(before);assert.equal(saved.verified,true)
  const r=f.repo.reconcile(before);assert.equal(r.reason,'material_merge_conflict');assert.deepEqual(r.conflicts,['file.js']);assert.equal(g(f.root,'rev-parse','HEAD'),local)
})
test('new secret-bearing blobs block publication without printing or pushing secret bytes',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'key.js'),'const key="sk-proj-'+'X'.repeat(60)+'"\n');g(f.root,'add','.');g(f.root,'commit','-m','fixture secret')
  const before=await f.repo.inspect();const scan=scanObjects(f.root,[before.head],before.remoteTips);assert.equal(scan.findings[0].rule,'provider_key');assert.ok(!JSON.stringify(scan).includes('X'.repeat(60)))
  assert.throws(()=>f.repo.preserve(before),/publication_scan_blocked/);assert.equal(g(f.root,'ls-remote','--heads','origin').split('\n').length,1)
})
test('a wrong repository or preservation directory inside the checkout fails closed',async t=>{
  const f=fixture(t)
  assert.throws(()=>createRepository({root:f.root,artifacts:path.join(f.root,'backup'),remote:f.remote,runtimeReader:async()=>({})}),/preservation_must_be_external/)
  const wrong=createRepository({root:f.root,artifacts:f.artifacts,remote:'https://github.com/other/repo.git',runtimeReader:async()=>({})})
  await assert.rejects(wrong.inspect(),/repository_identity_mismatch/)
})

test('batched remote inventory keeps every shared tip and fetches an unknown remote-only commit',async t=>{
 const f=fixture(t),other=path.join(f.dir,'other')
 for(let i=0;i<12;i++)g(f.root,'push','origin',f.base+':refs/heads/backup/shared-'+i)
 g(f.dir,'clone',f.remote,other);g(other,'checkout','main');fs.writeFileSync(path.join(other,'remote-only.js'),'remote-only');g(other,'add','.');g(other,'commit','-m','remote only');const remoteOnly=g(other,'rev-parse','HEAD');g(other,'push','origin','HEAD:refs/heads/feature/remote-only')
 assert.throws(()=>g(f.root,'cat-file','-e',remoteOnly+'^{commit}'))
 const refs=f.repo.remoteRefs();assert.equal(refs.main,f.base);assert.equal(refs.refs.length,14);assert.equal(refs.tips.length,2)
 assert.ok(refs.refs.some(r=>r.ref==='refs/heads/feature/remote-only'&&r.sha===remoteOnly));assert.equal(g(f.root,'show',remoteOnly+':remote-only.js'),'remote-only')
 g(f.root,'checkout','-b','feature/local-only');fs.writeFileSync(path.join(f.root,'local-only.js'),'local-only');g(f.root,'add','.');g(f.root,'commit','-m','local only');const localOnly=g(f.root,'rev-parse','HEAD');g(f.root,'branch','backup/shared-local',localOnly);g(f.root,'checkout','main')
 const kept=f.repo.preserve(await f.repo.inspect());assert.equal(kept.remoteBackups.length,1);assert.equal(kept.remoteBackups[0].sha,localOnly)
 assert.ok(f.repo.remoteRefs().refs.some(r=>r.ref===kept.remoteBackups[0].ref&&r.sha===localOnly));assert.equal(g(f.root,'show','feature/local-only:local-only.js'),'local-only')
})

test('history guard refuses alternate deletion, implicit main push and non-fast-forward refspec forms',()=>{
 for(const args of [['branch','-d','last'],['push','--delete=last','origin'],['push','origin','main'],['push','--mirror','origin'],['push','origin','+'+'a'.repeat(40)+':refs/heads/feature/safe'],['update-ref','refs/heads/main','a'.repeat(40)]])assert.throws(()=>safeGitArgs(args));
 assert.doesNotThrow(()=>safeGitArgs(['commit','-m','reset']));
});

test('a conflict-free integration candidate is recognized instead of recursively recreating reconciliation worktrees',async t=>{
 const f=fixture(t),other=path.join(f.dir,'other');g(f.dir,'clone',f.remote,other);g(other,'checkout','main');fs.writeFileSync(path.join(other,'remote.js'),'remote\n');g(other,'add','.');g(other,'commit','-m','remote');g(other,'push','origin','main');
 fs.writeFileSync(path.join(f.root,'file.js'),'local\n');g(f.root,'add','.');g(f.root,'commit','-m','local');const before=await f.repo.inspect();f.repo.preserve(before);const r=f.repo.reconcile(before);assert.equal(r.state,'candidate_ready');
 const candidate=createRepository({root:r.worktree,runtimeRoot:f.root,artifacts:f.artifacts,remote:f.remote,runtimeReader:async()=>({bootCommit:g(f.root,'rev-parse','HEAD')})});const inspected=await candidate.inspect();assert.equal(inspected.reconciliationCandidate,true);assert.equal(inspected.next,'preserve_then_develop');assert.equal(inspected.mergeHead,before.remoteMain);
 assert.equal(g(r.worktree,'show',before.head+':file.js'),'local');assert.equal(fs.readFileSync(path.join(r.worktree,'remote.js'),'utf8').trim(),'remote');
});
