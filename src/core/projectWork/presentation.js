'use strict'
// Wire-only projection. Canonical source, attempts and approval material stay intact.
const {createHash}=require('node:crypto'),{excerpt}=require('../workerFlow/reviewPacket')
const hash=s=>createHash('sha256').update(s).digest('hex'),CHUNK=32768
const pick=(r,keys)=>Object.fromEntries(keys.filter(k=>r&&Object.hasOwn(r,k)).map(k=>[k,structuredClone(r[k])]))
function tests(r){return r?pick(r,['exitCode','total','passed','failed','skipped','cancelled','evidenceHash','engine','at','boundary','browser']):null}
function present(r){
 if(!r)return null
 const p=pick(r,['id','workflow','state','reason','startedAt','finishedAt','workOrder','source','approvalHash','expiresAt','appliedToLive','failureDiagnostic','repositoryPromotion','liveVerification','codexThread'])
 const steps=Array.isArray(r.steps)?r.steps:[]
 p.steps=steps.slice(-40).map(s=>{const v=pick(s,['stage','at']);if(s.facts){const raw=JSON.stringify(s.facts);v.facts=raw.length<=2048?structuredClone(s.facts):{omitted:true,characters:raw.length}}return v})
 if(r.recoveries)p.recoveries=r.recoveries.map(a=>({...pick(a,['approvalId','requestId','state','runtimeCommit','runtimeSourceHash','outcome']),originalFailure:pick(a.failure,['state','reason','finishedAt'])}))
 if(r.review){p.review=pick(r.review,['verdict','model','billing','costUsd','formatAttempts','visual']);p.review.summary=String(r.review.summary||'').slice(0,4000);p.review.findings=(r.review.findings||[]).slice(0,50).map(f=>typeof f==='string'?f.slice(0,2000):pick(f,['severity','file','line','title','reason']));p.review.omittedFindings=Math.max(0,(r.review.findings?.length||0)-50)}
 if(r.result){const v=r.result;p.result={...pick(v,['model','effort','billing','costUsd','execution','changedFiles','patchHash','isolatedRunId','appliedToLive']),summary:String(v.summary||'').slice(0,4000),baseline:tests(v.baseline),tests:tests(v.tests),changes:(v.changes||[]).map(c=>{let e;try{e=excerpt(c)}catch{throw Error('evidence_changed')}const small=e.before.length+e.after.length<=16000;return{file:c.file,beforeHash:c.beforeHash,afterHash:c.afterHash,excerpt:true,startLine:e.startLine,before:small?e.before:null,after:small?e.after:null,omittedIdenticalPrefix:e.omittedIdenticalPrefix,omittedIdenticalSuffix:e.omittedIdenticalSuffix,contentAvailable:true,excerptOmitted:!small}})}
 }
 p.presentation={version:1,canonicalRetained:true,fullEvidence:'on_demand',omittedAttempts:r.attempts?.length||0,omittedSteps:Math.max(0,steps.length-40)}
 if(JSON.stringify(p).length>196608)throw Error('presentation_too_large')
 return p
}
function list(rows){const runs=rows.slice(0,10).map(present);return{runs,omitted:Math.max(0,rows.length-runs.length)}}
function evidence(r,input){
 if(!r?.result||!input||!['before','after','tests','baseline','review'].includes(input.part)||!Number.isSafeInteger(input.offset)||input.offset<0||! /^[a-f0-9]{64}$/.test(input.patchHash||''))throw Error('invalid_request')
 if(input.patchHash!==r.result.patchHash)throw Error('evidence_changed')
 let text,sha256
 if(['before','after'].includes(input.part)){const c=r.result.changes?.find(c=>c.file===input.file);if(!c||!r.workOrder.allowedFiles.includes(input.file))throw Error('evidence_unavailable');text=c[input.part];sha256=c[input.part+'Hash'];if(typeof text!=='string'||hash(text)!==sha256)throw Error('evidence_changed')}
 else{if(input.file!==undefined)throw Error('invalid_request');const source=input.part==='review'?r.review:r.result[input.part];if(!source)throw Error('evidence_unavailable');text=JSON.stringify(source,null,2);sha256=hash(text)}
 if(input.offset>text.length)throw Error('invalid_request')
 let end=Math.min(text.length,input.offset+CHUNK);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--
 return{id:r.id,patchHash:r.result.patchHash,part:input.part,...(input.file?{file:input.file}:{}),sha256,offset:input.offset,totalChars:text.length,content:text.slice(input.offset,end),nextOffset:end<text.length?end:null}
}
module.exports={present,list,evidence,CHUNK}
