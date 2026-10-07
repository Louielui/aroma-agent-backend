'use strict'
const {t}=require('../i18n/t')
const code=v=>'`'+String(v).replace(/[`\\\r\n]/g,' ').slice(0,240)+'`'
function workflowTitle(role){
 switch(role){
 case 'test_draft':return t('investigation.testDraftWorkflow',{},'en')
 case 'development':return t('investigation.developmentWorkflow',{},'en')
 case 'review':return t('investigation.reviewWorkflow',{},'en')
 case 'adoption':return t('investigation.adoptionWorkflow',{},'en')
 default:return null
 }
}
// The legacy prose-name gate is built for Cantonese answers with Latin entity
// names. Do not weaken that protection or expand its vocabulary to arbitrary
// English. This bounded English presentation uses only the observed operational
// receipt fields and fixed uncertainty/recommendation text, never model prose.
// Script detection chooses presentation only; the judged focus and Owner read
// have already determined access and this module cannot request any operation.
function renderOperationalBrief(report,{message=''}={}){
 if(report?.readOnly!==true||!Array.isArray(report.sections)||!/[A-Za-z]/.test(message)||/[\u3400-\u9fff]/.test(message))return null
 const section=name=>report.sections.find(s=>s.section===name&&['ok','partial'].includes(s.state))
 const lines=[]
 if(report.focus==='work_failure'){
  const work=section('work'),records=work?.records||[]
  const failed=records.find(r=>r.sourceId===work.latestFailureId&&r.state==='failed')||records.find(r=>r.state==='failed')
  if(failed)lines.push(t('investigation.briefFailure',{id:code(failed.sourceId),reason:failed.reason?code(failed.reason):t('investigation.briefNotRecorded',{},'en')},'en'))
  else lines.push(t('investigation.briefNoFailure',{},'en'))
  lines.push(t('investigation.briefFixUnknown',{},'en'),t('investigation.briefFailureRecommendation',{},'en'))
 }else if(report.focus==='background'){
  lines.push(t('investigation.briefBackground',{},'en'))
  const schedules=section('schedules')
  for(const r of (schedules?.records||[]).slice(0,20)){
   const state=r.state==='PAUSED'?t('investigation.paused',{},'en'):r.state==='NOT_INSTALLED'?t('investigation.notInstalled',{},'en'):r.state?code(r.state):t('investigation.briefNotRecorded',{},'en')
   lines.push(t('investigation.briefSchedule',{name:code(r.name||r.sourceId),state,model:r.model?code(r.model):t('investigation.briefNotRecorded',{},'en')},'en'))
  }
  if(!schedules?.records?.length)lines.push(t('investigation.briefNoSchedules',{},'en'))
  const work=section('work')
  for(const w of (work?.workflows||[]).slice(0,5)){
   const title=workflowTitle(w.role)
   if(!title||w.modelBasis!=='host_workflow_default_not_per_job_selection')continue
   lines.push(t('investigation.briefWorkflow',{role:title,state:['idle','occupied'].includes(w.state)?code(w.state):t('investigation.briefNotRecorded',{},'en'),model:w.model?code(w.model):t('investigation.briefNotRecorded',{},'en'),at:w.at?code(w.at):t('investigation.briefNotRecorded',{},'en')},'en'))
  }
  const config=section('configuration')?.records?.find(r=>r.role==='central_brain_default')
  if(config?.model)lines.push(t('investigation.briefCentral',{model:code(config.model),effort:config.effort?code(config.effort):t('investigation.briefNotRecorded',{},'en')},'en'))
  lines.push(t('investigation.briefActivityUnknown',{},'en'),t('investigation.briefBackgroundRecommendation',{},'en'))
 }else return null
 return lines.join('\n\n')
}
module.exports={renderOperationalBrief}
