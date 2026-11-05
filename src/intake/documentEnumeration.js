'use strict'
// Local document structure is not business evidence. Admit only a complete
// proposal-count header followed immediately by that many ordered text items.
// The item bodies remain independent inputs to every ordinary evidence guard.
const {splitSentences,cjkToNumber}=require('./answerPlan')
const numeral='[0-9零〇一二兩三四五六七八九十百千萬]+'
const zhKinds='(?:提案|方案|草案|計劃|計畫|設計|建議)',enKinds='(?:proposal|plan|draft|design)'
const header=new RegExp('^(?:(?:這份|本)?'+zhKinds+'(?:內容)?(?:我)?(?:暫定為|分為|包含|包括|有)\\s*('+numeral+')\\s*(?:項改動|項建議|個步驟|個重點)|(?:The )?'+enKinds+' (?:includes|contains|has) ([0-9]+) (?:changes|recommendations|steps|points))[。.!！]?$','iu')
const marker=new RegExp('^(?:第('+numeral+')[，、：:]\\s*|([0-9]{1,2})[.)]\\s+)([\\s\\S]+)$','u')
const number=s=>/^\d+$/.test(s)?Number(s):cjkToNumber(s)
function item(sentence){const m=sentence.match(marker);return m?{ordinal:number(m[1]||m[2]),text:sentence,body:m[3]}:null}
function verifiedDocumentLists(reply){
 const sentences=splitSentences(reply),lists=[]
 let cursor=0
 for(let i=0;i<sentences.length;i++){
  const start=reply.indexOf(sentences[i],cursor);cursor=start+sentences[i].length
  const match=sentences[i].match(header);if(!match)continue
  const count=number(match[1]||match[2]);if(count<2||count>16)continue
  const items=sentences.slice(i+1,i+1+count).map(item)
  if(items.length!==count||items.some((v,n)=>!v||v.ordinal!==n+1||!v.body.trim())||item(sentences[i+1+count]||''))continue
  lists.push({header:sentences[i],start,items:items.map(v=>v.text)})
 }
 return lists
}
// An indefinite article in a conditional draft object does not quantify the
// business entity in an earlier clause. This recognizes only one proposed text
// object, not completed work, source availability or a business-state claim.
// The caller still checks entity/status predicates and every adjacent clause.
const conditionalZh=new RegExp('^(?:可以(?:考慮)?|建議)(?:先)?(?:準備|草擬|整理|建立|開)\\s*(一|1)(?:份|個|張)(?:唯讀的|待批的|隔離的)?(?:[「“][^「」“”\\r\\n]{1,40}[」”])?(?:的)?(?:'+zhKinds+'|草稿|工作單)(?:[（(][^）)\\r\\n]*[）)]?)?[，；;。.!！]?$', 'u')
const conditionalEn=new RegExp('^(?:We could (?:draft|prepare|create)|(?:I suggest|Consider) (?:drafting|preparing|creating)) (one|a|an) (?:read-only |proposed |isolated |pending-approval )?'+enKinds+'(?: \\([^()\\r\\n]*\\))?[.!]?$','iu')
// Modal transformations describe a proposed text/work unit too. Their result
// object, rather than a preceding source noun, owns the indefinite article.
// A whole-clause match excludes actual/completed transformations and extra data.
const transformationZh=new RegExp('^(?:可(?:以)?|建議)(?:先|再)?(?:合併|整合|歸併|拆分|轉換)(?:成|為)\\s*(一|1)(?:項(?:修正|變更)|個(?:步驟|流程|'+zhKinds+'))[，；;。.!！]?$', 'u')
const transformationEn=new RegExp('^(?:We could (?:combine|consolidate|merge)|(?:I suggest|Consider) (?:combining|consolidating|merging))(?: these)? into (one|a|1) (?:change|step|workflow|'+enKinds+')[.!]?$', 'iu')
function conditionalDraftObject(clause){
 const text=String(clause).trim(),match=text.match(conditionalZh)||text.match(conditionalEn)||text.match(transformationZh)||text.match(transformationEn)
 if(!match)return false
 const at=text.indexOf(match[1]);return !/[\p{N}零〇一二兩三四五六七八九十百千萬]/u.test(text.slice(0,at)+text.slice(at+match[1].length))
}
// A numbered Markdown section is a local document address. Its body still
// traverses every ordinary fact/status guard; an ordinal is not a file count.
function numberedSections(text){
 if(/^ {0,3}(?:\x60{3,}|~{3,})/m.test(String(text)))return []
 const lines=String(text).split(/\r?\n/),sections=[];let fence=null
 for(const line of lines){
  const code=line.match(/^ {0,3}(`{3,}|~{3,})/)
  if(code){if(!fence)fence=code[1];else if(code[1][0]===fence[0]&&code[1].length>=fence.length)fence=null;continue}
  if(fence)continue
  const header=line.match(/^\*\*(\d{1,2})[.)]\s+(.+?)\*\*\s*$|^#{1,6}\s+(\d{1,2})[.)]\s+(.+?)\s*$/u)
  if(header){sections.push({ordinal:Number(header[1]||header[3]),title:header[2]||header[4],lines:[]});continue}
  if(sections.length)sections.at(-1).lines.push(line)
 }
 return sections.length>=2&&sections.length<=16&&sections.every((s,i)=>s.ordinal===i+1)?sections:[]
}
function documentReference(clause,ordinals){
 const match=String(clause).trim().match(/^第\s*([0-9零〇一二兩三四五六七八九十百千萬]+)\s*項(?:(?:可以|建議|應|要)?(?:先|再)|可以|建議)([^\p{N}零〇一二兩三四五六七八九十百千萬]+)$/u)
 return Boolean(match&&ordinals.has(number(match[1])))
}
module.exports={verifiedDocumentLists,conditionalDraftObject,numberedSections,documentReference}
