'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'..')
function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory()&&e.name!=='assets')walk(f,out);else if(e.isFile()&&/\.js$/.test(f)&&!/(?:test|e2e)\.js$/.test(f))out.push(f)}return out}
test('every current subscription process boundary is inventoried; new unmetered CLI transports fail the survey',()=>{
 const spawnFiles=walk(root).filter(f=>{const s=fs.readFileSync(f,'utf8');return /(?:spawn(?:Impl|Fn)?\s*\(|\.spawn\s*\()/.test(s)&&/(?:--output-format|app-server)/.test(s)}).map(f=>path.relative(root,f).replaceAll('\\','/')).sort()
 assert.deepEqual(spawnFiles,['agent/agentBridgeWorker.js','agent/claudeCodeWorker.js','core/workerFlow/providers.js','subscription/codexClient.js','workers/claudeWorker.js'])
 for(const file of ['agent/agentBridgeWorker.js','agent/claudeCodeWorker.js','workers/claudeWorker.js'])assert.ok(fs.readFileSync(path.join(root,file),'utf8').includes('blockInteractiveWorker()'),file)
 assert.ok(fs.readFileSync(path.join(root,'core/workerFlow/providers.js'),'utf8').includes("nativePermit('helper'"))
 assert.ok(fs.readFileSync(path.join(root,'subscription/codexClient.js'),'utf8').includes('withRPCBudget(rpc,operation)'))
 // This survey inventories process doors. Behavioral tests separately prove
 // before-spawn refusal, atomic capacity, retries and late failure recording.
})
