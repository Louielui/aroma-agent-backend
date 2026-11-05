'use strict'
// Foreground presentation only. Existing source, premise and execution gates own
// the facts and permissions; an investigation focus cannot replace a plan goal.
const {t}=require('../i18n/t')
function isPlanningAdvice({plan,report,mode,ownerGoal,clarification=false}={}){
 return !ownerGoal&&!clarification&&mode==='recommend'&&report?.readOnly===true&&
  plan?.executiveFrame?.taskType==='plan'&&plan.executiveFrame.decisionNeeded===true
}
// Select the first actual Markdown list, including one attached to a heading.
// Retain complete continuation/nested lines within each item; never pick a later
// acceptance list merely because the earlier proposal used ordered markers.
function markdownPoints(text){
 const lines=text.split(/\r?\n/),marker=line=>line.match(/^( {0,3})([-*+]|\d{1,3}[.)])[ \t]+(.*)$/),isOrdered=m=>/^\d/.test(m[2]),indent=line=>(line.match(/^[ \t]*/)||[''])[0].length
 const boundary=line=>/^\s*(?:#{1,6}\s|>\s|(?:[-*_]\s*){3,}$)/.test(line)||/^\s*(?:\*\*[^*]+\*\*|__[^_]+__)\s*$/.test(line)
 let fence=null
 for(let i=0;i<lines.length;i++){
  const code=lines[i].match(/^ {0,3}(`{3,}|~{3,})/)
  if(code){if(!fence)fence=code[1];else if(code[1][0]===fence[0]&&code[1].length>=fence.length)fence=null;continue}
  if(fence||boundary(lines[i]))continue
  const first=marker(lines[i]);if(!first)continue
  const ordered=isOrdered(first),level=first[1].length,items=[]
  let current=null,expected=1
  for(let j=i;j<lines.length;j++){
   const line=lines[j],m=marker(line)
   if(!line.trim()){
    let next=j+1;while(next<lines.length&&!lines[next].trim())next++
    const following=marker(lines[next]||'')
    if(following&&following[1].length===level&&isOrdered(following)===ordered||next<lines.length&&indent(lines[next])>level)continue
    break
   }
   if(/^\s*(`{3,}|~{3,})/.test(line))return null
   if(m&&m[1].length===level){
    if(isOrdered(m)!==ordered)break
    if(!m[3].trim()||ordered&&Number(m[2].slice(0,-1))!==expected++)return null
    current=[m[3].trim()];items.push(current)
   }else if(current&&indent(line)>level)current.push(line.trim())
   else if(boundary(line)||m)break
   else if(current)current.push(line.trim())
  }
  const selected=items.slice(0,3).map(parts=>'- '+parts.join(' '))
  return selected.some(item=>item.length>400)?null:selected
 }
 return[]
}
function compactPlanningAdvice(reply,{message='',report}={}){
 if(typeof reply!=='string'||!reply.trim()||reply.length>3600)return null
 const blocks=reply.trim().split(/\n\s*\n/),first=blocks[0]
 if(/^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|```)/.test(first))return null
 const conclusion=require('../intake/answerPlan').splitSentences(first)[0]?.trim()
 if(!conclusion||conclusion.length>400)return null
 const points=markdownPoints(reply);if(points===null)return null
 if(!points.length){
  const list=require('../intake/documentEnumeration').verifiedDocumentLists(reply)[0]
  if(list)for(const item of list.items.slice(0,3)){if(item.length>400)return null;points.push('- '+item)}
 }
 const locale=/[\u3400-\u9fff]/.test(message)?'zh':'en'
 const gaps=report?.gaps?.length||report?.sections?.some(s=>!['ok','partial'].includes(s.state))||report?.crossSourceReads?.some(s=>s.state!=='sampled')
 const boundary=[t('planningAdvice.boundary',{},locale),...(gaps?[t('planningAdvice.sourceGaps',{},locale)]:[]),
  ...(require('../memory/capturePolicy').exclusionReason(message)==='owner_opt_out'?[t('planningAdvice.captureBoundary',{},locale)]:[])]
 return{reply:[conclusion,points.join('\n'),boundary.join(' ')].filter(Boolean).join('\n\n'),details:reply,points:points.length}
}
function unavailable(message){return t('planningAdvice.unavailable',{},/[\u3400-\u9fff]/.test(message)?'zh':'en')}
module.exports={isPlanningAdvice,compactPlanningAdvice,unavailable}
