'use strict'

const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {randomUUID} = require('node:crypto')
const {createDailyDialogue} = require('./dailyDialogue')
const deployment = require('./deploymentProfile.json')
const usage = require('../actions/usageBudget')
const commit = 'b'.repeat(40)
const selection = {model:deployment.model, digest:deployment.digest, effort:'auto', phase:'answer'}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'standing-dialogue-'))
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}))
  let now = Date.parse('2026-11-21T23:00:00Z')
  const open = () => createDailyDialogue({dir,now:() => now,runtimeCommit:() => commit})
  return {dir,open,advance:ms => {now+=ms},id:randomUUID(),conversation:randomUUID()}
}

function attempt() {
  const permit=usage.service().reserve('helper',selection)
  assert.equal(permit.claimNative(selection),true)
  permit.capture('local_model_input',{content:'not saved as raw output'})
  permit.dispatched('local_http_send')
  permit.finish(null)
}

test('standing approval persists across restart and time with an independent audited ceiling on each message',async t => {
  const f=fixture(t), service=f.open()
  assert.equal(service.status().state,'not_activated')
  await assert.rejects(service.run(f.conversation,randomUUID(),attempt),{code:'usage_not_enabled'})
  service.manageStanding('activate',f.id,commit)
  assert.equal(service.status().mode,'standing')
  assert.equal(service.status().helper.limit,null)
  const first=randomUUID()
  await assert.rejects(service.run(f.conversation,first,() => {
    for(let i=0;i<12;i++)attempt()
    attempt()
  }),{code:'usage_limit_reached'})
  const receipt=service.afterTurn(f.id,f.conversation,first,{get:id => ({id,state:'completed',conversationId:f.conversation})})
  assert.equal(receipt.attempts.length,12)
  f.advance(2*86400000)
  const again=f.open()
  for(let i=0;i<130;i++)await again.run(f.conversation,randomUUID(),attempt)
  await assert.rejects(again.run(f.conversation,first,attempt),{code:'usage_turn_replayed'})
  assert.deepEqual([again.status().state,again.status().expiresAt,again.status().helper.succeeded,again.status().today.succeeded],['active',null,142,130])
})

test('standing pause fences outstanding permits even after resume, and preserves short approvals',async t => {
  const f=fixture(t), service=f.open(), previous=randomUUID()
  service.activate({id:previous,commit,limit:4,windowMs:900000})
  assert.throws(() => service.manageStanding('activate',f.id,commit),{code:'usage_unresolved_work'})
  service.pause(previous)
  const oldFile=path.join(f.dir,previous+'.json'), saved=fs.readFileSync(oldFile)
  service.manageStanding('activate',f.id,commit)
  await assert.rejects(service.run(f.conversation,randomUUID(),() => {
    const permit=usage.service().reserve('helper',selection)
    permit.claimNative(selection)
    const owner=f.open()
    owner.manageStanding('pause',f.id,commit)
    assert.equal(owner.status().state,'paused')
    owner.manageStanding('resume',f.id,commit)
    try {permit.dispatched('local_http_send')}catch(e){permit.finish(e);throw e}
  }),{code:'usage_run_not_active'})
  assert.deepEqual([service.status().helper.reserved,service.status().helper.dispatched,service.status().helper.failed],[1,0,1])
  service.manageStanding('pause',f.id,commit)
  await assert.rejects(f.open().run(f.conversation,randomUUID(),attempt),{code:'usage_run_not_active'})
  service.manageStanding('resume',f.id,commit)
  await service.run(f.conversation,randomUUID(),attempt)
  service.manageStanding('revoke',f.id,commit)
  assert.throws(() => service.manageStanding('resume',f.id,commit),{code:'usage_binding_conflict'})
  assert.deepEqual(fs.readFileSync(oldFile),saved)
})


test('standing audit failure prevents dispatch and preserves the preceding reservation',async t => {
  const f=fixture(t), service=f.open()
  service.manageStanding('activate',f.id,commit)
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(f.dir,'standing.sqlite'))
  try {
    // Refuse publication of the input digest after the durable reservation.
    db.exec("CREATE TRIGGER reject_input BEFORE UPDATE ON turns WHEN NEW.ledger GLOB '*local_model_input*' BEGIN SELECT RAISE(ABORT,'test'); END")
  } finally {db.close()}
  let providerSends=0
  await assert.rejects(service.run(f.conversation,randomUUID(),() => {
    const permit=usage.service().reserve('helper',selection)
    permit.claimNative(selection)
    try {
      permit.capture('local_model_input',{content:'never dispatch'})
      permit.dispatched('local_http_send')
      providerSends++
    } catch (err) { permit.finish(err); throw err }
  }),{code:'usage_audit_unavailable'})
  const totals=service.status().helper
  assert.deepEqual([providerSends,totals.reserved,totals.dispatched,totals.failed,totals.unresolved],[0,1,0,1,0])
  const evidence=path.join(f.dir,'standing-evidence'),names=fs.readdirSync(evidence)
  assert.equal(names.length,1)
  const failure=JSON.parse(fs.readFileSync(path.join(evidence,names[0]),'utf8'))
  assert.match(failure.osCode,/^SQLITE_\d+$/)
  assert.deepEqual([failure.fileOperation,failure.event],['write','evidence_digest'])
  assert.ok(!JSON.stringify(failure).includes('never dispatch'))
})

test('standing status follows the installed source and pause does not discard dispatched usage',async t => {
  const f=fixture(t), service=f.open()
  service.manageStanding('activate',f.id,commit)
  await service.run(f.conversation,randomUUID(),() => {
    const permit=usage.service().reserve('helper',selection)
    permit.claimNative(selection)
    permit.dispatched('local_http_send')
    assert.equal(f.open().status().helper.unresolved,1)
    f.open().manageStanding('pause',f.id,commit,1)
    permit.finish(null)
  })
  assert.deepEqual([service.status().state,service.status().helper.succeeded],['paused',1])
  service.manageStanding('resume',f.id,commit,2)
  assert.throws(()=>service.manageStanding('pause',f.id,commit,1),{code:'usage_binding_conflict'})
  const otherCommit='c'.repeat(40)
  const afterUpgrade=createDailyDialogue({dir:f.dir,runtimeCommit:()=>otherCommit})
  assert.deepEqual([afterUpgrade.status().sourceMatches,afterUpgrade.status().helper.available],[false,0])
  await assert.rejects(afterUpgrade.run(f.conversation,randomUUID(),attempt),{code:'usage_binding_conflict'})
  afterUpgrade.manageStanding('pause',f.id,otherCommit,3)
  assert.throws(()=>afterUpgrade.manageStanding('resume',f.id,otherCommit,4),{code:'usage_binding_conflict'})
  afterUpgrade.manageStanding('revoke',f.id,otherCommit,4)
  assert.equal(afterUpgrade.standingStatus(f.id).helper.succeeded,1)
})
