'use strict'
// A closed entrance to the existing dispatch-v1 recipe, never a general agent
// command. Only the current Owner message is considered; history is not authority.
function parseRequest(message){
 if(typeof message!=='string'||message.length>500)return null
 const value=message.trim().replace(/[。！？!?]+$/u,'')
 if(/[「」『』"`\n]/u.test(value)||/^(?:不要|別|do not|don't)/i.test(value))return null
 if(/^(?:請)?\s*(?:查|核對)?(?:你目前已登記的\s*)?(?:Codex\s*)?(?:bridge|橋接)(?:\s*健康|狀態)(?:及派工能力)?$/iu.test(value)||/^(?:請)?\s*(?:查|核對)?\s*Codex\s*(?:派工能力|bridge 健康及派工能力)$/iu.test(value))return 'health'
 if(/^請查你目前已登記的 Codex 派工能力及 bridge 健康$/iu.test(value)||/^Codex bridge health and dispatch capabilities$/i.test(value))return 'health'
 if(/^(?:請)?\s*Codex\s*(?:工作單|任務)(?:狀態|進度|結果)$/iu.test(value))return 'status'
 if(/^(?:請|幫我)?\s*(?:派\s*)?Codex\s*唯讀(?:調查|檢查)(?:香香|Imagine)(?:的)?派工(?:流程|入口及結果回傳機制)$/iu.test(value))return 'dispatch'
 if(/^ask Codex to review (?:Imagine|Xiangxiang) dispatch read-only$/i.test(value))return 'dispatch'
 // The reported compound request: each clause is explicitly bounded. A changed
 // model, arbitrary source, execution verb or extra clause cannot fit this grammar.
 if(/^請查你目前已登記的 Codex 派工能力及 bridge 健康。若可用，派 GPT-6\.1 Sol[／/]High 做唯讀調查：現有一般任務派工入口及結果回傳機制。(?:選此模型是因為需要跨模組程式調查。)?回報真實工作單 ID 及接單證據；若不可用，說明具體阻塞。不要改碼、部署、轉 API 或執行業務動作$/u.test(value))return 'dispatch'
 // Explicit unsupported Codex enquiries get a concrete limit, not an unrelated
 // schedule/cost investigation. Negated and quoted examples remain conversation.
 if(/(?:Codex|GPT-6)/iu.test(value)&&/(?:派|指揮|唯讀調查)/u.test(value))return 'unsupported'
 return null
}
module.exports={parseRequest}
