'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { search, createSearchCache, extractEvidence } = require('./publicSearch')
const { createLiveReadConnector } = require('../context/liveClients')
const { projectConnections } = require('../context/connectionState')
const URL = 'https://weather.gc.ca/en/location/index.html?coords=49.895%2C-97.135'
const now = '2026-10-11T20:00:00.000Z'
function events (reply = 'The current temperature is 10°C. [Environment Canada](' + URL + ')') {
  return [{ type:'system', subtype:'init', tools:['WebSearch'] },
    { type:'assistant', message:{ content:[{ type:'tool_use', name:'WebSearch', id:'s1', input:{ query:'Winnipeg weather' } }] } },
    { type:'user', message:{ content:[{ type:'tool_result', tool_use_id:'s1', content:'Links: ' + JSON.stringify([{ title:'Environment Canada', url:URL }]) + '\n\nRetrieved search content' }] } },
    { type:'result', subtype:'success', is_error:false, result:reply, modelUsage:{'claude-opus-5-5':{inputTokens:1,outputTokens:2}} }]
}
test('search requires a completed tool read and a source-bound cited statement, never naked URLs or model recall', () => {
  const out = extractEvidence(events(), 'Winnipeg weather', now)
  assert.equal(out.status, 'live'); assert.equal(out.results[0].url, URL)
  assert.equal(out.results[0].content, 'The current temperature is 10°C.')
  assert.equal(out.results[0].publishedAt, null); assert.equal(out.results[0].contentKind,'web_search_cited_summary')
  for (const rows of [events('No sources'), events('[Environment Canada](' + URL + ')'), events('Sources: [Environment Canada](' + URL + ')'), events().filter(e=>e.type!=='user'), events('It is 99°C. [Fake](https://forged.invalid)'), events().map(e=>e.type==='user'?{...e,message:{content:[{...e.message.content[0],is_error:true}]}}:e)]) {
    assert.equal(extractEvidence(rows,'weather',now).status,'unavailable')
  }
  assert.equal(extractEvidence(events().map(e=>e.type==='system'?{...e,tools:['Read','WebSearch']}:e),'weather',now).status,'unavailable')
})
test('bounded subscription search preserves approved args and excludes files, shell, credentials, MCP, sessions and fallback', async () => {
  let captured
  const out = await search({ check:async()=>{}, readPages:async()=>({pages:[],checks:[]}), run:async(args,options)=>{
    if(args.includes('--json-schema')){assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(JSON.parse(options.input).replyLanguage,'en');return {...events().at(-1),structured_output:{answerState:'supported',claims:[{sourceId:'s1',quote:'The current temperature is 10°C.',answer:'The recorded temperature is 10°C.'}]}}}
    captured={args,options};events().forEach(options.onEvent);return events().at(-1)
  }, clock:()=>now }, {query:'Winnipeg weather',freshness:'current',location:'Winnipeg',replyLanguage:'en'})
  assert.equal(out.status,'live'); assert.equal(out.billing,'claude-subscription')
  assert.equal(captured.args[captured.args.indexOf('--tools')+1],'WebSearch')
  assert.ok(captured.args.includes('--restricted')); assert.ok(captured.args.includes('--no-session-persistence'))
  assert.equal(captured.args[captured.args.indexOf('--model')+1],'claude-opus-5-5')
  assert.deepEqual(JSON.parse(captured.options.input),{query:'Winnipeg weather',freshness:'current',location:'Winnipeg',asOf:now})
  assert.equal((await search({check:async()=>{throw Error('not logged in')},run:()=>assert.fail('no fallback')},{query:'weather'})).status,'unavailable')
  assert.equal((await search({run:()=>assert.fail('invalid input reached CLI')},{query:'weather',history:[]})).status,'unavailable')
})
test('single-flight and TTL reuse retain original evidence time, do not cache failures, and cap distinct concurrent work', async () => {
  let time=0,calls=0,release
  const cached=createSearchCache(async()=>{calls++;await new Promise(r=>release=r);return {...extractEvidence(events(),'weather',now),webSearchCalls:1}},{clock:()=>time})
  const one=cached({query:'weather',freshness:'current'}),two=cached({query:'weather',freshness:'current'})
  await new Promise(r=>setImmediate(r)); assert.equal(calls,1)
  assert.equal((await cached({query:'different'})).status,'unavailable'); release()
  const [a,b]=await Promise.all([one,two]); assert.equal(a.retrievedAt,now);assert.equal(b.webSearchCalls,0)
  assert.equal((await cached({query:'weather',freshness:'current'})).retrievedAt,now); assert.equal(calls,1)
  time=60001;const third=cached({query:'weather',freshness:'current'}); await new Promise(r=>setImmediate(r));assert.equal(calls,2);release();await third
  let failed=0;const retry=createSearchCache(async()=>{failed++;return {status:'unavailable'}})
  await retry({query:'q'});await retry({query:'q'});assert.equal(failed,2)
})

