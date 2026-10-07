'use strict'
const {t}=require('../i18n/t')
const language=message=>/[\u3400-\u9fff]/.test(message)?'zh':'en'
function renderSemanticAnswer(review,{message=''}={}){
 if(!review?.accepted?.length)return null
 const locale=language(message),lines=review.accepted.map(c=>c.text)
 if(review.withheld.length)lines.push(t('investigation.semanticWithheld',{count:review.withheld.length},locale))
 lines.push(t('investigation.semanticBoundary',{},locale))
 return lines.join('\n\n')
}
function fallbackBrief(report,{message=''}={}){
 const locale=language(message)
 return (report?.focus==='cost'?t('investigation.semanticCostFallback',{},locale)+'\n\n':'')+t('investigation.semanticFallback',{},locale)
}
function reviewUnavailable({message=''}={}){return t('investigation.semanticUnavailable',{},language(message))}
module.exports={renderSemanticAnswer,fallbackBrief,reviewUnavailable}
