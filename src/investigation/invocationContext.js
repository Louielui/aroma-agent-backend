'use strict'
const {AsyncLocalStorage}=require('node:async_hooks')
const context=new AsyncLocalStorage()
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const PHASES=['goal_understanding','intent','answer','evidence_review','unspecified']
function validTrace(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='phase,requestId'&&UUID.test(value.requestId)&&PHASES.includes(value.phase)}
function withInvocationContext(requestId,fn){return context.run(UUID.test(requestId)?{requestId}:null,fn)}
function currentInvocationTrace(phase){const value=context.getStore();return value?{requestId:value.requestId,phase:PHASES.includes(phase)?phase:'unspecified'}:null}
module.exports={withInvocationContext,currentInvocationTrace,validTrace,UUID}
