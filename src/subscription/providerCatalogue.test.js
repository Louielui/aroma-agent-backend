'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const rows=[{value:'sonnet',resolvedModel:'claude-sonnet-5',displayName:'Sonnet',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},{value:'opus',resolvedModel:'claude-opus-4-6',displayName:'Opus',supportsEffort:true,supportedEffortLevels:['low','medium','high','max']},{value:'haiku',resolvedModel:'claude-haiku-4-5-20251001',displayName:'Haiku'},{value:'default',resolvedModel:'claude-sonnet-5',displayName:'Default'}]
test('Claude catalogue preserves provider capabilities, versions, and no-effort models without duplicating aliases',()=>{
 const {catalogueRows}=require('./claudeClient'),models=catalogueRows(rows)
 assert.equal(models.length,3)
 assert.deepEqual(models[1].efforts,['low','medium','high','max'])
 assert.equal(models[2].supportsEffort,false);assert.deepEqual(models[2].efforts,[])
 assert.match(models[0].name,/5/);assert.equal(models[0].model,'claude-sonnet')
 assert.equal(models[1].model,'claude-opus-4-6')
 assert.deepEqual(catalogueRows([{value:'rogue',resolvedModel:'other-provider'}]),[])
})
test('Claude chosen model is pinned, unsupported effort rejected before inference, Haiku omits effort',async()=>{
 const {complete}=require('./claudeClient');let generation=0,last
 const options={catalogue:async()=>rows,run:async(args)=>{if(args.includes('status'))return {loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'};generation++;last=args;return {type:'result',subtype:'success',result:'OK',modelUsage:{[args[args.indexOf('--model')+1]]:{}}}}}
 await assert.rejects(complete(options,{model:'claude-opus-4-6',effort:'xhigh',prompt:'Hi'}),/subscription_model_unavailable/);assert.equal(generation,0)
 const r=await complete(options,{model:'claude-opus-4-6',effort:'max',prompt:'Hi'});assert.equal(r.model,'claude-opus-4-6');assert.equal(last[last.indexOf('--model')+1],'claude-opus-4-6')
 await complete(options,{model:'claude-haiku-4-5-20251001',effort:'auto',prompt:'Hi'});assert.ok(!last.includes('--effort'))
 await assert.rejects(complete(options,{model:'claude-haiku-4-5-20251001',effort:'high',prompt:'Hi'}),/subscription_model_unavailable/)
 assert.equal(generation,2)
})
test('every advertised Claude family routes as Claude, only closed model identifiers accepted',()=>{
 const {isBrainModel,billingFor}=require('./chatModels')
 for(const model of ['claude-sonnet','claude-opus-5','claude-fable-5-1','claude-haiku-4-5-20251001']){assert.ok(isBrainModel(model));assert.equal(billingFor(model),'claude-subscription')}
 for(const model of ['claude-other','claude-opus-5 --tools Bash','http://host','default'])assert.equal(isBrainModel(model),false)
})
test('catalogue handshake is read-only, bounded and exposes models without account or command data',async()=>{
 const {runClaude}=require('../core/workerFlow/providers'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');let killed=false
 const input=JSON.stringify({type:'control_request',request_id:'catalogue',request:{subtype:'initialize',hooks:{}}})+'\n'
 const output=await runClaude(['--input-format','stream-json'],{controlRequestId:'catalogue',input,resolveCommand:()=>({ok:true,command:'fixture'}),spawnImpl:()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{killed=true}
  child.stdin=new Writable({write(chunk,encoding,done){assert.equal(chunk.toString(),input);done()},final(done){done();process.nextTick(()=>child.stdout.end(JSON.stringify({type:'control_response',response:{request_id:'catalogue',subtype:'success',response:{models:rows,account:{email:'private'},commands:['private']}}})+'\n'))}})
  return child
 }})
 assert.equal(killed,true);assert.deepEqual(output,{models:rows})
})
