'use strict'
// Omit only byte-identical outer context. Every differing character, its complete
// source lines and nearby lines remain in review; this never raises input caps.
const {createHash}=require('node:crypto'),hash=s=>createHash('sha256').update(s).digest('hex')
function excerpt(c){
 if(typeof c.before!=='string'||typeof c.after!=='string'||c.beforeHash!==hash(c.before)||c.afterHash!==hash(c.after)||c.before===c.after)throw Error('invalid_worker_result')
 let start=0,end=0;while(start<Math.min(c.before.length,c.after.length)&&c.before[start]===c.after[start])start++
 while(end<Math.min(c.before.length,c.after.length)-start&&c.before[c.before.length-1-end]===c.after[c.after.length-1-end])end++
 // Two complete leading/trailing context lines, using common offsets only.
 start=c.before.lastIndexOf('\n',start-1)+1
 for(let i=0;i<2&&start>0;i++)start=c.before.lastIndexOf('\n',start-2)+1
 let afterEnd=c.after.length-end,beforeEnd=c.before.length-end
 for(let i=0;i<3;i++){const at=c.before.indexOf('\n',beforeEnd);const delta=at<0?c.before.length-beforeEnd:at+1-beforeEnd;beforeEnd+=delta;afterEnd+=delta}
 const prefix=c.before.slice(0,start),suffix=c.before.slice(beforeEnd)
 if(c.after.slice(0,start)!==prefix||c.after.slice(afterEnd)!==suffix)throw Error('invalid_worker_result')
 return{file:c.file,beforeHash:c.beforeHash,afterHash:c.afterHash,startLine:prefix.split('\n').length,before:c.before.slice(start,beforeEnd),after:c.after.slice(start,afterEnd),omittedIdenticalPrefix:{characters:prefix.length,sha256:hash(prefix)},omittedIdenticalSuffix:{characters:suffix.length,sha256:hash(suffix)}}
}
function reviewPacket(packet){
 if(Buffer.byteLength(JSON.stringify(packet))<=700000)return packet
 const value={workOrder:packet.workOrder,model:packet.model,effort:packet.effort,billing:packet.billing,execution:packet.execution,changedFiles:packet.changedFiles,changes:packet.changes.map(excerpt),summary:packet.summary,baseline:packet.baseline,tests:packet.tests,patchHash:packet.patchHash,isolatedRunId:packet.isolatedRunId,appliedToLive:packet.appliedToLive,design:packet.design,reviewScope:'All final differing text plus complete source/context lines. Only identical outer bytes and duplicate before/after/previous-candidate bodies are omitted, with hashes. This is not a whole-file line review.',priorAttempts:packet.attempts?.map(a=>({attempt:a.attempt,tests:a.tests,at:a.at}))}
 if(Buffer.byteLength(JSON.stringify(value))>900000)throw Error('review_scope_too_large')
 return value
}
module.exports={reviewPacket,excerpt}
