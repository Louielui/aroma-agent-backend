'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path')
const fixture=path.join(__dirname,'quiescenceCompatibility.fixture.cjs')
function run(mode,scenario){return new Promise((resolve,reject)=>{const child=cp.fork(fixture,[mode,scenario],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});let output='',value;child.stderr.on('data',d=>output+=d);child.on('message',m=>{value=m});child.once('error',reject);child.once('exit',code=>code===0&&value?resolve(value):reject(Error(output||'fixture_exit_'+code)))})}
for(const scenario of ['promisify','http','https','ipv6'])test('OPEN fenced and native Node contracts agree: '+scenario,{timeout:60000},async()=>{const native=await run('native',scenario),fenced=await run('fenced',scenario);assert.deepEqual(fenced,native)})
test('promisified subprocess and timer retain admission through drain and reject new frozen work',{timeout:60000},async()=>{assert.deepEqual(await run('fenced','drain'),{pending:true,refused:true,finished:true,frozen:true})})
test('Windows delete-pending EPERM is retried without entering or stealing the lock',{timeout:60000},async()=>{assert.deepEqual(await run('fenced','lock'),{completed:true,refused:true,unchanged:true})})
