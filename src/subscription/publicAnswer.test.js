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