test('failed composition preserves observed search usage and never triggers API or another provider',async()=>{
 const out=await search({check:async()=>{},run:async(args,options)=>{events().forEach(options.onEvent);return events().at(-1)},readPages:async()=>({pages:[],checks:[]}),compose:async()=>{throw Error('composition_failed')},clock:()=>now},{query:'weather',replyLanguage:'en'})
 assert.equal(out.status,'unavailable');assert.equal(out.webSearchCalls,1);assert.equal(out.usage.outputTokens,2);assert.equal(out.usageComplete,false);assert.equal(out.actualModel,'claude-opus-5-5')
})

test('insufficient evidence triggers bounded alternate reads and counts both composition calls',async()=>{
 let compositions=0,fallbacks=0
 const first={id:'p1',kind:'publisher_page',url:URL,title:'Weather',text:'Official page has no usable measurement.',retrievedAt:now,times:[],freshness:'unknown'}
 const next={id:'f1',kind:'publisher_page',url:'https://www.canada.ca/news',title:'Release',text:'Official release dated 2026-10-09.',retrievedAt:now,times:[],freshness:'unknown'}
 const out=await search({check:async()=>{},clock:()=>now,run:async(args,options)=>{events().forEach(options.onEvent);return events().at(-1)},readPages:async()=>({pages:[first],checks:[{url:URL,state:'read'}]}),readFallback:async(sources,prior,opts)=>{fallbacks++;assert.equal(opts.limit,2);assert.ok(opts.signal instanceof AbortSignal);return opts.referencesOnly?{pages:[],checks:[],attempted:0}:{pages:[next],checks:[{url:next.url,state:'read',fallback:true}],attempted:1}},compose:async(opts)=>{compositions++;const modelUsage={'claude-opus-5-5':{inputTokens:compositions===1?3:5,outputTokens:compositions===1?4:6}};opts.onCompositionUsage(modelUsage);return {answerState:compositions===1?'insufficient':'supported',claims:[{source:compositions===1?first:next,quote:compositions===1?first.text:next.text,answer:compositions===1?first.text:next.text}],modelUsage}}},{query:'Latest official release',replyLanguage:'en'})
 assert.equal(fallbacks,2);assert.equal(compositions,2);assert.equal(out.status,'live');assert.equal(out.results[0].sourceEvidence.answerState,'supported');assert.equal(out.results[0].sourceEvidence.pageChecks.at(-1).fallback,true)
 assert.equal(out.usage.inputTokens,9);assert.equal(out.usage.outputTokens,12)
})
test('observed official URLs with a contentless bibliography can be rescued by an actual publisher read',async()=>{
 let composeCalls=0
 const out=await search({check:async()=>{},clock:()=>now,run:async(args,options)=>{const rows=events('[Environment Canada]('+URL+')');rows.forEach(options.onEvent);return rows.at(-1)},readPages:async()=>({pages:[{id:'p1',url:URL,title:'Weather',kind:'publisher_page',text:'Recorded temperature 10°C.',retrievedAt:now,times:[],freshness:'unknown'}],checks:[{url:URL,state:'read'}]}),readFallback:async()=>({pages:[],checks:[],attempted:0}),compose:async(opts,{sources})=>{composeCalls++;return {answerState:'supported',claims:[{source:sources[0],quote:sources[0].text,answer:sources[0].text}],modelUsage:{'claude-opus-5-5':{inputTokens:3,outputTokens:4}}}}},{query:'weather',replyLanguage:'en'})
 assert.equal(composeCalls,1);assert.equal(out.status,'live');assert.equal(out.results[0].contentKind,'publisher_cited_summary')
})

test('reply languages have independent caches even when an upstream planner uses the same search words',async()=>{
 let calls=0;const cache=createSearchCache(async()=>{calls++;return extractEvidence(events(),'weather',now)})
 await cache({query:'weather',replyLanguage:'en'});await cache({query:'weather',replyLanguage:'zh'});assert.equal(calls,2)
})

