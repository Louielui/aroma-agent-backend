'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process')
const {wrap}=require('./wslTestDiagnostics.fixture.cjs')
test('WSL diagnostics preserve exact argv/options/result and exclude raw stderr and paths',()=>{
 const argv=['git','-c','core.fsmonitor=false','clone','--quiet','https://fixture.invalid/private','/private/clone'],opts={timeoutMs:120000,maxOutput:2097152},result={status:1,timedOut:true,stdout:'private output',stderr:'secret token /private/clone ETIMEDOUT'},events=[]
 const run=wrap((a,o)=>{assert.equal(a,argv);assert.equal(o,opts);return result},{emit:r=>events.push(r)})
 assert.equal(run(argv,opts),result);assert.equal(events.length,1);assert.equal(events[0].command,'git_clone');assert.equal(events[0].failure,'timeout');assert.equal(events[0].deadlineMs,120000);assert.equal(events[0].stdoutBytes,14)
 assert.ok(!/secret|private|fixture.invalid/.test(JSON.stringify(events)))
})
test('diagnostic sink failure cannot turn a native failure into success or replace its exception',()=>{
 const error=Object.assign(Error('private failure'),{code:'EACCES'}),opts={timeoutMs:120000}
 const run=wrap(()=>{throw error},{emit:()=>{throw Error('sink failure')}})
 assert.throws(()=>run(['git','clone'],opts),e=>e===error)
 const denied={status:128,stderr:'Could not resolve host: secret.invalid'},events=[]
 assert.equal(wrap(()=>denied,{emit:r=>events.push(r)})(['git','clone'],opts),denied)
 assert.equal(events[0].failure,'dns');assert.ok(!JSON.stringify(events).includes('secret.invalid'))
})
test('a real bounded child timeout is observed without retrying the child',()=>{
 let calls=0;const events=[],run=wrap(()=>{calls++;return cp.spawnSync(process.execPath,['-e','setTimeout(()=>{},1000)'],{timeout:30,windowsHide:true,encoding:'utf8'})},{emit:r=>events.push(r)})
 const result=run(['git','clone'],{timeoutMs:30});assert.equal(result.error.code,'ETIMEDOUT');assert.equal(calls,1);assert.equal(events[0].failure,'timeout');assert.ok(events[0].elapsedMs>0);assert.equal(events[0].deadlineMs,30)
})
