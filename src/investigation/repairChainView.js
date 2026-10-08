'use strict'
const {t}=require('../i18n/t')
const localeFor=message=>/[\u3400-\u9fff]/.test(message)?'zh':'en'
function nextEvidence (chain, locale) {
  switch(chain?.firstGap) {
    case 'failure':return t('investigation.repairNeedFailure',{},locale)
    case 'linked_correction':return t('investigation.repairNeedLink',{},locale)
    case 'passing_tests':return t('investigation.repairNeedTests',{},locale)
    case 'adoption':return t('investigation.repairNeedAdoption',{},locale)
    case 'current_version':return t('investigation.repairNeedVersion',{},locale)
    case 'registered_regression':return t('investigation.repairNeedRegression',{},locale)
    default:return t('investigation.repairNeedLive',{},locale)
  }
}
function renderRepairChain (chain, message='') {
  if(chain?.readOnly!==true || !Array.isArray(chain.stages))return null
  const locale=localeFor(message),labels={failure:t('investigation.repairStageFailure',{},locale),linked_correction:t('investigation.repairStageLink',{},locale),passing_tests:t('investigation.repairStageTests',{},locale),adoption:t('investigation.repairStageAdoption',{},locale),current_version:t('investigation.repairStageVersion',{},locale),registered_regression:t('investigation.repairStageRegression',{},locale),live_failure_verification:t('investigation.repairStageLive',{},locale)}
  const safe=v=>String(v||'').replace(/[<>`\r\n]/g,' ').slice(0,160)
  const state=value=>value==='CONFIRMED'?t('investigation.repairObserved',{},locale):value==='SUPPORTED'?t('investigation.repairSupported',{},locale):value==='UNAVAILABLE'?t('investigation.repairUnavailable',{},locale):value==='CONTRADICTED'?t('investigation.repairConflict',{},locale):t('investigation.repairMissing',{},locale)
  return [t('investigation.repairChainTitle',{},locale),...chain.stages.map(s=>t('investigation.repairChainRow',{stage:labels[s.key]||safe(s.key),state:state(s.state)},locale)+(s.references.length?' — '+s.references.slice(0,3).map(r=>safe(r.sourceId)+' / '+safe(r.recordId)).join('; '):'')),nextEvidence(chain,locale)].join('\n')
}
module.exports={renderRepairChain,nextEvidence}
