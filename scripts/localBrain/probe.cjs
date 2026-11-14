'use strict'
// Explicit local-model acceptance probe. Never uses or activates a cloud ledger.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks')
const evidence='C:/Users/louis/Documents/Codex/local-candidates/local-brain-20261114'
async function main(){
 const launch=JSON.parse(fs.readFileSync(path.join(evidence,'isolated-launch.json'),'utf8'))
 const url=new URL(launch.url)
 if(url.origin!=='http://127.0.0.1:18092')throw Error('unexpected_isolated_endpoint')
 const login=await fetch(url.origin+'/owner/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Origin:url.origin},body:JSON.stringify({password:fs.readFileSync('C:/Aroma/local-brain-runtime/owner-password.txt','utf8').trim(),next:'/local'})})
 if(login.status!==302)throw Error('isolated_login_failed')
 const cookie=login.headers.get('set-cookie')?.split(';')[0]
 if(!cookie)throw Error('isolated_session_missing')
 const status=await(await fetch(url.origin+'/api/local/status',{headers:{Cookie:cookie}})).json()
 if(status.provider!=='local'||status.cloudFallback!==false)throw Error('local_status_mismatch')
 const message=process.argv[2]||'香香，早安。請用一句簡短中文回應。'
 const start=performance.now(),events=[]
 const response=await fetch(url.origin+'/api/v1/demo/intake',{method:'POST',headers:{'Content-Type':'application/json',Origin:url.origin,Cookie:cookie,Accept:'text/event-stream'},body:JSON.stringify({message,history:[],conversationId:crypto.randomUUID(),interactionMode:'chat'}),signal:AbortSignal.timeout(300000)})
 const decoder=new TextDecoder();let buffer=''
 for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const item=buffer.slice(0,end);buffer=buffer.slice(end+2);if(item.startsWith('data: ')){const event=JSON.parse(item.slice(6));events.push({...event,clientMs:performance.now()-start})}}}
 const receipt={at:new Date().toISOString(),message,httpStatus:response.status,totalMs:performance.now()-start,events}
 const file=path.join(evidence,'probe-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(receipt,null,2))
 console.log(JSON.stringify({file,totalMs:receipt.totalMs,final:events.find(e=>e.type==='final')?.body,models:events.filter(e=>e.type==='model_complete').map(e=>({model:e.model,timing:e.timing})),failures:events.filter(e=>e.type==='model_failed')}))
}
main().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1})
