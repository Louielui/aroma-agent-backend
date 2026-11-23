'use strict'
// Typed interpretation inside the existing answer call. Quotes bind every input
// to host-saved Owner text; the program alone computes and renders the result.
// This is not an EvidenceSet, a business observation or an execution permission.
const {renderTransfer,renderPrep}=require('./suppliedCalculationReply')
const hypothetical=/虛構|虚构|假設|假设|假定|\bhypothetical\b|\bsuppose\b/i
const calculation=/計算|计算|調貨|调货|調完|调完|盒數|盒数|搬|安排|\bcalculat\w*\b|\btransfer\b|\brebalanc\w*\b|\ballocat\w*\b/i
function context(token){
 const texts=require('./conversationEvidence').ownerSources(token);if(!texts?.length)return null
 const current=texts.at(-1);if(!calculation.test(current)||/(?:查|讀取|读取).{0,12}(?:實際|实际|真實|真实|系統|系统)|\b(?:query|read|look up)\b.{0,20}\b(?:actual|live|system)\b/i.test(current))return null
 let start=-1;for(let i=0;i<texts.length;i++)if(hypothetical.test(texts[i])&&(texts[i].match(/\d+/g)||[]).length>=2)start=i
 return start<0?null:texts.slice(start)
}
const amount={type:'integer',minimum:0,maximum:1000000},word={type:'string',minLength:1,maxLength:32},quote={type:'string',minLength:1,maxLength:120}
const row={type:'object',additionalProperties:false,required:['entity','quantity','unit','quote'],properties:{entity:word,quantity:amount,unit:word,quote}}
const schema={anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['kind','locations','minimum','transferOnlyQuote'],properties:{kind:{type:'string',enum:['minimum_transfer']},locations:{type:'array',minItems:2,items:row},minimum:{type:'object',additionalProperties:false,required:['quantity','unit','quote'],properties:{quantity:amount,unit:word,quote}},transferOnlyQuote:quote}}]}
function withFormat(format,token){
 if(!context(token))return format
 const base=format||{type:'json_schema',name:'supplied_calculation_answer',strict:true,schema:require('./answerPlan').withReadChoices(require('./answerPlan').DISTILL_WITH_READ_DECISION_SCHEMA,[],'No tool operations are available for this supplied hypothetical calculation.')}
 const out=structuredClone(base);out.schema.properties.suppliedCalculation=structuredClone(schema);out.schema.required=[...new Set([...out.schema.required,'suppliedCalculation'])];return out
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
const keys=(o,names)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===names.length&&names.every(k=>Object.hasOwn(o,k))
const validAmount=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000
function bound(row,texts,entity){
 if(!validAmount(row.quantity)||typeof row.quote!=='string'||!row.quote.length||row.quote.length>120||typeof row.unit!=='string'||!/^\p{L}{1,16}$/u.test(row.unit))return false
 const numbers=row.quote.match(/\d+(?:\.\d+)?/g)||[];if(numbers.length!==1||Number(numbers[0])!==row.quantity||!new RegExp('(?:^|[^0-9.])'+escape(numbers[0])+'\\s*'+escape(row.unit)+'(?!\\p{L})','u').test(row.quote))return false
 let source=-1;for(let i=0;i<texts.length;i++)if(texts[i].includes(row.quote))source=i
 if(source<0)return false
 if(entity){
  if(typeof entity!=='string'||!/^\p{L}[\p{L} -]{0,31}$/u.test(entity)||!row.quote.includes(entity))return false
  const stock=new RegExp('^'+escape(entity)+'\\s*(?:有|存有|庫存(?:是|為)?|has)\\s*'+escape(numbers[0])+'\\s*'+escape(row.unit)+'$','iu')
  if(!stock.test(row.quote))return false
  // A later Owner amendment invalidates the older operand. Assistant prose and
  // browser history never enter texts. Ambiguity declines instead of guessing.
  const later=new RegExp(escape(entity)+'[^。；;\\n]{0,40}\\d+\\s*'+escape(row.unit),'u')
  if(texts.slice(source+1).some(s=>later.test(s)))return false
 }else{
  const floor=new RegExp('^(?:每(?:間|個)?(?:店|位置|地點|倉庫)?(?:的)?(?:庫存)?(?:至少|最少)(?:要|須|需|維持|保持)?|each (?:site|location|shop|store) (?:needs |requires |must have )?at least)\\s*'+escape(numbers[0])+'\\s*'+escape(row.unit)+'$','iu')
  if(!floor.test(row.quote))return false
  if(texts.slice(source+1).some(s=>/(?:每|each)[^。；;\n]{0,40}(?:至少|最少|at least)[^。；;\n]{0,15}\d+/i.test(s)))return false
 }
 return true
}
function calculate(proposal,token){
 const texts=context(token);if(!texts||!keys(proposal,['kind','locations','minimum','transferOnlyQuote'])||proposal.kind!=='minimum_transfer'||!Array.isArray(proposal.locations)||proposal.locations.length<2||proposal.locations.length>8)return null
 const locale=/[\u3400-\u9fff]/.test(texts.at(-1))?'zh':'en'
 const transfer=proposal.transferOnlyQuote;if(typeof transfer!=='string'||transfer.length>120||!texts.some(s=>s.includes(transfer))||!/^(?:(?:只能|只准)(?:調貨|调货)[，,、\s]*(?:不能購買|不能购买|唔買|不買|不买)|only transfers?[,\s]*(?:no purchases?|cannot buy))$/i.test(transfer))return null
 const source=texts.findLastIndex(s=>s.includes(transfer))
 if(texts.slice(source+1).some(s=>/購買|购买|採購|采购|\bpurchas\w*\b|\bbuy\b/i.test(s)))return null
 const min=proposal.minimum;if(!keys(min,['quantity','unit','quote'])||!bound(min,texts,null))return null
 if(proposal.locations.some(r=>!keys(r,['entity','quantity','unit','quote'])||r.unit!==min.unit||!bound(r,texts,r.entity)))return null
 if(new Set(proposal.locations.map(r=>r.entity)).size!==proposal.locations.length||new Set(proposal.locations.map(r=>r.quote)).size!==proposal.locations.length)return null
 // This contract represents a uniform floor and unrestricted transfers only.
 // Additional stock/transfer constraints must return to ordinary understanding.
 const quotes=[...proposal.locations.map(r=>r.quote),min.quote,transfer]
 const rest=texts.map(s=>quotes.reduce((v,q)=>v.replaceAll(q,''),s)).join('\n')
 if(/\d|(?:不能|不可|不得|禁止|只限|最多|上限).{0,16}(?:調|搬|盒|存量|庫存)|\b(?:at most|cannot|must not|only from|limit|capacity)\b/i.test(rest))return null
 const locations=proposal.locations.map(({entity,quantity,unit})=>({entity,quantity,unit})),total=locations.reduce((s,r)=>s+r.quantity,0),need=locations.reduce((s,r)=>s+Math.max(0,min.quantity-r.quantity),0),required=min.quantity*locations.length
 if(total<required)return{feasible:false,moved:0,locations,transfers:[],reply:renderTransfer({feasible:false,total,required,unit:min.unit},locale)}
 const transfers=[];for(const receiver of locations)for(const donor of locations){const quantity=Math.min(Math.max(0,min.quantity-receiver.quantity),Math.max(0,donor.quantity-min.quantity));if(quantity){donor.quantity-=quantity;receiver.quantity+=quantity;transfers.push({from:donor.entity,to:receiver.entity,quantity})}}
 if(locations.some(r=>r.quantity<min.quantity)||locations.reduce((s,r)=>s+r.quantity,0)!==total||transfers.reduce((s,r)=>s+r.quantity,0)!==need)throw Error('supplied_calculation_invariant')
 return{feasible:true,moved:need,locations,transfers,reply:renderTransfer({feasible:true,locations,transfers,unit:min.unit},locale)}
}

const prepRow = /^([\p{L}][\p{L} \u2019'-]{0,31}?)\s*(?:明天|聽日)?\s*(?:需要|要)\s*(\d{1,7})\s*份(?:\s*(雲吞|云吞))?$/u
// Only the supported bare shop labels can use the wonton shortcut. Free
// text in a name position can contain a separate operational request.
// Other labels go to ordinary intake and its evidence and action checks.
const prepSiteLabel = /^(?:The Forks|St Mary['’]s|第[一二三四五六七八九十]{1,3}店)$/iu
const prepSiteKey = name => name.trim().replaceAll('’', "'").toLowerCase()
const prepCapacity = /^中央(?:工場|工场)?\s*每(?:一)?(盤|盘|批)\s*(?:可做|做|可出|出)\s*(\d{1,7})\s*份$/u
const prepRequest = /^(?:幫我|帮我|請|请)\s*(?:安排|排)\s*(?:明天|聽日)(?:的|嘅)?\s*(?:prep|備料|备料)$/iu
const prepCorrection = /^([\p{L}][\p{L} \u2019'-]{0,31}?)\s*(?:只要|改為|改成)\s*(\d{1,7})\s*份$/u

function prepParts (message) {
 return message.length <= 450 ? message.replace(/[。.!！]$/u,'').split(/[，,。；;]\s*/u).map(s=>s.trim()) : []
}

function prepScenario (text) {
 const source = /^(?:假設|假设|假定)\s*(.+)$/u.exec(text)
 if (!source) return null
 const parts = prepParts(source[1])
 const request = parts.pop()
 const capacity = prepCapacity.exec(parts.pop() || '')
 if (!prepRequest.test(request || '') || !capacity || parts.length < 1 || parts.length > 8) return null
 const each = Number(capacity[2])
 if (!validAmount(each) || each === 0) return null
 const locations = new Map()
 let product = null
 for (const part of parts) {
  const row = prepRow.exec(part)
  if (!row || !validAmount(Number(row[2])) || (product && row[3] && product !== row[3])) return null
  const name = row[1].trim()
  if (!prepSiteLabel.test(name)) return null
  const key = prepSiteKey(name)
  if (locations.has(key)) return null
  locations.set(key,{name, quantity:Number(row[2])})
  if (row[3]) product = row[3]
 }
 return product ? {locations, product, each, batch:capacity[1] === '盘' ? '盤' : capacity[1]} : null
}

function suppliedPrep (message, token) {
 const texts = require('./conversationEvidence').ownerSources(token)
 if (typeof message !== 'string' || !texts || texts.at(-1) !== message.trim()) return null
 let scenario = null
 let index = texts.length - 1
 for (; index >= 0; index--) {
  scenario = prepScenario(texts[index])
  if (scenario) break
 }
 if (!scenario) return null
 for (const turn of texts.slice(index + 1)) {
  const parts = prepParts(turn)
  if (parts.length !== 4 || !/^(?:改一改|更正)$/u.test(parts[0]) ||
      !/^(?:其他照舊|其他照旧|其餘照舊|其餘不變)$/u.test(parts[2]) ||
      !/^(?:重新計算|重新計|再計)$/u.test(parts[3])) return null
  const update = prepCorrection.exec(parts[1])
  if (!update || !validAmount(Number(update[2]))) return null
  const location = scenario.locations.get(prepSiteKey(update[1]))
  if (!location) return null
  location.quantity = Number(update[2])
 }
 const locations = [...scenario.locations.values()]
 const total = locations.reduce((n, row) => n + row.quantity, 0)
 const batches = Math.ceil(total / scenario.each)
 const spare = batches * scenario.each - total
 return {reply:renderPrep({locations, product:scenario.product, each:scenario.each, batch:scenario.batch, total, batches, spare})}
}
module.exports={withFormat,calculate,context,suppliedPrep}
