'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{project}=require('./setupReadiness.cjs')
test('reload readiness requires real idle witnesses for both model lanes and all bounded workflows',()=>{
  const runtime={records:['chat_completion','memory_completion'].map(role=>({role,currentRunningState:'idle'}))}
  const work={workflows:['test_draft','development','review','adoption','fixture'].map(role=>({role,state:'idle'}))}
  const bridge={component:'execution-bridge',state:'ready',pid:123,bootCommit:'a'.repeat(40)}
  assert.equal(project(runtime,work,bridge).state,'idle_verified')
  for(const value of [{}, {...work,workflows:work.workflows.slice(0,3)}, {...work,workflows:work.workflows.map(x=>({...x,state:x.role==='development'?'occupied':x.state}))}])assert.equal(project(runtime,value,bridge).state,'not_idle_verified')
  assert.equal(project({...runtime,records:runtime.records.map(x=>({...x,currentRunningState:x.role==='memory_completion'?'active':'idle'}))},work,bridge).state,'not_idle_verified')
  assert.equal(project(runtime,work,{...bridge,bootCommit:null}).state,'not_idle_verified')
})
