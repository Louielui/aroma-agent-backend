'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {schema,replacements}=require('./isolatedCoding'),{digest}=require('./windowsSandbox')
const file='src/i18n/catalogue.js',text="const value='"+'x'.repeat(110000)+"UNIQUE';\n",o={files:{[file]:text,'proof.test.js':'test'},editable:[file],tests:['proof.test.js'],expectedTests:1}
const change=(patch={})=>({file,beforeHash:digest(text),edits:[{oldText:'UNIQUE',newText:'receipt'}],...patch})
test('large admitted files use compact hash-bound edits rather than impossible full-file output',()=>{
 assert.ok(schema(o).properties.changes.items.properties.edits)
 const result=replacements(o,{changes:[change()],summary:'copy correction'})
 assert.equal(result[file],text.replace('UNIQUE','receipt'));assert.equal(result['proof.test.js'],'test');assert.ok(JSON.stringify(change()).length<1000)
})
test('bounded edits reject stale, missing or ambiguous anchors, out-of-scope files and oversized packets',()=>{
 for(const patch of [{beforeHash:'a'.repeat(64)},{file:'proof.test.js'},{edits:[{oldText:'absent',newText:'x'}]},{edits:[{oldText:'xx',newText:'x'}]},{edits:[{oldText:'',newText:'x'}]},{edits:Array(33).fill({oldText:'UNIQUE',newText:'x'})},{edits:[{oldText:'UNIQUE',newText:'x'.repeat(100000)}]}])assert.throws(()=>replacements(o,{changes:[change(patch)],summary:'not accepted'}),/invalid_worker_result/)
})
test('small-file output contract is retained',()=>{
 const small={...o,files:{...o.files,[file]:'before'}};assert.ok(schema(small).properties.changes.items.properties.content)
 assert.equal(replacements(small,{changes:[{file,content:'after'}],summary:'ok'})[file],'after')
 const moderate={...o,files:{...o.files,[file]:'x'.repeat(68000)}};assert.ok(schema(moderate).properties.changes.items.properties.content)
 assert.equal(replacements(moderate,{changes:[{file,content:moderate.files[file]+' receipt'}],summary:'ok'})[file],moderate.files[file]+' receipt')
})
test('compact worker repairs against the current hash while retaining protected tests and original before evidence',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createIsolatedCoding,MODEL}=require('./isolatedCoding')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'compact-worker-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 let runs=0,calls=0
 const executor={readiness:async()=>({ready:true}),isBusy:()=>false,run:async p=>{runs++;assert.equal(p.files['proof.test.js'],'test');return{exitCode:runs<3?1:0,total:1,passed:runs<3?0:1,failed:runs<3?1:0,skipped:0,cancelled:0,stdout:'measured fixture',evidenceHash:String(runs)}}}
 const provider={preflight:async()=>{},complete:async(prompt,options)=>{calls++;const p=JSON.parse(prompt),anchor=calls===1?'UNIQUE':'partial';assert.ok(options.responseFormat.schema.properties.changes.items.properties.edits);assert.equal(p.baseHashes[file],digest(p.files[file]));assert.equal(p.files[file],calls===1?text:text.replace('UNIQUE','partial'));return{model:MODEL,billing:'chatgpt-subscription',text:JSON.stringify({changes:[{file,beforeHash:p.baseHashes[file],edits:[{oldText:anchor,newText:calls===1?'partial':'receipt'}]}],summary:'fixture'})}}}
 const worker=createIsolatedCoding({root,executor,provider}),result=await worker.execute({approval:worker.prepare({...o,goal:'Replace one exact phrase',effort:'high'},'owner'),actor:'owner'})
 assert.equal(calls,2);assert.equal(result.state,'accepted_isolated');assert.equal(result.changes[0].before,text);assert.equal(result.changes[0].after,text.replace('UNIQUE','receipt'));assert.equal(result.attempts[0].changes[0].after,text.replace('UNIQUE','partial'))
})
