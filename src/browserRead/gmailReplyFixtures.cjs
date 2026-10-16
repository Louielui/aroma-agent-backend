'use strict'
const {randomUUID,createHash}=require('node:crypto')
const RO='https://www.googleapis.com/auth/gmail.readonly',QUESTION='幫我回覆這封 Email'
function fixture(options={}){
 const {createGmailScope,createGmailContextAdapter,gmailResources}=require('../context/gmailContext')
 const {createReadConnector}=require('../context/readConnector'),{createToolGateway}=require('../context/toolGateway')
 const env={READ_ACCESS:'on',CONTEXT_GMAIL:'on'},calls=[],audit=[],models=[],rows=new Map();let revision='v1'
 const message=(id,body)=>({id,threadId:'def456',internalDate:'1792100000000',labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Project question'},{name:'From',value:'Sender <sender@example.test>'},{name:'Reply-To',value:'Replies <reply@example.test>'},{name:'To',value:'chef@example.test'},{name:'Cc',value:'team@example.test'},{name:'Message-ID',value:'<'+id+'@example.test>'},{name:'References',value:'<older@example.test>'}],body:{data:Buffer.from(body).toString('base64url')}}})
 const messages=[message('abc122','Earlier authorized context'),message('abc123',options.body||'Please confirm the delivery date.')]
 const scope=createGmailScope({env,registry:{snapshot:()=>({users:[{id:'owner',role:'owner',email:'chef@example.test',grants:[]}],sources:[]})},credentials:()=>({client:true,token:true,revision})})
 const reader={identity:async()=>({scopes:[RO]}),metadata:async()=>({emailAddress:options.account||'chef@example.test'}),getMessage:async id=>{calls.push('message');return messages.find(m=>m.id===id)},getThread:async id=>{calls.push('thread');if(options.revoke)revision='v2';return {id,messages:options.messages||messages}}}
 const connector=createReadConnector({env});connector.register(createGmailContextAdapter({scope,readerFactory:()=>reader}))
 const gateway=createToolGateway({connector,resources:gmailResources(),audit:{append:e=>audit.push(e)}})
 const gmail=require('../context/gmailContextService').createGmailContextService({gateway,scope})
 const task=require('./contextTask').createContextTask({legacy:{describe:()=>[],run:async()=>{throw Error('wrong_legacy_route')}},drive:null,gmail,env})
 const draft={mode:'draft_proposal',understanding:{recipient:{name:null,email:'reply@example.test',confidence:'high'},purpose:{value:'Reply preview',confidence:'high'},tone:{value:'natural',confidence:'high'},constraints:[],understandingSignals:[{classification:'FACT',statement:'Owner requested a reply preview',source:'current_message',confidence:'high'}]},restatement:'Prepare reply preview',clarifyingQuestion:null,draft:{to:'attacker@example.test',subject:'Invented subject',body:'Hi, what date would you prefer?',tone:'natural'}}
 const adapter={model:'claude-opus-5-5',providerName:'claude',complete:async(prompt,opts)=>{models.push({prompt,system:opts.system});if(options.modelWait)await options.modelWait();return{model:'claude-opus-5-5',text:JSON.stringify(draft)}}}
 const store={get:id=>structuredClone(rows.get(id)),all:()=>[...rows.values()].map(r=>structuredClone(r)),save:r=>rows.set(r.id,structuredClone(r))}
 const service=require('./service').createBrowserRead({store,selection:()=>({model:adapter.model,effort:'medium'}),provider:()=>adapter,taskRunner:task})
 const text='Visible synthetic current message',source={url:'https://mail.google.com/mail/u/0/',tabId:10,windowId:20,documentId:'gmail-document',frameId:0,capturedAt:new Date().toISOString(),contentHash:createHash('sha256').update(text).digest('hex'),truncated:false,gmail:{kind:'gmail_message',accountEmail:'chef@example.test',messageId:'abc123',threadId:'def456',routeToken:'FMfcgSyntheticMessage'}}
 const prepare=(extra={})=>service.handle({op:'prepare',requestId:randomUUID(),question:QUESTION,source,taskVersion:3,...extra})
 const run=async()=>{const p=await prepare();return service.handle({op:'read',id:p.id,consent:true,source,text})}
 return{env,calls,audit,models,messages,reader,task,source,text,service,store,prepare,run,revoke:()=>{revision='v2'}}
}
module.exports={fixture,QUESTION,RO}
