'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{contentRiskText}=require('./checks'),{classifyChanges}=require('./policy')
const header='diff --git a/src/memory/transport.js b/src/memory/transport.js\n--- a/src/memory/transport.js\n+++ b/src/memory/transport.js\n@@ -1,3 +1,3 @@\n'
const old="      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(['backup', 'queue_index'].includes(request.op) ? 65000 : 20000),"
const changed="      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(request.op === 'backup' ? 270000 : request.op === 'queue_index' ? 65000 : 20000),"
const before="     const response = await fetch('http://127.0.0.1:8091/memory-store', {",after="       headers: { authorization: existingToken }, body: JSON.stringify(request)"
test('a pure deadline change on the identical transport has no new write verb; full diff remains reviewable',()=>{
 const diff=header+[before,'-'+old,'+'+changed,after].join('\n'),risk=contentRiskText([diff])
 assert.deepEqual(classifyChanges([],risk.addedText),[]);assert.equal(risk.adjustments.length,1)
 assert.ok(risk.addedText.includes('270000'));assert.ok(diff.includes("method: 'POST'"))
})
test('new writes, changed methods, destination/payload changes and side-effectful deadline expressions retain business-write protection',()=>{
 const cases=[header+'+'+changed,
 header+[before,'-'+old,'+'+changed.replace("'POST'","'DELETE'"),after].join('\n'),
 header+['-'+before.trimStart(),'+'+before.replace('memory-store','external-writer'),'%-'.replace('%','')+old,'+'+changed,after].join('\n'),
 header+[before,'-'+old,'+'+changed,'-'+after.trimStart(),'+'+after.replace('request','newPayload')].join('\n'),
 header+[before,'-'+old,'+'+changed.replace('270000','writeSomething()'),after].join('\n')]
 for(const diff of cases)assert.ok(classifyChanges([],contentRiskText([diff]).addedText).includes('business_data_write'),diff)
})
