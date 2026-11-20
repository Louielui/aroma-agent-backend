'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const profile=require('../../localBrain/deploymentProfile.json')
const {createIsolatedCoding}=require('./isolatedCoding')
const order={goal:'Implement a small feature in the approved package only',files:{'issue.js':'exports.value=0','issue.test.js':'// immutable tests'},editable:['issue.js'],tests:['issue.test.js'],expectedTests:2,sourceRevision:'offline-fixture'}
function fixture(t,provider){const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-code-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let runs=0;return{root,worker:createIsolatedCoding({root,local:true,provider,executor:{isBusy:()=>false,readiness:async()=>({ready:true}),run:async p=>{assert.equal(p.files['issue.test.js'],order.files['issue.test.js']);const green=p.files['issue.js']==='exports.value=42';runs++;return{exitCode:green?0:1,total:2,passed:green?2:0,failed:green?0:2,skipped:0,cancelled:0,stdout:'assert value equals 42',evidenceHash:'offline-fixture-'+runs}}}})}}
test('local coding reuses the sealed approval, immutable tests and measured repair loop',async t=>{let calls=0;const f=fixture(t,{preflight:async()=>{},complete:async(p,o)=>{calls++;assert.equal(o.model,'local:'+profile.model);assert.equal(o.effort,'auto');if(calls===2)assert.equal(JSON.parse(p).repair.failed,2);return{model:'local:'+profile.model,billing:'local',text:JSON.stringify({changes:[{file:'issue.js',content:'exports.value='+(calls===1?41:42)}],summary:'candidate'})}}});const ticket=f.worker.prepare(order,'owner');const result=await f.worker.execute({approval:ticket,actor:'owner'});assert.equal(calls,2);assert.equal(result.state,'accepted_isolated');assert.equal(result.billing,'local');assert.equal(result.appliedToLive,false);assert.equal(result.workOrder.executionSelection.digest,profile.digest);await assert.rejects(f.worker.execute({approval:ticket,actor:'owner'}),/approval_unavailable/)})
test('local coding refuses subscription output without retrying or running candidate tests',async t=>{let calls=0;const f=fixture(t,{preflight:async()=>{},complete:async()=>{calls++;return{model:'gpt-6.1-sol',billing:'chatgpt-subscription',text:'{}'}}});await assert.rejects(f.worker.execute({approval:f.worker.prepare(order,'owner'),actor:'owner'}),/local_model_selection_mismatch/);assert.equal(calls,1)})
test('local work cannot mislabel a fixed local model with cloud reasoning settings',t=>{const f=fixture(t,{});assert.throws(()=>f.worker.prepare({...order,effort:'high'},'owner'),/local_effort_unsupported/)})
test('local provider refuses missing usage scope before even metadata or model traffic',async()=>{let sent=0;const {createLocalCodingProvider}=require('./localCodingProvider');const provider=createLocalCodingProvider({fetchFn:async()=>{sent++;throw Error('must not send')}});await assert.rejects(provider.complete('x',{model:'local:'+profile.model,effort:'auto',responseFormat:{type:'json_schema',schema:{}}}),/usage_scope_required/);assert.equal(sent,0)})
test('local provider pins the loopback endpoint, model, digest and billing without cloud clients',async()=>{const {createLocalCodingProvider}=require('./localCodingProvider');assert.throws(()=>createLocalCodingProvider({env:{LOCAL_MODEL_URL:'https://example.invalid/'}}),/local_model_selection_mismatch/);assert.throws(()=>createLocalCodingProvider({env:{LOCAL_MODEL:'other'}}),/local_model_selection_mismatch/);const p=createLocalCodingProvider();assert.equal(p.selection.model,'local:'+profile.model);assert.equal(p.selection.digest,profile.digest);assert.equal(p.selection.cloudFallback,false)})

// This uses the source-pinned stock criteria from an existing native draft
// fixture. The provider and executor are doubles; no generated code runs.
test('stock implementation and measured repair both carry the complete numeric contract', async t => {
  const { definition } = require('../../core/projectTasks/contract')
  const { evidence } = require('../../../test/localBrain/fixtures/stock-case-proof-native-v1.json')
  const native = JSON.parse(evidence['draft-input'].raw)
  const draft = JSON.parse(native.messages.find(message => message.role === 'user').content)
  const stock = 'src/localBrain/examples/stock.js'
  const protectedTest = 'acceptance/registered-task.test.cjs'
  const protectedCode = "require('node:test'); require('node:assert/strict')"
  const id = 'ba0dce59-3723-4f1c-9326-4a8ef85243fc'
  const source = draft.files[stock]
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-guidance-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const changedCriteria = draft.criteria.map((criterion, index) => index === 2 ? criterion + ' Retain equivalent inputs.' : criterion)
  const scenarios = [
    { goal: draft.goal, criteria: draft.criteria, exactRecipe: true },
    { goal: draft.goal, criteria: changedCriteria, exactRecipe: false },
    { goal: draft.goal + '\nOwner acceptance criteria:\nAn earlier heading', criteria: draft.criteria, exactRecipe: false }
  ]
  for (const { goal, criteria, exactRecipe } of scenarios) {
    const request = { bootCommit: 'a'.repeat(40), requestId: id, goal, criteria, execution: 'local',
      editable: [stock], scope: { profile: 'repository', files: [stock], budgetRoot: id } }
    const { workOrder } = definition(id, request, { testCode: protectedCode, expectedTests: 3 })
    const order = { goal: workOrder.goal, editable: [stock], tests: [protectedTest], expectedTests: 3,
      sourceRevision: request.bootCommit, files: { [stock]: source, [protectedTest]: protectedCode } }
    const expectedSystems = []
    let executorCalls = 0
    const measured = { failed: 1, total: 3, stdout: 'measured first assertion only', evidenceHash: 'bound-failed-candidate' }
    const worker = createIsolatedCoding({
      local: true, root, provider: {
        preflight: async () => {},
        complete: async (text, options) => {
          const packet = JSON.parse(text)
          expectedSystems.push(options.system)
          assert.equal(packet.goal, workOrder.goal)
          assert.equal(packet.files[protectedTest], protectedCode)
          assert.deepEqual(packet.repair, expectedSystems.length === 1 ? undefined : measured)
          assert.deepEqual(options.responseFormat.schema.properties.changes.items.properties.file.enum, [stock])
          return { model: 'local:' + profile.model, billing: 'local',
            text: JSON.stringify({ changes: [{ file: stock, content: source + '\n// fixture ' + expectedSystems.length }], summary: 'fixture' }) }
        }
      }, executor: {
        isBusy: () => false,
        readiness: async () => ({ ready: true }),
        run: async () => {
          executorCalls++
          return { ...measured, exitCode: 1, passed: 2, skipped: 0, cancelled: 0 }
        }
      }
    })

    await assert.rejects(worker.execute({ approval: worker.prepare(order, 'owner'), actor: 'owner' }), /acceptance_failed/)
    assert.equal(executorCalls, 3)
    assert.equal(expectedSystems.length, 2)
    for (const system of expectedSystems) {
      for (const requirement of ['Number.isSafeInteger(counted)', 'Number.isSafeInteger(recorded)', 'counted < 0', 'recorded < 0',
        'RangeError', 'difference === 0 ? 0 : difference', 'all 12 rejection cases']) {
        assert.equal(system.includes(requirement), exactRecipe, requirement)
      }
    }
    assert.doesNotMatch(expectedSystems[0], /first failing assertion/)
    assert.match(expectedSystems[1], /first failing assertion/)
    assert.match(expectedSystems[1], /recheck every original requirement/)
  }
})
