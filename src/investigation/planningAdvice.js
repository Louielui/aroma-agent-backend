'use strict'
// Foreground presentation only. Existing source, premise and execution gates own
// the facts and permissions; an investigation focus cannot replace a plan goal.
const {t}=require('../i18n/t')
function isPlanningAdvice({plan,report,mode,ownerGoal,clarification=false}={}){
 return !ownerGoal&&!clarification&&mode==='recommend'&&report?.readOnly===true&&
  plan?.executiveFrame?.taskType==='plan'&&plan.executiveFrame.decisionNeeded===true
}
function compactPlanningAdvice(reply,{message='',report}={}){
 if(typeof reply!=='string'||!reply.trim()||reply.length>3600)return null
 const blocks=reply.trim().split(/\n\s*\n/),first=blocks[0]
 if(/^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|```)/.test(first))return null
 const conclusion=require('../intake/answerPlan').splitSentences(first)[0]?.trim()
 if(!conclusion||conclusion.length>400)return null
 const points=[]
 for(const block of blocks.slice(1)){
  const lines=block.split('\n')
  if(lines.every(l=>/^[-*] /.test(l))){for(const line of lines){if(points.length<3){if(line.length>400)return null;points.push(line)}}break}
 }
 const locale=/[\u3400-\u9fff]/.test(message)?'zh':'en'
 const gaps=report?.gaps?.length||report?.sections?.some(s=>!['ok','partial'].includes(s.state))||report?.crossSourceReads?.some(s=>s.state!=='sampled')
 const boundary=[t('planningAdvice.boundary',{},locale),...(gaps?[t('planningAdvice.sourceGaps',{},locale)]:[]),
  ...(require('../memory/capturePolicy').exclusionReason(message)==='owner_opt_out'?[t('planningAdvice.captureBoundary',{},locale)]:[])]
 return{reply:[conclusion,points.join('\n'),boundary.join(' ')].filter(Boolean).join('\n\n'),details:reply,points:points.length}
}
function unavailable(message){return t('planningAdvice.unavailable',{},/[\u3400-\u9fff]/.test(message)?'zh':'en')}
module.exports={isPlanningAdvice,compactPlanningAdvice,unavailable}
