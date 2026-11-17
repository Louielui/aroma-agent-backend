'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{approvalExpiryDisplay}=require('./approvalTime')
test('saved source-card deadline is MBT UTC-05 with the exact original UTC epoch and milliseconds',()=>{
 assert.deepEqual(approvalExpiryDisplay(1794897603452),{epoch:1794897603452,utc:'2026-11-17T06:40:03.452Z',local:'2026-11-17 01:40:03.452 UTC-05:00',timeZone:'America/Winnipeg',rule:'manitoba-permanent-05-2026'})
})
test('Manitoba no longer falls back in November and remains UTC-05 in subsequent winters',()=>{
 for(const[utc,local]of [['2026-10-31T04:59:59.999Z','2026-10-30 23:59:59.999 UTC-05:00'],['2026-10-31T05:00:00.000Z','2026-10-31 00:00:00.000 UTC-05:00'],['2026-11-01T06:59:59.999Z','2026-11-01 01:59:59.999 UTC-05:00'],['2026-11-01T07:00:00.000Z','2026-11-01 02:00:00.000 UTC-05:00'],['2027-01-15T12:00:00.000Z','2027-01-15 07:00:00.000 UTC-05:00'],['2027-11-07T07:00:00.000Z','2027-11-07 02:00:00.000 UTC-05:00'],['2028-03-01T04:59:59.999Z','2028-02-29 23:59:59.999 UTC-05:00']])assert.equal(approvalExpiryDisplay(Date.parse(utc)).local,local)
})
test('historical winter and summer offsets are preserved rather than rewriting prior dates',()=>{
 assert.equal(approvalExpiryDisplay(Date.parse('2026-01-15T12:00:00.123Z')).local,'2026-01-15 06:00:00.123 UTC-06:00')
 assert.equal(approvalExpiryDisplay(Date.parse('2026-07-15T12:00:00.123Z')).local,'2026-07-15 07:00:00.123 UTC-05:00')
 assert.equal(approvalExpiryDisplay(Date.parse('2026-03-08T07:59:59.999Z')).local,'2026-03-08 01:59:59.999 UTC-06:00')
 assert.equal(approvalExpiryDisplay(Date.parse('2026-03-08T08:00:00.000Z')).local,'2026-03-08 03:00:00.000 UTC-05:00')
})
test('post-change display does not consult stale, unavailable or mismatched host timezone data',()=>{
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('./approvalTime'),'utf8'),{module,Date,Intl:{DateTimeFormat(){throw Error('stale_timezone_engine')}}})
 assert.equal(module.exports.approvalExpiryDisplay(1794897603452).local,'2026-11-17 01:40:03.452 UTC-05:00')
})
test('unrepresentable or nonnumeric deadlines have no display and cannot be coerced to a time',()=>{
 for(const x of [null,undefined,NaN,Infinity,-Infinity,'1794897603452',true,{},[],0.5,-1,Number.MAX_SAFE_INTEGER,253402300800000])assert.equal(approvalExpiryDisplay(x),null)
})
