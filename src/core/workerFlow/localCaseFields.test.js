'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),{createHash}=require('node:crypto'),saved=require('../../../test/localBrain/fixtures/draft-case-fields-v1.json'),draft=require('./localTestDraft'),cases=require('./localCasePlan'),{synthetic}=require('../../../test/localBrain/fixtures/casePlan.fixture.cjs')
const input=JSON.parse(saved.inputRaw),output=JSON.parse(saved.outputRaw),packet=JSON.parse(input.messages.find(m=>m.role==='user').content),hash=s=>createHash('sha256').update(s).digest('hex')
test('retained native case-field failure is immutable and still refused before any rendering',()=>{
 assert.equal(hash(saved.inputRaw),saved.inputSha256);assert.equal(hash(saved.outputRaw),saved.outputSha256)
 assert.equal(saved.inputSha256,'ab75ffbbd9cd16505d773c30dc6cb640b3c28921102171b8d2f7b679251501e1');assert.equal(saved.outputSha256,'cca433047b6694a6b341719ccc600bcb10ef3cf179ef90b4ce29e6b73dcd82e2')
 for(const p of [{packet},draft.prepare(JSON.stringify(packet))])assert.throws(()=>draft.project(output.text,p),e=>e.localDraftValidation.reason==='case_plan_expression')
})
test('new case schema explains numeric slots, quoted string expressions and exact baseline arithmetic',()=>{
 const p=draft.prepare(JSON.stringify(packet)),schema=p.schema.properties.tests.properties
 for(const [id,arity]of [['c1',3],['c2',1],['c3',1]]){
  const row=schema[id].properties.groups.items.properties.rows.items
  assert.equal(row.minItems,arity+1);assert.equal(row.maxItems,arity+1)
  assert.ok(row.description.includes('slots 0..'+(arity-1)));assert.ok(row.description.includes('slot '+arity));assert.ok(row.description.includes('never the callee'))
  assert.ok(row.items.description.includes('JS expression'));assert.ok(row.items.description.includes('quoted'))
 }
 const guide=p.system
 assert.ok(guide.includes('["7","11","2","2"]'));assert.ok(guide.includes('["5","\'00:00:05\'"]'));assert.ok(guide.includes('["NaN","RangeError"]'))
 assert.ok(guide.includes('BigInt(Number.MAX_SAFE_INTEGER)'));assert.ok(guide.includes('never a computed return value'));assert.ok(guide.includes('do not derive a new-format expectation'))
 assert.deepEqual(p.packet.criteria,packet.criteria);assert.deepEqual(p.packet.files,packet.files);assert.deepEqual(p.packet.draftContract.casePlan,packet.draftContract.casePlan)
})
test('field guidance never repairs calls, bare expected strings, placeholders or missing rejection probes',()=>{
 const p=draft.prepare(JSON.stringify(packet)),make=()=>synthetic(p.packet.draftContract.casePlan)
 for(const bad of ['require("../src/localBrain/examples/duration.js").formatDuration(0)','0m 0s','],','result','String(5)']){
  const v=make();v.tests.c2.groups[0].rows[0][1]=bad
  assert.throws(()=>draft.project(JSON.stringify(v),p),e=>e.localDraftValidation.reason==='case_plan_expression',bad)
 }
 const v=make();delete v.tests.c3.rejections.r6;assert.throws(()=>draft.project(JSON.stringify(v),p),e=>e.localDraftValidation.reason==='case_plan_boundary')
 const projected=draft.project(JSON.stringify(make()),p);assert.equal(projected.origin.testsExecuted,false);assert.equal(projected.origin.modelAuthoredJavaScript,false)
})
test('synthetic preserved expectations execute exactly; a grammar-valid wrong large value is not silently fixed',t=>{
 // Controlled test fixture execution only, never native/model output or formal files.
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'case-field-regression-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 for(const [name,text]of Object.entries(packet.files)){const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text)}
 const target=path.join(root,'src/localBrain/examples/duration.js')
 fs.appendFileSync(target,"\nmodule.exports.formatClockDuration=function(seconds){if(!Number.isSafeInteger(seconds)||seconds<0)throw new RangeError('seconds');const n=BigInt(seconds);return String(n/3600n).padStart(2,'0')+':'+String(n%3600n/60n).padStart(2,'0')+':'+String(n%60n).padStart(2,'0')}\n")
 const p=draft.prepare(JSON.stringify(packet)),v=synthetic(p.packet.draftContract.casePlan),file=path.join(root,'acceptance/registered-task.test.cjs');fs.mkdirSync(path.dirname(file))
 const large=v.tests.c2.groups[0].rows.find(row=>row[0]==='Number.MAX_SAFE_INTEGER')
 large[1]='(BigInt(Number.MAX_SAFE_INTEGER)/60n)+"m "+(BigInt(Number.MAX_SAFE_INTEGER)%60n)+"s"'
 const env={...process.env};delete env.NODE_TEST_CONTEXT
 const run=value=>{fs.writeFileSync(file,draft.project(JSON.stringify(value),p).generated.testCode);return cp.spawnSync(process.execPath,['--test','--test-reporter=tap',file],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:30000})}
 const good=run(v);assert.equal(good.status,0,good.stdout+good.stderr);assert.match(good.stdout,/# pass 3/)
 large[1]="'423666631m 59s'";assert.throws(()=>run(v),e=>e.localDraftValidation.reason==='case_plan_baseline_expected')
 assert.equal(v.tests.c3.groups[0].rows.length,10);assert.equal(Object.keys(v.tests.c3.rejections).length,14)
 // The exact-source catalogue now rejects this grammar-valid wrong literal
 // before execution, without changing or silently correcting the response.
 assert.equal(large[1],"'423666631m 59s'")
})
