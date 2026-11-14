'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
test('local selection uses existing revision, persistence and audit; rejects cloud selection',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'local-model-center-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}))
  const options={dataDir,catalogue:async()=>({models:[{model:'local:qwen3:8b',available:true,supportsEffort:false}]}),selectionPolicy:{initialBrain:{model:'local:qwen3:8b',effort:'auto'},validChoice:v=>v?.model==='local:qwen3:8b'&&v?.effort==='auto'}}
  const {createModelCenter}=require('../../src/modelCenter/service'),center=createModelCenter(options)
  await center.saveBrain({revision:0,model:'local:qwen3:8b',effort:'auto'})
  assert.equal(createModelCenter(options).read().brain.model,'local:qwen3:8b');assert.equal(center.read().audit.length,1)
  await assert.rejects(center.saveBrain({revision:0,model:'local:qwen3:8b',effort:'auto'}),/revision_conflict/)
  await assert.rejects(center.saveBrain({revision:1,model:'claude-sonnet',effort:'medium'}),/invalid_model_selection/)
  assert.equal(center.read().revision,1)
})
