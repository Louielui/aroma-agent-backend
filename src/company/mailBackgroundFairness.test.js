'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createTestStore } = require('../memory/structuredStore')
const { createMailMemory } = require('./mailMemory')
const { createMailScheduler } = require('./mailScheduler')
const OWNER = { owner:true }
const flush = () => new Promise(resolve => setImmediate(resolve))

function fixture(t, {retainMs=40000,analysisMs=30000,retainError=null,engineEnabled=true}={}) {
  t.mock.timers.enable({apis:['setTimeout','setInterval']})
  let now=Date.parse('2026-10-01T12:00:00Z'), active=0, maxActive=0, revision=0, enabled=true, foreground=false
  const calls=[], documents=new Map(), store=createTestStore()
  const model=(kind,delay,signal,result)=>new Promise((resolve,reject)=>{
    active++;maxActive=Math.max(maxActive,active);calls.push({kind,at:now});let settled=false
    const finish=(error)=>{if(settled)return;settled=true;active--;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result)}
    const abort=()=>{calls.push({kind:'cancel',at:now});finish(Error('memory_yielded'))}
    const timer=setTimeout(()=>finish(),delay)
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
  })
  const mailbox={status:()=>({mailbox:'adm@example.test'}),lease:actor=>{const at=revision;return()=>{if(!enabled||actor?.owner!==true||revision!==at)throw Error('mail_access_denied')}},
    check:async actor=>mailbox.lease(actor)(),read:async actor=>{mailbox.lease(actor)();return {}}}
  const adapter=signal=>({get:async id=>documents.get(id)||null,withSignal:adapter,
    retainAutomatic:async(id,text)=>{const result=await model('index',retainMs,signal,{id,text,facts:1});if(retainError)throw Error(retainError);documents.set(id,result);return result}})
  const analyzer={analyze:async input=>{
    const source=input.evidence[0], quote=source.body.slice(0,30)
    return model('analysis',analysisMs,null,{category:'notification',summary:'Synthetic source notice.',messageId:source.id,quote,task:null,change:{kind:'none',messageId:source.id,quote}})
  },cancel:()=>{}}
  const memory=createMailMemory({store,mailbox,engine:engineEnabled?{forMailSource:()=>adapter()}:null,analyzer,allowed:()=>enabled,foreground:()=>foreground,clock:()=>new Date(now).toISOString()})
  const scheduler=createMailScheduler({store,mailbox,memory,clock:()=>new Date(now).toISOString()})
  const add=id=>memory.capture(OWNER,{id,threadId:id,mailbox:'adm@example.test',subject:'Synthetic source notice',from:'vendor@example.test',body:'Synthetic retained source '+id+'.',date:'2026-09-30T12:00:00Z',internalDate:'1790769600000',bodyState:'available',bodyTruncated:false})
  const advance=async ms=>{for(let elapsed=0;elapsed<ms;elapsed+=1000){now+=Math.min(1000,ms-elapsed);t.mock.timers.tick(Math.min(1000,ms-elapsed));await flush()}}
  t.after(()=>{scheduler.stop();memory.stop()})
  return {store,mailbox,memory,scheduler,add,advance,calls,documents,now:()=>now,maxActive:()=>maxActive,
    slowStore:ms=>{for(const key of ['get','all','commit']){const original=store[key];store[key]=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,ms));return original(...args)}}},
    foreground:value=>{foreground=value},revoke:()=>{enabled=false;revision++}}
}

test('combined background backlog makes both canonical indexing and analysis progress without cancellation or model overlap',async t=>{
  const f=fixture(t);for(let i=1;i<=20;i++)await f.add(i.toString(16))
  f.memory.start();f.scheduler.start();await f.advance(260000)
  const rows=await f.store.all()
  assert.ok(rows.filter(r=>r.source.kind==='admin_mail_message'&&r.index.state==='saved').length>=2,'semantic backlog starved by analysis')
  assert.ok(rows.filter(r=>r.source.kind==='admin_mail_thread'&&r.details.analysis?.state==='ready').length>=2,'analysis backlog starved by indexing')
  assert.equal(f.calls.filter(r=>r.kind==='cancel').length,0,'background analysis cancelled an active retain')
  assert.equal(f.maxActive(),1)
})

test('fast indexing still hands an opportunity to background analysis under continuous backlog',async t=>{
  const f=fixture(t,{retainMs:1000,analysisMs:1000});for(let i=1;i<=40;i++)await f.add(i.toString(16))
  f.memory.start();f.scheduler.start();await f.advance(30000)
  assert.ok(f.calls.filter(r=>r.kind==='analysis').length>=2)
  assert.ok(f.calls.filter(r=>r.kind==='index').length>=2)
  assert.equal(f.maxActive(),1)
  assert.equal(f.calls.filter(r=>r.kind==='cancel').length,0)
})

