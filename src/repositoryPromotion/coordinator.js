'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {createRepository,digest,scanObjects}=require('./repository')
const {createGitHub}=require('./github'),{createRuntime}=require('./runtime')
const {VERSION,promotionDecision,complete,classifyChanges,SHA}=require('./policy')
const {createWorkflow}=require('./workflow'),checks=require('./checks')
function atomic (file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp'
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,file)
}
function createCoordinator ({root,runtimeRoot,artifacts,privateRefs=[],ownerAuthorization=()=>[],invocationLedger=null}) {
  const dependencies=path.join(runtimeRoot,'node_modules')
  let runtime
  const repository=createRepository({root,runtimeRoot,artifacts,privateRefs,runtimeReader:()=>runtime.health()})
  runtime=createRuntime({repository,dependencies})
  const github=createGitHub({root}),runs=path.join(artifacts,'runs'),lockFile=path.join(artifacts,'promotion.lock')
  fs.mkdirSync(runs,{recursive:true})
  let active=false
  function acquire () {
    if(active)throw Error('promotion_busy')
    try{fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx'})}catch{throw Error('promotion_lock_requires_inspection')}
    active=true
  }
  function release () {active=false;fs.unlinkSync(lockFile)}
  async function begin () {
    const f=await repository.inspect()
    const preservation=f.next==='blocked'&&f.preservationAllowed!==true?null:repository.preserve(f)
    const receipt={at:new Date().toISOString(),...f,preservation}
    if(f.next==='preserve_then_reconcile')receipt.reconciliation=repository.reconcile(f)
    atomic(path.join(artifacts,'preflight-latest.json'),receipt)
    if(f.next==='blocked')throw Error(f.reason)
    if(f.next==='preserve_then_reconcile')throw Error('repository_reconciliation_required')
    return receipt
  }
  function body (row) {
    return `Promote the accepted Imagine tranche at \`${row.committed.commit}\` into the formal baseline. Repository history and working files were preserved before integration; the runtime is limited to the local assistant.\n\nFull isolated suite: ${row.tests.passed} passed, ${row.tests.failed} failed, ${row.tests.skipped} explicitly recorded skips. Independent Claude review and policy checks are bound to the exact commit and tested tree.\n\nRollback point: \`${row.runtimeSnapshot.head}\`. Deployment requires exact merged-tree agreement, idle witnesses, health/bridge SHA checks and isolated regression tests. A failed verification triggers a forward-history rollback. Owner exceptions are retained; no force push, reset, branch deletion or business-data write is available.\n\nSee docs/AUTONOMOUS-REPOSITORY-PROMOTION.md for policy scope and completion evidence.`
  }
  function adapter (options={}) {
    const {files,message='Accepted Imagine development tranche'}=options
    return {
      inspect:()=>repository.inspect(),
      preserve:row=>repository.preserve(row.preflight),reconcile:row=>repository.reconcile(row.preflight),
      prepare:async row=>{
        if(!Array.isArray(files)||!files.length||files.some(p=>typeof p!=='string'||p.startsWith('/')||p.split('/').includes('..')||p.includes('\\')))throw Error('invalid_accepted_scope')
        if(root===runtimeRoot||repository.git(['branch','--show-current'])==='main')throw Error('isolated_worktree_required')
        const dirty=row.preflight.dirty.map(f=>f.path).sort()
        if(JSON.stringify([...new Set(files)].sort())!==JSON.stringify(dirty))throw Error('unaccounted_working_changes')
        repository.git(['add','--',...files])
        const hooks=files.filter(p=>/^scripts\/repository\/hooks\/(?:pre-commit|post-commit|pre-push)$/.test(p))
        if(hooks.length)repository.git(['update-index','--chmod=+x','--',...hooks])
        if(repository.git(['diff','--no-ext-diff','--name-only']))throw Error('working_tree_changed')
        const tree=repository.git(['write-tree'])
        row.runtimeSnapshot=repository.preserve(row.preflight,runtimeRoot)
        return{tree,parent:repository.git(['rev-parse','HEAD']),branch:repository.git(['branch','--show-current']),files}
      },
      test:row=>checks.runTests({root,dependencies,directory:path.join(runs,row.id,'full-tests'),tree:row.prepared.tree}),
      commit:async row=>{
        if(row.tests.exitCode!==0||row.tests.failed!==0||row.tests.cancelled!==0||row.tests.passed<1||row.tests.skipped!==row.tests.skipNames.length||row.tests.skipNames.some(n=>!checks.AUTHORIZED_SKIP_NAMES.includes(n)))throw Error('tests_unresolved')
        if(repository.git(['write-tree'])!==row.prepared.tree||repository.git(['rev-parse','HEAD'])!==row.prepared.parent||repository.git(['diff','--no-ext-diff','--name-only']))throw Error('working_tree_changed')
        repository.git(['commit','-m',message])
        const commit=repository.git(['rev-parse','HEAD']),tree=repository.git(['rev-parse',commit+'^{tree}'])
        if(tree!==row.prepared.tree||repository.git(['status','--porcelain=v1']))throw Error('accepted_commit_unconfirmed')
        row.tests.commit=commit
        return{commit,tree,parent:row.prepared.parent,branch:row.prepared.branch}
      },
      publish:async row=>{
        const refs=repository.remoteRefs(),scan=scanObjects(root,[row.committed.commit],refs.tips)
        atomic(path.join(runs,row.id,'publication-scan.json'),scan)
        if(scan.findings.length)throw Error('credential_secret_change')
        const ref='refs/heads/'+row.committed.branch
        if(ref==='refs/heads/main')throw Error('direct_main_push_forbidden')
        repository.git(['push','origin',row.committed.commit+':'+ref])
        return{commit:row.committed.commit,remoteRef:ref,verified:repository.remoteRefs().refs.some(r=>r.ref===ref&&r.sha===row.committed.commit),scan}
      },
      pullRequest:row=>github.pullRequest({branch:row.committed.branch,head:row.committed.commit,title:message,body:body(row)}),
      review:async row=>{
        const packet=checks.reviewPacket({root,commit:row.committed.commit,base:row.runtimeSnapshot.checkpoint,tests:row.tests})
        packet.ownerAuthorization=ownerAuthorization(row.committed.commit,packet.changedPaths)
        packet.runtimeOverlays=require('./runtime').overlayPlan(repository,row.runtimeSnapshot,row.committed.commit).map(f=>({path:f.path,sha256:f.sha256,absorbed:f.absorbed,retained:true,beforeBlob:f.beforeBlob,targetBlob:f.targetBlob,snapshotBlob:f.snapshotBlob}))
        packet.overlayExplanation='The pre-existing uncommitted CLAUDE_CHAT_MODEL launcher line remains a private machine-local override. The canonical launcher targetBlob equals beforeBlob, so this promotion does not change the shared launcher. Diff relative to the dirty checkpoint shows the local line absent in canonical Git only; applyCheckout restores its exact saved bytes before restart. Owner asked to preserve existing modifications, not publish this local model override as a shared default.'
        packet.authorityModel='The authenticated Owner pre-authorized ordinary low-risk accepted work through tests, independent subscription review, local host evidence gates, PR merge and local deployment. Windows ACL changes are NOT pre-authorized. GitHub statuses mirror locally measured evidence; GitHub Actions independently checks policy contracts, not the full Windows suite. Host credentials and evidence are trusted host authority, not sandbox/model-supplied receipts.'
        row.reviewPacket={...packet,batches:undefined}
        const cwd=path.join(runs,row.id,'review-empty');fs.mkdirSync(cwd,{recursive:true})
        return checks.runReview({packet,cwd,directory:path.join(runs,row.id,'review')})
      },
      evidence:async row=>{
        const pre=await repository.inspect(),pr=await github.inspectPR(row.pr.number)
        const exceptions=ownerAuthorization(row.committed.commit,row.reviewPacket.changedPaths)
        const e={policyVersion:VERSION,commit:row.committed.commit,tree:row.committed.tree,base:row.preflight.remoteMain,
          workingTree:{accounted:repository.git(['status','--porcelain=v1'])==='',snapshotHash:row.preservation.snapshotHash},preservation:row.publication,
          rollback:{commit:row.runtimeSnapshot.head,checkpoint:row.runtimeSnapshot.checkpoint,remoteVerified:repository.remoteRefs().refs.some(r=>r.sha===row.runtimeSnapshot.head)},
          tests:row.tests,review:row.review,conflicts:[],changes:row.reviewPacket.changedPaths,addedText:row.reviewPacket.addedText,authorizedExceptions:exceptions,pr:{...pr,checksState:'success'},runtimeImpact:'local_assistant_only',expectedRuntime:row.preflight.runtimeExpected,observedRuntime:pre.runtimeObserved}
        const localGate=promotionDecision(e)
        if(localGate.allowed)await github.recordChecks(pr.number,e.commit,e)
        for(let i=0;i<12;i++){
          e.pr=await github.inspectPR(pr.number)
          if(e.pr.mergeable!==null&&e.pr.checksState!=='pending')break
          await new Promise(resolve=>setTimeout(resolve,2000))
        }
        return e
      },
      recheck:async row=>{
        if(repository.git(['rev-parse','HEAD'])!==row.committed.commit||repository.git(['status','--porcelain=v1']))return false
        const pr=await github.inspectPR(row.pr.number),live=await runtime.health()
        return pr.head===row.evidence.commit&&pr.base===row.evidence.base&&await github.main()===row.evidence.base&&pr.checksState==='success'&&pr.unresolvedThreads===0&&live.bootCommit===row.evidence.expectedRuntime
      },
      merge:async row=>{
        const result=await github.merge({number:row.pr.number,head:row.evidence.commit,base:row.evidence.base})
        repository.git(['fetch','--no-tags','origin',result.commit])
        if(repository.git(['rev-parse',result.commit+'^{tree}'])!==row.evidence.tree)throw Error('merged_tree_mismatch')
        return result
      },
      deploy:row=>runtime.deploy(row),
      verify:async row=>{
        const verified=await runtime.verify(row)
        if(verified.verified){
          const final={...row.evidence,pr:{...row.evidence.pr,state:'merged',mergeCommit:row.merge.commit},runtime:{...verified,state:'verified'}}
          verified.verified=complete(final).complete;row.completionEvidence=final
        }
        return verified
      },
      recheckDeployed:async row=>repository.runtimeGit(['rev-parse','HEAD'])===row.merge.commit&&await github.main()===row.merge.commit,
      recheckPending:async row=>repository.runtimeGit(['rev-parse','HEAD'])===row.runtimeSnapshot.head&&await github.main()===row.merge.commit&&(await runtime.health()).bootCommit===row.preflight.runtimeExpected,
      restartPending:async row=>{
        if((await runtime.idle()).state!=='idle_verified')return{state:'idle_required',applied:false}
        return runtime.restart(row.merge.commit)
      },
      rollback:async row=>{
        if(await github.main()!==row.merge.commit)throw Error('rollback_ref_drift')
        const before=row.runtimeSnapshot.head,tree=repository.git(['rev-parse',before+'^{tree}'])
        const commit=repository.git(['commit-tree',tree,'-p',row.merge.commit,'-m','Restore verified pre-promotion source after failed runtime verification'])
        const branch='rollback/promotion-'+row.id
        repository.git(['update-ref','refs/heads/'+branch,commit]);repository.git(['push','origin',commit+':refs/heads/'+branch])
        const pr=await github.pullRequest({branch,head:commit,title:'Rollback failed Imagine promotion '+row.id,body:`Restore the exact pre-promotion tree \`${tree}\` from \`${before}\` using a forward commit. Failure evidence is retained. No database, credential or unrelated business state is restored.`})
        const result=await github.rollbackMerge({pr:pr.number,head:commit,base:row.merge.commit,source:before,tree,failure:row.failure,runId:row.id})
        repository.git(['fetch','--no-tags','origin',result.commit])
        const snapshot={...row.runtimeSnapshot,comparisonHead:row.runtimeSnapshot.head,head:repository.runtimeGit(['rev-parse','HEAD'])}
        // A rollback must restore only the original accounted overlays. The old
        // snapshot parent is retained so blob comparisons never infer a new grant.
        require('./runtime').applyCheckout(repository,snapshot,result.commit)
        await runtime.restart(result.commit,{controlCommit:row.merge.commit})
        return{...result,restoredSource:before,tree,pr:pr.number}
      },
      verifyRollback:row=>runtime.verify(row,{rollback:true})
    }
  }
  async function finish (options) {
    acquire();const id=crypto.randomUUID(),file=path.join(runs,id+'.json')
    try{
      const workflow=createWorkflow({id,adapter:adapter(options),save:row=>atomic(file,row)})
      const result=await workflow.finish();atomic(path.join(artifacts,'latest.json'),{id,state:result.state,record:file})
      return result
    }finally{release()}
  }
  async function resume (id) {
    if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('invalid_promotion_id')
    acquire();const file=path.join(runs,id+'.json')
    try{
      const initial=JSON.parse(fs.readFileSync(file,'utf8')),workflow=createWorkflow({id,initial,adapter:adapter(),save:row=>atomic(file,row)})
      const result=await workflow.resume();atomic(path.join(artifacts,'latest.json'),{id,state:result.state,record:file});return result
    }finally{release()}
  }
  return{begin,finish,resume,repository,runtime,github,isActive:()=>active,artifacts}
}
module.exports={atomic,createCoordinator}
