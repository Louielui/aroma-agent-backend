'use strict'
const {t}=require('../i18n/t')
const {renderCostFindings}=require('./costFindings')
const {renderRuntimeSummary}=require('./operationalBrief')

const localeFor=message=>/[\u3400-\u9fff]/.test(message)?'zh':'en'
const readable=section=>section&&['ok','partial'].includes(section.state)
const safeValue=value=>typeof value==='string'&&value.length>0&&value.length<=160&&
  !/[<>\r\n`]/.test(value)?value:null
const inline=value=>'`'+value.replace(/[\\`]/g,' ')+'`'

// Shared presentation boundary for registered, read-only Owner investigations.
// A finding is admitted only from one readable section and one uniquely identified
// record. The full receipt stays in the report; the answer carries its exact source.
function renderWorkFailure(report,{message=''}={}){
 if(report?.continuity)return null // Follow-ups need their same-record comparison.
 const sections=(report.sections||[]).filter(s=>s.section==='work'&&readable(s)&&safeValue(s.sourceId))
 if(sections.length!==1)return null
 const section=sections[0],records=Array.isArray(section.records)?section.records:[]
 const id=safeValue(section.latestFailureId)
 const candidates=id?records.filter(r=>r?.sourceId===id):records.filter(r=>r?.state==='failed')
 if(candidates.length!==1)return null
 const record=candidates[0]
 if(record.state!=='failed'||(record.fixedInCurrentVersion!==null&&record.fixedInCurrentVersion!==undefined)||
   report.contradictions?.some(x=>x.sourceId===section.sourceId&&x.recordId===record.sourceId)||
   !safeValue(record.sourceId)||!safeValue(record.reason)||
   records.filter(r=>r?.sourceId===record.sourceId).length!==1)return null
 const locale=localeFor(message),references=[{sourceId:section.sourceId,recordId:record.sourceId,
  fields:{state:record.state,reason:record.reason}}]
 return {version:1,kind:'work_failure',text:[
  t('investigation.briefFailure',{id:inline(record.sourceId),reason:inline(record.reason)},locale),
  t('investigation.briefFixUnknown',{},locale),
  t('investigation.briefFailureRecommendation',{},locale)
 ].join('\n\n'),references,scope:'one_sampled_failed_work_record_not_current_repair',modelProseUsed:false}
}

function renderSourceBoundFindings(report,{message='',plan=null}={}){
 if(report?.readOnly!==true||!Array.isArray(report.sections))return null
 const scoped=result=>{
  if(!result||!Array.isArray(plan?.facts))return result
  // A fact with no resolved operation is not a named, omitted source.
  const outside=plan.facts.filter(f=>f.operation&&f.operation!=='xiangxiang_operations')
  if(!outside.length||outside.every(f=>report.crossSourceReads?.some(r=>r.source===f.operation&&r.state==='sampled')))return result
  return {...result,text:result.text+'\n\n'+t('investigation.otherSourcesNotVerified',{},localeFor(message)),otherSourcesNotVerified:true}
 }
 if(report.focus==='cost'){
  const result=renderCostFindings(report,{message})
  return scoped(result?{...result,kind:'cost'}:null)
 }
 if(report.focus==='work_failure')return scoped(renderWorkFailure(report,{message}))
 if(report.focus==='background'){
  const result=renderRuntimeSummary(report,{message})
  return scoped(result?{...result,kind:'background',modelProseUsed:false}:null)
 }
 return null // General investigations still require the reviewed semantic path.
}
module.exports={renderSourceBoundFindings}
