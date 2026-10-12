'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const pages=require('./publicPages')
const at='2026-10-12T08:00:00Z'
const body='<main><h1>Public guidance</h1><p>Applications are accepted online with the required documents.</p></main>'
test('inline syntax highlighting preserves technical command tokens instead of inserting spaces',()=>{
 const page=pages.extractPage('<main><h1>Creating virtual environments</h1><p>Run <code>python <span>-</span><span>m</span> venv tutorial<span>-</span>env</code> to create an environment.</p></main>','https://docs.python.org/3/tutorial/venv.html',at)
 assert.ok(page.text.includes('python -m venv tutorial-env'));assert.doesNotMatch(page.text,/python - m|tutorial - env/)
})

test('the complete search-to-quote chain prioritizes actually cited sources in Chinese and English across domains',async()=>{
 const {search,MODEL}=require('./publicSearch')
 const cases=[
  {url:'https://www.immd.gov.hk/eng/guidance',query:'香港護照申請需要什麼文件？',language:'zh',quote:'Applications require the listed documents.',answer:'申請需要列出的文件。'},
  {url:'https://support.mozilla.org/en-US/kb/update-firefox',query:'How can I update Firefox?',language:'en',quote:'Open the menu and select Help to check for updates.',answer:'Open the menu and select Help to check for updates.'},
  {url:'https://www.tourismwinnipeg.com/plan-your-trip',query:'Winnipeg 旅遊資料在哪裡找？',language:'zh',quote:'The visitor centre provides maps and local travel information.',answer:'旅客中心提供地圖及本地旅遊資訊。'}
 ]
 for(const row of cases){
  const observed=[{url:'https://irrelevant.example.org/old',title:'Different entity'},{url:row.url,title:'Named publisher'}],reads=[]
  const out=await search({check:async()=>{},clock:()=>at,latencySink:()=>{},
   run:async(args,opts)=>{
    if(args.includes('--json-schema')){
     const input=JSON.parse(opts.input);assert.equal(input.replyLanguage,row.language);assert.equal(args[args.indexOf('--tools')+1],'');assert.ok(input.sources.every(s=>s.kind!=='search_summary'),'a read body must not be replaced by its search summary')
     const source=input.sources.find(s=>s.text.includes(row.quote));assert.ok(source)
     return {subtype:'success',modelUsage:{[MODEL]:{inputTokens:3,outputTokens:4}},structured_output:{answerState:'supported',claims:[{sourceId:source.id,quote:row.quote,answer:row.answer}]}}
    }
    const events=[{type:'system',subtype:'init',tools:['WebSearch']},{type:'assistant',message:{content:[{type:'tool_use',name:'WebSearch',id:'s',input:{query:row.query}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'s',content:'Links: '+JSON.stringify(observed)}]}},{type:'result',subtype:'success',result:row.quote+' [Publisher]('+row.url+')',modelUsage:{[MODEL]:{inputTokens:1,outputTokens:2}}}]
    events.forEach(opts.onEvent);return events.at(-1)
   },
   readPages:(sources,opts)=>pages.readOfficialPages(sources,{...opts,read:(url,options)=>pages.readPage(url,{...options,get:async(u)=>{reads.push(u);return {status:200,headers:{'content-type':'text/html'},body:'<main><h1>Named publisher</h1><p>'+ (u===row.url?row.quote:'Different entity has no requested data.')+'</p></main>'}}})}),
  },{query:row.query,replyLanguage:row.language})
  assert.equal(out.status,'live');assert.equal(reads[0],row.url);assert.equal(out.results[0].content,row.answer);assert.equal(out.results[0].url,row.url)
  assert.equal(out.results[0].sourceEvidence.kind,'publisher_page');assert.equal(out.results[0].sourceEvidence.accessBasis,'observed_search_url');assert.equal(out.results[0].sourceEvidence.language,row.language);assert.match(out.results[0].sourceEvidence.hash,/^[a-f0-9]{64}$/)
 }
})

test('observed government, manufacturer and venue URLs are read without extending the static host catalogue',async()=>{
 for(const url of ['https://www.immd.gov.hk/eng/service/travel_document/apply.html','https://support.mozilla.org/en-US/kb/update-firefox-latest-release','https://www.tourismwinnipeg.com/plan-your-trip']){
  const seen=[]
  const out=await pages.readOfficialPages([{url}],{read:(value,options)=>pages.readPage(value,{...options,now:()=>Date.parse(at),get:async(u,o)=>{seen.push({u,o});return {status:200,headers:{'content-type':'text/html'},body}}})})
  assert.equal(out.pages.length,1);assert.equal(out.pages[0].url,url);assert.equal(out.pages[0].accessBasis,'observed_search_url');assert.equal(out.pages[0].freshness,'unknown');assert.equal(out.pages[0].publishedAt,null)
  assert.equal(seen[0].o.method,'GET');assert.equal(seen[0].o.credentials,'omit');assert.equal(seen[0].o.redirect,'manual')
  assert.equal((await pages.readPage(url,{get:()=>assert.fail('unobserved direct read')})).state,'unavailable')
 }
})

