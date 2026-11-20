'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto')
const saved=require('../../../test/localBrain/fixtures/test-draft-inline-v1.json'),draft=require('./localTestDraft'),{catalogue,codeMask}=require('./localTestEvidence')
const file='acceptance/registered-task.test.cjs',packet=JSON.parse(saved.input.messages.find(m=>m.role==='user').content)
const generated=JSON.parse(saved.output.text),prepared={packet}
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')

test('saved real inline named-export draft binds the selected subject without executing generated code',()=>{
 assert.equal(sha(saved.input),saved.inputSha256);assert.equal(sha(saved.output),saved.outputSha256)
 assert.equal([...codeMask(generated.testCode).matchAll(/\btest\s*\(/g)].length,3)
 assert.deepEqual(draft.parse(saved.output.text,prepared),generated)
 const evidence=catalogue({[file]:generated.testCode},packet.files,packet.criteria)
 const stock=evidence.files[0].lines.find(l=>l.text.includes('.orderBoxes(3, 10, 4)'))
 assert.equal(stock.kind,'assertion');assert.deepEqual(stock.subjects,[{file:'src/localBrain/examples/stock.js',symbol:'orderBoxes'}])
 assert.equal(stock.text,generated.testCode.split('\n')[stock.line-1])
})

test('inline export anchors require a direct selected relative module call, never references or lookalike text',()=>{
 const source={'src/stock.js':'module.exports={orderBoxes};\n'},criteria=['Exercise orderBoxes']
 const accepted="assert.equal(require('../src/stock.js').orderBoxes(1,2,1),1)"
 const subjects=code=>catalogue({[file]:code},source,criteria).files[0].lines.flatMap(l=>l.subjects)
 assert.deepEqual(subjects(accepted),[{file:'src/stock.js',symbol:'orderBoxes'}])
 for(const code of ["// "+accepted,"'"+accepted.replaceAll("'",'"')+"'",'`'+accepted+'`',"assert.ok(require('../src/stock.js').orderBoxes)","assert.equal(require('../src/stock.js')['orderBoxes'](1,2,1),1)","assert.equal(require('../src/stock.js').tools.orderBoxes(1,2,1),1)","assert.equal(require('../src/unselected.js').orderBoxes(1,2,1),1)","assert.equal(require('../src/stock.js').other(1,2,1),1)","assert.equal(fake . require('../src/stock.js').orderBoxes(1,2,1),1)"]){
  assert.equal(subjects(code).some(s=>s.symbol==='orderBoxes'),false,code)
 }
 assert.deepEqual(catalogue({[file]:"assert.equal(require('../src/stock.js').newExport(1),1)"},source,['Exercise newExport']).required,[[{file:'src/stock.js',symbol:'newExport'}]])
})

test('inline named exports keep the full compact-review binding and all criterion checks',()=>{
 const review=require('./localTestReview'),prior=require('../../../test/localBrain/fixtures/test-draft-review-v4.json')
 const input={...prior.packet,ownerGoal:packet.goal,acceptanceCriteria:packet.criteria,source:packet.files,protectedTests:{[file]:generated.testCode}}
 const {packet:p,schema}=review.prepareCompact(input),lines=p.target.files.flatMap(f=>f.lines)
 const refs=c=>c.requiredSubjects.map(s=>lines.find(l=>l.kind==='assertion'&&l.subjects.some(v=>v.file===s.file&&v.symbol===s.symbol)).anchorId)
 const response={binding:p.binding,verdict:'pass',summary:schema.anyOf.find(v=>v.properties.verdict.const==='pass').properties.summary.const,findings:[],coverage:p.criteria.map(c=>({criterion:c.id,status:'covered',checks:c.checks.map(k=>({id:k.id,status:'covered',anchors:[...new Set(refs(c))],reason:'Synthetic protocol check only.'}))})),baseline:{expectation:'expected_failure',anchor:refs(p.criteria.at(-1))[0],reason:'New export is absent from unchanged baseline.'}}
 const result=review.parseCompact(JSON.stringify(response),input)
 assert.equal(result.reviewBasis.coverage.flatMap(c=>c.checks).length,13)
 const stock=result.reviewBasis.coverage[0].assertions[0];assert.match(stock.quote,/require\('.*stock.js'\)\.orderBoxes/)
 assert.equal(stock.quote,generated.testCode.split('\n')[stock.line-1])
 for(const mutate of [r=>r.coverage[0].checks.pop(),r=>{for(const k of r.coverage[0].checks)k.anchors=r.coverage[1].checks[0].anchors},r=>r.binding='0'.repeat(64)]){
  const r=structuredClone(response);mutate(r);assert.throws(()=>review.parseCompact(JSON.stringify(r),input),/invalid_worker_result/)
 }
})

test('missing named export retains the refusal with bounded diagnostic counts and no rejected source',()=>{
 const value={...generated,testCode:generated.testCode.replaceAll('.orderBoxes(','.wrongExport(')}
 assert.throws(()=>draft.parse(JSON.stringify(value),prepared),e=>{
  assert.equal(e.message,'invalid_worker_result');const d=draft.diagnostic(e)
  assert.equal(d.reason,'required_subject');assert.equal(d.missingSubjects,1);assert.equal(d.expectedTests,3)
  assert.ok(!JSON.stringify(d).includes('wrongExport'));assert.ok(!JSON.stringify(d).includes('stock.js'))
  return true
 })
})

test('draft rejection stages distinguish JSON, shape, syntax, contract and count without provider text',()=>{
 const cases=[['not JSON','json'],[JSON.stringify({expectedTests:3,testCode:'x',secret:'never persist this'}),'shape'],[JSON.stringify({expectedTests:3,testCode:'const broken = ;'}),'syntax'],[JSON.stringify({expectedTests:3,testCode:'const secret = "private text";'}),'contract'],[JSON.stringify({...generated,expectedTests:4}),'test_count']]
 for(const [text,reason]of cases)assert.throws(()=>draft.parse(text,prepared),e=>{
  const d=draft.diagnostic(e);assert.equal(d.reason,reason);assert.equal(d.responseChars,text.length)
  assert.ok(!JSON.stringify(d).includes('private text'));assert.equal(d.stage,'local_test_draft');return true
 })
 const d=draft.diagnostic({localDraftValidation:{reason:'secret reason',responseChars:Infinity,testCodeChars:-1,expectedTests:100000,declaredTests:{private:'text'},observedTests:NaN,missingSubjects:'1',raw:'do not copy'}})
 assert.equal(d.reason,'unknown');for(const key of ['responseChars','testCodeChars','expectedTests','declaredTests','observedTests','missingSubjects'])assert.equal(d[key],null)
 assert.equal(Object.hasOwn(d,'raw'),false)
})
