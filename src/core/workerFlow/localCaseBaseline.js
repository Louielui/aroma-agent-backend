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

const STOCK_VERSION = 'node_stock_variance_v1'
const STOCK_FILE = ROOT+'stock.js'
// The three exact Owner criteria pin this finite catalogue to its approved use.
const STOCK_CRITERIA_SHA256 = 'ee6f3049ead727cf4e6979bb51c440a9a86dec14ed0493a9b11426797854100f'

function isStockRecipe(criteria) {
  return Array.isArray(criteria) && hash(JSON.stringify(criteria)) === STOCK_CRITERIA_SHA256
}

function stockProfile(spec) {
  if (!isStockRecipe(spec?.tests?.map(test=>test.criterion))) return null
  const stockSources = { [STOCK_FILE]: sources[STOCK_FILE] }
  const subjects = [['orderBoxes',3],['orderBoxes',3],['stockVariance',2]]
  if (!spec.sourceHashes || Object.keys(spec.sourceHashes).length !== 1 || spec.sourceHashes[STOCK_FILE] !== stockSources[STOCK_FILE] ||
      spec.tests.length !== subjects.length || subjects.some(([symbol,arity],index) => {
        const subject = spec.tests[index].subject
        return subject?.file !== STOCK_FILE || subject.symbol !== symbol || subject.arity !== arity
      })) invalid('baseline_source')
  return { version:STOCK_VERSION, sourceHashes:stockSources, criteriaSha256:STOCK_CRITERIA_SHA256, requiredRows:35, stock:{equal:7,throws:28} }
}