test('manual analysis can immediately cancel an active semantic retain',async t=>{
  const f=fixture(t);const thread=await f.add('a');f.memory.start();await f.advance(2000)
  const manual=f.memory.analyze(OWNER,thread.id);await flush()
  assert.equal(f.calls.filter(r=>r.kind==='cancel').length,1)
  assert.equal(f.calls.filter(r=>r.kind==='analysis').length,1)
  await f.advance(30000);await manual
  assert.equal(f.maxActive(),1)
})

test('a background reservation remains exclusive through awaited source reads and honors subsequent revocation',async t=>{
  const f=fixture(t);await f.add('a');let release;const check=f.mailbox.check
  const blocked=new Promise(resolve=>{release=resolve})
  f.mailbox.check=async actor=>{await blocked;return check(actor)}
  const analysis=f.memory.analyzeNext(OWNER,{background:true});await flush()
  const indexing=f.memory.indexNext(OWNER);await flush()
  const indexed=await Promise.race([indexing,Promise.resolve({state:'source_read_in_progress'})])
  f.revoke();release();await assert.rejects(analysis,/denied/)
  if(indexed.state!=='busy')await assert.rejects(indexing,/denied/)
  assert.equal(indexed.state,'busy')
  assert.equal(f.calls.length,0)
})

test('an indexer sleeping through durable quota backoff cannot hold background triage indefinitely',async t=>{
  const f=fixture(t,{retainMs:1000,analysisMs:1000,retainError:'memory_rate_limited'})
  for(let i=1;i<=40;i++)await f.add(i.toString(16))
  f.memory.start();f.scheduler.start();await f.advance(120000)
  assert.ok(f.calls.filter(r=>r.kind==='analysis').length>=8,'quota-sleeping indexer monopolized the handoff')
  assert.equal(f.calls.filter(r=>r.kind==='index').length,1,'mail-wide quota circuit was bypassed')
  assert.ok((await f.memory.status()).hindsight.backoffUntil)
  assert.equal(f.maxActive(),1)
})

test('analysis continues when the semantic model provider is not connected',async t=>{
  const f=fixture(t,{analysisMs:1000,engineEnabled:false});for(let i=1;i<=8;i++)await f.add(i.toString(16))
  f.memory.start();f.scheduler.start();await f.advance(30000)
  assert.ok(f.calls.filter(r=>r.kind==='analysis').length>=3)
  assert.equal(f.calls.filter(r=>r.kind==='index').length,0)
})

test('foreground work arriving during source checks prevents a reserved background model call',async t=>{
  const f=fixture(t);await f.add('a');let release;const check=f.mailbox.check
  const blocked=new Promise(resolve=>{release=resolve})
  f.mailbox.check=async actor=>{await blocked;return check(actor)}
  const analysis=f.memory.analyzeNext(OWNER,{background:true});await flush()
  f.foreground(true);release()
  assert.deepEqual(await analysis,{state:'deferred',reason:'foreground_busy'})
  assert.equal(f.calls.length,0)
})

test('staggered source reads and persistence still hand slow model work to both background queues',async t=>{
  const f=fixture(t);for(let i=1;i<=20;i++)await f.add(i.toString(16))
  f.slowStore(2000);f.memory.start();f.scheduler.start();await f.advance(700000)
  // Read fixture state with its synchronous original API after timed work completes.
  assert.ok(f.documents.size>=3,'slow persistence let analysis starve source indexing')
  assert.ok(f.calls.filter(r=>r.kind==='analysis').length>=3,'slow persistence let indexing starve analysis')
  assert.equal(f.maxActive(),1)
  assert.equal(f.calls.filter(r=>r.kind==='cancel').length,0)
})

test('pausing a waiting analysis scheduler withdraws its handoff without pausing subsequent indexing',async t=>{
  const f=fixture(t);await f.add('a');await f.add('b')
  f.memory.start();await f.advance(2000)
  assert.equal((await f.memory.analyzeNext(OWNER,{background:true})).state,'deferred')
  await f.advance(40000)
  await f.scheduler.control(OWNER,{paused:true,mode:'catchup'})
  await f.advance(5000)
  assert.equal(f.calls.filter(r=>r.kind==='index').length,2)
  assert.equal(f.calls.filter(r=>r.kind==='analysis').length,0)
})
