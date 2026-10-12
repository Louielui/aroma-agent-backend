'use strict'
const https=require('node:https'),dns=require('node:dns'),crypto=require('node:crypto')
const structured=require('./publicStructured')
// Public publisher reads only. No caller can supply headers, cookies, a method,
// credentials, a port or a host outside this fixed catalogue.
const HOSTS=Object.freeze(['weather.gc.ca','www.canada.ca','www.gov.mb.ca','news.gov.mb.ca','www.winnipeg.ca','wpl.winnipeg.ca'])
const MAX_BYTES=512*1024
function admitUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.port===''&&HOSTS.includes(u.hostname)&&u.href.length<=2000?u.href:null}catch{return null}}
function publicAddress(address){
 const v=address.replace(/^::ffff:/,'')
 if(v.includes(':'))return /^[23][0-9a-f]{3}:/i.test(v)&&!/^2001:db8:/i.test(v)
 const a=v.split('.').map(Number)
 return a.length===4&&a.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&![0,10,127].includes(a[0])&&a[0]<224&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]>=16&&a[1]<=31)&&!(a[0]===192&&(a[1]===168||a[1]===0))&&!(a[0]===100&&a[1]>=64&&a[1]<=127)&&!(a[0]===198&&(a[1]===18||a[1]===19))
}
function getPublic(url,{signal}={}){
 if(require('../testProcess').isTestProcess())return Promise.reject(Error('test_public_egress_forbidden'))
 return new Promise((resolve,reject)=>{
  const req=https.request(url,{method:'GET',signal,headers:{accept:'text/html,text/plain,application/ld+json,application/json','user-agent':'Imagine-Public-Read/1.0','cache-control':'no-cache'},lookup:(host,options,callback)=>{
   dns.lookup(host,{all:true},(error,rows)=>{if(error)return callback(error);if(!rows.length||rows.some(r=>!publicAddress(r.address)))return callback(Error('public_address_required'));callback(null,options.all?rows:rows[0].address,options.all?undefined:rows[0].family)})
  }},res=>{
   const chunks=[];let size=0
   res.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){res.destroy(Error('page_too_large'));return}chunks.push(chunk)})
   res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}))
  });req.on('error',reject);req.end()
 })
}
function decode(text){return text.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>=0&&cp<=0x10ffff?String.fromCodePoint(cp):''}).replace(/&(amp|lt|gt|quot|apos|nbsp|deg|ndash|mdash);/gi,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',deg:'°',ndash:'–',mdash:'—'})[n.toLowerCase()])}
function plain(html){return decode(html.replace(/<!--[^]*?-->/g,' ').replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').replace(/°\s+([CF])\b/g,'°$1').trim()}
function iso(raw){if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)&&Number.isFinite(Date.parse(raw))?new Date(raw).toISOString():null}
function extractPage(html,url,retrievedAt){
 const clean=html.replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1>/gi,' '),main=clean.match(/<main\b[^>]*>([^]*?)<\/main>/i)?.[1]||clean
 const text=plain(main).slice(0,24000),times=[]
 for(const match of main.matchAll(/<time\b([^>]*\bdatetime=["']([^"']+)["'][^>]*)>([^]*?)<\/time>/gi)){
  const value=iso(match[2]);if(!value)continue
  const prior=plain(main.slice(Math.max(0,match.index-500),match.index)),attrs=match[1]
  const kind=/datePublished/i.test(attrs)?'publication':/dateModified/i.test(attrs)?'update':new URL(url).hostname==='weather.gc.ca'&&/Observed at:.*$/i.test(prior.slice(-250))?'observation':new URL(url).hostname==='weather.gc.ca'&&/Forecast issued\s*:\s*$/i.test(prior.slice(-100))?'forecast':null
  if(kind&&!times.some(t=>t.kind===kind&&t.value===value))times.push({kind,value,raw:plain(match[3]).slice(0,180)})
 }
 for(const match of clean.matchAll(/<meta\b[^>]*>/gi)){
  const tag=match[0],kind=/(?:article:published_time|datePublished)/i.test(tag)?'publication':/(?:article:modified_time|dateModified)/i.test(tag)?'update':null
  const value=iso(tag.match(/\bcontent=["']([^"']+)["']/i)?.[1]||'')
  if(kind&&value&&!times.some(t=>t.kind===kind&&t.value===value))times.push({kind,value,raw:value})
 }
 const observed=times.filter(t=>t.kind==='observation'&&t.value.includes('T')).map(t=>Date.parse(t.value)),age=observed.length?Date.parse(retrievedAt)-Math.max(...observed):null
 const subject=plain(main.match(/<h1\b[^>]*>([^]*?)<\/h1>/i)?.[1]||'').slice(0,200),inspected=structured.inspectDocument(html,url,subject),hash=crypto.createHash('sha256').update(html).digest('hex')
 return {state:'read',url,title:plain(clean.match(/<title\b[^>]*>([^]*?)<\/title>/i)?.[1]||subject||new URL(url).hostname).slice(0,200),text,retrievedAt,hash,times,publishedAt:times.find(t=>t.kind==='publication')?.value||null,freshness:age===null?'unknown':age<0?'unknown':age<=2*60*60*1000?'recent_observation':'stale_observation',structuredRecords:inspected.records.map(r=>({...r,url,retrievedAt,hash,parentUrl:url})),references:inspected.references.filter(r=>admitUrl(r.url)||structured.admitStructuredUrl(r.url)),navigation:inspected.navigation}
}
async function readPage(value,{get=getPublic,signal,now=Date.now,format=null,binding=null}={}){
 const original=admitUrl(value)||(format==='structured'&&binding&&admitUrl(binding.pageUrl)?structured.admitStructuredUrl(value):null);if(!original)return {url:value,state:'unavailable',reason:'host_not_registered'}
 const deadline=AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])
 try{
  let url=original
  for(let n=0;n<3;n++){
   const r=await get(url,{method:'GET',redirect:'manual',credentials:'omit',signal:deadline})
   if([301,302,303,307,308].includes(r.status)){const next=admitUrl(new URL(r.headers.location,url).href);if(!next||(format==='structured'&&new URL(next).origin!==new URL(original).origin))throw Error('redirect_not_registered');url=next;continue}
   const accepted=format==='structured'?/^(?:application\/(?:ld\+)?json|text\/plain)(?:;|$)/i:/^text\/(html|plain)(?:;|$)/i
   if(r.status!==200||!accepted.test(r.headers['content-type']||'')||typeof r.body!=='string'||Buffer.byteLength(r.body)>MAX_BYTES)throw Error('page_unavailable')
   if(format==='structured'){
    const projected=structured.projectStructured(JSON.parse(r.body),binding);if(!projected)throw Error('structured_subject_mismatch')
    return {...projected,state:'read',url:original,finalUrl:url,retrievedAt:new Date(now()).toISOString(),hash:crypto.createHash('sha256').update(r.body).digest('hex'),parentUrl:binding.pageUrl}
   }
   const page=extractPage(r.body,url,new Date(now()).toISOString());if(page.text.length<20&&!page.structuredRecords.length)throw Error('page_empty');return {...page,url:original,finalUrl:url}
  }
  throw Error('redirect_limit')
 }catch(e){return {url:original,state:'unavailable',reason:['redirect_not_registered','page_empty','page_too_large','structured_subject_mismatch'].includes(e.message)?e.message:'page_unavailable'}}
}
async function readOfficialPages(sources,{read=readPage,signal,freshness=null}={}){
 const selected=Array.from(new Set(sources.map(s=>admitUrl(s.url)).filter(Boolean))).sort((a,b)=>Number(/\.pdf(?:\?|$)/i.test(a))-Number(/\.pdf(?:\?|$)/i.test(b))).slice(0,2),pages=[],checks=[]
 for(const url of selected){
  if(signal?.aborted)break
  let page=await read(url,{signal});checks.push({url,state:page.state,reason:page.reason||null,freshness:page.freshness||'unknown'})
  if(page.state==='read'&&freshness==='current'&&page.freshness==='stale_observation'&&checks.length<3){const retry=await read(url,{signal});checks.push({url,state:retry.state,reason:retry.reason||null,freshness:retry.freshness||'unknown',retry:true});if(retry.state==='read')page=retry}
  if(page.state==='read')pages.push({...page,id:'p'+(pages.length+1)})
 }
 return {pages,checks}
}
async function readFallbackPages(sources,official,{read=readPage,signal,limit=2,referencesOnly=false,query=''}={}){
 const named=Array.from(new Map((official.pages||[]).flatMap(p=>p.navigation||[]).filter(r=>typeof r.subject==='string'&&query.toLowerCase().includes(r.subject.toLowerCase())).map(r=>[r.url,r])).values());
 const seen=new Set((official.checks||[]).map(c=>c.url)),references=[...(official.pages||[]).flatMap(p=>p.references||[]),...(named.length===1?named:[])],alternates=referencesOnly?[]:sources.map(s=>({url:admitUrl(s.url),format:null,relation:'observed_search_alternate'})),selected=[]
 for(const hint of [...references,...alternates]){if(!hint.url||seen.has(hint.url)||selected.length>=Math.min(2,Math.max(0,limit)))continue;seen.add(hint.url);selected.push(hint)}
 const pages=[],checks=[]
 for(const hint of selected){if(signal?.aborted)break;const page=await read(hint.url,{signal,format:hint.format,binding:hint.binding});checks.push({url:hint.url,state:page.state,reason:page.reason||null,fallback:true,relation:hint.relation,parentUrl:hint.binding?.pageUrl||null});if(page.state==='read')pages.push({...page,id:'f'+(checks.length)})}
 return {pages,checks,attempted:checks.length}
}
module.exports={HOSTS,admitUrl,publicAddress,extractPage,readPage,readOfficialPages,readFallbackPages,plain}