function profile(spec){
 const stock=stockProfile(spec);if(stock)return stock
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
function regressionRows(contract) {
  const [stock,duration] = catalogue()
  return contract.version === STOCK_VERSION ? [stock.filter(item=>item.method==='equal'),stock.filter(item=>item.method==='throws')] : [stock,duration]
}

function stockVarianceRows() {
  const equal = [
    ['0','0','0'],['-0','0','0'],['0','-0','0'],['7','3','4'],['3','7','-4'],['9','9','0'],
    ['Number.MAX_SAFE_INTEGER','0','Number.MAX_SAFE_INTEGER'],['0','Number.MAX_SAFE_INTEGER','-Number.MAX_SAFE_INTEGER'],
    ['Number.MAX_SAFE_INTEGER','Number.MAX_SAFE_INTEGER-1','1'],['Number.MAX_SAFE_INTEGER-1','Number.MAX_SAFE_INTEGER','-1']
  ].map(row=>({method:'equal',row}))
  const throws = ['-1','1.5',"'1'",'NaN','Infinity','Number.MAX_SAFE_INTEGER+1']
    .flatMap(value=>[[value,'0','RangeError'],['0',value,'RangeError']])
    .map(row=>({method:'throws',row}))
  return { equal, throws }
}

function reference({method,row,alternatives}) {
  return {method,arguments:row.slice(0,-1),expected:row.at(-1),...(alternatives?{alternativeExpectedExpressions:[...alternatives]}:{})}
}

// Expose only audited source and Owner cases. The returned draft supplies every row.
function references(spec) {
  const contract = profile(spec)
  if (!contract) return null
  return regressionRows(contract).map((rows,i)=>({criterion:spec.tests[i].id,symbol:spec.tests[i].subject.symbol,cases:rows.map(reference)}))
}
const key=args=>JSON.stringify(args.map(expression))
const clockInputs = ['0','9','59','60','3599','3600','86399','86400','360000','Number.MAX_SAFE_INTEGER']
const clockCases = clockInputs.map(argument => {
  const seconds = argument === 'Number.MAX_SAFE_INTEGER' ? BigInt(Number.MAX_SAFE_INTEGER) : BigInt(argument)
  const expected = [seconds / 3600n, seconds / 60n % 60n, seconds % 60n].map(part => String(part).padStart(2, '0')).join(':')
  return { argument, expected }
})
const clockExamples = clockCases.map(({argument,expected}) => (argument === 'Number.MAX_SAFE_INTEGER' ? 'MAX_SAFE_INTEGER' : argument) + '=' + expected).join('; ')

// Bind only the explicit, source-pinned Owner recipe. No free-form inference,
// evaluation of returned expressions, or addition of rows to model output.
function newExamples(spec) {
 const contract=profile(spec)
 if(!contract)return null
 if(contract.version===STOCK_VERSION){
  const {equal,throws}=stockVarianceRows()
  return {criterion:spec.tests[2].id,symbol:spec.tests[2].subject.symbol,cases:equal.map(reference),rejectionCases:throws.map(reference)}
 }
  const test = spec.tests[2]
  if (!test.criterion?.includes('): ' + clockExamples + '. Reject ')) return null
  return { criterion: test.id, symbol: test.subject.symbol, cases: clockCases.map(({argument,expected}) => ({argument,expected:JSON.stringify(expected)})) }
}

function checkNewExamples(spec, value) {
  const contract = newExamples(spec)
  if (!contract) return null
  const test = spec.tests[2]
  const actual = value.tests[contract.criterion]
  const rows = actual.groups.flatMap(group => group.rows.map(row => ({method:group.method,row})))
    .concat(Object.values(actual.rejections).map(row => ({method:'throws',row})))
  for (const {argument,expected} of contract.cases) {
    const matching = rows.filter(({row}) => expression(row[0]) === expression(argument))
    if (!matching.length) invalid('new_coverage')
    if (matching.some(({method,row}) => !['equal','deepEqual'].includes(method) || expression(row[1]) !== expression(expected))) invalid('new_expected')
  }
  for (const probe of test.rejections) {
    if (!rows.some(({method,row}) => method === 'throws' && expression(row[0]) === expression(probe.expression) && row[1] === probe.error)) invalid('new_coverage')
  }
  return { exactCases: contract.cases.length, rejectionProbes: test.rejections.length }
}

function measureRows(required, actual) {
  const inputs = new Map()
  for (const group of actual.groups) {
    for (const row of group.rows) add(group.method==='deepEqual'?'equal':group.method,row)
  }
  for (const row of Object.values(actual.rejections)) add('throws',row)
  function add(method,row) {
    const id = key(row.slice(0,-1))
    if (!inputs.has(id)) inputs.set(id,[])
    inputs.get(id).push({method,expected:method==='throws'?row.at(-1):expression(row.at(-1))})
  }
  let missing=0,wrong=0
  for (const item of required) {
    const matches=inputs.get(key(item.row.slice(0,-1)))
    if (!matches) { missing++; continue }
    const allowed=item.method==='throws'?[item.row.at(-1)]:[item.row.at(-1),...(item.alternatives||[])].map(expression)
    wrong+=matches.filter(candidate=>candidate.method!==item.method||!allowed.includes(candidate.expected)).length
  }
  return {missing,wrong}
}

function checkStockExamples(spec,value) {
  const {equal,throws}=stockVarianceRows()
  const {missing,wrong}=measureRows([...equal,...throws],value.tests[spec.tests[2].id])
  const stats={missingNewCases:missing,wrongNewExpectedValues:wrong}
  if (missing) invalid('new_coverage',stats)
  if (wrong) invalid('new_expected',stats)
  return {exactCases:equal.length,rejectionProbes:throws.length}
}

function check(spec,value) {
  const contract=profile(spec)
  if (!contract) return null
  let missing=0,wrong=0
  for (const [i,required] of regressionRows(contract).entries()) {
    const counts=measureRows(required,value.tests[spec.tests[i].id])
    missing+=counts.missing
    wrong+=counts.wrong
  }
  const stats={missingBaselineCases:missing,wrongBaselineExpectedValues:wrong}
  // Duplicate correct rows cannot hide a conflicting expectation.
  if (missing) invalid('baseline_coverage',stats)
  if (wrong) invalid('baseline_expected',stats)
  const newExampleProof=contract.version===STOCK_VERSION?checkStockExamples(spec,value):checkNewExamples(spec,value)
  return {...contract,...stats,testsExecuted:false,...(newExampleProof?{newExampleProof}:{})}
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
 if(!spec){if(isStockRecipe(input.acceptanceCriteria))invalid('baseline_source');return null}
 if(!profile(spec))return null
 const names=Object.keys(input.protectedTests||{});if(names.length!==1)invalid('baseline_form')
 return rendered(spec,input.protectedTests[names[0]])
}
const GUIDE='Audited node_examples_baseline_v1: preserve all 35 orderBoxes rows (7 equal and 28 throws: 9 invalid values at ALL 3 positions, plus separate overflow) and all 17 formatDuration rows (7 exact strings and 10 throws, including MAX_SAFE_INTEGER+1). Expand the original matrices, do not summarize them. formatDuration(MAX_SAFE_INTEGER) is exactly the string "150119987579016m 31s", or retain the original BigInt quotient/remainder expression with the concrete input substituted. Baseline preservation is checked by the host against exact source hashes and a finite expression catalogue. Missing cases, unproved alternative expressions and conflicting expectations are refused before review; a review PASS cannot override this. The host never supplies missing rows or rewrites output. New-function criteria, all rejection probes, semantic review, exact-version approval and Sandbox remain mandatory. This catalogue is specific to this exact example source, not proof of arbitrary Node coverage or execution.'
function expectedFailureSubject(proof) {
  if (proof?.version === STOCK_VERSION) return {file:STOCK_FILE,symbol:'stockVariance'}
  if (proof?.version === VERSION) return {file:ROOT+'duration.js',symbol:'formatClockDuration'}
  return null
}

const STOCK_GUIDE='Audited node_stock_variance_v1: draftContract.baselineContract.referenceCases assigns the seven existing orderBoxes results to c1 and all 28 refusals to c2. Copy each full tuple in its assigned criterion. In the three-position refusal matrix, vary only the indicated argument of (1,3,1). Preserve the separate overflow row. draftContract.newExampleContract assigns ten exact results and twelve full refusal tuples to c3. Each of the six invalid values must appear in BOTH parameter positions with zero in the other. The six required rN entries provide a row per invalid value; return the other position too in a throws group. A probe name alone does not cover both positions. Copy the supplied values and argument types exactly. The host checks the case rows without filling them or changing model output. Review and actual Sandbox evidence remain required.'
module.exports={profile,references,newExamples,check,rendered,review,expectedFailureSubject,isStockRecipe,GUIDE,STOCK_GUIDE,STOCK_VERSION}
