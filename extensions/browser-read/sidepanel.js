'use strict'
const el=id=>document.getElementById(id)
let capture=null,job=null,busy=false,generation=0
let topic=null,topicRecord={headId:null,title:'',draft:'',mode:'task_only'},topicWrites=Promise.resolve()
function saveTopic(){if(!topic)return Promise.reject(Error('conversation_unavailable'));const value=structuredClone(topicRecord);topicWrites=topicWrites.catch(()=>{}).then(()=>chrome.storage.local.set({[topic.key]:value}));return topicWrites}
const ERRORS={conversation_tab_changed:'目前分頁或視窗已改變，請回到原分頁，或按工具列的香香圖示重新開啟。',selection_text_unavailable:'請先在網頁選取可見文字，再傳送。',conversation_source_changed:'對話來源已改變。請按「新對話」讀取這個頁面。',conversation_limit_reached:'這段對話已達 8 輪，請開新對話繼續。',conversation_unavailable:'上次對話無法恢復，請開新對話。',native_host_unavailable:'尚未接通本機讀取器，請完成安裝後再試。',page_access_unavailable_click_extension_icon:'無法讀取這個分頁。請先按工具列的香香圖示授權，再試一次。',source_changed:'頁面或分頁已改變，請重新準備及確認。',capture_stale:'頁面快照已過期，請重新準備。',site_not_allowed:'這個網址不在第一期可讀取範圍。',subscription_login_required:'所選模型的 CLI 訂閱需要重新登入。',read_unavailable:'本次讀取未完成；沒有自動重試。',native_reply_unknown_check_saved_result:'尚未收到結果；請重新開啟側欄查看已保存狀態，不要重複送出。'}
async function send(message){const response=await chrome.runtime.sendMessage(message);if(response?.error)throw Error(response.error);if(!response?.result)throw Error('native_host_unavailable');return response.result}
const rpc=body=>send({type:'rpc',body})
async function capturePanelPage(){if(!topic)throw Error('conversation_unavailable');return send({type:'capture',windowId:topic.windowId,coverage:el('coverage-mode').value})}
function error(e){if(e.message==='native_reply_unknown_check_saved_result')el('recover').hidden=false;el('status').textContent=ERRORS[e.message]||('讀取未完成：'+e.message)}
function wageTable(id,rows){
 const table=document.createElement('table');table.id=id;table.className='wage-table';const head=table.createTHead().insertRow();for(const title of ['薪率','人員']){const th=document.createElement('th');th.scope='col';th.textContent=title;head.append(th)}
 const groups=new Map();for(const row of rows){const names=groups.get(row.rate)||[];names.push(row);groups.set(row.rate,names)}
 const rank=rate=>!Number.isFinite(parseFloat(rate))?3:parseFloat(rate)===0?2:/週薪|salary/.test(rate)?1:0
 const grouped=[...groups].sort((a,b)=>rank(a[0])-rank(b[0])||parseFloat(a[0])-parseFloat(b[0]))
 const body=table.createTBody();for(const [rate,people]of grouped){const tr=body.insertRow(),cell=tr.insertCell();cell.textContent=rate;if(people.some(p=>p.note.includes('系統零薪率'))){const warning=document.createElement('small');warning.textContent='系統零薪率，需確認';cell.append(warning)}const names=tr.insertCell();for(const person of people){const line=document.createElement('div');line.textContent=person.name;if(person.needsVerification){const flag=document.createElement('abbr');flag.textContent=' *';flag.title=person.note||'薪率未確認';flag.tabIndex=0;flag.setAttribute('aria-label',person.name+'：'+flag.title);line.append(flag)}names.append(line)}}return table
}
function presentWages(p){
 const box=el('text');box.replaceChildren();box.classList.add('wage-summary');const heading=document.createElement('h2');heading.textContent=p.heading+'（'+p.primaryTotal+'）';box.append(heading,wageTable('wage-primary',p.primary))
 if(p.primary.some(row=>row.needsVerification)){const warning=document.createElement('p');warning.className='note';warning.textContent='* 零薪率或部分職位需確認；指向標記可看原因，完整資料在下方明細。';box.append(warning)}
 for(const note of p.notes){const line=document.createElement('p');line.className='note';line.textContent=note;box.append(line)}
 if(p.otherTotal){const other=document.createElement('details');other.id='wage-other';const title=document.createElement('summary');title.textContent=p.otherHeading+'（'+p.otherTotal+'）';other.append(title,wageTable('wage-inactive',p.other));box.append(other)}
 const details=document.createElement('details');details.id='wage-details';const title=document.createElement('summary');title.textContent='查看職位薪率明細';const text=document.createElement('pre');text.textContent=p.details;details.append(title,text);box.append(details)
}
function present(r){
 job=r;el('recover').hidden=r.state!=='processing';el('welcome').hidden=true;el('messages').replaceChildren();
 const rows=r.messages||[{id:r.id,question:r.question,state:r.state,result:r.result}];
 for(const m of rows){const question=m.id===r.id?r.question:m.question;if(question){const q=document.createElement('div');q.className='message user';q.textContent=question+(m.questionTruncated?'（已截短）':'');el('messages').append(q)}if(m.result&&m.id!==r.id){const a=document.createElement('div');a.className='message assistant';a.textContent=m.result.text+(m.result.truncated?'\n（先前回答已截短；完整回答保留在本機）':'');el('messages').append(a)}}
 el('coverage-mode').disabled=rows.some(m=>m.state==='completed');
 el('answer').hidden=r.state!=='completed';el('cancel').hidden=!['awaiting_consent','processing'].includes(r.state)
 if(r.state==='completed'){
  el('answer').hidden=false;el('text').classList.remove('wage-summary');el('text').textContent=r.result.text
  const source=r.result.source,tool=r.result.taskEvidence
  const metadata=(tool?`資料來源：7shifts · ${tool.retrievedAt} · ${tool.complete?'範圍完整':'未完整／未能讀取'} · 公司 ID：${tool.companyId??'未確認'}`:source?`快照來源：${source.origin} · ${new Date(source.capturedAt).toLocaleString()}`:'任務回答 · 未讀取網頁')+` · 所選 ${r.result.requestedModel} · 實際 ${r.result.actualModel||'未確認'}`
  const wages=tool?.operation==='seven_shifts.employee_wages'&&r.result.wagePresentation?.version===1
  el('read-evidence').hidden=!wages;el('read-evidence').open=false;el('read-evidence-text').textContent=metadata
  if(wages){presentWages(r.result.wagePresentation);el('evidence').textContent='7shifts · '+(tool.state!=='live'?'本次未能讀取':tool.complete?'薪率已核對':tool.outputComplete===false?'明細未完整展示':'已讀取，部分薪率待確認')}else el('evidence').textContent=metadata
  el('context-chip').textContent=source?(source.coverage==='selection_text'?'選取文字':'網頁快照')+' · '+source.origin:'任務 · 不讀取網頁'
  el('coverage-mode').value=source?(source.coverage||'main_frame_visible_text'):'task_only';el('status').textContent='可以接着追問；每次會重新確認讀取範圍。'
 }
 else if(r.state==='failed')error(Error(r.error))
 else if(r.state==='cancelled')el('status').textContent='已停止本次讀取；不會自動重試。已送出的模型工作可能仍計入訂閱額度。'
 else if(r.state==='interrupted')el('status').textContent='服務重啟中斷了這次讀取，沒有自動重試。'
 else if(r.state==='processing')el('status').textContent='已送出，等待所選模型回答…'
}
async function prepare(){
 if(busy||!topic)return;if(!el('question').value.trim()){el('status').textContent='請輸入你想問香香的問題。';return}const version=generation;busy=true;el('prepare').disabled=true;el('read').disabled=true;el('consent').checked=false;el('preview').hidden=true;el('answer').hidden=true
 try{
  if(job&&['awaiting_consent','processing'].includes(job.state))await rpc({op:'cancel',id:job.id})
  const taskOnly=el('coverage-mode').value==='task_only';el('status').textContent=taskOnly?'正在準備任務範圍…':'正在核對目前分頁…'
  capture=taskOnly?{taskOnly:true}:await capturePanelPage()
  const parentId=job?.messages?.findLast(m=>m.state==='completed')?.id||(job?.state==='completed'?job.id:null)
  const r=await rpc({op:'prepare',requestId:crypto.randomUUID(),question:el('question').value,...(taskOnly?{}:{source:capture.source,taskVersion:1}),...(parentId?{parentId}:{})})
  if(version!==generation)return;topicRecord.headId=r.id;topicRecord.title||=el('question').value.slice(0,60);topicRecord.mode=el('coverage-mode').value;await saveTopic();present(r);el('question').readOnly=true
  el('source').textContent=taskOnly?'任務模式：沒有讀取目前網頁。':capture.title+' · '+capture.source.url
  el('model').textContent='跟隨中央模型：'+r.selection.model+' · '+r.selection.effort
  el('context-chip').textContent=taskOnly?'任務 · 不讀取網頁':(capture.source.coverage==='selection_text'?'選取文字':'目前網頁')+' · '+capture.title
  el('coverage').textContent=(taskOnly?'沒有網頁快照。':`${capture.source.coverage==='selection_text'?'選取文字':'主框架可見文字'} ${capture.text.length} 字${capture.source.truncated?'（已截斷）':''}。`)+`含 ${r.messages?.length? r.messages.length-1:0} 輪先前對話${r.historyTruncated?'（部分回答截短至 2,000 字）':''}。圖片、iframe、輸入欄未讀取。`
  el('task-scope').textContent=r.taskCapabilities?.length?'佢可按你的要求，唯讀查詢 7shifts 公司 '+r.taskCapabilities[0].companyId+' 的員工姓名、在職狀態、目前薪率與職位；可包含非在職及管理帳號。查詢結果會外送予上述模型；回答保留本機。不會修改員工、薪率、排班或 payroll。':'本次未接通可用的公司查詢工具；佢會說明資料缺漏。'
  el('excerpt').textContent=taskOnly?el('question').value:capture.text;el('history-details').hidden=!parentId
  el('history-preview').textContent=(r.messages||[]).filter(m=>m.result).map(m=>'你：'+m.question+'\n香香：'+m.result.text+(m.result.truncated?'\n（回答已截短）':'')).join('\n\n')
  el('preview').hidden=false;el('status').textContent='尚未呼叫模型。請先確認範圍。'
 }catch(e){capture=null;error(e)}finally{busy=false;el('prepare').disabled=false}
}
el('composer').addEventListener('submit',e=>{e.preventDefault();prepare()})
el('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();prepare()}})
el('question').addEventListener('input',()=>{if(topic&&!el('question').readOnly){topicRecord.draft=el('question').value;saveTopic().catch(e=>error(e))}})
el('consent').addEventListener('change',()=>{el('read').disabled=!el('consent').checked||busy||!capture||job?.state!=='awaiting_consent'})
el('read').addEventListener('click',async()=>{
 if(busy||!capture||!job||!el('consent').checked)return;busy=true;el('read').disabled=true;el('prepare').disabled=true;el('status').textContent='再次核對頁面後交給香香…'
 const version=generation;el('preview').hidden=true;try{const r=await rpc({op:'read',id:job.id,consent:true,...(capture.taskOnly?{}:{source:capture.source,text:capture.text})});if(version!==generation)return;present(r);if(r.state==='completed'){el('question').value='';topicRecord.draft='';await saveTopic()}}catch(e){error(e)}finally{busy=false;capture=null;el('prepare').disabled=false;el('question').readOnly=false}
})
el('cancel').addEventListener('click',async()=>{if(!job)return;try{present(await rpc({op:'cancel',id:job.id}));capture=null;el('preview').hidden=true;el('read').disabled=true;el('question').readOnly=false}catch(e){error(e)}})
el('recover').addEventListener('click',async()=>{if(!job)return;try{present(await rpc({op:'get',id:job.id}))}catch(e){error(e)}})
el('dismiss').addEventListener('click',async()=>{if(job?.state==='awaiting_consent'){try{present(await rpc({op:'cancel',id:job.id}))}catch(e){error(e);return}}capture=null;el('preview').hidden=true;el('question').readOnly=false;el('read').disabled=true;el('status').textContent='已返回編輯，尚未外送。'})
 el('new-chat').addEventListener('click',async()=>{if(busy){el('status').textContent='請先停止這次讀取，再開新對話。';return}if(!topic)return;generation++;if(job?.state==='awaiting_consent'){try{await rpc({op:'cancel',id:job.id})}catch(e){error(e);return}}try{await topicWrites;await chrome.storage.local.remove(topic.key)}catch{el('status').textContent='本機對話狀態未清除，請稍後再試。';return}topicRecord={headId:null,title:'',draft:'',mode:el('coverage-mode').value};job=null;capture=null;el('recover').hidden=true;el('cancel').hidden=true;el('messages').replaceChildren();el('answer').hidden=true;el('preview').hidden=true;el('welcome').hidden=false;el('question').value='';el('question').readOnly=false;el('coverage-mode').disabled=false;el('context-chip').textContent=el('coverage-mode').value==='task_only'?'任務 · 不讀取網頁':'尚未加入網頁內容';el('status').textContent=''})
 const restoreVersion=generation;el('prepare').disabled=true
 ;(async()=>{try{const params=new URL(location.href).searchParams;const context=params.has('tabId')?{type:'context'}:{type:'context',windowId:(await chrome.windows.getCurrent()).id};topic=await send(context);if(!/^browser-topic:[a-f0-9-]{36}$/.test(topic.key)||!Number.isSafeInteger(topic.tabId)||!Number.isSafeInteger(topic.windowId))throw Error('conversation_unavailable');const value=await chrome.storage.local.get(topic.key);if(restoreVersion!==generation)return;if(value[topic.key])topicRecord={...topicRecord,...value[topic.key]};el('question').value=topicRecord.draft;el('coverage-mode').value=topicRecord.mode;if(topicRecord.headId){const r=await rpc({op:'get',id:topicRecord.headId});if(restoreVersion===generation&&!busy)present(r)}}catch(e){error(e)}finally{el('prepare').disabled=!topic}})()
