'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm')
const {buildAromaContextHtml}=require('./aromaContextView')
// Execute the formatter shipped in the real page. A timestamp renderer cannot
// accidentally pass as a business-date renderer just because the test runs in UTC.
function formatter(){
  const html=buildAromaContextHtml(),match=/const date=([\s\S]*?);let active=false/.exec(html)
  assert.ok(match,'the tested formatter must be the actual page implementation')
  class TimestampDate extends Date {toLocaleString(){return 'converted timestamp'}}
  return vm.runInNewContext(match[1],{Date:TimestampDate,Number,L:{unknown:'unknown'}})
}
test('date-only invoice source dates remain their original day without a timezone conversion',()=>{
  const date=formatter();assert.equal(date('2026-09-28'),'2026-09-28');assert.equal(date('2026-01-01'),'2026-01-01')
})
test('missing source dates stay unknown while actual timestamps retain local display',()=>{
  const date=formatter();assert.equal(date(null),'unknown');assert.equal(date('invalid'),'unknown');assert.equal(date('2026-10-01T21:00:00.000Z'),'converted timestamp')
})
