'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { buildReadResultReply } = require('./readResultView')
const row = { source: 'public_knowledge', trust: 'live', sourceId: 'web-1', retrievedAt: '2026-10-11T20:55:04.902Z',
  fields: { provider: 'claude_subscription_search', consulted: true, sourceTitle: 'Weather source', url: 'https://weather.gc.ca/forecast' } }
test('the real reply formatter preserves links, original evidence time and unknown freshness in both languages', () => {
  for (const message of ['今天 Winnipeg 天氣如何？', 'What is the weather in Winnipeg today?']) {
    const input = { message, reply: 'A bounded weather summary.', itemsBySource: [{ source: 'public_knowledge', items: [row, row] }] }
    const out = buildReadResultReply(input)
    assert.equal(out.reply.split('https://weather.gc.ca/forecast').length - 1, 1)
    assert.ok(out.reply.includes(row.retrievedAt)); assert.match(out.reply, /未確認|unconfirmed/)
    assert.match(out.reply, /並非網站原文或此刻觀測|not publisher text or a current observation/)
    assert.equal(out.reply.includes('published today'), false)
  }
})

test('structured hours expose missing weekday, unknown exception scope, fallback checks and publisher reference',()=>{
 for(const language of ['zh','en']){
  const data='https://raw.githubusercontent.com/winnipegpublibrary/winnipeg-ca-openinghours/main/hours-schema/1262.json'
  const observed={...row,content:language==='zh'?'星期一開放10:00至17:00。':'Monday: opens 10:00; closes 17:00.',fields:{...row.fields,url:data,contentKind:'publisher_cited_summary',sourceEvidence:{kind:'publisher_structured',language,hash:'a'.repeat(64),quote:'Monday: opens 10:00; closes 17:00.',times:[],freshness:'unknown',parentUrl:'https://www.winnipeg.ca/library',coverage:{kind:'recurring_hours',missingDays:['Sunday'],exceptions:'unknown',invalidFields:1},pageChecks:[{url:data,state:'read',fallback:true}],answerState:'supported'}}}
  const out=buildReadResultReply({message:language==='zh'?'營業時間？':'Opening hours?',itemsBySource:[{source:'public_knowledge',items:[observed]}]})
  const lead=out.reply.split('### ')[0]
  assert.match(lead,/常規週期|recurring/);assert.match(lead,/星期日|Sunday/);assert.match(lead,/不代表休息|does not mean closed/);assert.match(lead,/假日|holiday/);assert.ok(lead.includes('https://www.winnipeg.ca/library'))
  assert.match(out.reply,/結構化|structured/);assert.match(out.reply,/已補查|Additional sources checked/);assert.match(lead,/1/)
 }
})
test('no evidence, failed reads, invented model URLs and legacy providers gain no public attribution', () => {
  for (const r of [null, { ...row, trust: 'unavailable' }, { ...row, fields: { ...row.fields, consulted: false } },
    { ...row, fields: { ...row.fields, url: 'javascript:alert(1)' } }, { ...row, fields: { ...row.fields, provider: 'legacy' } }]) {
    const out = buildReadResultReply({ message: 'Weather?', reply: 'No verified current answer.', itemsBySource: [{ source: 'public_knowledge', items: r ? [r] : [] }] })
    assert.equal(out.reply.includes('Search retrieved'), false)
  }
})
test('a public-only answer preserves the observed excerpt, units, uncertainty and age without releasing the model draft', () => {
  const observed = { ...row, content: 'At 11:05 CDT: 10°C. The source date is unconfirmed.', fields: { ...row.fields, contentKind: 'web_search_cited_summary' } }
  const out = buildReadResultReply({ message: 'Weather today?', reply: 'Invented 99°C right now.', itemsBySource: [{ source: 'public_knowledge', items: [observed] }] })
  assert.match(out.reply, /11:05 CDT: 10°C/); assert.match(out.reply, /earlier observations/)
  assert.ok(out.reply.includes(row.fields.url)); assert.ok(out.reply.includes(row.retrievedAt)); assert.doesNotMatch(out.reply, /99°C/)
  const mixed = buildReadResultReply({ message: 'Compare public weather and company records', reply: 'A bounded comparison.', itemsBySource: [{ source: 'public_knowledge', items: [observed] }, { source: 'gmail', items: [{ source: 'gmail', trust: 'live' }] }] })
  assert.doesNotMatch(mixed.reply, /These are excerpts/)
})

test('official quote summaries lead with requested-language facts, preserve time meanings and collapseable source detail',()=>{
 for(const language of ['zh','en']){
  const observed={...row,content:language==='zh'?'**該次觀測：** 氣溫7°C。':'**Recorded observation:** Temperature 7°C.',fields:{...row.fields,contentKind:'publisher_cited_summary',sourceEvidence:{kind:'publisher_page',language,hash:'a'.repeat(64),quote:'Temperature: 7°C at 4 PM CDT.',times:[{kind:'observation',value:'2026-10-11T21:00:00Z'},{kind:'update',value:'2026-09-03T15:20:37Z'}],freshness:'recent_observation',pageChecks:[]}}}
  const out=buildReadResultReply({message:language==='zh'?'天氣？':'Weather?',reply:'Invented 99°C currently.',itemsBySource:[{source:'public_knowledge',items:[observed]}]})
  assert.ok(out.reply.startsWith('- '));assert.doesNotMatch(out.reply,/\\|\*\*|99°C|currently/);assert.match(out.reply,/Winnipeg/)
  assert.match(out.reply,/觀測時間|Observation time/);assert.ok(out.reply.includes('16:00'));assert.match(out.reply,/### (來源與核對細節|Source checks and excerpts)/)
  assert.ok(out.reply.includes(observed.fields.sourceEvidence.quote))
  observed.fields.sourceEvidence.language=language==='en'?'zh':'en'
  const wrong=buildReadResultReply({message:language==='zh'?'天氣？':'Weather?',itemsBySource:[{source:'public_knowledge',items:[observed]}]})
  assert.doesNotMatch(wrong.reply,/Temperature 7°C|該次觀測/)
 }
})

test('an insufficient result cannot expose unverified figures as its leading answer',()=>{
 const observed={...row,content:'Unverified opening hours: 10:00–17:00.',fields:{...row.fields,contentKind:'web_search_cited_summary',sourceEvidence:{kind:'search_summary',language:'en',quote:'A different branch calendar has these hours.',times:[],freshness:'unknown',answerState:'insufficient'}}}
 const out=buildReadResultReply({message:'What are the opening hours?',itemsBySource:[{source:'public_knowledge',items:[observed]}]})
 const lead=out.reply.split('### Source checks and excerpts')[0]
 assert.match(lead,/do not establish the requested information/);assert.doesNotMatch(lead,/10:00|17:00/)
})
