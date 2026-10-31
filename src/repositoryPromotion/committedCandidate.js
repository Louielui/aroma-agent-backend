'use strict'
const fs=require('node:fs'),path=require('node:path')
const checks=require('./checks'),{digest,command}=require('./repository'),{SHA,classifyChanges}=require('./policy')
function plain(file,max=10000000){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>max||fs.realpathSync(file).toLowerCase()!==path.resolve(file).toLowerCase())throw Error('committed_evidence_unavailable');return fs.readFileSync(file,'utf8')}
function verifiedCandidate({root,artifacts,commit,pr,evidenceRunId}){
 if(!SHA.test(commit||'')||!Number.isSafeInteger(pr)||pr<1||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(evidenceRunId||''))throw Error('invalid_committed_candidate')
 const directory=path.join(artifacts,'runs',evidenceRunId),row=JSON.parse(plain(directory+'.json'))
 if(row.id!==evidenceRunId||row.committed?.commit!==commit||row.pr?.number!==pr||command(root,['rev-parse','HEAD'])!==commit||command(root,['status','--porcelain=v1'])||command(root,['rev-parse',commit+'^{tree}'])!==row.committed.tree)throw Error('committed_candidate_changed')
 const logPath=path.join(directory,'full-tests','tests.tap'),log=plain(logPath),parsed=checks.parseTests(log,row.tests?.exitCode)
 if(path.resolve(row.tests?.logPath||'')!==path.resolve(logPath)||row.tests?.commit!==commit||row.tests?.tree!==row.committed.tree||row.tests?.timedOut!==false||parsed.exitCode!==0||parsed.failed!==0||parsed.cancelled!==0||parsed.passed<1||parsed.logHash!==row.tests.logHash||parsed.total!==parsed.passed+parsed.skipped||parsed.skipNames.length!==parsed.skipped||parsed.skipNames.some(n=>!checks.AUTHORIZED_SKIP_NAMES.includes(n)))throw Error('committed_tests_unconfirmed')
 for(const key of ['total','passed','failed','cancelled','skipped'])if(parsed[key]!==row.tests[key])throw Error('committed_tests_unconfirmed')
 const packet=checks.reviewPacket({root,commit,base:row.review?.base,tests:row.tests}),receipt=JSON.parse(plain(path.join(directory,'review','review.json')))
 if(receipt.producer!=='claude-subscription'||receipt.commit!==commit||receipt.tree!==row.committed.tree||receipt.reviewedDiffHash!==packet.reviewedDiffHash||receipt.verdict!=='pass'||receipt.securityRegression!==false||receipt.permissionRegression!==false||receipt.findings?.length!==0||receipt.batches?.length!==packet.batches.length)throw Error('committed_review_unconfirmed')
 for(let i=0;i<packet.batches.length;i++){const reviewed=checks.readReview(JSON.parse(plain(path.join(directory,'review',`review-output-${i+1}.json`))),packet);if(reviewed.verdict!=='pass'||reviewed.securityRegression||reviewed.permissionRegression||reviewed.findings.length||reviewed.actualModel!==receipt.batches[i].actualModel)throw Error('committed_review_unconfirmed')}
 if(classifyChanges(packet.changedPaths,packet.addedText).some(c=>c!=='security_permission_change')||receipt.exceptionCategories.some(c=>c!=='security_permission_change'))throw Error('unsupported_promotion_exception')
 return{committed:row.committed,tests:{...row.tests,...parsed},publication:row.publication,review:receipt,reviewPacket:{...packet,batches:undefined},runtimeSnapshot:row.runtimeSnapshot,evidenceSourceRunId:evidenceRunId}
}
module.exports={verifiedCandidate}
