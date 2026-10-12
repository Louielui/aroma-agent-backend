'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {admitClaims,compose}=require('./publicAnswer')
const page={id:'p1',url:'https://weather.gc.ca/weather',title:'Weather',text:'At 4 PM CDT the temperature is 7°C. Wind north 28 km/h.',state:'read',retrievedAt:'2026-10-11T22:00:00Z',times:[],freshness:'unknown',hash:'a'.repeat(64)}
test('only exact source quotes survive; unrelated URLs, extra numbers and wrong-language answers are withheld',()=>{
 const claim={sourceId:'p1',quote:'the temperature is 7°C.',answer:'The temperature was 7°C.'}
 assert.equal(admitClaims({claims:[claim]},[page],'en').length,1)
 for(const value of [{...claim,sourceId:'fake'},{...claim,quote:'It is 99°C.'},{...claim,answer:'It is 99°C now.'},{...claim,answer:'氣溫7°C。'}])assert.equal(admitClaims({claims:[value]},[page],'en').length,0)
 assert.equal(admitClaims({claims:[{...claim,answer:'該次觀測氣溫為7°C。'}]},[page],'zh').length,1)
})

test('recurring hours cannot turn missing days or undated exceptions into confirmed closures',()=>{
 const source={...page,kind:'publisher_structured',coverage:{kind:'recurring_hours',missingDays:['Sunday'],exceptions:'unknown'},text:'Sunday state unknown; Monday opens 10:00 and closes 17:00.'}
 for(const language of ['en','zh']){
  const claim={sourceId:'p1',quote:source.text,answer:language==='en'?'Sunday is closed.':'星期日休館。'}
  assert.equal(admitClaims({claims:[claim]},[source],language).length,0)
 }
})

test('insufficient subject or period evidence yields an explicit incomplete state rather than unrelated numeric answers',async()=>{
 const result=await compose({run:async(args,options)=>{assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(JSON.parse(options.input).replyLanguage,'en');return {subtype:'success',is_error:false,structured_output:{answerState:'insufficient',claims:[{sourceId:'p1',quote:page.text,answer:'Unrelated opening hours: 10:00–17:00.'}]},modelUsage:{'claude-opus-5-5':{inputTokens:3,outputTokens:4}}}}},{query:'Opening hours of a named location',language:'en',sources:[page]})
 assert.equal(result.answerState,'insufficient');assert.equal(result.claims[0].quote,page.text);assert.doesNotMatch(result.claims[0].answer,/10:00/)
})

test('insufficient output still requires successful completion and observed approved model usage',async()=>{
 const valid={subtype:'success',is_error:false,structured_output:{answerState:'insufficient',claims:[]},modelUsage:{'claude-opus-5-5':{inputTokens:3,outputTokens:4}}}
 for(const change of [{subtype:'error'},{is_error:true},{modelUsage:{}},{modelUsage:{'unexpected-model':{inputTokens:3}}}]){
  await assert.rejects(compose({run:async()=>({...valid,...change})},{query:'Opening hours',language:'en',sources:[page]}),/public_composition_unavailable/)
 }
})

test('the measured honest scope translation is rendered by the host, not counted as a withheld fact',async()=>{
 const scope='Coverage: recurring hours only; date-specific opening status and holiday exceptions are unknown. Missing weekdays are unknown, not closed. Missing weekdays: Sunday.';
 const source={...page,kind:'publisher_structured',coverage:{kind:'recurring_hours',missingDays:['Sunday'],exceptions:'unknown'},text:'Monday: opens 10:00; closes 17:00\n'+scope};
 const draft={answerState:'supported',claims:[{sourceId:'p1',quote:'Monday: opens 10:00; closes 17:00',answer:'星期一 10:00 開門，17:00 關門。'},{sourceId:'p1',quote:scope,answer:'資料範圍：僅為常規時間；特定日期的開放狀態及假日例外情況不明。未列出的星期為不明，並非休館。未列出的星期：週日。'}]};
 const out=await compose({run:async()=>({subtype:'success',is_error:false,structured_output:draft,modelUsage:{'claude-opus-5-5':{inputTokens:3,outputTokens:4}}})},{query:'Regular hours',language:'zh',sources:[source]});
 assert.equal(out.claims.length,1);assert.equal(out.omitted,0);assert.equal(out.hostScopeHandled,1);assert.deepEqual(out.withheldReasons,{});
});

test('a scope quote cannot become a false closure; other withheld facts have counted reasons',async()=>{
 const scope='Coverage: recurring hours only; date-specific opening status and holiday exceptions are unknown. Missing weekdays are unknown, not closed. Missing weekdays: Sunday.';
 const source={...page,kind:'publisher_structured',coverage:{kind:'recurring_hours',missingDays:['Sunday'],exceptions:'unknown'},text:'Monday: opens 10:00; closes 17:00\n'+scope};
 const draft={answerState:'supported',claims:[{sourceId:'p1',quote:'Monday: opens 10:00; closes 17:00',answer:'Monday opens 10:00 and closes 17:00.'},{sourceId:'p1',quote:scope,answer:'Sunday is closed.'},{sourceId:'p1',quote:'Monday: opens 10:00; closes 17:00',answer:'Monday closes at 19:00.'}]};
 const out=await compose({run:async()=>({subtype:'success',is_error:false,structured_output:draft,modelUsage:{'claude-opus-5-5':{inputTokens:3,outputTokens:4}}})},{query:'Regular hours',language:'en',sources:[source]});
 assert.equal(out.claims.length,1);assert.equal(out.hostScopeHandled,1);assert.equal(out.omitted,1);assert.deepEqual(out.withheldReasons,{unverified_number:1});assert.doesNotMatch(out.claims[0].answer,/closed/);
});

test('numeric repair supplies only an original exact quote and refuses an otherwise valid unrequested claim',async()=>{
 const source={...page,text:'Forecast high 7°C. Observed wind 28 km/h.'};
 const run=async(args,opts)=>{
  const input=JSON.parse(opts.input);assert.equal(input.sources[0].text,'Forecast high 7°C.');assert.equal(input.repairClaims[0].quote,'Forecast high 7°C.');
  return {subtype:'success',is_error:false,structured_output:{answerState:'supported',claims:[{sourceId:'p1',quote:'Observed wind 28 km/h.',answer:'Observed wind 28 km/h.'}]},modelUsage:{'claude-opus-5-5':{inputTokens:3,outputTokens:4}}};
 };
 await assert.rejects(compose({run},{query:'Weather',language:'en',sources:[source],repairClaims:[{sourceId:'p1',quote:'Forecast high 7°C.'}]}),/public_composition_unavailable/);
});
