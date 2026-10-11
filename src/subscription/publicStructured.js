'use strict'
// Publisher profiles are data-source bindings, never query/intent routing.
// Only the library data directory referenced by the observed official page is
// registered outside the original publisher hosts. No script is executed.
const BRANCHES=Object.freeze({'millennium-library':1262,'bill-and-helen-norrie-library':7343,'charleswood-library':1264,'cornish-library':1265,'fort-garry-library':1266,'harvey-smith-library':1280,'henderson-library':1268,'louis-riel-library':1269,'munroe-library':1270,'osborne-library':1271,'pembina-trail-library':1272,'st-boniface-library':1274,'st-james-assiniboia-library':1275,'st-johns-library':1276,'st-vital-library':1277,'sir-william-stephenson-library':1278,'transcona-library':1279,'west-kildonan-library':1281,'westwood-library':1282,'windsor-park-library':1283})
const DAYS=Object.freeze(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])
const SCHEMA_BASE='https://raw.githubusercontent.com/winnipegpublibrary/winnipeg-ca-openinghours/main/hours-schema/'
const SCRIPT_BASE='https://cdn.jsdelivr.net/gh/winnipegpublibrary/winnipeg-ca-openinghours@main/'
function admitStructuredUrl(value){try{const u=new URL(value);return !u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&Object.values(BRANCHES).some(id=>u.href===SCHEMA_BASE+id+'.json')?u.href:null}catch{return null}}
function key(value){return String(value||'').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,'')}
function scalar(value,max=1000){return typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null}
function sourceDate(value){if(typeof value!=='string')return null;if(/^\d{4}-\d{2}-\d{2}$/.test(value))return Number.isFinite(Date.parse(value))&&new Date(value).toISOString().startsWith(value)?value:null;return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null}
function projectStructured(node,binding={}){
 if(!node||Array.isArray(node)||typeof node!=='object'||(node['@context']!=null&&!['https://schema.org','http://schema.org'].includes(node['@context'])))return null
 const types=Array.isArray(node['@type'])?node['@type']:[node['@type']],name=scalar(node.name,200)||scalar(node.headline,200)
 if(!types.some(t=>['Library','LocalBusiness','Organization','GovernmentOrganization','NewsArticle','Article','WebPage'].includes(t))||!name||![binding.name,binding.title].some(v=>v&&key(v)===key(name)))return null
 const lines=['name: '+name],times=[],datePublished=sourceDate(node.datePublished),dateModified=sourceDate(node.dateModified)
 if(datePublished){times.push({kind:'publication',value:datePublished,raw:node.datePublished});lines.push('datePublished: '+node.datePublished)}
 if(dateModified){times.push({kind:'update',value:dateModified,raw:node.dateModified});lines.push('dateModified: '+node.dateModified)}
 const address=typeof node.address==='string'?scalar(node.address):node.address&&typeof node.address==='object'?[node.address.streetAddress,node.address.addressLocality,node.address.addressRegion].map(v=>scalar(v,200)).filter(Boolean).join(', '):null
 if(address)lines.push('address: '+address)
 let coverage=null
 if(node.openingHoursSpecification!=null){
  if(!Array.isArray(node.openingHoursSpecification)||!node.openingHoursSpecification.length||node.openingHoursSpecification.length>21)return null
  let invalidFields=0;const days=new Set()
  for(const row of node.openingHoursSpecification){
   const dayValues=Array.isArray(row?.dayOfWeek)?row.dayOfWeek:[row?.dayOfWeek],selected=dayValues.map(d=>typeof d==='string'?d.replace(/^https?:\/\/schema\.org\//,''):null)
   if(!row||row.validFrom!=null||row.validThrough!=null||!selected.length||selected.some(d=>!DAYS.includes(d))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.opens||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.closes||'')){invalidFields++;continue}
   for(const day of selected){days.add(day);lines.push(day+': opens '+row.opens+'; closes '+row.closes)}
  }
  if(!days.size)return null
  coverage={kind:'recurring_hours',daysListed:DAYS.filter(d=>days.has(d)),missingDays:DAYS.filter(d=>!days.has(d)),exceptions:'unknown',invalidFields}
  lines.push('Coverage: recurring hours only; date-specific opening status and holiday exceptions are unknown. Missing weekdays are unknown, not closed. Missing weekdays: '+coverage.missingDays.join(', ')+'.')
 }else{const description=scalar(node.description,1500);if(description)lines.push('description: '+description);if(!datePublished&&!description)return null}
 return {title:name,text:lines.join('\n'),coverage,times,publishedAt:datePublished,freshness:'unknown',kind:'publisher_structured',extraction:'schema_fields'}
}
function nodes(value){if(Array.isArray(value))return value.slice(0,30);if(value&&Array.isArray(value['@graph']))return value['@graph'].slice(0,30).map(n=>({...n,'@context':n?.['@context']||value['@context']}));return [value]}
function inspectDocument(html,pageUrl,title){
 const records=[],references=[],binding={pageUrl,title};let url
 try{url=new URL(pageUrl)}catch{return {records,references}}
 for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([^]*?)<\/script>/gi)){
  if(records.length>=2||match[1].length>65536)break
  try{for(const node of nodes(JSON.parse(match[1]))){const projected=projectStructured(node,binding);if(projected&&records.length<2)records.push(projected)}}catch{/* Invalid data stays absent; scripts are never run. */}
 }
 for(const match of html.matchAll(/<(?:link|a)\b[^>]*>/gi)){
  if(references.length>=2)break
  const tag=match[0];if(!/\btype=["']application\/(?:ld\+)?json["']/i.test(tag))continue
  const href=tag.match(/\bhref=["']([^"']+)["']/i)?.[1];if(!href)continue
  try{const next=new URL(href.replace(/&amp;/g,'&'),pageUrl);if(next.origin===url.origin&&!next.username&&!next.password&&!next.search&&!next.hash)references.push({url:next.href,binding,format:'structured',relation:'publisher_alternate'})}catch{}
 }
 const slug=url.pathname.match(/^\/recreation-leisure\/libraries\/locations-and-hours\/([a-z-]+)\/?$/)?.[1],id=BRANCHES[slug]
 const scripts=Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),m=>m[1])
 if(url.origin==='https://www.winnipeg.ca'&&id&&scripts.includes(SCRIPT_BASE+'hours-schema-inject.js')&&scripts.includes(SCRIPT_BASE+'winnipeg_ca_library_hours_translation.js'))references.unshift({url:SCHEMA_BASE+id+'.json',binding:{pageUrl,title,name:title.replace(/ Library$/,'')},format:'structured',relation:'registered_publisher_profile'})
 return {records,references:references.slice(0,2)}
}
module.exports={inspectDocument,projectStructured,admitStructuredUrl,DAYS}
