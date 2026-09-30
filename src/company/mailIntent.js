'use strict'
function parseMailRequest (message) {
  if (typeof message !== 'string' || /不要|唔好|別讀|例如|如果|假設|寄出|發送|发送|轉寄|删除|刪除|幫我寄|帮我寄|do not|example|send|delete|forward/i.test(message)) return null
  const value = message.trim().replace(/^香香[，,\s]*/, '').replace(/^(?:請|请|幫我|帮我)\s*/, '')
  const memory = /^(?:查看|搜尋|搜索)?行政部(?:電郵|郵件)?(?:記憶|待辦)(?:\s*[:：]\s*(.*))?[。？?]?$/u.exec(value)
  if (memory) return { mode: 'memory', q: memory[1] || '' }
  const full = /^(?:讀取|查看|打開|打开)?行政部(?:電郵|郵件|信件|邮件)全文\s*[:：]?\s*([a-f0-9]{1,100})[。！!?？]?$/i.exec(value)
  if (full) return { mode: 'read', id: full[1] }
  const search = /^(?:搜尋|搜索|查找)行政部(?:電郵|郵件|信件|邮件)\s*[:：]\s*(.+)$/u.exec(value)
  if (search) return { mode: 'search', q: search[1] }
  if (!/^(?:(?:查看|整理|總結|总结|看看|查下)\s*)?(?:(?:今天|今日|最新|最近)的?)?行政部/u.test(value)) return null
  if (!/電郵|郵件|信箱|邮件|跟進|跟进/.test(value)) return null
  return { mode: 'summary', today: /今日|今天/.test(value) }
}
module.exports = { parseMailRequest }