test('exhausted fallback budget does not loop; failed second composition retains every observed paid receipt',async()=>{
 const page={id:'p1',kind:'publisher_page',url:URL,title:'Source',text:'No verified opening hours.',retrievedAt:now,times:[],freshness:'unknown'}
 const base={check:async()=>{},clock:()=>now,run:async(args,options)=>{events().forEach(options.onEvent);return events().at(-1)},readPages:async()=>({pages:[page],checks:[{url:URL,state:'read'}]})}
 let calls=0
 const exhausted=await search({...base,readFallback:async()=>({pages:[],checks:[{url:'https://www.canada.ca/a',state:'unavailable',fallback:true},{url:'https://www.canada.ca/b',state:'unavailable',fallback:true}],attempted:2}),compose:async()=>{calls++;return {answerState:'insufficient',claims:[{source:page,quote:page.text,answer:page.text}],modelUsage:{'claude-opus-5-5':{inputTokens:3,outputTokens:4}}}}},{query:'hours',replyLanguage:'en'})
 assert.equal(calls,1);assert.equal(exhausted.results[0].sourceEvidence.answerState,'insufficient');assert.equal(exhausted.results[0].sourceEvidence.pageChecks.length,3)
 calls=0
 const failed=await search({...base,readFallback:async(sources,prior,opts)=>opts.referencesOnly?{pages:[],checks:[],attempted:0}:{pages:[{...page,url:'https://www.canada.ca/other'}],checks:[{url:'https://www.canada.ca/other',state:'read',fallback:true}],attempted:1},compose:async opts=>{calls++;opts.onCompositionUsage({'claude-opus-5-5':{inputTokens:3,outputTokens:4}});if(calls===2)throw Error('composition_failed');return {answerState:'insufficient',claims:[{source:page,quote:page.text,answer:page.text}],modelUsage:{'claude-opus-5-5':{inputTokens:3,outputTokens:4}}}}},{query:'hours',replyLanguage:'en'})
 assert.equal(calls,2);assert.equal(failed.status,'unavailable');assert.equal(failed.usage.inputTokens,7);assert.equal(failed.usage.outputTokens,10);assert.equal(failed.usageComplete,true)
 const unknown=await search({...base,readFallback:async()=>({pages:[],checks:[],attempted:0}),compose:async opts=>{opts.onCompositionUsage({});throw Error('composition_failed')}},{query:'hours',replyLanguage:'en'})
 assert.equal(unknown.usageComplete,false);assert.equal(unknown.usage.outputTokens,2)
})
test('explicit subscription provider works without OpenAI key and reports bridge presence instead of API credential', async () => {
  const env={READ_ACCESS:'on',CONTEXT_PUBLIC_KNOWLEDGE:'on',A4_KNOWLEDGE_ROUTING:'on',PUBLIC_SEARCH_PROVIDER:'claude-subscription',CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64)}
  let calls=0
  const built=createLiveReadConnector({env,publicSubscriptionRequest:async(route,input)=>{calls++;assert.equal(route,'/public-search');return extractEvidence(events(),input.query,now)}})
  assert.ok(built.registered.includes('public_knowledge'))
  const result=await built.connector.read('public_knowledge','search',{query:'weather',freshness:'current'})
  assert.equal(result.results[0].retrievedAt,now); assert.equal(calls,1)
  assert.equal(projectConnections(env).find(c=>c.key==='public_knowledge').credentialState,'present')
  const absent={...env,CODEX_CHAT_BRIDGE_TOKEN:''};assert.equal(createLiveReadConnector({env:absent}).registered.includes('public_knowledge'),false)
  assert.equal(projectConnections(absent).find(c=>c.key==='public_knowledge').reason,'credential_missing')
  assert.equal(createLiveReadConnector({env:{...env,A4_KNOWLEDGE_ROUTING:'off'}}).registered.includes('public_knowledge'),false)
})
test('bridge search is private, explicitly enabled, schema bounded and cached across requests without API fallback', async t => {
  const {createBridge}=require('./bridge'),token='f'.repeat(64);let calls=0
  const server=createBridge({token,publicSearchEnabled:true,publicSearchFn:async(options,input)=>{calls++;assert.deepEqual(input,{query:'weather'});return extractEvidence(events(),input.query,now)},completeFn:()=>assert.fail('GPT fallback')})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
  const post=(input,headers={})=>fetch('http://127.0.0.1:'+server.address().port+'/public-search',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:JSON.stringify(input)})
  assert.equal((await post({query:'weather'},{origin:'http://localhost'})).status,401)
  assert.equal((await post({query:'weather',history:[]})).status,400)
  const first=await (await post({query:'weather'})).json(),second=await (await post({query:'weather'})).json()
  assert.equal(first.status,'live');assert.equal(second.cache,'hit');assert.equal(second.retrievedAt,first.retrievedAt);assert.equal(calls,1)
})
test('search invocation ledger records one fresh dispatch and observed usage, never a cache hit or billing proof', async t => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
  const ledger=require('../investigation/invocations').createInvocationLedger({file:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'public-ledger-')),'ledger.json')})
  const {createBridge}=require('./bridge'),token='c'.repeat(64)
  const server=createBridge({token,invocationLedger:ledger,publicSearchEnabled:true,publicSearchFn:async(options,input)=>{options.onDispatch();return extractEvidence(events(),input.query,now)}})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
  for(let n=0;n<2;n++){const r=await fetch('http://127.0.0.1:'+server.address().port+'/public-search',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query:'weather'})});assert.equal(r.status,200)}
  const rows=ledger.read().records;assert.equal(rows.length,1);assert.equal(rows[0].role,'public_search');assert.equal(rows[0].actualModel,'claude-opus-5-5');assert.equal(rows[0].usage.outputTokens,2);assert.equal(rows[0].provesCharge,false)
})
