'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),saved=require('../../../test/localBrain/fixtures/case-atomic-native-v1.json'),draft=require('./localTestDraft'),baseline=require('./localCaseBaseline'),{synthetic}=require('../../../test/localBrain/fixtures/casePlan.fixture.cjs')
const hash=b=>createHash('sha256').update(b).digest('hex'),input=JSON.parse(saved.inputRaw),output=JSON.parse(saved.outputRaw),packet=JSON.parse(input.messages.find(m=>m.role==='user').content),make=()=>draft.prepare(JSON.stringify(packet))

test('native tail-comma failure is retained byte-for-byte and rejected without output repair',()=>{
 assert.equal(hash(saved.inputRaw),saved.inputSha256);assert.equal(hash(saved.outputRaw),saved.outputSha256)
 const data=JSON.parse(output.text);assert.equal(data.tests.c2.groups[0].rows[6][0],'Number.MAX_SAFE_INTEGER,');assert.equal(data.tests.c3.groups[0].rows[9][0],'Number.MAX_SAFE_INTEGER,')
 for(const prepared of [{packet},make()])assert.throws(()=>draft.project(output.text,prepared),e=>e.localDraftValidation.reason==='case_plan_expression')
 assert.equal(JSON.parse(saved.outputRaw).text,output.text)
})

test('exact-source drafting input exposes each of the 52 baseline cases as reference data, never model output',()=>{
 const p=make(),c=p.packet.draftContract.baselineContract,refs=c.referenceCases
 assert.equal(c.requiredRows,52);assert.ok(Array.isArray(refs));assert.equal(refs.length,2)
 assert.deepEqual(refs.map(v=>[v.criterion,v.symbol,v.cases.length]),[['c1','orderBoxes',35],['c2','formatDuration',17]])
 const stock=refs[0].cases,duration=refs[1].cases
 for(const value of ['NaN','Infinity','-Infinity',"'2'",'undefined','null','true','{}','[]'])for(let i=0;i<3;i++){
  const args=['1','3','1'];args[i]=value;assert.ok(stock.some(v=>v.method==='throws'&&JSON.stringify(v.arguments)===JSON.stringify(args)&&v.expected==='RangeError'))
 }
 assert.ok(stock.some(v=>v.method==='throws'&&JSON.stringify(v.arguments)===JSON.stringify(['0','Number.MAX_VALUE','Number.MIN_VALUE'])))
 assert.equal(duration.find(v=>v.arguments[0]==='Number.MAX_SAFE_INTEGER').expected,'"150119987579016m 31s"')
 assert.ok(duration.some(v=>v.arguments[0]==='Number.MAX_SAFE_INTEGER+1'&&v.expected==='RangeError'))
 assert.deepEqual(p.packet.files,packet.files);assert.deepEqual(p.packet.criteria,packet.criteria)
 refs[0].cases.pop();assert.equal(make().packet.draftContract.baselineContract.referenceCases[0].cases.length,35)
 assert.ok(p.system.includes('referenceCases'));assert.ok(p.system.includes('not inserted into your reply'));assert.ok(p.system.includes('Number.MAX_SAFE_INTEGER,'))
})

test('case-cell schema excludes dangling delimiters without excluding quoted commas or structured expressions',()=>{
 const p=make(),prior=JSON.parse(input.messages.find(m=>m.role==='system').content.split('HOST OUTPUT CONTRACT (field meanings and shape, not task data):\n')[1])
 const strip=v=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['description','pattern'].includes(k)).map(([k,x])=>[k,strip(x)])):v
 assert.deepEqual(strip(p.schema),strip(prior))
 for(const t of p.packet.draftContract.casePlan.tests){
  const cell=p.schema.properties.tests.properties[t.id].properties.groups.items.properties.rows.items.items
  assert.equal(cell.pattern,'[^,;\\s]\\s*$');const pattern=new RegExp(cell.pattern)
  for(const bad of ['Number.MAX_SAFE_INTEGER,','1;','NaN,  ',' ,'])assert.equal(pattern.test(bad),false,bad)
  for(const good of ['Number.MAX_SAFE_INTEGER',"'2'",'"a,b,"','[1,2]','{x:1,y:2}','(BigInt(Number.MAX_SAFE_INTEGER)/60n)+"m "+(BigInt(Number.MAX_SAFE_INTEGER)%60n)+"s"'])assert.equal(pattern.test(good),true,good)
 }
})

test('input references cannot supply missing returned cases or override wrong types and exact expectations',()=>{
 const p=make(),spec=p.packet.draftContract.casePlan,complete=synthetic(spec)
 assert.equal(draft.project(JSON.stringify(complete),p).generated.expectedTests,3)
 for(const change of [v=>v.tests.c1.groups[1].rows.pop(),v=>{v.tests.c1.groups[1].rows.find(r=>r[0]==="'2'")[0]='2'},v=>{v.tests.c2.groups[0].rows.at(-1)[1]="'41783329883052m 31s'"}]){
  const value=structuredClone(complete);change(value);const before=JSON.stringify(value)
  assert.throws(()=>draft.project(before,p),e=>['case_plan_baseline_coverage','case_plan_baseline_expected'].includes(e.localDraftValidation.reason));assert.equal(JSON.stringify(value),before)
 }
 const exact=structuredClone(complete);exact.tests.c2.groups[0].rows.at(-1)[1]='(BigInt(Number.MAX_SAFE_INTEGER)/60n)+"m "+(BigInt(Number.MAX_SAFE_INTEGER)%60n)+"s"'
 assert.equal(draft.project(JSON.stringify(exact),p).generated.expectedTests,3)
 for(const cell of ['Number.MAX_SAFE_INTEGER,','process.exit()','require("x")','result','String(2)']){const value=structuredClone(complete);value.tests.c3.groups[0].rows.at(-1)[0]=cell;assert.throws(()=>draft.project(JSON.stringify(value),p),e=>e.localDraftValidation.reason==='case_plan_expression')}
})

test('reference rows are source-bound, exclude the unimplemented subject and are not a general recipe oracle',()=>{
 const spec=make().packet.draftContract.casePlan;assert.equal(baseline.references({...spec,sourceHashes:{}}),null)
 for(const file of Object.keys(spec.sourceHashes)){const changed=structuredClone(spec);changed.sourceHashes[file]='a'.repeat(64);assert.throws(()=>baseline.references(changed),e=>e.casePlanFailure==='baseline_source')}
 assert.ok(baseline.references(spec).every(v=>v.symbol!=='formatClockDuration'))
})
