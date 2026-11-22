'use strict'

const principle = /理念|價值觀|价值观|核心價值|核心价值|(?:經營|经营|管理|做事|帶團隊|带团队)原則|(?:經營|经营)哲學|\b(?:principles?|philosophy|values|mission)\b/i
const aroma = /\bAroma\b|餐飲|餐饮|餐廳|餐厅/i
const personal = /個人|个人|做事|帶團隊|带团队/
const topicOf = text => aroma.test(text) ? 'aroma' : personal.test(text) ? 'personal' : null

function safeQuote(text) {
  return typeof text === 'string' && text.trim() !== '' &&
    !require('./capturePolicy').exclusionReason(text,false) &&
    !require('../intake/redlinePolicy').checkRedLine(text).blocked
}

function approvedPrinciple(row, now) {
  return row?.status === 'active' && (!row.expiresAt || row.expiresAt > now) &&
    typeof row.subject === 'string' && principle.test(row.subject) &&
    row.approval?.kind === 'owner' && row.approval.actor === 'owner' &&
    safeQuote(row.text) && row.approval.contentHash === require('node:crypto').createHash('sha256').update(row.text).digest('hex')
}

const historyMatch = (text, query) => text.toLowerCase().includes(query.toLowerCase())

module.exports = {principle, topicOf, approvedPrinciple, safeQuote, historyMatch}
