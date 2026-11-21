'use strict'
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {spawnSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto')
const draft=require('./localTestDraft'),review=require('./localTestReview')
const saved=require('../../../test/localBrain/fixtures/generic-draft-guidance-v1.json')
const snapshot=require('../../../test/localBrain/fixtures/pr205-knowledge-pack-v1.json')
const modelInput=JSON.parse(JSON.parse(saved.inputRaw).messages.find(message=>message.role==='user').content)
const rules=JSON.parse(snapshot['rules/request-kind.json'])
const oldDraft=JSON.parse(JSON.parse(saved.outputRaw).text)
const rows=oldDraft.testCode.split(/\/\/ Criterion \d: [^\n]*\n/).slice(1).flatMap((group,i)=>group.trim().split('\n').map(line=>{
 const parts=/^assert\.equal\(requestKind\(('([^']*)'|42)\),\s*(null|'(inspect|complete)')\);?$/.exec(line.trim())
 assert.ok(parts,line)
 return {testGroup:i+1,input:parts[2]??42,expected:parts[4]??null}
}))
const source=rules.scope.editableSource,testPath=rules.scope.protectedTest
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function pack(t){
 const temp=os.tmpdir(),dir=fs.mkdtempSync(path.join(temp,'pr205-cases-'))
 t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(temp)+path.sep));fs.rmSync(dir,{recursive:true,force:true})})
 for(const [name,text] of Object.entries(snapshot)){
  const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text)
 }
 return dir
}
const prepare=(dir,input=modelInput)=>draft.prepare(JSON.stringify(input),{pr205KnowledgePackDir:dir})
const wire=(cases=rows)=>JSON.stringify({cases})

test('the Owner Bridge resolves the sealed default without a new environment setting',()=>{
 const {resolvePr205KnowledgePackDir}=require('../../../scripts/subscription/startBridge')
 const ownerHome=path.join(os.tmpdir(),'owner-fixture')
 assert.equal(resolvePr205KnowledgePackDir({},ownerHome),
  path.join(ownerHome,'Documents','Codex','local-candidates','pr205-followup-knowledge-pack-v1'))
 const override=path.join(ownerHome,'explicit-copy')
 assert.equal(resolvePr205KnowledgePackDir({XIANGXIANG_PR205_KNOWLEDGE_PACK_DIR:override},ownerHome),override)
 const bridge=fs.readFileSync(require.resolve('../../../scripts/subscription/startBridge'),'utf8')
 assert.match(bridge,/workerProviders\.local\(\{pr205KnowledgePackDir:resolvePr205KnowledgePackDir\(env\)\}\)/)
})

