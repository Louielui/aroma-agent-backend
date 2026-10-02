'use strict'

// A closed Owner-command entrance to existing capabilities. Untrusted context
// cannot choose a worker, supply a path, expand permissions or request execution.
const { isDevelopmentPlanRequest } = require('../core/developmentPlan/service')
function routeWorkRequest (message) {
  if (typeof message !== 'string' || message.length > 500) return null
  if (isDevelopmentPlanRequest(message)) return { recipe: 'development-proposal-v1', capability: 'DevelopmentProposal', version: 1, service: 'developmentPlan', url: '/development-plan' }
  const value = message.trim().replace(/[。！!？?]+$/, '').trim()
  if (/^(?:香香[，,\s]*)?(?:請|幫我)?(?:檢查|診斷)(?:自己|香香)(?:目前|現在)?(?:的)?(?:程式|代碼|程式碼)(?:[，,]\s*|並)(?:提出|列出)(?:問題證據和修正方案|問題、證據和修正方案|診斷報告與修正方案)$/u.test(value) || /^diagnose xiangxiang code and propose evidence-based fixes$/i.test(value)) {
    return { recipe: 'xiangxiang-code-diagnosis-v1', capability: 'CodeDiagnosis', version: 1, service: 'codeDiagnosis', url: '/code-diagnosis' }
  }
  return null
}
module.exports = { routeWorkRequest }
