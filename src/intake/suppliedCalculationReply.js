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

function calculationAnswer (reply, requestId) {
 return {blocked:false,mode:'chat',intent:'question',talkOnly:true,interactionMode:'chat',
  reply,replyForArchive:reply,utility:'supplied_calculation',readClaimCorrected:false,
  decision:null,tasks:[],risks:[],next_step:'',requestId}
}
module.exports={renderTransfer,renderPrep,calculationAnswer}
