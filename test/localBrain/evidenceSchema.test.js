'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {withEvidenceFields}=require('../../src/localBrain/evidenceSchema')
const {DISTILL_WITH_PLAN_SCHEMA}=require('../../src/intake/answerPlan')
test('local schema uses host field names and declared arithmetic only, without mutating shared schemas',()=>{
  const before=JSON.stringify(DISTILL_WITH_PLAN_SCHEMA)
  const out=withEvidenceFields(DISTILL_WITH_PLAN_SCHEMA,[{source:'inventory',items:[{fields:{stock:'3',par:'8',unit:'kg'}}]}],[{source:'inventory',derivations:{shortage:{minus:['par','stock']}}}])
  const fields=out.properties.answerPlan.properties.sections.items.properties.items.items.properties.facts.items.properties.field.enum
  assert.deepEqual(fields,['shortage','stock','par','unit'])
  assert.equal(JSON.stringify(DISTILL_WITH_PLAN_SCHEMA),before)
  assert.equal(withEvidenceFields(DISTILL_WITH_PLAN_SCHEMA,[],[]),DISTILL_WITH_PLAN_SCHEMA)
})

test('memory selections bind to active owner-visible gateway rows; invented and conflicting pointers fail closed',()=>{
  const {withMemoryReferences,projectMemoryReferences}=require('../../src/localBrain/evidenceSchema')
  const {present}=require('../../src/memory/replySources')
  const id='xx-cd157abe-4079-49ab-8895-b562db8252d4'
  const row={documentId:id,source:'memory_gateway',status:'active',scope:'private:owner',version:4,date:null}
  const base={type:'object',properties:{reply:{type:'string'}},required:['reply']},before=JSON.stringify(base)
  const schema=withMemoryReferences(base,[row,{...row,documentId:'bad'}, {...row,documentId:'xx-06c3a189-a5c1-4287-8fad-46955d4019ab',status:'deleted'}])
  assert.deepEqual(schema.properties.memoryReferences.items.enum,[id]);assert.equal(JSON.stringify(base),before)
  const selected=JSON.parse(projectMemoryReferences(JSON.stringify({reply:'A factual answer',memoryReferences:[id,id]}),schema))
  assert.equal(selected.memoryReferences,undefined)
  const shown=present(selected.reply,[row]);assert.equal(shown.memorySources.items[0].version,4);assert.equal(shown.memorySources.claimsVerified,false)
  assert.throws(()=>projectMemoryReferences(JSON.stringify({reply:'x',memoryReferences:['invented']}),schema))
  assert.equal(withMemoryReferences(base,[row,{...row,version:5}]),base)
  assert.equal(JSON.parse(projectMemoryReferences(JSON.stringify({reply:'No memory needed',memoryReferences:[]}),schema)).reply,'No memory needed')
})
