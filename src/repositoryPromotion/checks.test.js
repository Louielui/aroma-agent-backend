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

test('a single JSON fence preserves a negative review verdict; prose and malformed output still fail closed',()=>{
 const packet={changedPaths:['src/code.js']},result={verdict:'changes_requested',summary:'fix',findings:[{file:'src/code.js',line:1,message:'fix'}],securityRegression:true,permissionRegression:false,exceptionCategories:['security_permission_change']};
 const envelope={type:'result',subtype:'success',result:'```json\n'+JSON.stringify(result)+'\n```',modelUsage:{'claude-sonnet':{}}};
 assert.equal(readReview(envelope,packet).verdict,'changes_requested');
 assert.throws(()=>readReview({...envelope,result:'explanation\n'+envelope.result},packet),/review_invalid_output/);
});

test('the actual committed diff feeds content risk gates; authorized repository protocols remain protected by path',t=>{
 const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),{reviewPacket}=require('./checks'),{classifyChanges}=require('./policy');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'content-gate-'));t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('unsafe cleanup');fs.rmSync(root,{recursive:true,force:true})});
 const git=(...args)=>cp.execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','-C',root,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 git('init','-b','main');fs.writeFileSync(path.join(root,'base.js'),'module.exports=1');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
 for(const [p,text] of [['src/demo/assets/app.js',"fetch(url,{method:'POST'});"],['src/repositoryPromotion/github.js',"method:'DELETE'"],['src/sample.test.js','DROP TABLE facts'],['src/foo.test.config.js',"method:'PATCH'"],['src/x.test.d/run.js','TRUNCATE TABLE facts']]){fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),text)}
 git('add','.');git('commit','-m','candidate');const packet=reviewPacket({root,commit:git('rev-parse','HEAD'),base,tests:{}});
 assert.ok(packet.addedText.includes("method:'POST'"));assert.ok(!packet.addedText.includes("method:'DELETE'"));assert.ok(!packet.addedText.includes('DROP TABLE'));assert.ok(packet.addedText.includes("method:'PATCH'"));assert.ok(packet.addedText.includes('TRUNCATE TABLE'));assert.ok(packet.batches.join('\n').includes('foo.test.config.js'));
 assert.ok(classifyChanges(['src/demo/assets/app.js'],packet.addedText).includes('business_data_write'));assert.ok(classifyChanges(['src/repositoryPromotion/github.js']).includes('security_permission_change'));assert.match(packet.contentGateHash,/^[a-f0-9]{64}$/);
});
