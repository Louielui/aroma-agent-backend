'use strict'

const { ownerSources } = require('./conversationEvidence')
const { renderPeriodAnalysis } = require('./suppliedCalculationReply')

// Consume the whole Owner message, including any transcript wrapper. A read,
// write, extra question, mixed currency, or unbound operand falls through.
const transcriptHeader = '以下係同一題嘅完整前文同問題。請答最後一則使用者問題，用廣東話。只根據所給資料，毋須查網或使用工具。'
const intro = /^(?:以下係)?同一間虛構(?:\s+Aroma)?\s*門市兩個相鄰(?:四星期|期間)嘅比較。兩段營業日數相同，金額用加元。/u
const integer = '(?:[0-9]{1,3}(?:,[0-9]{3}){1,2}|[0-9]{1,9})'
const money = '(' + integer + '(?:\\.[0-9]{1,2})?)'
const period = new RegExp('^(前期|上期|今期|本期)營業額\\s*' + money + '、訂單\\s*(' + integer + ')、食材(?:開支|採購入帳額)\\s*' + money + '。', 'u')
const basis = /^(?:食材開支係採購入帳金額，未調整期初同期末庫存。)(?:冇提供採購單價、用量、盤點或報廢明細。)?/u
const question = /^(點解營業額跌咗，但食材開支升咗[？?]|兩期營業額、訂單同採購入帳額有咩變化[？?])請根據上面資料，分開講已知、可能原因同你會先核對咩[。.]?$/u

function cents(value) {
  const [whole, fraction = ''] = value.replaceAll(',', '').split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

function readPeriod(text, labels) {
  const row = period.exec(text)
  if (!row || !labels.includes(row[1])) return null
  const revenue = cents(row[2])
  const orders = Number(row[3].replaceAll(',', ''))
  const purchases = cents(row[4])
  if (revenue === 0 || orders === 0) return null
  return { revenue, orders, purchases, rest: text.slice(row[0].length) }
}

function analyze(message, token) {
  if (typeof message !== 'string' || ownerSources(token)?.at(-1) !== message.trim()) return null
  let text = message.trim().replace(/\r\n/g, '\n')
  if (text.length > 900) return null
  if (text.startsWith(transcriptHeader)) {
    const lines = text.split('\n')
    if (lines.length !== 4 || lines[0] !== transcriptHeader || lines[1] !== '' ||
        !lines.slice(2).every(line => line.startsWith('使用者：'))) return null
    text = lines.slice(2).map(line => line.slice('使用者：'.length)).join('')
  }
  const header = intro.exec(text)
  if (!header) return null
  const before = readPeriod(text.slice(header[0].length), ['前期', '上期'])
  if (!before || before.purchases === 0) return null
  const after = readPeriod(before.rest, ['今期', '本期'])
  if (!after) return null
  const note = basis.exec(after.rest)
  const ask = note && question.exec(after.rest.slice(note[0].length))
  if (!ask || (ask[1].startsWith('點解') &&
      !(after.revenue < before.revenue && after.purchases > before.purchases))) return null
  const change = (start, end) => 100 * (end - start) / start
  const share = row => 100 * row.purchases / row.revenue
  const reply = renderPeriodAnalysis({
    revenueChange: change(before.revenue, after.revenue),
    orderChange: change(before.orders, after.orders),
    purchaseChange: change(before.purchases, after.purchases),
    beforeAverage: before.revenue / before.orders / 100,
    afterAverage: after.revenue / after.orders / 100,
    averageComparison: BigInt(after.revenue) * BigInt(before.orders) - BigInt(before.revenue) * BigInt(after.orders),
    beforeShare: share(before),
    afterShare: share(after)
  })
  return reply
}

module.exports = { analyze }
