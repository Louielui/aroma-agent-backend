'use strict'
// Canned conversational replies, not interface labels or model instructions.
// Only the verified program result reaches this renderer; no action is implied.
function renderTransfer(result,locale){
 const {feasible,unit}=result,en=locale==='en'
 if(!feasible){const {total,required}=result;return en
  ?`Under your supplied assumptions, the total of ${total} ${unit} is insufficient for the combined minimum of ${required} ${unit}. The shortfall is ${required-total} ${unit}; transfers alone cannot satisfy it.`
  :`按你個假設，總數只有 ${total} ${unit}，未夠各店合計最少要嘅 ${required} ${unit}。仲差 ${required-total} ${unit}，只靠調貨做唔到。`}
 const moves=result.transfers.length?result.transfers.map(r=>en?`move ${r.quantity} ${unit} from ${r.from} to ${r.to}`:`${r.from}調 ${r.quantity} ${unit}畀${r.to}`).join(en?'; ':'；'):en?'no transfer is needed':'唔使調貨'
 const balances=result.locations.map(r=>en?`${r.entity} has ${r.quantity} ${unit}`:`${r.entity}剩 ${r.quantity} ${unit}`).join(en?', ':'，')
 return en?`Under your supplied assumptions, ${moves}; this minimizes the total quantity moved. Afterwards, ${balances}.`:`按你個假設，${moves}，咁樣搬動最少。之後${balances}。`
}

function renderPrep ({locations,product,each,batch,total,batches,spare}) {
 const needs = locations.map(({name,quantity}) => `${name} ${quantity} 份`).join('、')
 const remainder = spare > 0 ? `如果按整${batch}做，會多 ${spare} 份。` : ''
 return `按你個假設，${needs}，合共 ${total} 份${product}。每${batch} ${each} 份，中央做 ${batches} ${batch}。${remainder}`
}

function renderPeriodAnalysis (metrics) {
 const number = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2, useGrouping: false })
 const format = n => number.format(n)
 const direction = n => n < 0 ? '跌' : '升'
 const movement = n => n === 0 ? '持平（0%）' : direction(n) + ' ' + format(Math.abs(n)) + '%'
 const { beforeAverage, afterAverage, averageComparison, beforeShare, afterShare } = metrics
 const average = averageComparison === 0n
  ? '兩期每單收入都係 ' + format(beforeAverage) + ' 加元，營業額變化來自訂單量。'
  : '每單收入由 ' + format(beforeAverage) + ' 加元' + (averageComparison < 0n ? '跌' : '升') + '到 ' + format(afterAverage) + ' 加元。'
 const shareDelta = afterShare - beforeShare
 const shareChange = shareDelta === 0 ? '，比例持平' : '，' + direction(shareDelta) + '約 ' + format(Math.abs(shareDelta)) + ' 個百分點'
 return [
  '已知\n- 營業額' + movement(metrics.revenueChange) + '，訂單' + movement(metrics.orderChange) + '。' + average,
  '- 食材採購入帳額' + movement(metrics.purchaseChange) + '，佔營業額由 ' + format(beforeShare) + '% 變到約 ' + format(afterShare) + '%' + shareChange + '。未調整期初同期末庫存，採購入帳額唔等於實際食材耗用。',
  '可能原因\n單價同入貨量可能有變，亦可能同補庫存或入帳時點有關。現有數字未能確認成因。',
  '先核對\n逐項比較兩期採購單價同入貨量，分清係價變定量變。再對收貨同期初、期末盤點，分清多買咗定實際用多咗。'
 ].join('\n')
}

function calculationAnswer (reply, requestId) {
 return {blocked:false,mode:'chat',intent:'question',talkOnly:true,interactionMode:'chat',
  reply,replyForArchive:reply,utility:'supplied_calculation',readClaimCorrected:false,
  decision:null,tasks:[],risks:[],next_step:'',requestId}
}
module.exports={renderTransfer,renderPrep,renderPeriodAnalysis,calculationAnswer}
