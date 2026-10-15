'use strict'
const {createHash}=require('node:crypto')
const STATE_ID='f36e9277-fbde-4401-a641-70353f741001',TARGET='daily-procurement',CONTROL='daily-procurement-control'
const DEFINITION=Object.freeze({workflow:'daily_procurement_report',definitionVersion:1,toolScopeVersion:1,time:'08:00',timezone:'America/Winnipeg',taskName:'DailyProcurementReport',taskPath:'\\AromaXiangXiang\\',operations:Object.freeze(['aroma.order_planning.list','aroma.suppliers.list'])})
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,GOAL=/^[a-f0-9]{64}$/
const TASK=/^task_[a-f0-9]{8}$/
function intent(message){
 if(typeof message!=='string'||message.length>2000||/[「」“”"`]/u.test(message)||/^(?:不要|不需要|唔好|do not\b|don't\b|never\b)/iu.test(message)||/[?？]/u.test(message))return null
 const s=message.trim();const approval=s.match(/^(?:確認|批准)(建立|新增|暫停|恢復|撤銷|修復)每日採購排程[。.!！]?$/u);if(approval)return{operation:'approve',approveOperation:{建立:'create',新增:'create',暫停:'pause',恢復:'resume',撤銷:'revoke',修復:'recover'}[approval[1]]}
 if(/^(?:查看|查詢|看看|列出|status of|show)(?:每日採購排程| daily procurement (?:report|schedule))\s*[。.!！]?$/iu.test(s))return{operation:'status'}
 const op=s.match(/^(?:請|幫我)?(暫停|恢復|撤銷|修復)每日採購排程[。.!！]?$/u);if(op)return{operation:{暫停:'pause',恢復:'resume',撤銷:'revoke',修復:'recover'}[op[1]]}
 // V1 has no alternate hour notation or zone aliases. Unknown explicit temporal
 // qualifiers stay with ordinary goal clarification, never a different fixed time.
 if(/(?:[0-9０-９一二三四五六七八九十]\s*[時时]|\bo['’]clock\b|[0-9]\s*p\.?m\.?\b|[+-][0-9]{2}:?[0-9]{2}|\b(?:evening|afternoon|noon|night)\b)/iu.test(s))return null
 const zones=s.match(/\b[A-Za-z_]+(?:\/[A-Za-z_]+){1,2}\b/g)||[]
 if(zones.some(z=>z!=='America/Winnipeg'))return null
 if(/(?:小時|分鐘|分鍾|\bhourly\b|\b(?:yearly|weekdays|weekends)\b|\bevery\s+(?!(?:day|morning|supplier|item)\b)|(?<![0-9])(?:[01][0-9]|2[0-3])[0-5][0-9](?![0-9])|\b[0-9]{1,2}\s*h\b)/iu.test(s))return null
 const at=s.match(/\bat\s+([^;\n]*)/iu)
 if(at&&!/^(?:08:00|8:00|08am|8am|8)(?=\s|$|[,.!])/iu.test(at[1]))return null
 const qualifiers=[...s.matchAll(/[0-9]{1,2}:[0-9]{2}\s*([A-Z]{2,8})\b/g)].map(m=>m[1]),tail=s.match(/[0-9]{1,2}:[0-9]{2}\s+([A-Za-z].*)$/),prefix=s.match(/\b([A-Za-z]{2,8})\s+[0-9]{1,2}:[0-9]{2}/)
 if(qualifiers.some(v=>!['AM','AND','FOR','API','SKU','PAR'].includes(v))||tail&&!/^(?:America\/Winnipeg\b|am\b|please\b|daily\b|and\b|for\b)/iu.test(tail[1])||prefix&&!['at','for','from','morning','daily'].includes(prefix[1].toLowerCase()))return null
 const times=s.match(/(?:[0-9０-９]{1,2}[:：][0-9０-９]{2}|[0-9０-９一二三四五六七八九十]{1,2}\s*點|[0-9]{1,2}\s*[ap]m)/giu)||[]
 if(/\bam\b/iu.test(s)&&!times.length)return null
 if(/(?:每週|每月|weekly|monthly|下午|晚上|點\s*(?:半|[0-9０-９一二三四五六七八九十]+(?:分|刻)?)|[0-9]{1,2}\.[0-9]{2}|America\/(?!Winnipeg\b)[A-Za-z_]+|\b(?:UTC|GMT|EST|EDT|PST|PDT)\b)/iu.test(s)||times.some(v=>!['08:00','8:00','8點','８點','八點','8am','08am'].includes(v.replace(/\s/g,'').toLowerCase())))return null
 const start=/^(?:請|幫我)?(?:新增|建立|設定)(?:一個)?(?:每日|每天|採購|訂貨|schedule|排程)/iu.test(s)||/^(?:please )?(?:create|add|set up) (?:a )?daily procurement (?:report|schedule)/iu.test(s)
 return start&&/(?:採購|供應商|補貨|訂貨|procurement)/iu.test(s)&&/(?:每日|每天|daily)/iu.test(s)?{operation:'create'}:null
}
function validInput(b){
 if(!b||typeof b!=='object'||Array.isArray(b))return false
 const shapes={procurement_status:['op'],procurement_tick:['op'],procurement_prepare:['op','operation','taskId','conversationId','goalId'],procurement_present:['op','id','hash','conversationId'],procurement_approve:['op','id','hash','nonce','conversationId']}
 if(!Object.hasOwn(shapes,b.op)||Object.keys(b).sort().join(',')!==shapes[b.op].slice().sort().join(','))return false
 if(b.op==='procurement_prepare')return ['create','pause','resume','revoke','recover'].includes(b.operation)&&TASK.test(b.taskId)&&UUID.test(b.conversationId)&&GOAL.test(b.goalId)
 return ['procurement_status','procurement_tick'].includes(b.op)||typeof b.id==='string'&&UUID.test(b.id)&&GOAL.test(b.hash)&&UUID.test(b.conversationId)&&(b.op!=='procurement_approve'||/^[a-f0-9]{48}$/.test(b.nonce||''))
}
module.exports={STATE_ID,TARGET,CONTROL,DEFINITION,hash,UUID,GOAL,TASK,intent,validInput}
