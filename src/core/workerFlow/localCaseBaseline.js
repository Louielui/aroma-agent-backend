'use strict'
// A finite, audited baseline catalogue, not a JavaScript evaluator. Unknown
// source versions fail closed for this recipe; other registered recipes keep
// their existing semantic review and Sandbox requirements.
const {createHash}=require('node:crypto'),{expression}=require('./localCaseExpression')
const VERSION='node_examples_baseline_v1',ROOT='src/localBrain/examples/',hash=s=>createHash('sha256').update(s).digest('hex')
const sources={
 [ROOT+'duration.js']:'48459617a07eea9bb1e6e990a1ff2951871ad4c107013c90740009ea2126d249',
 [ROOT+'stock.js']:'d4b07336f6f92d85bdb92df4e94d2dc2cad282d43a0c67b4c5a502cd0f12bcd6',
 [ROOT+'examples.test.js']:'17471cd4ad56a4c4cf6a829b5c1bec22e7ea18be7fb8fbc3be94e60c71da9b89'
}
function invalid(stage,stats){const e=Error('invalid_worker_result');e.casePlanFailure=stage;e.baselineValidation=stats;throw e}
function profile(spec){
 if(!spec?.sourceHashes||!Object.hasOwn(spec.sourceHashes,ROOT+'examples.test.js')||!spec.tests?.some(t=>t.subject?.file===ROOT+'stock.js'||t.subject?.file===ROOT+'duration.js'))return null
 if(Object.entries(sources).some(([file,h])=>spec.sourceHashes[file]!==h))invalid('baseline_source')
 const expected=[['stock.js','orderBoxes',3],['duration.js','formatDuration',1],['duration.js','formatClockDuration',1]]
 if(spec.tests.length!==3||expected.some(([file,symbol,arity],i)=>spec.tests[i].subject.file!==ROOT+file||spec.tests[i].subject.symbol!==symbol||spec.tests[i].subject.arity!==arity))invalid('baseline_source')
 return{version:VERSION,sourceHashes:{...sources},requiredRows:52,stock:{equal:7,throws:28},duration:{equal:7,throws:10}}
}
function catalogue(){
 const equal=rows=>rows.map(row=>({method:'equal',row})),throws=rows=>rows.map(row=>({method:'throws',row}))
 const stock=equal([['3','10','4','2'],['0.1','0.4','0.1','3'],['0','1.1','0.1','11'],['1.01','1.04','0.01','3'],['12','10','4','0'],['0','Number.MIN_VALUE','Number.MIN_VALUE','1'],['0','Number.MAX_SAFE_INTEGER','1','Number.MAX_SAFE_INTEGER']])
 stock.push(...throws(['NaN','Infinity','-Infinity',"'2'",'undefined','null','true','{}','[]'].flatMap(value=>[0,1,2].map(i=>{const args=['1','3','1'];args[i]=value;return[...args,'RangeError']}))),...throws([['0','Number.MAX_VALUE','Number.MIN_VALUE','RangeError']]))
 const seconds=['0','59','60','119','120','3600','Number.MAX_SAFE_INTEGER'],values=['0m 0s','0m 59s','1m 0s','1m 59s','2m 0s','60m 0s','150119987579016m 31s']
 const duration=equal(seconds.map((s,i)=>[s,JSON.stringify(values[i])]))
 duration.forEach((entry,i)=>{const n='BigInt('+seconds[i]+')';entry.alternatives=['('+n+'/60n)+"m "+('+n+'%60n)+"s"']})
 duration.push(...throws(['Number.MAX_SAFE_INTEGER+1','-1','1.5','NaN','Infinity',"'60'",'null','undefined','{}','60n'].map(s=>[s,'RangeError'])))
 return[stock,duration]
}
const key=args=>JSON.stringify(args.map(expression))
function check(spec,value){
 const contract=profile(spec);if(!contract)return null
 let missing=0,wrong=0
 for(const [i,required]of catalogue().entries()){
  const t=spec.tests[i],v=value.tests[t.id],rows=v.groups.flatMap(g=>g.rows.map(row=>({method:g.method==='deepEqual'?'equal':g.method,row}))).concat(Object.values(v.rejections).map(row=>({method:'throws',row})))
  for(const expected of required){
   const matches=rows.filter(r=>key(r.row.slice(0,-1))===key(expected.row.slice(0,-1)))
   const allowed=expected.method==='throws'?[expected.row.at(-1)]:[expected.row.at(-1),...(expected.alternatives||[])].map(expression)
   const valid=r=>r.method===expected.method&&allowed.includes(r.method==='throws'?r.row.at(-1):expression(r.row.at(-1)))
   if(!matches.length)missing++
   wrong+=matches.filter(r=>!valid(r)).length
  }
 }
 const stats={missingBaselineCases:missing,wrongBaselineExpectedValues:wrong}
 // A wrong expectation for a present input is distinguished from an absent
 // row. Duplicate good rows cannot hide a conflicting expectation.
 if(missing)invalid('baseline_coverage',stats)
 if(wrong)invalid('baseline_expected',stats)
 return{...contract,missingBaselineCases:0,wrongBaselineExpectedValues:0,testsExecuted:false}
}
// Split only bounded rendered data expressions. Calls/identifiers still pass
// through the unchanged expression parser; nothing is evaluated or imported.
function split(text){
 const out=[];let start=0,quote=null,escape=false;const stack=[]
 for(let i=0;i<text.length;i++){
  const c=text[i]
  if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue}
  if(c==='"'||c==="'"){quote=c;continue}
  if('([{'.includes(c))stack.push(c)
  else if(')]}'.includes(c)){if(stack.pop()!=={')':'(',']':'[','}':'{'}[c])invalid('baseline_form')}
  else if(c===','&&!stack.length){out.push(text.slice(start,i));start=i+1}
 }
 if(quote||stack.length)invalid('baseline_form');out.push(text.slice(start));return out
}
function rendered(spec,code){
 if(!profile(spec))return null
 if(typeof code!=='string'||code.length>30000)invalid('baseline_form')
 const lines=code.split('\n');if(lines.at(-1)==='')lines.pop()
 if(lines.shift()!=="'use strict'"||lines.shift()!=="const test=require('node:test'),assert=require('node:assert/strict')")invalid('baseline_form')
 const tests={};let index=0,active=null
 for(const line of lines){
  if(!active){
   const match=/^test\(("(?:[^"\\]|\\.)*"),\(\)=>\{$/.exec(line);if(!match||index>=spec.tests.length)invalid('baseline_form')
   try{JSON.parse(match[1])}catch{invalid('baseline_form')}
   active=spec.tests[index++];tests[active.id]={groups:[],rejections:{}};continue
  }
  if(line==='})'){active=null;continue}
  const match=/^assert\.(equal|deepEqual|throws)\((.*)\)$/.exec(line);if(!match)invalid('baseline_form')
  const parts=split(match[2]);if(parts.length!==2)invalid('baseline_form')
  const prefix=(match[1]==='throws'?'()=>':'')+active.subject.callee+'('
  if(!parts[0].startsWith(prefix)||!parts[0].endsWith(')'))invalid('baseline_form')
  const args=split(parts[0].slice(prefix.length,-1)),row=[...args,parts[1]]
  if(row.length!==active.subject.arity+1)invalid('baseline_form')
  args.forEach(expression);if(match[1]!=='throws')expression(parts[1]);else if(!['Error','TypeError','RangeError','SyntaxError'].includes(parts[1]))invalid('baseline_form')
  tests[active.id].groups.push({method:match[1],rows:[row]})
 }
 if(active||index!==spec.tests.length)invalid('baseline_form')
 return check(spec,{tests})
}
function review(input){
 const spec=require('./localCasePlan').prepare({files:input.source,criteria:input.acceptanceCriteria,goal:input.ownerGoal})
 if(!spec)return null
 if(!profile(spec))return null
 const names=Object.keys(input.protectedTests||{});if(names.length!==1)invalid('baseline_form')
 return rendered(spec,input.protectedTests[names[0]])
}
const GUIDE='Audited node_examples_baseline_v1: preserve all 35 orderBoxes rows (7 equal and 28 throws: 9 invalid values at ALL 3 positions, plus separate overflow) and all 17 formatDuration rows (7 exact strings and 10 throws, including MAX_SAFE_INTEGER+1). Expand the original matrices, do not summarize them. formatDuration(MAX_SAFE_INTEGER) is exactly the string "150119987579016m 31s", or retain the original BigInt quotient/remainder expression with the concrete input substituted. Baseline preservation is checked by the host against exact source hashes and a finite expression catalogue. Missing cases, unproved alternative expressions and conflicting expectations are refused before review; a review PASS cannot override this. The host never supplies missing rows or rewrites output. New-function criteria, all rejection probes, semantic review, exact-version approval and Sandbox remain mandatory. This catalogue is specific to this exact example source, not proof of arbitrary Node coverage or execution.'
module.exports={profile,check,rendered,review,GUIDE}
