'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {createLifecycle}=require('./engineLifecycle')

test('operations are serialized and manual release refuses while work is queued or running',async()=>{
  const seen=[]
  let resume
  const life=createLifecycle({unload:async reason=>seen.push(reason)})
  const first=life.run(async()=>{seen.push('first');await new Promise(resolve=>{resume=resolve})})
  const second=life.run(async()=>{seen.push('second')})
  await assert.rejects(life.release(),/local_engine_busy/)
  assert.deepEqual(seen,['first'])
  resume()
  await Promise.all([first,second])
  await life.release()
  assert.deepEqual(seen,['first','second','manual'])
})

test('a stale idle callback cannot unload active work and the latest idle callback can unload',async()=>{
  const timers=[]
  const seen=[]
  const life=createLifecycle({idleMs:10,unload:async reason=>seen.push(reason),
    setTimer:fn=>{timers.push(fn);return timers.length},clearTimer:()=>{}})
  await life.run(async()=>seen.push('one'))
  const stale=timers[0]
  await life.run(async()=>{stale();seen.push('two')})
  assert.deepEqual(seen,['one','two'])
  await timers.at(-1)()
  assert.deepEqual(seen,['one','two','idle'])
})

test('close waits for queued work, rejects new requests and runs the shutdown once',async()=>{
  const seen=[]
  const life=createLifecycle({unload:async reason=>seen.push(reason)})
  const pending=life.run(async()=>seen.push('request'))
  const stop=life.close()
  await assert.rejects(life.run(async()=>seen.push('bad')),/local_engine_manager_closed/)
  await pending
  await stop
  await life.close()
  assert.deepEqual(seen,['request','shutdown'])
})
