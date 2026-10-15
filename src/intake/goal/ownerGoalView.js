'use strict'
const {t}=require('../../i18n/t')
function renderGoal(g){
 const state=g.status==='GOAL_COMPLETED'?t('ownerGoal.completed'):g.status==='GOAL_PARTIAL'?t('ownerGoal.partial'):t('ownerGoal.incomplete')
 const rows=g.outcomes.map(o=>'- '+o.ownerQuote+' — '+(o.status==='COMPLETED_WITH_EVIDENCE'?t('ownerGoal.verified'):o.status==='AUTHORIZATION_REQUIRED'?t('ownerGoal.authorization'):o.status==='AVAILABLE'?t('ownerGoal.available'):o.status==='BLOCKED'?t('ownerGoal.blocked'):t('ownerGoal.unavailable')))
 // Action progress is composed only from host metadata. A draft sentence can
 // neither claim execution nor erase an unresolved mandatory outcome.
 return ['### '+t('ownerGoal.heading'),state,...rows,...g.constraints.map(s=>t('ownerGoal.constraint',{text:s})),...(g.status==='GOAL_COMPLETED'?[]:[t('ownerGoal.investigationOnly')])].join('\n\n')
}
module.exports={renderGoal}
