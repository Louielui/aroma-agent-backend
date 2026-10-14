'use strict'
const API='https://api.7shifts.com/v2',MAX_PAGES=3,MAX_USERS=300,MAX_BYTES=500000
const id=n=>Number.isSafeInteger(n)&&n>0
const safeName=s=>typeof s==='string'?s.replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,200):''
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s
function selectWages(rows,roles,roleBased,today){
 if(!Array.isArray(rows)||rows.length>300)throw Error('invalid_source_response')
 const seen=new Set()
 for(const w of rows){if(!w||!id(w.id)||seen.has(w.id)||!date(w.effective_date)||!['hourly','weekly_salary'].includes(w.wage_type)||!Number.isSafeInteger(w.wage_cents)||w.wage_cents<0||w.role_id!==null&&!id(w.role_id))throw Error('invalid_source_response');seen.add(w.id)}
 const current=rows.filter(w=>w.effective_date<=today)
 if(!current.length)return null
 const latest=current.slice().sort((a,b)=>b.effective_date.localeCompare(a.effective_date))[0]
 if(current.some(w=>w.effective_date===latest.effective_date&&w.wage_type!==latest.wage_type))return null
 const keys=latest.wage_type==='weekly_salary'||!roleBased?[{roleId:null,roleName:null}]:roles
 if(!keys.length)return null
 const selected=[]
 for(const key of keys){
  const matches=current.filter(w=>w.role_id===key.roleId&&w.wage_type===latest.wage_type).sort((a,b)=>b.effective_date.localeCompare(a.effective_date))
  if(!matches.length||matches.some(w=>w.effective_date===matches[0].effective_date&&w.wage_cents!==matches[0].wage_cents)){selected.push({...key,wageType:latest.wage_type,wageCents:null,effectiveDate:null});continue}
  selected.push({...key,wageType:latest.wage_type,wageCents:matches[0].wage_cents,effectiveDate:matches[0].effective_date})
 }
 return selected.some(w=>w.wageCents!==null)?selected:null
}
// This capability accepts status only. Company, host, paths, method, version,
// transport budget and credential source are host-owned, never model arguments.
function createSevenShiftsWagesReader({env=process.env,fetchFn,clock=()=>new Date().toISOString(),timeoutMs=75000}={}){
 async function read(input){
  if(!input||!['active','inactive','all'].includes(input.status)||Object.keys(input).some(k=>!['status','signal'].includes(k)))throw Error('invalid_request')
  const companyId=Number(env.SEVEN_SHIFTS_COMPANY_ID),token=env.SEVEN_SHIFTS_ACCESS_TOKEN,retrievedAt=clock(),outer=input.signal
  let deadlineReached=false
  const controller=new AbortController(),timer=setTimeout(()=>{deadlineReached=true;controller.abort()},timeoutMs)
  const abort=()=>controller.abort();outer?.addEventListener('abort',abort,{once:true});if(outer?.aborted)abort()
  const users=[],rows=[];let rosterComplete=false,pages=0
  const accessCurrent=()=>env.READ_ACCESS==='on'&&env.CONTEXT_SEVEN_SHIFTS==='on'&&Number(env.SEVEN_SHIFTS_COMPANY_ID)===companyId&&env.SEVEN_SHIFTS_ACCESS_TOKEN===token
  const report=reason=>({state:'live',companyId,status:input.status,rows:users.map((u,index)=>rows[index]||{...u,wages:null,error:reason}),rosterComplete,complete:!reason&&rosterComplete&&rows.every(r=>r&&r.wages!==null&&r.wages.every(w=>w.wageCents!==null)&&r.employeeName!==null),retrievedAt,...(reason?{reason}:{}),
   provenance:{endpoint:API+'/company/'+companyId+'/users',wagesEndpoint:API+'/company/'+companyId+'/users/{user_id}/wages',pages,maxUsers:MAX_USERS,readOnly:true,scope:'configured_company_users_including_management'}})
  const verify=()=>{
   if(controller.signal.aborted)throw Error('read_timeout')
   if(env.READ_ACCESS!=='on'||env.CONTEXT_SEVEN_SHIFTS!=='on')throw Error('read_access_disabled')
   if(!id(companyId)||typeof token!=='string'||!token.trim())throw Error('connection_not_configured')
   if(Number(env.SEVEN_SHIFTS_COMPANY_ID)!==companyId||env.SEVEN_SHIFTS_ACCESS_TOKEN!==token)throw Error('source_access_changed')
   if(!fetchFn&&process.env.NODE_TEST_CONTEXT)throw Error('live_transport_not_allowed_in_tests')
  }
  async function get(path,params={}){
   verify();const url=new URL(API+'/company/'+companyId+'/'+path)
   for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v))
   const request=new AbortController(),stop=()=>request.abort();controller.signal.addEventListener('abort',stop,{once:true})
   let deadline,abortListener
   const refused=new Promise((_,reject)=>{abortListener=()=>reject(Error('read_timeout'));request.signal.addEventListener('abort',abortListener,{once:true});deadline=setTimeout(()=>request.abort(),5000)})
   try{
    const work=(async()=>{
     const response=await (fetchFn||globalThis.fetch)(url.href,{method:'GET',redirect:'error',signal:request.signal,headers:{Authorization:'Bearer '+token,accept:'application/json','x-api-version':'2022-05-01'}})
     verify();if(!response.ok)throw Error(response.status===401||response.status===403?'source_not_authorised':response.status===429?'source_rate_limited':'source_unavailable')
     if(response.headers?.get('content-length')>MAX_BYTES)throw Error('invalid_source_response')
     let text=''
     if(response.body?.getReader){const reader=response.body.getReader();let size=0;try{const chunks=[];while(true){const r=await reader.read();verify();if(r.done)break;size+=r.value.byteLength;if(size>MAX_BYTES)throw Error('invalid_source_response');chunks.push(Buffer.from(r.value))}text=Buffer.concat(chunks).toString('utf8')}finally{await reader.cancel().catch(()=>{})}}
     else text=await response.text()
     verify();if(Buffer.byteLength(text)>MAX_BYTES)throw Error('invalid_source_response');return JSON.parse(text)
    })()
    const value=await Promise.race([work,refused]);verify();return value
   }finally{clearTimeout(deadline);controller.signal.removeEventListener('abort',stop);request.signal.removeEventListener('abort',abortListener)}
  }
  try{
   verify();const settings=(await get('labor_settings')).data
   if(settings?.company_id!==companyId||typeof settings.wage_based_roles_enabled!=='boolean')throw Error('invalid_source_response')
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(retrievedAt))
   const seen=new Set();let scopesComplete=true
   for(const status of input.status==='all'?['active','inactive']:[input.status]){
    let cursor=null,complete=false;const cursors=new Set()
    for(let n=0;n<MAX_PAGES&&users.length<MAX_USERS;n++){
     const limit=Math.min(100,MAX_USERS-users.length),value=await get('users',{status,limit,...(cursor?{cursor}:{})});pages++
     if(!Array.isArray(value.data)||value.data.length>limit)throw Error('invalid_source_response')
     for(const u of value.data){
      if(!u||u.company_id!==companyId||!id(u.id)||seen.has(u.id)||u.active!==(status==='active'))throw Error('invalid_source_response')
      seen.add(u.id);const name=[safeName(u.first_name),safeName(u.last_name)].filter(Boolean).join(' ')
      users.push({userId:u.id,employeeName:name||null,active:u.active})
      if(users.length>MAX_USERS)throw Error('invalid_source_response')
     }
     const next=value.meta?.cursor?.next
     if(next===null){complete=true;break}
     if(typeof next!=='string'||!next||next.length>2048||cursors.has(next))throw Error('invalid_source_response')
     cursors.add(next);cursor=next
    }
    scopesComplete=scopesComplete&&complete
   }
   rosterComplete=scopesComplete;let offset=0
   async function collect(){while(offset<users.length){verify();const index=offset++,u=users[index];try{
    const value=await get('users/'+u.userId+'/wages');if(!Array.isArray(value.data?.current_wages))throw Error('invalid_source_response')
    let roles=[]
    if(settings.wage_based_roles_enabled){const assigned=await get('users/'+u.userId+'/role_assignments');if(!Array.isArray(assigned.data)||assigned.data.length>100||assigned.meta?.cursor?.next!=null)throw Error('invalid_source_response');const ids=new Set();roles=assigned.data.map(r=>{if(Object.hasOwn(r,'company_id')&&r.company_id!==companyId||!id(r.role_id)||ids.has(r.role_id))throw Error('invalid_source_response');ids.add(r.role_id);return {roleId:r.role_id,roleName:safeName(r.name)||null}})}
    rows[index]={...u,wages:selectWages(value.data.current_wages,roles,settings.wage_based_roles_enabled,today),error:null}
   }catch(e){verify();rows[index]={...u,wages:null,error:['source_not_authorised','source_rate_limited','invalid_source_response'].includes(e.message)?e.message:'source_unavailable'}}}}
   await Promise.all(Array.from({length:Math.min(4,users.length)},collect));verify()
   return report(null)
  }catch(e){
   // Only the reader's own deadline may retain verified partial evidence.
   // Owner cancellation and revoked source authority always discard it.
   if(deadlineReached&&!outer?.aborted&&accessCurrent()&&users.length)return report('read_timeout')
   return {state:'unavailable',reason:['read_access_disabled','connection_not_configured','source_access_changed','source_not_authorised','source_rate_limited','read_timeout','invalid_source_response'].includes(e.message)?e.message:'source_unavailable',retrievedAt,rows:null,complete:null}
  }
  finally{clearTimeout(timer);outer?.removeEventListener('abort',abort)}
 }
 return {read}
}
module.exports={createSevenShiftsWagesReader,selectWages}
