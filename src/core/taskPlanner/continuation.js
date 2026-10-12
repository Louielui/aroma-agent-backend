'use strict'
const { classify, hash } = require('./contract')
const TTL = 30 * 60 * 1000
const normalize = text => String(text || '').replace(/side\s+bar/ig, 'sidebar')
// A positive acknowledgement is optional, but an explicit start or instruction
// to follow the current suggestion is required. This closed grammar cannot add
// a target, path, second action or authority; the host-owned receipt supplies it.
const confirmation = text => typeof text === 'string' && /^(?:(?:很?好(?:的|啊|呀|嘅)?|同意|可以(?:的|啊)?|沒問題|ok(?:ay)?|great|sounds good)[,，、!！\s]*)?(?:請)?(?:開始(?:改良|改善|規劃|做|尹良)?|(?:就)?(?:照|按)(?:你(?:的)?|上述|剛才)(?:的)?建議(?:開始(?:改良|改善|規劃|做)?|做)|go ahead|start)(?:吧|啦|喇)?[。.!！\s]*$/i.test(text.trim())
const advice = text => /(?:建議|認為|覺得|討論|好嗎|好不好|suggest|recommend|what do you think)/i.test(text)
const target = text => /(?:sidebar|側欄|聊天頁面|對話頁|chat page|composer)/i.test(text)
const refinement = text => /(?:功能\s*bar|頂部|頁面上方|選單|top\s*bar|toolbar)/i.test(text)
const navigation = text => /(?:功能\s*(?:bar|列)|top\s*bar|toolbar|navigation\s*bar)/i.test(text)
const foreignNavigation = text => /(?:GPT|Codex|Google\s*Drive|Gmail|Calendar|其他網站|其他專案)\s*(?:的\s*)?(?:功能\s*(?:bar|列)|top\s*bar|toolbar|navigation\s*bar)/i.test(text)
const excluded = text => /(?:production|Aroma\s*System|正式餐廳|\.env|[a-z]:[\\/]|\.\.[\\/]|寄信|寄出|send email|批准|approval|執行命令)/i.test(text)
function validOffer(offer, revision, now = Date.now()) {
  return !!offer && Object.keys(offer).sort().join(',') === 'createdAt,digest,message,profile,revision' &&
    /^[a-f0-9]{40}$/.test(revision || '') && offer.revision === revision &&
    Number.isFinite(Date.parse(offer.createdAt)) && now >= Date.parse(offer.createdAt) && now - Date.parse(offer.createdAt) < TTL &&
    typeof offer.message === 'string' && !excluded(offer.message) &&
    ['interface','chat'].includes(offer.profile) && classify(offer.message)?.profile === offer.profile &&
    offer.digest === hash(JSON.stringify([offer.message,offer.profile,offer.revision,offer.createdAt]))
}
// A current Owner discussion creates a host-owned, bounded planning receipt.
// Assistant prose and browser history are never consulted. This receipt permits
// only committed-source planning; registration, coding and adoption stay separate.
function makeOffer(message, mode, prior, revision, now = Date.now()) {
  const text = normalize(message)
  if (!['recommend','chat'].includes(mode) || !advice(text) || excluded(text) || foreignNavigation(text) || !/^[a-f0-9]{40}$/.test(revision || '')) return null
  let request
  if (target(text)) request = '規劃香香介面：' + text
  else if (refinement(text) && validOffer(prior,revision,now)) request = prior.message + ' Owner refinement: ' + text
  // A standalone navigation question is bounded to this app's fixed sidebar
  // profile. Generic positioning and another application's toolbar are not a
  // target; comparisons alone never expand the editable source profile.
  else if (navigation(text)) request = '規劃香香介面：側欄功能導覽。Owner request: ' + text
  else return null
  const profile = classify(request)?.profile
  if (!['interface','chat'].includes(profile)) return null
  const offer = { message:request,profile,revision,createdAt:new Date(now).toISOString() }
  offer.digest=hash(JSON.stringify([offer.message,offer.profile,offer.revision,offer.createdAt]))
  return offer
}
function resolveConfirmation(message, conversation, revision, now = Date.now()) {
  if (!confirmation(message)) return null
  const last = conversation?.messages?.at(-1)
  if (last?.role !== 'assistant') return { clarification:true }
  if (typeof last.taskPlanRunId === 'string') return { runId:last.taskPlanRunId }
  if (!validOffer(last.planningOffer,revision,now)) return { clarification:true }
  // Stable across HTTP retries and an uncertain conversation append. The planner
  // persists this request identity before dispatch, so a new browser UUID cannot
  // issue the same planning receipt twice.
  const h = last.planningOffer.digest
  return { message:last.planningOffer.message,profile:last.planningOffer.profile,requestId:[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20,32)].join('-') }
}
module.exports = { makeOffer, resolveConfirmation, confirmation, validOffer }
