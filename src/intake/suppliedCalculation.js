'use strict'
// Typed interpretation inside the existing answer call. Quotes bind every input
// to host-saved Owner text; the program alone computes and renders the result.
// This is not an EvidenceSet, a business observation or an execution permission.
const {renderTransfer}=require('./suppliedCalculationReply')
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
module.exports={withFormat,calculate,context}
