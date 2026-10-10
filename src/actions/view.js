'use strict'
const {t,currentLocale}=require('../i18n/t')
function page () {
  const labels={reconcile:t('actions.reconcile'),bridgeReady:t('actions.bridgeReady'),bridgeOffline:t('actions.bridgeOffline'),bridgeChecking:t('actions.bridgeChecking'),bridgeRecovering:t('actions.bridgeRecovering'),readbacks:{MATCHES_DESIRED:t('actions.readbackMatchesDesired'),DIFFERS_FROM_DESIRED:t('actions.readbackDiffersFromDesired'),DEFINITION_CHANGED:t('actions.readbackDefinitionChanged'),NOT_IDLE:t('actions.readbackNotIdle'),UNAVAILABLE:t('actions.readbackUnavailable')},title:t('actions.title'),intro:t('actions.intro'),inspect:t('actions.inspect'),pause:t('actions.pause'),resume:t('actions.resume'),approve:t('actions.approve'),restore:t('actions.restore'),busy:t('actions.busy'),unknown:t('actions.unknown'),impact:t('actions.impact'),rollback:t('actions.rollback'),history:t('actions.history'),failure:t('actions.failure'),confirm:t('actions.confirm'),enabled:t('actions.enabled'),disabled:t('actions.disabled'),unavailable:t('actions.unavailable'),verified:t('actions.verified'),pending:t('actions.pending'),evidence:t('actions.evidence')}
  return require('node:fs').readFileSync(require('node:path').join(__dirname,'view.html'),'utf8').replace('/*LOCALE*/',currentLocale()).replace('/*LABELS*/',JSON.stringify(labels).replace(/</g,'\\u003c'))
}
module.exports={page}
