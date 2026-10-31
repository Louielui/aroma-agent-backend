'use strict'
const { t } = require('../i18n/t')

// Owner-facing outcomes; model instructions stay in context.js.
function missingRecallReply(context, question = null) {
  const clarification = typeof question === 'string' && question.trim() ? question.trim() : t('memory.recallClarification')
  if (!context || context.state !== 'ok') return t('memory.unavailable') + '\n\n' + clarification
  if (context.count === 0) return t('memory.noMatchingRecall') + '\n\n' + clarification
  return null
}
function withMemoryFailureNotice(result, failures) {
  if (!result || result.blocked || !failures?.size) return result
  const prefix = t('context.memoryUnavailable') + '\n\n'
  return { ...result, contextFailures: [...failures], reply: prefix + (result.reply || ''),
    ...(typeof result.replyForArchive === 'string' ? { replyForArchive: prefix + result.replyForArchive } : {}) }
}
function enforceCapturePolicyReply(reply,message){
 const out={reply,corrected:false}
 if(typeof reply!=='string'||require('./capturePolicy').exclusionReason(message)!=='owner_opt_out'||require('../intake/generalKnowledge').generalRequestKind(message)==='supplied_text')return out
 const memory=/長期記憶|长期记忆|自動記憶|自动记忆|記憶中心|记忆中心|long.term (?:memory|storage)|memory cent(?:er|re)/i
 const denial=/(?:我|\bI\b).{0,12}(?:沒(?:有權限|辦法|法)|無法|不能|沒有辦法|cannot|can['’]t|unable|no (?:permission|ability))/i
 const followon=/記(?:下|錄)|记录|保(?:存|留)|阻止|刪除|排除|儲存|\b(?:record|sav|stor|delet|exclu|prevent)/i
 const completed=/(?:我已|已經|already|I (?:have|did)).*(?:刪除|删除|停用|disable|delet)/i
 const accessFailure=/連線|连接|連接|召回|讀取|读取|\b(?:connect|unavailable|recall|retrieve|read)\b/i
 let topic=false,changed=false
 const kept=[]
 for(const sentence of require('../intake/answerPlan').splitSentences(reply)){
  if(accessFailure.test(sentence)){topic=false;kept.push(sentence);continue}
  if(memory.test(sentence)&&(denial.test(sentence)||completed.test(sentence))&&!/回執|回执|receipt|未核對|待核對/i.test(sentence)){topic=true;changed=true;continue}
  if(topic&&(memory.test(sentence)||followon.test(sentence))){changed=true;continue}
  topic=false;kept.push(sentence)
 }
 if(!changed)return out
 const result={reply:[kept.join(' '),t('memory.captureOptOutPolicy',{},/[\u3400-\u9fff]/.test(message)?'zh':'en')].filter(Boolean).join('\n\n'),corrected:true,policy:'owner_opt_out',receipt:'not_observed'}
 const usage=require('../actions/usageBudget');if(usage.currentScope())usage.service().capture('capture_policy_guard',{policy:'owner_opt_out',input:reply,result})
 return result
}
module.exports = { missingRecallReply: (...args)=>{const result=missingRecallReply(...args),usage=require('../actions/usageBudget');if(usage.currentScope())usage.service().capture('recall_guard',{input:args,result});return result}, withMemoryFailureNotice,enforceCapturePolicyReply }
