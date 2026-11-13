'use strict'
// Presentation only. No source reads, authority decisions or model instructions.
const {t}=require('../i18n/t')
const {validReceipt}=require('./delegationEvidence')
function renderDelegation(input){
 if(input.answerKind!=='capability_explanation'||input.capabilityReadSettled!==true||input.ownerGoalReporting===true)return null
 const rows=(input.itemsBySource||[]).filter(g=>g.source==='xiangxiang_operations').flatMap(g=>g.items||[]).filter(r=>r.source==='xiangxiang_operations'&&r.trust==='live'&&r.fields?.section==='delegation')
 if(rows.length!==1||!validReceipt(rows[0].fields))return null
 const row=rows[0],v=row.fields,groups=new Map()
 for(const r of v.records){if(!r.model||r.enabled===false||r.selection==='none')continue;const name=r.resolvedModel||r.model;if(!groups.has(name))groups.set(name,[]);groups.get(name).push(r)}
 const lines=[...groups].slice(0,6).map(([model,rows])=>'- '+model+' — '+[...new Set(rows.map(r=>r.role))].join(' / ')+' ('+(rows.every(r=>r.subscription==='catalogue_available')?t('rrv.delegationMetadataReady'):t('rrv.delegationMetadataUnknown'))+')')
 if(!groups.size)lines.push(t('rrv.delegationNoEnabledModel'))
 if(groups.size>6)lines.push(t('rrv.delegationMore'))
 const details=JSON.stringify({scope:v.scope,coverage:v.coverage,observedAt:v.observedAt,bootCommit:v.bootCommit,channels:v.records,legacyRoles:v.legacyRoles,recipes:v.recipes,providerStates:v.providerStates,modelChoices:v.modelChoices,catalogueCount:v.catalogueCount,dispatchVerified:false},null,2)
 return {reply:[t('rrv.delegationModels'),lines.join('\n'),t('rrv.delegationBoundary'),...(v.scopeComplete?[]:[t('rrv.delegationPartial')])].join('\n\n'),details,validation:{kind:'delegation_source_projection',boundDelegationFacts:v.records.length,sourceIds:['xiangxiang_operations#'+row.sourceId],dispatchVerified:false}}
}
module.exports={renderDelegation}
