'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process'), { randomUUID } = require('node:crypto')
const { MULTI_RECIPE, MULTI_WORK_ORDER: W, MULTI_TEST, MULTI_TESTS, FILE, GATEWAY, recipe } = require('./contract')
const { createSource } = require('./source'), { createRepository, git: command } = require('./adoptionRepository'), { createProjectWork } = require('./service'), { createAdoption, validateAccepted } = require('./adoption'), { createMemoryRunStore } = require('../operating/runStore')
const { digest } = require('../../workers/execution/windowsSandbox'), { order } = require('../../workers/execution/isolatedCoding')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40)
const boundary = Object.fromEntries(['noExternalInterfaces','hostReadDenied','hostWriteDenied','readonlyInputDenied','readonlyToolsDenied','loopbackDenied','ipv6LoopbackDenied','internetDenied','cleanIdentity','secretsAbsent'].map(k => [k,true]))
const evidence = (passed = 10) => ({ total:10, passed, failed:10-passed, skipped:0, cancelled:0, exitCode:passed === 10 ? 0 : 1, engine:'windows-sandbox-offline-v1', boundary })
const originals = { [FILE]:'one\n', [GATEWAY]:'two\n' }, candidates = { [FILE]:'new one\n', [GATEWAY]:'new two\n' }
function packet () {
  const files = { ...originals, [MULTI_TEST]:MULTI_TESTS }
  return { evidence: { projectId:W.projectId, recipe:MULTI_RECIPE, revision:HEAD, bootCommit:HEAD, sourceFiles:W.allowedFiles.map(n => ({path:n,sha256:digest(files[n])})), acceptanceFiles:[{path:MULTI_TEST,sha256:digest(MULTI_TESTS)}] }, hash:'c'.repeat(64), order:{files,goal:W.goal,editable:W.allowedFiles,tests:[MULTI_TEST],expectedTests:10,sourceRevision:HEAD,effort:'high'} }
}
function result () {
  const changes = W.allowedFiles.map(file => ({file,before:originals[file],after:candidates[file],beforeHash:digest(originals[file]),afterHash:digest(candidates[file])}))
  return { model:'gpt-6.1-sol',effort:'high',billing:'chatgpt-subscription',execution:'windows_sandbox_offline',appliedToLive:false,changedFiles:W.allowedFiles,changes,patchHash:digest(JSON.stringify(changes)),baseline:evidence(4),tests:evidence(),isolatedRunId:randomUUID() }
}
function accepted () {
  const snapshot=packet(), r=result(), isolated={id:r.isolatedRunId,state:'accepted_isolated',workOrder:snapshot.order,changes:r.changes,patchHash:r.patchHash,baseline:r.baseline,tests:r.tests,effort:'high'}
  const run={id:randomUUID(),state:'completed',workOrder:W,source:snapshot,review:{verdict:'pass',billing:'claude-subscription'},result:r,appliedToLive:false}
  return {snapshot,run,isolated}
}
function repositoryFixture (t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'multi-project-')), git=args=>execFileSync('git',['-C',root,'-c','core.hooksPath=','-c','commit.gpgsign=false',...args],{encoding:'utf8',windowsHide:true})
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());fs.rmSync(root,{recursive:true,force:true})})
  git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);git(['config','core.autocrlf','false'])
  for(const [n,s] of Object.entries(originals)){fs.mkdirSync(path.dirname(path.join(root,n)),{recursive:true});fs.writeFileSync(path.join(root,n),s)}
  fs.writeFileSync(path.join(root,'other.txt'),'original');git(['add','.']);git(['commit','-qm','fixture'])
  const head=()=>git(['rev-parse','HEAD']).trim();let boot=head();const source=createSource({root,health:async()=>({status:'ok',bootCommit:boot})})
  return {root,git,head,source,boot:()=>{boot=head()},read:()=>source.read(head(),undefined,MULTI_RECIPE)}
}
test('registered set and High reasoning are immutable, unknown scopes cannot be selected',()=>{
  assert.equal(W.allowedFiles.length,2);assert.equal(Object.isFrozen(W.allowedFiles),true);assert.throws(()=>recipe('../.env'),/invalid_request/)
  assert.equal(order(packet().order).effort,'high');assert.throws(()=>order({...packet().order,effort:'arbitrary'}),/invalid_work_order/)
})
test('snapshot covers every current committed file; dirt in the second file invalidates the whole order',async t=>{
  const f=repositoryFixture(t), s=await f.read();assert.deepEqual(s.order.editable,W.allowedFiles);assert.equal(s.order.effort,'high');assert.equal(s.order.files[MULTI_TEST],MULTI_TESTS);assert.equal(s.evidence.sourceFiles.length,2)
  fs.appendFileSync(path.join(f.root,GATEWAY),'dirty');await assert.rejects(f.source.verify(s),/source_dirty/)
})
test('one multi-file commit and a complete-set rollback preserve unrelated index and bytes',async t=>{
  const f=repositoryFixture(t), repo=createRepository({root:f.root,source:f.source});fs.writeFileSync(path.join(f.root,'other.txt'),'staged');f.git(['add','other.txt']);fs.writeFileSync(path.join(f.root,'other.txt'),'unstaged');fs.writeFileSync(path.join(f.root,'.env'),'untouched')
  const outside=()=>[f.git(['diff','--','other.txt']),f.git(['diff','--cached','--','other.txt']),fs.readFileSync(path.join(f.root,'.env'),'utf8')], old=outside()
  const adopted=await repo.apply({snapshot:await f.read(),before:originals,after:candidates,id:randomUUID(),action:'adopt'});assert.equal(adopted.files.length,2);assert.deepEqual(outside(),old)
  assert.deepEqual(f.git(['diff-tree','--no-commit-id','--name-only','-r','HEAD']).trim().split(/\r?\n/).sort(),W.allowedFiles.slice().sort());f.boot()
  await repo.verifyLoaded({commit:adopted.commit,source:{evidence:{recipe:MULTI_RECIPE}},after:candidates,change:adopted})
  const reverted=await repo.apply({snapshot:await f.read(),before:candidates,after:originals,id:randomUUID(),action:'rollback'});f.boot();assert.equal(reverted.parentCommit,adopted.commit)
  for(const n of W.allowedFiles)assert.equal(f.git(['show','HEAD:'+n]),originals[n]);assert.deepEqual(outside(),old)
})
test('proven commit failure restores both files without resetting history',async t=>{
  const f=repositoryFixture(t), head=f.head(), repo=createRepository({root:f.root,source:f.source,command:(root,args)=>args.includes('commit')?Promise.reject(Error('repository_unavailable')):command(root,args)})
  await assert.rejects(repo.apply({snapshot:await f.read(),before:originals,after:candidates,id:randomUUID(),action:'adopt'}),/repository_unavailable/)
  for(const n of W.allowedFiles)assert.equal(fs.readFileSync(path.join(f.root,n),'utf8'),originals[n]);assert.equal(f.head(),head);assert.equal(f.git(['status','--porcelain']).trim(),'')
})
test('missing source, extra path and ambiguous commit never produce a successful partial adoption',async t=>{
  const f=repositoryFixture(t), s=await f.read(), repo=createRepository({root:f.root,source:f.source})
  await assert.rejects(repo.apply({snapshot:s,before:originals,after:{[FILE]:candidates[FILE]},id:randomUUID(),action:'adopt'}),/invalid_request/)
  await assert.rejects(repo.apply({snapshot:s,before:originals,after:{...candidates,'.env':'wrong'},id:randomUUID(),action:'adopt'}),/invalid_request/)
  const ambiguous=createRepository({root:f.root,source:f.source,command:async(root,args)=>{const out=await command(root,args);if(args.includes('commit'))throw Error('transport');return out}})
  await assert.rejects(ambiguous.apply({snapshot:s,before:originals,after:candidates,id:randomUUID(),action:'adopt'}),/adoption_inspection_required/)
  assert.notEqual(f.head(),s.evidence.revision);for(const n of W.allowedFiles)assert.equal(fs.readFileSync(path.join(f.root,n),'utf8'),candidates[n])
})
test('concurrent change to the second source restores only the first transaction write',async t=>{
  const f=repositoryFixture(t), snapshot=await f.read();let heads=0
  const repo=createRepository({root:f.root,source:f.source,command:async(root,args)=>{const out=await command(root,args);if(args.join(' ')==='rev-parse HEAD'&&++heads===3)fs.writeFileSync(path.join(root,GATEWAY),'concurrent edit\n');return out}})
  await assert.rejects(repo.apply({snapshot,before:originals,after:candidates,id:randomUUID(),action:'adopt'}),/source_changed/)
  assert.equal(f.head(),snapshot.evidence.revision);assert.equal(fs.readFileSync(path.join(f.root,FILE),'utf8'),originals[FILE]);assert.equal(fs.readFileSync(path.join(f.root,GATEWAY),'utf8'),'concurrent edit\n')
})
test('multi-file sealed dispatch checks recipe, complete changes, hashes and effort before review',async()=>{
  for(const mutation of [r=>r,r=>({...r,changes:r.changes.slice(0,1)}),r=>({...r,effort:'medium'}),r=>({...r,changes:r.changes.map(c=>({...c,afterHash:'0'.repeat(64)}))})]) {
    const store=createMemoryRunStore();let reviews=0;const flow=createProjectWork({store,source:{read:async()=>packet(),verify:async()=>{}},enabled:()=>true,providers:{isolation:async()=>({ready:true}),status:async()=>({codex:{ready:true},claude:{ready:true}}),codeOrder:async()=>mutation(result()),reviewOrder:async()=>{reviews++;return{verdict:'pass'}}}})
    const p=await flow.prepare(OWNER,{projectId:W.projectId,recipe:MULTI_RECIPE,requestId:randomUUID(),bootCommit:HEAD});flow.approve(OWNER,{id:p.approval.id,hash:p.approval.hash,nonce:p.approval.nonce});await flow.settled()
    assert.equal(flow.get(OWNER,p.run.id).state,reviews?'completed':'failed');assert.equal(reviews,mutation(result()).changes.length===2&&mutation(result()).effort==='high'&&mutation(result()).changes[0].afterHash!== '0'.repeat(64)?1:0)
  }
})
test('multi-file independent evidence must bind both originals, protected tests, recipe and baseline',()=>{
  const ok=accepted();assert.deepEqual(validateAccepted(ok.run,ok.isolated).before,originals)
  for(const mutate of [f=>{f.run.result.changes.pop()},f=>{f.isolated.workOrder.files[GATEWAY]='other'},f=>{f.run.workOrder={...W,allowedFiles:[FILE,'.env']}},f=>{f.run.source.evidence.sourceFiles[1].sha256='0'.repeat(64)},f=>{f.isolated.workOrder.files[MULTI_TEST]='weaker'},f=>{f.run.result.effort='medium'},f=>{f.isolated.baseline={...evidence(4),failed:0}}]){const f=structuredClone(accepted());mutate(f);assert.throws(()=>validateAccepted(f.run,f.isolated),/accepted_evidence_changed/)}
})
test('adoption retests all files; rollback uses the verified original baseline, not hardcoded v1 counts',async()=>{
  const f=accepted(), store=createMemoryRunStore();let current=originals, boot=HEAD, loaded=false, writes=0;const seen=[]
  const flow=createAdoption({store,enabled:()=>true,work:{get:()=>structuredClone(f.run)},isolated:async()=>structuredClone(f.isolated),source:{read:async()=>({...packet(),order:{...packet().order,files:{...current,[MULTI_TEST]:MULTI_TESTS}},evidence:{...packet().evidence,revision:boot,bootCommit:boot}}),verify:async s=>{assert.equal(s.evidence.revision,boot)}},executor:{isBusy:()=>false,run:async pack=>{seen.push(pack);return evidence(pack.files[FILE]===candidates[FILE]?10:4)}},repository:{apply:async({before,after})=>{assert.deepEqual(before,current);current=after;boot=(writes++?'c':'b').repeat(40);return{commit:boot}},verifyLoaded:async r=>{if(!loaded)throw Error('source_changed');return{bootCommit:r.commit}}},loader:async()=>{loaded=true}})
  for(const action of ['adopt','rollback']) { const p=await flow.prepare(OWNER,{action,runId:f.run.id,requestId:randomUUID(),bootCommit:boot});flow.approve(OWNER,{id:p.approval.id,hash:p.approval.hash,nonce:p.approval.nonce});await flow.settled();await flow.refresh();const r=flow.get(OWNER,p.run.id);assert.equal(r.state,'completed');assert.equal(r.tests.passed,action==='adopt'?10:4) }
  assert.equal(writes,2);assert.deepEqual(current,originals);assert.equal(seen.every(p=>Object.keys(p.files).length===3&&p.files[MULTI_TEST]===MULTI_TESTS),true)
})
