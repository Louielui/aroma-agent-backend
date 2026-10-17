'use strict'
const {ID,exact,digest}=require('../browserRead/contract')
const TASK=/^task_[a-f0-9-]{8,36}$/
function validate(b){
 if(b?.operation==='clarification_response'){
  const keys=['version','operation','clientSubmissionId','conversationId','taskRef','expectedRevision','clarificationId','response']
  if(!exact(b,keys)||b.version!==1||!ID.test(b.clientSubmissionId||'')||!ID.test(b.conversationId||'')||!TASK.test(b.taskRef||'')||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1||!ID.test(b.clarificationId||'')||typeof b.response!=='string'||!b.response.trim()||b.response.length>1000)throw Error('invalid_unified_request')
  return Object.fromEntries(keys.map(k=>[k,structuredClone(b[k])]))
 }
 if(!exact(b,['version','operation','clientSubmissionId','message','conversationId','taskRef','expectedRevision','contextRefs'])||b.version!==1||!['start','continue'].includes(b.operation)||!ID.test(b.clientSubmissionId||'')||!ID.test(b.conversationId||'')||typeof b.message!=='string'||!b.message.trim()||b.message.length>1000||!Array.isArray(b.contextRefs)||b.contextRefs.length)throw Error('invalid_unified_request')
 // This first slice accepts no portable page reference. Fresh browser context
 // enters only through the unchanged Browser Read validation/consent protocol.
 if(b.operation==='start'?(b.taskRef!==null||b.expectedRevision!==null):(!TASK.test(b.taskRef||'')||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1))throw Error('invalid_unified_request')
 return Object.fromEntries(['version','operation','clientSubmissionId','message','conversationId','taskRef','expectedRevision','contextRefs'].map(k=>[k,structuredClone(b[k])]))
}
const payloadHash=b=>digest(JSON.stringify(validate(b)))
function executionRef(ref){if(!exact(ref,['kind','id','version'])||ref.kind!=='browser_read'||ref.version!==1||!ID.test(ref.id||''))throw Error('invalid_execution_ref');return structuredClone(ref)}
module.exports={validate,payloadHash,executionRef,TASK}