test('the saved 13 literals render three tests with direct calls and only the new group RED',t=>{
 const dir=pack(t),p=prepare(dir),{generated,origin}=draft.project(wire(),p)
 assert.equal(p.schema.properties.cases.maxItems,13)
 assert.deepEqual(rows.map(r=>r.testGroup),[1,1,1,2,2,2,2,2,2,2,3,3,3])
 assert.equal(generated.expectedTests,3)
 assert.equal((generated.testCode.match(/^test\(/gm)||[]).length,3)
 assert.equal((generated.testCode.match(/assert.equal\(require\("\.\.\/src\/topics\/publicAnswerFollowupIntent\.js"\)\.requestKind\(/g)||[]).length,13)
 assert.equal(origin.protocol,'pr205_literal_cases_v1')
 assert.equal(origin.rawOutputSha256,hash(wire()))
 assert.equal(origin.renderedTestSha256,hash(generated.testCode))
 assert.equal(origin.testsExecuted,false)
 assert.equal(draft.project(wire(),p).generated.testCode,generated.testCode)
 assert.throws(()=>draft.project(JSON.stringify(oldDraft),p),e=>e.localDraftValidation.reason==='pr205_case_shape')
 const base=path.join(dir,'baseline'),file=path.join(base,testPath)
 fs.mkdirSync(path.dirname(file),{recursive:true})
 fs.writeFileSync(file,generated.testCode)
 const env={...process.env}
 delete env.NODE_TEST_CONTEXT
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{cwd:base,env,encoding:'utf8',timeout:10000})
 assert.equal(result.status,1,result.stderr)
 assert.match(result.stdout,/^# pass 2\s*$/m)
 assert.match(result.stdout,/^# fail 1\s*$/m)
 assert.match(result.stdout,/^not ok 3 - new inspection phrases/m)
 assert.match(result.stdout,/null !== 'inspect'/)
 const redLine=generated.testCode.split('\n').findIndex(line=>line.includes('requestKind("Which parts are missing?"),"inspect"'))+1
 assert.ok(redLine>0)
 assert.ok(result.stdout.includes(testPath.split('/').at(-1)+':'+redLine+':'))
})

test('invalid replies name the missing slot, wrong group, wrong result or position without echoing model data',t=>{
 const p=prepare(pack(t))
 const check=(change,reason,fields)=>{
  const data=structuredClone(rows);change(data)
  assert.throws(()=>draft.project(wire(data),p),error=>{
   const info=draft.diagnostic(error)
   assert.equal(info.reason,reason)
   for(const [key,value] of Object.entries(fields))assert.equal(info[key],value)
   assert.doesNotMatch(JSON.stringify(info),/untrusted-sentinel/)
   return true
  })
 }
 check(a=>a.splice(4,1),'pr205_case_missing',{testGroup:2,caseInGroup:2})
 check(a=>a[10].testGroup=2,'pr205_case_group',{testGroup:3,caseInGroup:1,row:11})
 check(a=>a[10].expected='complete','pr205_case_expected',{testGroup:3,caseInGroup:1,row:11})
 check(a=>{[a[10],a[11]]=[a[11],a[10]]},'pr205_case_order',{testGroup:3,caseInGroup:1,row:11})
 check(a=>a[2]=a[1],'pr205_case_duplicate',{testGroup:1,caseInGroup:2,row:3})
 check(a=>a[0].input='untrusted-sentinel();','pr205_case_input',{row:1})
 check(a=>a[0].code='untrusted-sentinel();','pr205_case_shape',{row:1})
 check(a=>a.push(a[0]),'pr205_case_extra',{row:14})
})

test('only the pinned allowlist is loaded and exact selection or pack drift fails before a draft',t=>{
 const dir=pack(t)
 fs.writeFileSync(path.join(dir,'unlisted.txt'),'unlisted-sentinel')
 const p=prepare(dir),manifest=JSON.parse(snapshot['MANIFEST.json'])
 assert.deepEqual(p.packet.knowledge.files.map(f=>f.path),manifest.taskContext.allow)
 assert.doesNotMatch(JSON.stringify(p.packet),/unlisted-sentinel|evidenceDirectory/)
 assert.deepEqual(Object.keys(p.packet.files),[source])
 assert.ok(!draft.prepare(JSON.stringify(modelInput)).schema.properties.cases)
 const other={...modelInput,goal:'Different unchanged work'}
 assert.ok(!prepare(dir,other).schema.properties.cases)
 for(const changed of [
  {...modelInput,goal:modelInput.goal+' drift'},
  {...modelInput,criteria:modelInput.criteria.slice(1)},
  {...modelInput,files:{...modelInput.files,'extra.js':'unlisted-sentinel'}},
  {...modelInput,files:{[source]:modelInput.files[source]+' // changed'}},
  {...modelInput,editable:[]},
  {...modelInput,protectedTestPath:'../foreign.cjs'}
 ])assert.throws(()=>prepare(dir,changed),e=>draft.diagnostic(e).reason==='pr205_knowledge_scope')
 fs.appendFileSync(path.join(dir,manifest.taskContext.allow[1]),'changed')
 assert.throws(()=>prepare(dir),e=>draft.diagnostic(e).reason==='pr205_knowledge_pack')
})

test('the pinned manifest and listed entries cannot be replaced or linked',t=>{
 const dir=pack(t)
 const manifest=path.join(dir,'MANIFEST.json')
 fs.appendFileSync(manifest,' ')
 assert.throws(()=>prepare(dir),e=>draft.diagnostic(e).reason==='pr205_knowledge_pack')
 fs.writeFileSync(manifest,snapshot['MANIFEST.json'])
 const rulesFile=path.join(dir,'rules','request-kind.json'),copy=path.join(dir,'unlisted-copy.json')
 fs.renameSync(rulesFile,copy)
 fs.linkSync(copy,rulesFile)
 assert.throws(()=>prepare(dir),e=>draft.diagnostic(e).reason==='pr205_knowledge_pack')
})

test('the local provider sends only sealed context and returns host-generated code from saved literals',async t=>{
 const dir=pack(t),manifest=JSON.parse(snapshot['MANIFEST.json'])
 const usage=require('../../actions/usageBudget'),{createStore}=require('../../actions/store'),{hash:approvalHash}=require('../../actions/contract')
 const {createLocalProviders}=require('./localProviders')
 const profile=usage.localDevelopmentProfile(randomUUID()),commit='a'.repeat(40),owner={id:'owner',role:'owner'}
 const budget=usage.createUsageBudget({store:createStore({dir:path.join(dir,'fixture-usage')}),profile,
  evidenceDir:path.join(dir,'fixture-evidence'),activationReady:()=>true,runtimeCommit:()=>commit})
 budget.handle(owner,{op:'usage_local_acceptance_activate',rootId:profile.id,predecessorHash:approvalHash([]),commit})
 budget.handle(owner,{op:'usage_bind_turn',turnId:profile.id,conversationId:profile.id})
 const scope=budget.enterTurn(profile.id,profile.id,randomUUID(),'coding')
 let sends=0
 const provider=createLocalProviders({root:dir,pr205KnowledgePackDir:dir,
  executor:{run:async()=>{throw Error('unexpected guest')},readiness:async()=>({ready:true}),isBusy:()=>false},
  fetchFn:async(url,options)=>{
   assert.ok(url.startsWith('http://127.0.0.1:11435/'))
   if(url.endsWith('/api/tags'))return Response.json({models:[{name:profile.model,digest:profile.digest}]})
   sends++
   const request=JSON.parse(options.body),packet=JSON.parse(request.messages.find(m=>m.role==='user').content)
   assert.equal(request.options.num_predict,4096)
   assert.equal(request.think,false)
   assert.deepEqual(Object.keys(request.format.properties),['cases'])
   assert.deepEqual(Object.keys(request.format.properties.cases.items.properties),['testGroup','input','expected'])
   assert.deepEqual(packet.knowledge.files.map(f=>[f.path,hash(f.content)]),
    manifest.taskContext.allow.map(name=>[name,manifest.payload[name].sha256]))
   assert.doesNotMatch(JSON.stringify(packet),/diagnostic-sentinel|fixture-usage|evidenceDirectory/)
   return new Response(JSON.stringify({message:{content:wire()},done:true,done_reason:'stop'})+'\n')
  }
 })
 try{
  const input={...modelInput,unapprovedContext:'diagnostic-sentinel'}
  const result=await budget.withScope(scope,()=>provider.draft.complete(JSON.stringify(input),{}))
  assert.equal(sends,1)
  assert.equal(result.draftOrigin.rawOutputSha256,hash(wire()))
  assert.equal(result.draftOrigin.modelAuthoredJavaScript,false)
  assert.equal(JSON.parse(result.text).expectedTests,3)
  assert.equal(budget.status().helper.dispatched,1)
  const evidence=fs.readdirSync(path.join(dir,'fixture-evidence')).map(name=>JSON.parse(fs.readFileSync(path.join(dir,'fixture-evidence',name),'utf8')))
  assert.ok(evidence.some(row=>row.text===wire()))
 }finally{budget.finishTurn(scope);budget.handle(owner,{op:'usage_pause'})}
})

test('review binds the one designated RED assertion to the rendered version',t=>{
 const p=prepare(pack(t)),{generated,origin}=draft.project(wire(),p)
 const input={ownerGoal:modelInput.goal,acceptanceCriteria:modelInput.criteria,source:modelInput.files,
  protectedTests:{[testPath]:generated.testCode},workOrder:{allowedFiles:[testPath],protectedFiles:[testPath],expectedTests:3},
  draftOrigin:origin,testsExecuted:false,appliedToLive:false}
 const checked=review.prepareCompact(input),lines=checked.packet.target.files[0].lines.filter(line=>line.kind==='assertion')
 const anchor=lines[10]
 assert.match(anchor.text,/\)\.requestKind\("Which parts are missing\?"\),"inspect"\)/)
 assert.deepEqual(checked.schema.$defs.red.properties.anchor.enum,[anchor.anchorId])
 assert.deepEqual(checked.packet.criteria.map(group=>group.checks.length),[3,7,3])
 const response={binding:checked.packet.binding,verdict:'pass',summary:'Static review passed. Tests were not run. Baseline RED expected.',findings:[],
  coverage:checked.packet.criteria.map((group,g)=>({criterion:group.id,status:'covered',checks:group.checks.map((check,i)=>({
   id:check.id,status:'covered',anchors:[lines[[0,3,10][g]+i].anchorId],reason:'Saved literal checked offline.'}))})),
  baseline:{anchor:anchor.anchorId,expectation:'expected_failure',reason:'Unchanged requestKind returns null for the designated input.'}}
 assert.equal(review.parseCompact(JSON.stringify(response),input).reviewBasis.baseline.quote,anchor.text)
 response.baseline.anchor=lines[0].anchorId
 assert.throws(()=>review.parseCompact(JSON.stringify(response),input),e=>e.reviewValidation.stage==='red_anchor')
})
