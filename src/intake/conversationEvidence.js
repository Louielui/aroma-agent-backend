'use strict'

// This is an evidence type for the existing reply guard, not business read rows.
// Only the HTTP composition root calls the issuer, with the full store.get()
// transcript, before any prompt truncation. Browser history/model JSON cannot
// serialize an attestation. No transcript text is exposed in the issued token.
const issued = new WeakMap()
const {cjkToNumber} = require('./answerPlan')

function fromSavedConversation(saved, message) {
  const messages = saved?.messages
  if (!Array.isArray(messages) || messages.length % 2 !== 0 || typeof message !== 'string') return null
  const owners = []
  for (let i = 0; i < messages.length; i++) {
    const entry = messages[i]
    if (entry?.role !== (i % 2 === 0 ? 'user' : 'assistant')) return null
    const text = typeof entry.text === 'string' ? entry.text : entry.content
    if (typeof text !== 'string' || !text.trim()) return null
    if (entry.role === 'user') owners.push(text.trim())
  }
  owners.push(message.trim()) // Current input is not in the saved prior transcript.
  const first = owners[0]
  // A literal, substantial repeated request is provable. Semantic similarity,
  // short acknowledgements and mixed-topic histories are deliberately unknown.
  const repeated = owners.length > 1 && first.length >= 24 && owners.every(text => text.startsWith(first))
  const token = Object.freeze({kind: 'saved_conversation', ownerMessages: owners.length})
  issued.set(token, Object.freeze({ownerMessages:owners.length,
    currentMessageOccurrences:owners.filter(text=>text===message.trim()).length,
    firstRequestPrefixOccurrences:repeated?owners.length:null}))
  return token
}

function checkConversationClaim(clause, token) {
  // A bounded grammatical claim type (ordinal + speech act + same topic), not
  // a specific count/sentence exception. No trailing operational predicate fits.
  const text = String(clause).trim().replace(/^[-*+]\s+/u, '')
  const match = text.replace(/[。．.!！,，；;—]$/u,'').match(/^(?:(?:這|这)(?:已經|已经)?是)?你(?:已經|已经)?第\s*([0-9零〇一二兩三四五六七八九十百千萬]+)\s*次(?:提出|提起|提及|詢問|询问|問到|问到|重複|重复|發送|发送|發|发|說|说|講|讲)(.+)$/u)
  if (!match) return null
  const exactMessage=/^(?:(?:同一|這|这)(?:段|句)(?:話|话|文字)|(?:同一|這|这)(?:則|则)(?:訊息|信息)|相同的(?:訊息|信息|文字))$/u.test(match[2])
  const firstRequest=/^(?:同一個|同一个|這個|这个)(?:構想|构想|想法|要求|問題|问题)$/u.test(match[2])
  if(!exactMessage&&!firstRequest)return null
  const count = /^\d+$/.test(match[1]) ? Number(match[1]) : cjkToNumber(match[1])
  const evidence = token && typeof token === 'object' ? issued.get(token) : null
  const expected=exactMessage?evidence?.currentMessageOccurrences:evidence?.firstRequestPrefixOccurrences
  return {kind:exactMessage?'conversation_exact_message_count':'conversation_request_prefix_count',supported:Number.isSafeInteger(count)&&Number.isSafeInteger(expected)&&count===expected}
}

// The same immutable receipt informs generation and review. A serialized token
// cannot introduce counts into a prompt or attest business records.
function promptFacts(token){return token&&typeof token==='object'?issued.get(token)||null:null}
module.exports = {fromSavedConversation, checkConversationClaim, promptFacts}
