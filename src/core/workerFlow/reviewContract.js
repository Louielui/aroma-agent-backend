'use strict'
// The same closed review shape is used by local and subscription workers.
function parse(text,files){
 const invalid=stage=>{const e=Error('invalid_worker_result');e.reviewValidation={stage,responseChars:typeof text==='string'?text.length:null};throw e}
 if(typeof text!=='string'||text.length>50000)invalid('envelope')
 let r;try{r=JSON.parse(text)}catch{invalid('json')}
 const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',')
 if(!exact(r,['verdict','summary','findings'])||!Array.isArray(r.findings)||r.findings.some(f=>!exact(f,['file','line','message']))||r.verdict==='pass'&&r.findings.length)invalid('schema')
 if(!['pass','changes_requested'].includes(r.verdict)||typeof r.summary!=='string'||r.summary.length>10000||r.findings.length>50||r.findings.some(f=>!files.includes(f.file)||!Number.isInteger(f.line)||f.line<1||typeof f.message!=='string'||f.message.length>3000))invalid('finding')
 return r
}
function schema(files){return{type:'object',additionalProperties:false,required:['verdict','summary','findings'],properties:{verdict:{type:'string',enum:['pass','changes_requested']},summary:{type:'string'},findings:{type:'array',items:{type:'object',additionalProperties:false,required:['file','line','message'],properties:{file:{type:'string',enum:files},line:{type:'integer',minimum:1},message:{type:'string'}}}}}}}
module.exports={parse,schema}
