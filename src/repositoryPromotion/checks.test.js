'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {parseTests,cleanTestEnv,readReview}=require('./checks')
test('test evidence records counts, exact skip names and log hash without inheriting paid credentials',()=>{
  const result=parseTests('ok 1 - normal\nok 2 - paid test # SKIP opt in\n# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n',0)
  assert.equal(result.total,2);assert.equal(result.passed,1);assert.deepEqual(result.skipNames,['paid test']);assert.match(result.logHash,/^[a-f0-9]{64}$/)
  assert.equal(parseTests('no summary',0).total,null)
  const env=cleanTestEnv('dependencies','data','artifacts')
  assert.ok(!Object.keys(env).some(k=>/API_KEY|TOKEN|SECRET|RUN_PAID|NODE_OPTIONS/.test(k)));assert.equal(env.AROMA_DATA_DIR,'data')
})
test('review envelope requires actual model, exact closed result and no finding on a pass',()=>{
  const packet={commit:'a'.repeat(40),tree:'b'.repeat(40),base:'c'.repeat(40),changedPaths:['src/code.js'],reviewedDiffHash:'d'.repeat(64),scope:'fixture'}
  const r={verdict:'pass',summary:'reviewed',findings:[],securityRegression:false,permissionRegression:false,exceptionCategories:[]}
  const envelope={type:'result',subtype:'success',result:JSON.stringify(r),modelUsage:{'claude-sonnet':{}}}
  assert.equal(readReview(envelope,packet).commit,packet.commit)
  assert.throws(()=>readReview({...envelope,modelUsage:{}},packet),/review_model_unavailable/)
  for(const bad of [{...r,findings:[{file:'src/code.js',line:1,message:'fix'}]},{...r,securityRegression:true},{...r,extra:true},{...r,exceptionCategories:['invented']}])assert.throws(()=>readReview({...envelope,result:JSON.stringify(bad)},packet))
})
