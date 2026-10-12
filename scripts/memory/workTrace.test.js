'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{execFileSync}=require('node:child_process')
test('installed Hindsight SDK callback carries only authenticated signed async context to the local bridge',()=>{
 const python='C:/Aroma/hindsight-runtime/Scripts/python.exe'
 const {createWorkTrace,encodeWorkTrace}=require('../../src/investigation/workTrace'),token='a'.repeat(64)
 const result=JSON.parse(execFileSync(python,['-B',path.join(__dirname,'workTrace.fixture.py')],{encoding:'utf8',windowsHide:true,input:JSON.stringify({token,header:encodeWorkTrace(createWorkTrace('mail_index','fixture','extraction'),token)})}))
 assert.deepEqual(result,{state:'passed',authenticatedForwarding:true,asyncIsolation:true,cloudLeak:false,dependencyFilesModified:false})
 const launcher=fs.readFileSync(path.join(__dirname,'startHindsight.cjs'),'utf8')
 assert.match(launcher,/work_trace_runtime.py/);assert.match(launcher,/'--workers', '1'/)
})
