'use strict'
const OP='seven_shifts.employee_wages'
const words=/(?:時薪|薪率|工資|薪資|薪酬|薪金|wages?|hourly\s+(?:rate|pay)|pay\s+rates?|salar(?:y|ies))/i
function resolveWageRead(question,conversation=[]){
 if(typeof question!=='string'||/[「」“”"`]/u.test(question)||/(?:不要|不用查|唔好|不需要|don't|do not|修改|加薪|減薪|批准|批核|刪除|寄出|發送|有沒有能力|會不會|能不能|\b(?:approve|delete|update|send|change|set|capabilities)\b)/i.test(question))return null
 const prior=conversation.at(-1),saved=prior?.readOperation===OP&&['active','inactive','all'].includes(prior.readStatus)
 const direct=words.test(question)&&/(?:列出|查看|查詢|查一下|查一查|幫我看|幫我查|整理|哪些人|邊個|\b(?:list|show|retrieve|find|read|check|who)\b)/i.test(question)
 const follow=saved&&(/(?:超過|低於|高於|大於|小於|少於|至少|最多|不少於|不超過|等於|[><=]|\b(?:over|above|below|under|at least|at most|exactly)\b)/i.test(question)||/^(?:請\s*|please\s+)?(?:只列|只要|僅列|only|just|filter|show|list)\s*(?:所有|全部|非在職|離職|在職|all|inactive|active)\s*(?:員工|使用者|employees|users|people)?[。？?!\s]*$/i.test(question))
 if(!direct&&!follow)return null
 const status=/(?:非在職|離職|inactive)/i.test(question)?'inactive':/(?:在職|\bactive\b)/i.test(question)?'active':/(?:全部|所有|\ball\b)/i.test(question)?'all':saved&&!direct?prior.readStatus:'all'
 const comparisons=[...question.matchAll(/(不少於|至少|不低於|不多於|最多|不高於|超過|高於|大於|低於|少於|小於|等於|不超過|at least|at most|over|above|more than|under|below|less than|exactly|>=|<=|>|<|=)\s*\$?\s*(\d+(?:\.\d+)?)/gi)]
 if(comparisons.length>1)return null
 if(!comparisons.length){if(/[><=]|超過|低於|高於|大於|少於|小於|至少|最多|等於|不少於|不低於|不多於|不高於|不超過|最高|最低|平均|\b(?:above|below|over|under|at least|at most|exactly|highest|lowest|average)\b/i.test(question)||/\d/.test(question.replace(/7shifts/ig,'')))return null;return {status,query:null}}
 const [,op,amount]=comparisons[0],suffix=question.slice(comparisons[0].index+comparisons[0][0].length);if(!/^\d+(?:\.\d{1,2})?$/.test(amount)||Number(amount)>1000000||/^[.,\d]/.test(suffix)||/(?:又|或者|或是|之間|between|百分|%|\band\b|\bor\b)/i.test(question))return null
 const normalized=op.toLowerCase(),operator=/^(?:不少於|至少|不低於|at least|>=)$/.test(normalized)?'gte':/^(?:不多於|最多|不高於|不超過|at most|<=)$/.test(normalized)?'lte':/^(?:超過|高於|大於|over|above|more than|>)$/.test(normalized)?'gt':/^(?:低於|少於|小於|under|below|less than|<)$/.test(normalized)?'lt':'eq'
 const [whole,fraction='']=amount.split('.'),value=Number(whole)*100+Number(fraction.padEnd(2,'0'))
 return {status,query:{operator,value}}
}
module.exports={resolveWageRead}
