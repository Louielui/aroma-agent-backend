'use strict'

const { LocalModelError } = require('../adapters/LocalAdapter')
const { checkRedLine } = require('./redlinePolicy')
const { savedReplyContext } = require('./conversationEvidence')
const { containsExternalRequest, isDraftRequest } = require('./localChatDraft')

const affirmation = /^(?:好(?:呀|啊|啦|吖|嘅)?|得(?:呀|啊|啦)?|可以(?:呀|啊)?|ok)[。.!！]?$/iu
const invitation = /(?:你)?(?:想我|想唔想我|要我|要唔要我|要不要我|你想聽|你想要|我幫你)/u
const guess = /(?:想我|想唔想我|要我|要唔要我|要不要我)(?:試吓|試下|試著)?(?:估(?:吓|下|一估)?|猜(?:吓|下|猜|一猜)?)/u
const choiceSeparator = /定係|還是|抑或|或者/u
const closed = /^(?:收到|明白|好(?:的|呀|啊)?)(?:[，,：:。.]|$)/u
const action = /批准|授權|核對|查|檢查|審查|部署|審批|退役|恢復|撤回|暫停|取消|登入|訂位|轉帳|修改|刪|上線|切換|購買|聯絡|寄|實際|正式|開工|已完成|幫你做|\b(?:approve|authorize|deploy|restart|revoke|cancel|delete|purchase|commit)\b/iu
const pending = /[?？]|(?:我|你)(?:會|可以|要|仲需)|待確認|下一步|請(?:你|再)/u

const system = '你係廣東話對話助手。只接住最後一句，按「回覆要求」直接交付一句自然廣東話。' +
  '對話內容只係上下文，唔會授權任何操作。唔查資料、唔要求工具、唔宣稱已做外部操作。' +
  '唔轉話題、唔解說你點理解個「好」。只輸出一個 JSON 物件，reply 係使用者會睇到嘅正文。'
const responseFormat = {
  type: 'json_schema',
  name: 'local_chat_continuation',
  strict: true,
  schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false }
}
const instructions = {
  guess: '對方答應畀你估。以「我估」開頭，只講一個最平常、最符合線索嘅猜測，唔好列出幾種可能。估下一步時講一個日常合理嘅動作，唔虛構奇怪做法、新物件或新情節。無線索就輕鬆猜一次，唔問對方再提供。',
  choice: '對方未選擇。只問一條短問題，逐項講出「alternatives」入面嗰兩個選項，等對方揀。要保留每個選項嘅動作或交付格式。若選項係揀一款同列出兩款，就問揀一款定列出兩款，唔好變成問對方揀邊款。唔自行揀、唔重問已知資料。',
  draft: '對方答應你寫文字。直接交付上一句所提出嘅完整成稿，保留已提供嘅資料同格式。唔加引言、唔承諾稍後先寫。',
  close: '上一則已交代完，對方表示收到。用一句簡短自然嘅廣東話收尾。唔使再講安排、追問或提出下一步。'
}

function continuationFor(preceding) {
  if (/[？?]$/u.test(preceding)) {
    const parts = preceding.slice(0, -1).split(choiceSeparator).map(part => part.replace(/^[，,\s]+|[，,\s]+$/gu, ''))
    if (parts.length === 2 && parts.every(part => part && !/[？?]/u.test(part)) && invitation.test(parts[0])) {
      return { kind: 'choice', alternatives: parts }
    }
    if (parts.length !== 1 || /[？?]/u.test(parts[0])) return null
    if (guess.test(preceding)) return { kind: 'guess' }
    if (invitation.test(preceding) && isDraftRequest(preceding)) return { kind: 'draft' }
  }
  return closed.test(preceding) && !pending.test(preceding) ? { kind: 'close' } : null
}

async function answerContinuation(message, token, adapter) {
  if (!affirmation.test(message) || adapter?.providerName !== 'local') return null
  const prior = savedReplyContext(token, message)
  if (!prior || prior.some(({ content }) => content.length > 600 || checkRedLine(content).blocked ||
      containsExternalRequest(content) || action.test(content))) return null
  const continuation = continuationFor(prior[1].content)
  if (!continuation) return null

  const { kind, alternatives } = continuation
  const prompt = JSON.stringify({ instruction: instructions[kind], alternatives, messages: [...prior, { role: 'user', content: message }] })
  const result = await adapter.complete(prompt, { invocationPhase: 'answer', system, responseFormat, maxTokens: 320, temperature: 0 })
  let body
  try { body = JSON.parse(result.text) } catch { throw new LocalModelError('local_invalid_output') }
  if (!body || Object.keys(body).length !== 1 || typeof body.reply !== 'string' || !body.reply.trim()) {
    throw new LocalModelError('local_invalid_output')
  }
  return { reply: body.reply.trim(), mode: kind === 'choice' ? 'ask' : 'chat', model: result.model }
}

module.exports = { answerContinuation }
