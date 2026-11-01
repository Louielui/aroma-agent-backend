'use strict'
// A closed entrance to the existing dispatch-v1 recipe, never a general agent
// command. Only the current Owner message is considered; history is not authority.
// Compose a single command with compatible assertions. Every clause must be
// consumed; an unknown model, source, quota or action is never silently dropped.
const MODEL='GPT-6\\.1\\s+Sol\\s*[／/]\\s*High'
const reason=/^(?:選此模型是)?(?:因為|原因[：:])需要跨模組(?:程式)?(?:調查|分析)$/u
function healthRequest(value){return /^(?:請)?\s*(?:查|核對)?(?:你目前已登記的\s*)?(?:Codex\s*)?(?:bridge|橋接)(?:\s*健康|狀態)(?:及派工能力)?$/iu.test(value)||/^(?:請)?\s*(?:查|核對)?\s*Codex\s*(?:派工能力|bridge 健康及派工能力)$/iu.test(value)||/^請查你目前已登記的 Codex 派工能力及 bridge 健康$/iu.test(value)||/^Codex bridge health and dispatch capabilities$/i.test(value)}
function reportClause(value){
 const m=value.match(/^(?:請)?(?:提供|回報|列出|說明)\s*(.+)$/u);if(!m)return false
 const fields=m[1].split(/[、及與和]/u).map(s=>s.trim().replace(/^(?:真實|實際)/u,''))
 return fields.length>0&&fields.every(s=>/^(?:工作單\s*ID|派工入口|結果回傳(?:路徑|機制)|限制|接單證據|接單[／/]完成狀態|完成狀態|接單狀態)$/u.test(s))
}
function prohibitedActions(value){
 if(!/^(?:不要|不)/u.test(value))return false
 return value.replace(/^(?:不要|不)/u,'').split(/[、，,或]/u).every((s,i)=>/^(?:改檔|改碼|部署|轉\s*API|執行業務動作)$/iu.test(i?s.trim().replace(/^(?:不要|不)/u,''):s.trim()))
}
function commandEnvelope(value){
 const clauses=value.split(/[。；;]/u).map(s=>s.trim()).filter(Boolean);let commands=0
 for(const clause of clauses){
  if(/^(?:現在|接下來)?(?:請|幫我|麻煩)?\s*(?:派\s*)?Codex\s*(?:做|進行)?唯讀(?:調查|檢查|分析)\s*(?:香香|Imagine|Xiangxiang)(?:\s*的)?派工(?:流程|入口及結果回傳機制)$/iu.test(clause)||/^ask Codex to review (?:Imagine|Xiangxiang) dispatch read-only$/i.test(clause)||new RegExp('^(?:若可用[，,])?派\\s*'+MODEL+'\\s*做唯讀調查[：:]現有一般任務派工入口及結果回傳機制$','iu').test(clause)){commands++;continue}
  if(healthRequest(clause)||reason.test(clause)||reportClause(clause)||prohibitedActions(clause))continue
  const model=clause.match(/^(?:指定|模型[：:])\s*(.+?)(?:[，,](.+))?$/u)
  if(model&&new RegExp('^'+MODEL+'$','iu').test(model[1])&&(!model[2]||reason.test(model[2])))continue
  const scope=clause.match(/^(?:僅|只)使用\s*CodeDiagnosis\s+v1\s*已登記的(?:八|8)個固定檔案範圍(?:[，,](.+))?$/iu)
  if(scope&&(!scope[1]||reportClause(scope[1])))continue
  // Non-executing discourse and budget-isolation assertions are compatible with
  // this recipe's existing subscription preflight, no fallback and single call.
  if(/^(?:虛構|理解)?測試(?:已)?(?:結束|完畢)$/u.test(clause))continue
  if(/^這是(?:本次|這次)獨立唯讀派工測試[，,]不使用或重置(?:先前|原本)(?:暫停|關閉)的(?:九|9)輪正式驗收額度$/u.test(clause))continue
  if(/^(?:若|如果)目前通道沒有(?:適用授權|可用量)(?:或(?:適用授權|可用量))?[，,]停止並明確回報$/u.test(clause))continue
  if(/^(?:若|如果)不可用[，,](?:說明|回報)(?:具體)?阻塞$/u.test(clause))continue
  return false
 }
 return commands===1
}
function parseRequest(message){
 if(typeof message!=='string'||message.length>500)return null
 const value=message.trim().replace(/[。！？!?]+$/u,'')
 if(/[「」『』"`\n]/u.test(value))return null
 if(healthRequest(value))return 'health'
 if(/^(?:請)?\s*Codex\s*(?:工作單|任務)(?:狀態|進度|結果)$/iu.test(value))return 'status'
 if(commandEnvelope(value))return 'dispatch'
 // Explicit unsupported Codex enquiries get a concrete limit, not an unrelated
 // schedule/cost investigation. Negated and quoted examples remain conversation.
 if(/(?:Codex|GPT-6)/iu.test(value)&&/(?:派|指揮|唯讀調查)/u.test(value))return 'unsupported'
 return null
}
module.exports={parseRequest}
