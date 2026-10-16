'use strict'
const el=id=>document.getElementById(id)
let capture=null,job=null,busy=false,generation=0
let topic=null,topicRecord={headId:null,title:'',draft:'',mode:'auto_context'},topicWrites=Promise.resolve()
let clientUpdating=false
el('client-update').addEventListener('click',async()=>{
 if(clientUpdating||!topic)return
 if(busy||['awaiting_consent','processing'].includes(job?.state)||['working','stopping','waiting','uncertain'].includes(workState)){el('status').textContent='請先完成或停止目前工作，再更新。';return}
 clientUpdating=true;el('client-update').disabled=true
 try{
  topicRecord.draft=el('question').value;await saveTopic();await topicWrites
  const update=await send({type:'client_update'})
  if(!['panel','extension'].includes(update.reload))throw Error('client_update_unavailable')
  el('status').textContent=update.reload==='panel'?'對話已保存，正在更新香香…':'對話已保存，正在更新 Extension；若側欄關閉，按香香圖示回來，無需重啟 Chrome。'
  if(update.reload==='panel')location.reload();else chrome.runtime.reload()
 }catch(e){el('status').textContent=e.message==='client_update_busy'?'有工作仍在執行，請完成或停止後再更新。':'未能確認更新，保留目前版本與對話。';clientUpdating=false;el('client-update').disabled=false}
})
let workEpoch=0,workTimer=null,workStart=null,workEnd=null,workState='idle',workLane=null
function workTime(){if(workStart===null){el('work-time').textContent='';return}const seconds=Math.max(0,Math.floor(((workEnd??Date.now())-workStart)/1000));el('work-time').textContent=(workEnd===null?'已用 ':'用時 ')+seconds+' 秒'}
function setWork(state,phase,start=workStart,end=null){
 clearInterval(workTimer);workTimer=null;workState=state;workStart=start;workEnd=['working','stopping'].includes(state)?null:(end??Date.now());el('work-progress').hidden=false;el('work-progress').dataset.state=state
 el('work-title').textContent={working:'香香正在工作',stopping:'正在停止',waiting:'等你確認',completed:'工作已完成',cancelled:'工作已停止',interrupted:'工作已中斷',failed:'本次未完成',uncertain:'進度暫未確認'}[state]||'工作狀態'
 el('work-phase').textContent=phase;el('work-stop').hidden=!['working','stopping','waiting','uncertain'].includes(state);el('work-stop').disabled=state==='stopping';workTime()
 if(['working','stopping'].includes(state))workTimer=setInterval(workTime,1000)
}
function beginWork(phase,start=Date.now(),lane='read'){const epoch=++workEpoch;workLane=lane;setWork('working',phase,start);return epoch}
function clearWork(){++workEpoch;clearInterval(workTimer);workTimer=null;workStart=null;workEnd=null;workState='idle';el('work-progress').hidden=true}
function eventTime(event){const value=Date.parse(event?.at);return Number.isFinite(value)&&value<=Date.now()+5000?value:null}
function workFromRecord(r){
 const timeline=Array.isArray(r.timeline)?r.timeline:[],start=eventTime(timeline.find(e=>e.stage==='consent_consumed_before_dispatch')),end=eventTime(timeline.at(-1)),stage=timeline.at(-1)?.stage
 if(r.state==='processing'){
  if(workState==='stopping')return
  const phases={model_request_started:'正在等候模型回覆…',model_request_finished:'模型已回覆，正在處理結果…',read_task_started:'正在讀取已授權資料…',read_task_finished:'資料讀取已返回，正在整理回覆…'},phase=Object.hasOwn(phases,stage)?phases[stage]:'正在處理已送出的任務…'
  setWork('working',phase,start??workStart??Date.now())
 }else if(r.state==='awaiting_consent')setWork('waiting','尚未呼叫模型，請先確認範圍。',null)
 else if(r.state==='completed'){
  const email=r.result?.taskEvidence?.operation==='gmail.reply_preview',preview=r.result?.taskEvidence?.previewPrepared===true
  setWork('completed',email?(preview?'預覽已保存在香香；未儲存 Gmail 草稿、未寄信。':'尚未製作回覆；請查看缺少資料或待確認事項。'):r.result?.taskEvidence?.complete===false?'回覆已保存；部分資料仍待確認。':'回覆已保存。',start,end)
  if(email)el('work-title').textContent=preview?'回覆預覽已準備':'回覆仍待確認'
 }
 else if(r.state==='cancelled')setWork('cancelled','不會自動重試；已送出的工作可能仍計入訂閱額度。',start,end)
 else if(r.state==='interrupted')setWork('interrupted','服務重啟中斷了這次工作，沒有自動接續。',start,end)
 else if(r.state==='failed')setWork('failed','本次未完成；可查看狀態說明，沒有自動重試。',start,end)
}
// Observe only the already-authorized saved job. No read/model/native action is
// dispatched by polling or restoration, and at most one status request is pending.
async function waitForSavedRead(id,epoch){
 const deadline=Date.now()+130000;let failures=0
 while(epoch===workEpoch&&Date.now()<deadline){
  await new Promise(resolve=>setTimeout(resolve,1000));if(epoch!==workEpoch)throw Error('progress_superseded')
  if(job?.id===id&&['completed','cancelled','failed','interrupted'].includes(job.state))return job
  let r;try{r=await rpc({op:'get',id})}catch{if(epoch!==workEpoch)throw Error('progress_superseded');failures++;if(workState!=='stopping')setWork('uncertain','暫未收到進度；原要求不會重送。');if(failures>=3)throw Error('native_reply_unknown_check_saved_result');continue}
  if(epoch!==workEpoch)throw Error('progress_superseded')
  if(r.id!==id||!['awaiting_consent','processing','completed','cancelled','failed','interrupted'].includes(r.state))throw Error('native_reply_unknown_check_saved_result')
  failures=0;job=r;workFromRecord(r);if(['completed','cancelled','failed','interrupted'].includes(r.state))return r
 }
 throw Error(epoch===workEpoch?'native_reply_unknown_check_saved_result':'progress_superseded')
}
async function restorePending(r){
 if(r.state!=='processing')return
 const version=generation,epoch=beginWork('正在查閱已保存的工作狀態…');workFromRecord(r);busy=true;el('prepare').disabled=true;el('question').readOnly=true
 try{const saved=await waitForSavedRead(r.id,epoch);if(version===generation&&epoch===workEpoch)present(saved)}catch(e){if(version===generation&&epoch===workEpoch)error(e)}finally{if(epoch===workEpoch){busy=false;el('prepare').disabled=!topic;el('question').readOnly=false}}
}
function saveTopic(){if(!topic)return Promise.reject(Error('conversation_unavailable'));const value=structuredClone(topicRecord);topicWrites=topicWrites.catch(()=>{}).then(()=>chrome.storage.local.set({[topic.key]:value}));return topicWrites}
const ERRORS={conversation_tab_changed:'目前分頁或視窗已改變，請回到原分頁，或按工具列的香香圖示重新開啟。',selection_text_unavailable:'請先在網頁選取可見文字，再傳送。',conversation_source_changed:'對話來源已改變。請按「新對話」讀取這個頁面。',conversation_limit_reached:'這段對話已達 8 輪，請開新對話繼續。',conversation_unavailable:'上次對話無法恢復，請開新對話。',native_host_unavailable:'尚未接通本機讀取器，請完成安裝後再試。',page_access_unavailable_click_extension_icon:'無法讀取這個分頁。請先按工具列的香香圖示授權，再試一次。',source_changed:'頁面或分頁已改變，請重新準備及確認。',capture_stale:'頁面快照已過期，請重新準備。',site_not_allowed:'這個網址不在第一期可讀取範圍。',subscription_login_required:'所選模型的 CLI 訂閱需要重新登入。',read_unavailable:'本次讀取未完成；沒有自動重試。',native_reply_unknown_check_saved_result:'尚未收到結果；請重新開啟側欄查看已保存狀態，不要重複送出。'}
async function send(message){const response=await chrome.runtime.sendMessage(message);if(response?.error)throw Error(response.error);if(!response?.result)throw Error('native_host_unavailable');return response.result}
const rpc=body=>send({type:'rpc',body})
async function capturePanelPage(){if(!topic)throw Error('conversation_unavailable');return send({type:'capture',windowId:topic.windowId,coverage:el('coverage-mode').value==='auto_context'?'main_frame_visible_text':el('coverage-mode').value})}
function error(e){if(e.message==='progress_superseded')return;if(e.message==='native_reply_unknown_check_saved_result')el('recover').hidden=false;el('status').textContent=ERRORS[e.message]||('讀取未完成：'+e.message);setWork(['native_reply_unknown_check_saved_result','native_host_unavailable'].includes(e.message)?'uncertain':'failed',el('status').textContent)}
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
 workFromRecord(r)
 job=r;el('recover').hidden=r.state!=='processing';el('welcome').hidden=true;el('messages').replaceChildren();
 const rows=r.messages||[{id:r.id,question:r.question,state:r.state,result:r.result}];
 for(const m of rows){const question=m.id===r.id?r.question:m.question;if(question){const q=document.createElement('div');q.className='message user';q.textContent=question+(m.questionTruncated?'（已截短）':'');el('messages').append(q)}if(m.result&&m.id!==r.id){const a=document.createElement('div');a.className='message assistant';a.textContent=m.result.text+(m.result.truncated?'\n（先前回答已截短；完整回答保留在本機）':'');el('messages').append(a)}}
 el('coverage-mode').disabled=rows.some(m=>m.state==='completed');
 el('answer').hidden=r.state!=='completed';el('cancel').hidden=!['awaiting_consent','processing'].includes(r.state)
 if(r.state==='completed'){
  el('answer').hidden=false;el('text').classList.remove('wage-summary');el('text').textContent=r.result.text
  const source=r.result.source,tool=r.result.taskEvidence
  const metadata=(tool?.operation==='gmail.reply_preview'?`Gmail · ${tool.previewPrepared?'回覆預覽':'尚未製作回覆'} · ${tool.complete?'本次 thread 內容已核對':'內容未完整／未能核對'} · 未儲存草稿、未寄信`:tool?.operation==='drive.company_files'?`Aroma Base · ${tool.state==='live'?'已查閱':'未查閱文件'} · ${tool.complete?'本次範圍完整':'查閱未完整'}`:tool?`資料來源：7shifts · ${tool.retrievedAt} · ${tool.complete?'範圍完整':'未完整／未能讀取'} · 公司 ID：${tool.companyId??'未確認'}`:source?`快照來源：${source.origin} · ${new Date(source.capturedAt).toLocaleString()}`:'任務回答 · 未讀取網頁')+` · 所選 ${r.result.requestedModel} · 實際 ${r.result.actualModel||'未確認'}`
  const wages=tool?.operation==='seven_shifts.employee_wages'&&r.result.wagePresentation?.version===1
  el('read-evidence').hidden=!wages;el('read-evidence').open=false;el('read-evidence-text').textContent=metadata
  if(wages){presentWages(r.result.wagePresentation);el('evidence').textContent='7shifts · '+(tool.state!=='live'?'本次未能讀取':tool.complete?'薪率已核對':tool.outputComplete===false?'明細未完整展示':'已讀取，部分薪率待確認')}else el('evidence').textContent=metadata
  el('context-chip').textContent=source?(source.coverage==='selection_text'?'選取文字':'網頁快照')+' · '+source.origin:'任務 · 不讀取網頁'
  el('coverage-mode').value=[2,3].includes(r.taskVersion)?topicRecord.mode:source?(source.coverage||'main_frame_visible_text'):'task_only';el('status').textContent='可以接着追問；每次會重新確認讀取範圍。'
 }
 else if(r.state==='failed')error(Error(r.error))
 else if(r.state==='cancelled')el('status').textContent='已停止本次讀取；不會自動重試。已送出的模型工作可能仍計入訂閱額度。'
 else if(r.state==='interrupted')el('status').textContent='服務重啟中斷了這次讀取，沒有自動重試。'
 else if(r.state==='processing')el('status').textContent='已送出，等待所選模型回答…'
}
async function prepare(){
 if(busy||!topic)return;if(!el('question').value.trim()){el('status').textContent='請輸入你想問香香的問題。';return}const version=generation,epoch=beginWork(el('coverage-mode').value==='task_only'?'正在準備任務範圍…':'正在核對目前分頁…',Date.now(),'prepare');busy=true;el('prepare').disabled=true;el('read').disabled=true;el('consent').checked=false;el('preview').hidden=true;el('answer').hidden=true
 try{
  if(job&&['awaiting_consent','processing'].includes(job.state))await rpc({op:'cancel',id:job.id})
  const taskOnly=el('coverage-mode').value==='task_only';el('status').textContent=taskOnly?'正在準備任務範圍…':'正在核對目前分頁…'
  let preparedCapture
  try{preparedCapture=taskOnly?{taskOnly:true}:await capturePanelPage()}catch(e){if(el('coverage-mode').value!=='auto_context'||!['page_access_unavailable_click_extension_icon','page_text_unavailable','site_not_allowed','current_tab_unavailable'].includes(e.message))throw e;preparedCapture={taskOnly:true,contextAvailability:'unavailable'}}
  if(version!==generation||epoch!==workEpoch)return
  const parentId=job?.messages?.findLast(m=>m.state==='completed')?.id||(job?.state==='completed'?job.id:null)
  const taskVersion=parentId?(job?.taskVersion||1):3
  const legacy=taskVersion===1
  const noPage=preparedCapture.taskOnly===true
  // Old topic consent cannot acquire new E1 tools. A fresh topic is required.
  if(taskVersion!==3&&preparedCapture.source?.gmail)delete preparedCapture.source.gmail
  const r=await rpc({op:'prepare',requestId:crypto.randomUUID(),question:el('question').value,...(noPage?{}:{source:preparedCapture.source}),...(legacy?(noPage?{}:{taskVersion:1}):{taskVersion,...(noPage?{contextAvailability:preparedCapture.contextAvailability||'excluded'}:{})}),...(parentId?{parentId}:{})})
  if(version!==generation||epoch!==workEpoch){if(r.state==='awaiting_consent')await rpc({op:'cancel',id:r.id}).catch(()=>{});return}topicRecord.headId=r.id;topicRecord.title||=el('question').value.slice(0,60);topicRecord.mode=el('coverage-mode').value;await saveTopic();if(version!==generation||epoch!==workEpoch){if(r.state==='awaiting_consent')await rpc({op:'cancel',id:r.id}).catch(()=>{});return}capture=preparedCapture;present(r);el('question').readOnly=true
  el('source').textContent=noPage?(capture.contextAvailability==='unavailable'?'未取得目前頁面授權／快照；本次不會假設頁面內容。':'任務模式：沒有讀取目前網頁。'):capture.title+' · '+capture.source.url
  el('model').textContent='跟隨中央模型：'+r.selection.model+' · '+r.selection.effort
  el('context-chip').textContent=noPage?'未加入網頁內容':(capture.source.coverage==='selection_text'?'選取文字':'目前網頁')+' · '+capture.title
  el('coverage').textContent=(noPage?'沒有網頁快照。':`${capture.source.coverage==='selection_text'?'選取文字':'主框架可見文字'} ${capture.text.length} 字${capture.source.truncated?'（已截斷）':''}。`)+`含 ${r.messages?.length? r.messages.length-1:0} 輪先前對話${r.historyTruncated?'（部分回答截短至 2,000 字）':''}。圖片、iframe、輸入欄未讀取。`
  const wageScope=r.taskCapabilities?.find(c=>c.id==='seven_shifts.employee_wages'),driveScope=r.taskCapabilities?.find(c=>c.id==='drive.company_files'),gmailScope=r.taskCapabilities?.find(c=>c.id==='gmail.reply_preview')
  el('task-scope').textContent=[wageScope?'唯讀查詢 7shifts 公司 '+wageScope.companyId+' 的員工姓名、在職狀態、目前薪率與職位；可包含非在職及管理帳號。':'',driveScope?'工具範圍 v'+driveScope.version+'：Aroma Base（'+driveScope.scope+'）唯讀核對目前 Drive 位置、搜尋及取得文件；最多讀取 3 份候選文件，可能只取得 metadata、截斷文字或不支援格式。':'',r.taskCapabilities?.length?'已確認的快照和相關查詢結果會外送予上述模型；回答保留本機。頁面不是授權；不會修改公司資料。':'本次未接通可用的公司查詢工具；佢會說明資料缺漏。'].filter(Boolean).join('\n')
  if(gmailScope)el('task-scope').textContent+='\nGmail 唯讀回覆預覽 v1：'+gmailScope.accountEmail+'；message '+gmailScope.messageId+'；thread '+gmailScope.threadId+'。最多 8 封訊息，每封最多 4,000 字；附件不讀取。未儲存 Gmail 草稿、未寄信。'
  el('excerpt').textContent=noPage?el('question').value:capture.text;el('history-details').hidden=!parentId
  el('history-preview').textContent=(r.messages||[]).filter(m=>m.result).map(m=>'你：'+m.question+'\n香香：'+m.result.text+(m.result.truncated?'\n（回答已截短）':'')).join('\n\n')
  el('preview').hidden=false;el('status').textContent='尚未呼叫模型。請先確認範圍。'
 }catch(e){if(epoch===workEpoch){capture=null;error(e)}}finally{if(epoch===workEpoch){busy=false;el('prepare').disabled=false}}
}
el('composer').addEventListener('submit',e=>{e.preventDefault();prepare()})
el('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();prepare()}})
el('question').addEventListener('input',()=>{if(topic&&!el('question').readOnly){topicRecord.draft=el('question').value;saveTopic().catch(e=>error(e))}})
el('consent').addEventListener('change',()=>{el('read').disabled=!el('consent').checked||busy||!capture||job?.state!=='awaiting_consent'})
el('read').addEventListener('click',async()=>{
 if(busy||!capture||!job||!el('consent').checked)return;const epoch=beginWork(capture.taskOnly?'正在將任務交給香香…':'再次核對頁面後交給香香…');busy=true;el('read').disabled=true;el('prepare').disabled=true;el('status').textContent=el('work-phase').textContent
 const version=generation,id=job.id;el('preview').hidden=true;try{const pending=rpc({op:'read',id,consent:true,...(capture.taskOnly?{}:{source:capture.source,text:capture.text})}),r=await Promise.race([pending,waitForSavedRead(id,epoch)]);if(version!==generation||epoch!==workEpoch)return;present(r);if(r.state==='completed'){el('question').value='';topicRecord.draft='';await saveTopic()}}catch(e){if(version===generation&&epoch===workEpoch){if(job?.state==='cancelled')present(job);else error(e)}}finally{if(epoch===workEpoch){busy=false;capture=null;el('prepare').disabled=false;el('question').readOnly=false}}
})
el('cancel').addEventListener('click',async()=>{if(!job||busy&&workLane==='prepare'){++workEpoch;setWork('cancelled','已停止準備，尚未呼叫模型。');busy=false;capture=null;el('preview').hidden=true;el('read').disabled=true;el('prepare').disabled=false;el('question').readOnly=false;return}const epoch=workEpoch;setWork('stopping','正在確認停止…');try{const saved=await rpc({op:'cancel',id:job.id});if(epoch!==workEpoch)return;present(saved);busy=false;capture=null;el('preview').hidden=true;el('read').disabled=true;el('prepare').disabled=false;el('question').readOnly=false}catch(e){if(epoch===workEpoch)error(e)}})
el('work-stop').addEventListener('click',()=>el('cancel').dispatchEvent(new MouseEvent('click',{bubbles:true})))
el('recover').addEventListener('click',async()=>{if(!job||busy)return;try{const saved=await rpc({op:'get',id:job.id});present(saved);await restorePending(saved)}catch(e){error(e)}})
el('dismiss').addEventListener('click',async()=>{if(job?.state==='awaiting_consent'){try{present(await rpc({op:'cancel',id:job.id}))}catch(e){error(e);return}}clearWork();capture=null;el('preview').hidden=true;el('question').readOnly=false;el('read').disabled=true;el('status').textContent='已返回編輯，尚未外送。'})
 el('new-chat').addEventListener('click',async()=>{if(busy){el('status').textContent='請先停止這次讀取，再開新對話。';return}if(!topic)return;generation++;clearWork();if(job?.state==='awaiting_consent'){try{await rpc({op:'cancel',id:job.id})}catch(e){error(e);return}}try{await topicWrites;await chrome.storage.local.remove(topic.key)}catch{el('status').textContent='本機對話狀態未清除，請稍後再試。';return}topicRecord={headId:null,title:'',draft:'',mode:'auto_context'};el('coverage-mode').value='auto_context';job=null;capture=null;el('recover').hidden=true;el('cancel').hidden=true;el('messages').replaceChildren();el('answer').hidden=true;el('preview').hidden=true;el('welcome').hidden=false;el('question').value='';el('question').readOnly=false;el('coverage-mode').disabled=false;el('context-chip').textContent=el('coverage-mode').value==='task_only'?'任務 · 不讀取網頁':'尚未加入網頁內容';el('status').textContent=''})
 const restoreVersion=generation;el('prepare').disabled=true
 ;(async()=>{try{const params=new URL(location.href).searchParams;const context=params.has('tabId')?{type:'context'}:{type:'context',windowId:(await chrome.windows.getCurrent()).id};topic=await send(context);if(!/^browser-topic:[a-f0-9-]{36}$/.test(topic.key)||!Number.isSafeInteger(topic.tabId)||!Number.isSafeInteger(topic.windowId))throw Error('conversation_unavailable');const value=await chrome.storage.local.get(topic.key);if(restoreVersion!==generation)return;if(value[topic.key])topicRecord={...topicRecord,...value[topic.key]};el('question').value=topicRecord.draft;el('coverage-mode').value=topicRecord.mode;if(topicRecord.headId){const r=await rpc({op:'get',id:topicRecord.headId});if(restoreVersion===generation&&!busy){present(r);await restorePending(r)}}}catch(e){error(e)}finally{el('prepare').disabled=!topic||busy;el('client-update').disabled=!topic}})()
