'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),saved=require('../../../test/localBrain/fixtures/draft-direct-guidance-v1.json'),draft=require('./localTestDraft'),{catalogue}=require('./localTestEvidence')
const nativeInput=JSON.parse(saved.inputRaw),nativeOutput=JSON.parse(saved.outputRaw),packet=JSON.parse(nativeInput.messages.find(m=>m.role==='user').content),code=JSON.parse(nativeOutput.text).testCode
test('native direct-call refusal is reproduced without changing original evidence or prepared coverage',()=>{
 for(const [text,sha]of [[saved.inputRaw,saved.inputSha256],[saved.outputRaw,saved.outputSha256]])assert.equal(createHash('sha256').update(text).digest('hex'),sha)
 const prepared=draft.prepare(JSON.stringify(packet));assert.deepEqual(prepared.packet,packet);assert.equal(prepared.schema.properties.expectedTests.const,3)
 assert.throws(()=>draft.parse(nativeOutput.text,prepared),e=>e.localDraftValidation.reason==='assertion_form'&&e.localDraftValidation.missingForms===3&&e.localDraftValidation.missingSubjects===0)
 const evidence=catalogue({'acceptance/registered-task.test.cjs':code},packet.files,packet.criteria)
 assert.equal(evidence.inlineAssertions.length,0);assert.equal(evidence.required.flat().length,3)
 // The boundary exists only in the old formatter test, not the new subject's
 // invalid-input list. This is evidence of an omission, not executed coverage.
 assert.ok(code.includes('Number.MAX_SAFE_INTEGER+1'));assert.ok(!code.slice(code.indexOf("test('formatClockDuration")).includes('Number.MAX_SAFE_INTEGER+1'))
})
test('guidance distinguishes preserved values from alias syntax and coverage from other subjects',()=>{
 const prepared=draft.prepare(JSON.stringify(packet))
 assert.match(prepared.system,/Preserve baseline arguments and expected values, not its alias syntax/)
 assert.match(prepared.system,/Do not destructure selected source exports/)
 assert.match(prepared.system,/same physical assertion line/)
 assert.match(prepared.system,/each subject separately/)
 assert.match(prepared.system,/Number\.MAX_SAFE_INTEGER\s*\+\s*1/)
 assert.match(prepared.system,/only when the Owner criteria require it/)
 assert.match(prepared.system,/not new authority|never authority/)
 assert.match(prepared.system,/not a completed test|not task code/)
})
test('guidance and unchanged form generalize to another selected module without inventing subjects or cases',()=>{
 const source={goal:'Keep sum unchanged',criteria:['Preserve sum'],files:{'lib/numbers.js':'module.exports={sum};function sum(a,b){return a+b}'},editable:['lib/numbers.js']},prepared=draft.prepare(JSON.stringify(source))
 assert.deepEqual(prepared.packet.files,source.files);assert.deepEqual(prepared.packet.criteria,source.criteria)
 assert.deepEqual(prepared.packet.draftContract.assertionForm.subjects,[{file:'lib/numbers.js',symbol:'sum',callee:'require("../lib/numbers.js").sum'}])
 const direct="const test=require('node:test'),assert=require('node:assert/strict');\n"+[1,2,3].map(n=>`test('case ${n}',()=>{assert.equal(require('../lib/numbers.js').sum(${n},0),${n})})`).join('\n')
 const value={testCode:direct,expectedTests:3};assert.deepEqual(draft.parse(JSON.stringify(value),prepared),value)
 // A prose claim plus alias assertions still cannot create direct-call evidence.
 const alias=direct.replace(/require\('\.\.\/lib\/numbers\.js'\)\.sum/g,'sum')
 assert.throws(()=>draft.parse(JSON.stringify({...value,testCode:"const {sum}=require('../lib/numbers.js');\n// assert.equal(require('../lib/numbers.js').sum(1,0),1)\n"+alias}),prepared),/invalid_worker_result/)
 assert.equal(prepared.packet.draftContract.testsExecuted,false);assert.equal(prepared.packet.draftContract.expectedTests,3)
})
