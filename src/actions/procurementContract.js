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
 const times=s.match(/(?:[0-9０-９]{1,2}[:：][0-9０-９]{2}|[0-9０-９一二三四五六七八九十]{1,2}點|[0-9]{1,2}\s*[ap]m)/giu)||[]
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