test('source scope does not authorize invented URLs, account routes or cross-origin redirects',async()=>{
 const source='https://www.immd.gov.hk/eng/public-guidance',scope=pages.createReadScope([{url:source}])
 for(const url of [source+'/invented','https://example.org/','https://www.immd.gov.hk/login','https://www.immd.gov.hk/page?access_token=secret']){
  assert.equal((await pages.readPage(url,{scope,get:()=>assert.fail('unobserved or account URL read')})).state,'unavailable')
 }
 const out=await pages.readPage(source,{scope,get:async()=>({status:302,headers:{location:'https://other.example.org/secret'},body:''})})
 assert.equal(out.state,'unavailable');assert.equal(out.reason,'redirect_not_registered')
 const forged=await pages.readPage(source,{scope:{urls:[source]},get:()=>assert.fail('forged scope')});assert.equal(forged.state,'unavailable')
 const redirected=await pages.readPage(source,{scope,get:async u=>u===source?{status:301,headers:{location:'/eng/canonical'},body:''}:{status:200,headers:{'content-type':'text/html'},body}})
 assert.equal(redirected.finalUrl,'https://www.immd.gov.hk/eng/canonical');assert.equal(redirected.state,'read')
})

test('public URL and DNS checks reject local and reserved networks including mixed and mapped answers',async()=>{
 for(const address of ['127.0.0.1','10.2.3.4','169.254.169.254','100.64.0.1','192.168.1.5','192.0.2.1','198.51.100.8','203.0.113.2','198.18.0.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:7f00:1','2001:db8::1','2002:7f00:1::','3fff::1'])assert.equal(pages.publicAddress(address),false,address)
 for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(pages.publicAddress(address),true,address)
 for(const value of ['http://www.immd.gov.hk/','https://localhost/','https://metadata.google.internal/','https://192.0.2.1/','https://user:pass@example.org/','https://example.org:444/','https://example.org/logout','https://example.org/admin','https://example.org/x?signature=secret']){
  assert.equal(pages.createReadScope([{url:value}]).count,0,value)
 }
 let error
 await new Promise(resolve=>pages.lookupPublic('example.org',{},e=>{error=e;resolve()},{lookup:(host,opts,cb)=>cb(null,[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}])}))
 assert.equal(error.message,'public_address_required')
})

test('failed initial sources trigger only observed alternate reads, with unavailable checks retained',async()=>{
 const urls=['https://publisher.example.org/a','https://vendor.example.org/b','https://venue.example.org/c','https://other.example.org/d','https://fifth.example.org/e']
 const read=(url,options)=>pages.readPage(url,{...options,get:async()=>url===urls[0]?{status:503,headers:{},body:''}:{status:200,headers:{'content-type':'text/html'},body}})
 const sources=urls.map(url=>({url})),initial=await pages.readOfficialPages(sources,{read})
 assert.equal(initial.checks.length,2);assert.equal(initial.checks[0].state,'unavailable');assert.equal(initial.pages.length,1)
 const extra=await pages.readFallbackPages(sources,initial,{read,limit:2})
 assert.deepEqual(extra.pages.map(p=>p.url),urls.slice(2,4));assert.equal(extra.attempted,2)
})

test('failed bodies cause an alternate body read before a search-summary-only answer is accepted',async()=>{
 const {search,MODEL}=require('./publicSearch'),urls=['https://first.example.org/a','https://second.example.org/b','https://third.example.org/c'],seen=[]
 const quote='The requested public documentation is available here.'
 const events=[{type:'system',subtype:'init',tools:['WebSearch']},{type:'assistant',message:{content:[{type:'tool_use',name:'WebSearch',id:'s'}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'s',content:'Links: '+JSON.stringify(urls.map(url=>({url,title:'Public documentation'})))}]}},{type:'result',subtype:'success',result:quote+' [Documentation]('+urls[0]+')',modelUsage:{[MODEL]:{inputTokens:1,outputTokens:2}}}]
 const read=(url,options)=>pages.readPage(url,{...options,get:async u=>{seen.push(u);return u===urls[2]?{status:200,headers:{'content-type':'text/html'},body:'<main><p>'+quote+'</p></main>'}:{status:503,headers:{},body:''}}})
 const out=await search({check:async()=>{},latencySink:()=>{},run:async(args,opts)=>{events.forEach(opts.onEvent);return events.at(-1)},readPages:(sources,opts)=>pages.readOfficialPages(sources,{...opts,read}),readFallback:(sources,prior,opts)=>pages.readFallbackPages(sources,prior,{...opts,read}),compose:async(opts,{sources})=>{const source=sources[0];return {answerState:'supported',claims:[{source,quote:source.text,answer:source.text}],modelUsage:{[MODEL]:{inputTokens:3,outputTokens:4}}}}} ,{query:'Read public documentation',replyLanguage:'en'})
 assert.deepEqual(seen,urls);assert.equal(out.results[0].sourceEvidence.kind,'publisher_page');assert.equal(out.results[0].url,urls[2]);assert.equal(out.results[0].sourceEvidence.pageChecks.filter(c=>c.state==='unavailable').length,2)
})

test('password and access-challenge pages stay unavailable and cannot become public quotations',async()=>{
 const url='https://publisher.example.org/article',scope=pages.createReadScope([{url}])
 for(const html of ['<h1>Log in</h1><form><input type="password"></form><p>Restricted employee data</p>','<title>Just a moment...</title><div>Verify you are human</div>','<title>Client Challenge</title><main>A required part of this site couldn’t load. Please check your connection.</main>']){
  const out=await pages.readPage(url,{scope,get:async()=>({status:200,headers:{'content-type':'text/html'},body:html})});assert.equal(out.state,'unavailable');assert.equal(out.reason,'access_required')
 }
})
