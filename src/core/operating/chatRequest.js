'use strict'
// A complete, explicit command. Quoted examples, negation and compound requests
// stay with ordinary conversation routing instead of triggering source reads.
function isBriefingRequest (message) {
  if (typeof message !== 'string') return false
  const value = message.trim().replace(/[。！!？?]+$/, '').trim()
  return /^(?:香香[，,\s]*)?(?:(?:請|幫我|请|帮我)\s*)?(?:(?:整理|生成|查看|提供|給我|给我)\s*)?(?:今日|今天)(?:的)?(?:營運|營業|营运|营业)簡報$/u.test(value) ||
    /^(?:please\s+)?(?:(?:show|prepare|give)\s+(?:me\s+)?)?(?:today'?s?\s+|daily\s+)(?:operations|operating)\s+briefing$/i.test(value)
}
function sameOrigin (req) {
  const host = req.get('host')
  return ['127.0.0.1:8090', 'localhost:8090'].includes(host) && req.get('origin') === 'http://' + host && req.get('sec-fetch-site') !== 'cross-site'
}
module.exports = { isBriefingRequest, sameOrigin }
