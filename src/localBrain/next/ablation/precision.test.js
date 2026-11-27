'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {calculate}=require('./precision')

test('decimal arithmetic, percentages and chained references remain exact',()=>{
  assert.deepEqual(calculate({steps:[
    {id:'total',op:'add',values:['0.1','0.2']},
    {id:'price',op:'divide',values:['$total','9']},
    {id:'pct',op:'percent',values:['30','48']},
    {id:'rounded',op:'round',values:['$price','3']}
  ]}),{total:'0.3',price:'1/30',pct:'62.5',rounded:'0.033'})
})
test('Gregorian civil dates and overnight times cross boundaries without host timezone',()=>{
  assert.deepEqual(calculate({steps:[
    {id:'day',op:'shift_days',values:['2028-02-28','1']},
    {id:'time',op:'shift_minutes',values:['2026-12-31T23:52','39']},
    {id:'hours',op:'minutes_between',values:['2028-02-29T23:55','2028-03-01T00:44']},
    {id:'weekday',op:'weekday',values:['$day']}
  ]}),{day:'2028-02-29',time:'2027-01-01T00:31',hours:'49',weekday:'Tuesday'})
})
test('rejects arbitrary evaluation, time zones, impossible dates, missing operands and bad refs',()=>{
  const run=(op,values)=>calculate({steps:[{id:'x',op,values}]})
  for(const item of [['eval',['5*8']],['add',['1','process.exit()']],['add',['1']],['divide',['1','0']],
    ['shift_minutes',['2027-01-01T00:00-06:00','5']],['weekday',['2027-02-29']],['add',['1','$x']]]) {
    assert.throws(()=>run(...item))
  }
  assert.throws(()=>calculate({steps:[{id:'__proto__',op:'add',values:['1','2']}]}))
})

test('compound numerical expressions use fixed precedence with no code or broad input grammar',()=>{
  assert.deepEqual(calculate({steps:[
    {id:'x',op:'percent',values:['60-75','75']},
    {id:'y',op:'subtract',values:['621/60-504/75','0']},
    {id:'z',op:'add',values:['(2+3)*4','-2']}
  ]}),{x:'-20',y:'3.63',z:'18'})
})

test('a numerical step ID and reference are valid protocol labels',()=>{
  assert.deepEqual(calculate({steps:[
    {id:'1',op:'shift_days',values:['2032-02-28','2']},
    {id:'2',op:'weekday',values:['$1']}
  ]}),{'1':'2032-03-01','2':'Monday'})
})
