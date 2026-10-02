'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm')
const {buildCalendarContextHtml}=require('./calendarContextView')
test('actual event detail chat includes source description, location and updated date',()=>{
  const reply=require('./calendarContextView').calendarReply({queryTimeZone:'America/Winnipeg',pack:{state:'ok',operation:'get',count:1,retrievedAt:'2026-10-01T12:00:00Z',coverage:{scope:'primary event event1',complete:true},content:[{title:'Review',sourceId:'event1',originalDate:'2026-09-29T12:00:00Z',content:'Bring the supplier quote',link:null,fields:{start:'2026-10-01',end:'2026-10-02',allDay:true,location:'Head office'}}]}})
  assert.match(reply,/Bring the supplier quote/);assert.match(reply,/Head office/);assert.match(reply,/2026-09-29T12:00:00Z/)
})
test('actual Calendar page renders nonempty linked events as text and preserves all-day dates',()=>{
  class Element {constructor(){this.children=[];this.dataset={};this.textContent='';this.value='today';this.parentElement=this}append(...children){this.children.push(...children)}replaceChildren(...children){this.children=children}setAttribute(){}addEventListener(){} }
  const elements=new Map(),document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)},createElement:()=>new Element()}
  const html=buildCalendarContextHtml(),script=html.match(/<script>([\s\S]*)<\/script>/)[1]
  const context=vm.createContext({document,Date,Number,fetch:()=>{throw Error('source_read_not_expected')}});vm.runInContext(script,context)
  context.report={queryTimeZone:'America/Winnipeg',pack:{state:'ok',count:1,operation:'list',resource:'calendar.owner_events',retrievedAt:'2026-10-01T12:00:00Z',coverage:{scope:'today',complete:true,truncated:false},content:[{title:'<script>unsafe()</script>',sourceId:'event1',link:'https://calendar.google.com/calendar/event?eid=fixture',originalDate:null,content:'source text',fields:{start:'2026-10-01',end:'2026-10-02',allDay:true}}]}}
  vm.runInContext('render(report)',context)
  const text=e=>e.textContent+' '+e.children.map(text).join(' '),rendered=text(elements.get('result'))
  assert.match(rendered,/<script>unsafe\(\)<\/script>/);assert.match(rendered,/2026-10-01/);assert.match(rendered,/2026-10-02/);assert.match(rendered,/結束日期不包含當天/);assert.match(rendered,/America\/Winnipeg/)
})
test('Calendar page unknown coverage and dates stay unknown instead of claiming an empty calendar',()=>{
  const html=buildCalendarContextHtml();assert.ok(!html.includes('⟦?'))
  const date=vm.runInNewContext(/const date=([\s\S]*?);let active=false/.exec(html)[1],{Date,Number,L:{unknown:'unknown'}})
  assert.equal(date('2026-10-01'),'2026-10-01');assert.equal(date(null),'unknown')
})
