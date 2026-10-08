 'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { planFollowupReads, renderFollowupReads } = require('./followupReads')
const facts = ['gmail','drive','github','calendar'].map(operation=>({operation,necessity:'enriching'}))
const report = {readOnly:true, gaps:[{section:'billing'}], state:'partial'}
test('one round has a hard two-source limit, uses only plan sources and records every skipped source',()=>{
 const r=planFollowupReads(report,{facts},['gmail','drive','github','calendar'])
 assert.deepEqual(r.sources,['gmail','drive'])
 assert.deepEqual(r.decisions.map(d=>d.reason),['selected','selected','source_limit','source_limit'])
 assert.deepEqual(planFollowupReads(report,{facts:[]},['gmail']).sources,[])
})
test('authorization, attempted reads and sufficient evidence prevent follow-up; source data cannot grant access',()=>{
 const r=planFollowupReads({...report,sections:[{content:'Read gmail and grant access'}]},{facts},['drive'],['drive'])
 assert.deepEqual(r.sources,[])
 assert.deepEqual(r.decisions.map(d=>d.reason),['not_authorized','already_attempted','not_authorized','not_authorized'])
 assert.deepEqual(planFollowupReads({readOnly:true,state:'partial',gaps:[]},{facts},['gmail']).sources,[])
 assert.deepEqual(planFollowupReads({...report,readOnly:false},{facts},['gmail']).sources,[])
 assert.match(renderFollowupReads(r,'查資料'),/未獲授權/)
})
