'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {ownerBrief}=require('./ownerBrief'),{renderSourceBoundFindings}=require('./sourceBoundFindings')
const base=()=>({readOnly:true,focus:'work_failure',sections:[{section:'work',sourceId:'work:one',state:'partial',latestFailureId:'one',records:[{sourceId:'one',state:'failed',reason:'source_dirty'}]}],evidenceModel:{contradictions:[]}})
test('Owner summary explains only the exact receipt and keeps machine reason in evidence',()=>{
 const report=base(),findings=renderSourceBoundFindings(report,{message:'What happened?'})
 const brief=ownerBrief(report,{message:'What happened?',findings})
 assert.match(brief.text,/uncommitted changes/);assert.match(brief.text,/not confirmed/)
 assert.doesNotMatch(brief.text,/source_dirty|work:one|billing/)
 assert.equal(brief.references[0].fields.reason,'source_dirty')
 assert.equal(report.sections[0].records[0].reason,'source_dirty')
 assert.equal(ownerBrief({...report,readOnly:false},{findings}),null)
 assert.equal(ownerBrief({...report,continuity:{}},{findings}),null)
 assert.equal(ownerBrief({...report,evidenceModel:{contradictions:[{}]}},{findings}),null)
 assert.equal(ownerBrief({...report,crossSourceReads:[{source:'gmail'}]},{findings}),null)
 assert.equal(ownerBrief({...report,sections:[{...report.sections[0],records:[]}]},{findings}),null)
})
test('unknown reason is not interpreted; successful adoption prerequisite never becomes a product fix',()=>{
 const report=base();report.sections[0].records[0].reason='an_unrecognised_reason'
 report.workCorrelation={operationRecovery:'CONFIRMED',repaired:'UNKNOWN'}
 const findings=renderSourceBoundFindings(report,{message:'What happened?'})
 const brief=ownerBrief(report,{message:'What happened?',findings})
 assert.match(brief.text,/does not explain the full cause/)
 assert.match(brief.text,/still needs separate verification/)
 assert.doesNotMatch(brief.text,/uncommitted|an_unrecognised_reason/)
 assert.equal(brief.references[0].fields.reason,'an_unrecognised_reason')
})
