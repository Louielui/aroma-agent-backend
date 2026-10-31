'use strict'

// A closed Owner-command entrance to existing capabilities. Untrusted context
// cannot choose a worker, supply a path, expand permissions or request execution.
const { isDevelopmentPlanRequest } = require('../core/developmentPlan/service')
function routeWorkRequest (message) {
  if (typeof message !== 'string' || message.length > 500) return null
  if (require('../core/codeDiagnosis/chat').parseRequest(message) === 'dispatch') return { recipe: 'xiangxiang-code-diagnosis-v1', capability: 'CodeDiagnosis', version: 1, service: 'codeDiagnosis', url: '/code-diagnosis' }
  if (isDevelopmentPlanRequest(message)) return { recipe: 'development-proposal-v1', capability: 'DevelopmentProposal', version: 1, service: 'developmentPlan', url: '/development-plan' }
  const value = message.trim().replace(/[。！!？?]+$/, '').trim()
  if (/^(?:(?:香香|Imagine|Xiangxiang)[，,\s]*)?(?:請|幫我)?跟進最新診斷(?:[，,]\s*|並)準備受控修正$/iu.test(value) || /^prepare controlled repair for the latest diagnosis$/i.test(value)) return { recipe: 'xiangxiang-controlled-repair-v1', capability: 'CodeRepair', version: 1, service: 'codeRepair', url: '/code-repair' }
  if (/^(?:(?:香香|Imagine|Xiangxiang)[，,\s]*)?(?:請|幫我)?(?:檢查|診斷)(?:自己|香香|Imagine|Xiangxiang)(?:目前|現在)?(?:的)?(?:程式|代碼|程式碼)(?:[，,]\s*|並)(?:提出|列出)(?:問題證據和修正方案|問題、證據和修正方案|診斷報告與修正方案)$/iu.test(value) || /^diagnose (?:xiangxiang|imagine) code and propose evidence-based fixes$/i.test(value)) {
    return { recipe: 'xiangxiang-code-diagnosis-v1', capability: 'CodeDiagnosis', version: 1, service: 'codeDiagnosis', url: '/code-diagnosis' }
  }
  return null
}
module.exports = { routeWorkRequest }
