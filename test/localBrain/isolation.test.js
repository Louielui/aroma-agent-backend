'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
test('process boundary denies remote AI, bridge fallback and CLI subprocesses',()=>{
  const net=require('node:net'),child=require('node:child_process'),events=[]
  const original=net.Socket.prototype.connect,spawn=child.spawn
  const restore=require('../../src/localBrain/isolation').install({audit:e=>events.push(e)})
  try{
    for(const target of [{host:'api.anthropic.com',port:443},{host:'api.openai.com',port:443},{host:'127.0.0.1',port:8091},{host:'localhost',port:11435},{path:'\\\\.\\pipe\\anything'}]){
      const socket=new net.Socket();assert.throws(()=>socket.connect(target),{code:'local_only_egress_denied'});socket.destroy()
    }
    assert.throws(()=>child.spawn('claude',['--version']),{code:'local_only_egress_denied'})
    assert.equal(events.length,6);assert.ok(events.every(e=>e.type==='egress_denied'))
  }finally{restore()}
  assert.equal(net.Socket.prototype.connect,original);assert.equal(child.spawn,spawn)
})
